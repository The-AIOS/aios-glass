import * as vscode from 'vscode';
import { AiosCommand, discoverCommands, expandHome, resolveCommandsDir } from '../aios/commands';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { listRunningAgents } from '../agents/running';
import { discoverAgents, iconForAgent } from '../agents/agents';
import { primaryName } from '../home/vault';

/**
 * The core "glass" mechanic: a click launches an existing AIOS command via
 * native Claude. We trigger the engine; we never reimplement it.
 *
 * Terminal model:
 *  - In-session actions (commands, skills) honor `aiosGlass.terminalMode`:
 *      · ask    → pick a terminal each time (existing ones, or a new one)
 *      · active → use the focused terminal (assumed to have a live Claude)
 *    A NEW terminal runs `claude "/slash"`; an EXISTING/active terminal gets
 *    the bare `/slash` typed into the Claude session already running there.
 *  - Always-new actions (spawn agent, spawn worker, resume, builder, auth)
 *    always open a fresh terminal and run the full shell command.
 */

const TERM_NAME = 'AIOS · Claude';

function frameworkRoot(): string | undefined {
  const dir = resolveCommandsDir();
  if (dir) return path.resolve(dir, '..', '..', '..');
  const configured = vscode.workspace.getConfiguration('aiosGlass').get<string>('frameworkPath', '~/aios');
  return configured ? expandHome(configured) : undefined;
}

/**
 * Per-action terminal styling. `icon` is a codicon id (or our contributed
 * `aios-mark`); `color` is a `terminal.ansi*` ThemeColor id — VS Code only
 * allows terminal tab colors from the ANSI palette, not arbitrary hex, so the
 * brand palette lives in the Home webview (the status dots) while terminal
 * tabs get a recognizable-but-themed tint per action type.
 */
export interface TermStyle { name?: string; icon?: string; color?: string; }

function newTerminal(style?: TermStyle): vscode.Terminal {
  return vscode.window.createTerminal({
    name: style?.name || TERM_NAME,
    cwd: frameworkRoot(),
    iconPath: style?.icon ? new vscode.ThemeIcon(style.icon) : undefined,
    color: style?.color ? new vscode.ThemeColor(style.color) : undefined,
  });
}

function claudeBin(): string {
  return vscode.workspace.getConfiguration('aiosGlass').get<string>('claudeCommand', 'claude') || 'claude';
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Resolve the target terminal for an in-session action (ask/active). `style`
 *  names/icons a NEW terminal if one is created (existing terminals keep theirs). */
async function pickTarget(style?: TermStyle): Promise<{ terminal: vscode.Terminal; isNew: boolean } | undefined> {
  const mode = vscode.workspace.getConfiguration('aiosGlass').get<string>('terminalMode', 'ask');

  if (mode === 'active') {
    const t = vscode.window.activeTerminal;
    return t ? { terminal: t, isNew: false } : { terminal: newTerminal(style), isNew: true };
  }

  // ask
  const NEW = '＋ New terminal';
  const names = vscode.window.terminals.map((t) => t.name);
  const choice = await vscode.window.showQuickPick([NEW, ...names], {
    title: 'Run in…', placeHolder: 'Pick a terminal'
  });
  if (choice === undefined) return undefined;
  if (choice === NEW) return { terminal: newTerminal(style), isNew: true };
  const existing = vscode.window.terminals.find((t) => t.name === choice);
  return existing ? { terminal: existing, isNew: false } : { terminal: newTerminal(style), isNew: true };
}

/**
 * Run a slash command in-session. A new terminal (or an existing one with no
 * live Claude) launches `claude "/slash"`; an existing terminal that already
 * has a Claude session gets the bare `/slash` typed into it. We detect a live
 * Claude by scanning the terminal's shell process tree.
 */
async function runInSession(slash: string, style?: TermStyle): Promise<void> {
  const target = await pickTarget(style);
  if (!target) return;
  target.terminal.show(true);
  const hasClaude = target.isNew ? false : await terminalHasClaude(target.terminal);
  if (hasClaude) {
    target.terminal.sendText(slash);
    return;
  }
  // New Claude session. Name it (--name) when the style carries a clean session
  // token, so the session shows correctly in Glass's running list — session name
  // = terminal name. (No --remote-control: governed globally by settings.json.)
  const n = style?.name;
  // A *new* terminal was already named at creation. When we're reusing an
  // existing (Claude-less) terminal, rename its tab to match — we just show()'d
  // it so it's the active terminal, which is what renameWithArg acts on.
  if (!target.isNew && n) {
    try { await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: n }); } catch { /* command unavailable — best effort */ }
  }
  const nameArg = n && /^[a-z0-9][a-z0-9-]*$/.test(n) ? `--name ${n} ` : '';
  target.terminal.sendText(`${claudeBin()} ${nameArg}${shellQuote(slash)}`);
}

/** True if a `claude` process is a descendant of the terminal's shell. */
export async function terminalHasClaude(terminal: vscode.Terminal): Promise<boolean> {
  const shellPid = await terminal.processId;
  if (!shellPid) return false;
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const childrenOf = new Map<number, number[]>();
      const exeOf = new Map<number, string>();
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        exeOf.set(pid, m[3].split(/\s+/)[0]);
        if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
        childrenOf.get(ppid)!.push(pid);
      }
      // Check the shell process itself, then walk its descendants.
      if (path.basename(exeOf.get(shellPid) ?? '') === 'claude') return resolve(true);
      const stack = [shellPid];
      const seen = new Set<number>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const child of childrenOf.get(cur) ?? []) {
          if (path.basename(exeOf.get(child) ?? '') === 'claude') return resolve(true);
          stack.push(child);
        }
      }
      resolve(false);
    });
  });
}

/** Run a full shell command line in a fresh terminal (always-new actions). */
function runNew(cmdline: string, style?: TermStyle): void {
  const t = newTerminal(style);
  t.show(true);
  t.sendText(cmdline);
}

// ── In-session actions (ask/active) ───────────────────────────────────────

/** Run an AIOS ritual; prompts for args first if the command declares an argument-hint. */
export async function runRitual(command: AiosCommand): Promise<void> {
  let slash = `/aios:${command.name}`;
  if (command.argumentHint) {
    const arg = await vscode.window.showInputBox({
      title: `/aios:${command.name}`,
      prompt: `Arguments (optional) — ${command.argumentHint}`,
      placeHolder: command.argumentHint,
      ignoreFocusOut: true
    });
    if (arg === undefined) return;
    if (arg.trim()) slash += ` ${arg.trim()}`;
  }
  await runInSession(slash, { name: command.name, icon: 'play', color: 'terminal.ansiBlue' });
}

/** Launch /aios:<name> directly (no arg prompt) — used by Home cards. A NEW
 *  terminal+session is named for the command unless the caller overrides `style`. */
export async function launchAios(name: string, args?: string, style?: TermStyle): Promise<void> {
  await runInSession(
    `/aios:${name}${args ? ` ${args}` : ''}`,
    style ?? { name, icon: 'play', color: 'terminal.ansiBlue' }
  );
}

/** Run free-form text in-session (Terminal-Control-aware). Used by "None" /
 *  prompt-style frequent tasks. */
export async function launchInSession(text: string, style?: TermStyle): Promise<void> {
  await runInSession(text, style);
}

/**
 * Invoke a skill in-session. Uses a natural-language instruction (not a raw
 * `/slash`) because slash-skill resolution only happens in the interactive
 * REPL, not from a CLI initial-prompt arg — NL works in both cases.
 */
export async function launchSkill(name: string, context?: string, style?: TermStyle): Promise<void> {
  await runInSession(
    `Use the ${name} skill.${context && context.trim() ? ' ' + context.trim() : ''}`,
    style ?? { name, icon: 'sparkle', color: 'terminal.ansiBlue' }
  );
}

/**
 * Run a slash in the PRIMARY session (/today, /close-day belong to it).
 * Targets the primary's terminal if it's live here; otherwise falls back to the
 * normal Terminal-Control routing (which can start a fresh session).
 */
export async function runInPrimarySession(slash: string): Promise<void> {
  const name = primaryName();
  if (name) {
    const live = (await listRunningAgents()).find((a) => a.name === name);
    if (live) {
      const t = await findAgentTerminal(name, live.pid);
      if (t) { t.show(true); t.sendText(slash); return; }
    }
  }
  await runInSession(slash, { name: slash.replace(/^\/aios:/, '').split(' ')[0], icon: 'play', color: 'terminal.ansiBlue' });
}

/**
 * Run a slash ONLY in an existing live-Claude session — never a new terminal.
 * Used by /close-session: you can't close a session that isn't running. Prefers
 * the active terminal; disambiguates if several Claude sessions are live.
 */
export async function runInActiveClaude(slash: string): Promise<void> {
  const active = vscode.window.activeTerminal;
  if (active && (await terminalHasClaude(active))) { active.show(true); active.sendText(slash); return; }

  const claudeTerms: vscode.Terminal[] = [];
  for (const t of vscode.window.terminals) {
    if (await terminalHasClaude(t)) claudeTerms.push(t);
  }
  if (claudeTerms.length === 1) { claudeTerms[0].show(true); claudeTerms[0].sendText(slash); return; }
  if (claudeTerms.length > 1) {
    const pick = await vscode.window.showQuickPick(
      claudeTerms.map((t) => ({ label: t.name, t })),
      { title: 'Close which session?', placeHolder: 'Pick the Claude session to close' }
    );
    if (!pick) return;
    pick.t.show(true);
    pick.t.sendText(slash);
    return;
  }
  void vscode.window.showInformationMessage('AIOS Glass: no live Claude session to close. Open or focus the session you want to close, then try again.');
}

/** Quick-pick across all commands, then run the chosen one. */
export async function runRitualPicker(): Promise<void> {
  const cmds = discoverCommands();
  const pick = await pickWithAsk(
    cmds.map((c) => ({ label: `/aios:${c.name}`, description: c.cadence, detail: c.description, cmd: c })),
    { title: 'Run an AIOS command', placeHolder: 'Pick a command — or type what you need', matchOnDetail: true }
  );
  if (pick) await runRitual(pick.cmd);
}

// ── Always-new actions ────────────────────────────────────────────────────

/** Spawn a named worker via the spawn wrapper (always a fresh terminal). */
export async function launchSpawn(name: string, task?: string): Promise<void> {
  // Icon comes from the agent's own context (declared frontmatter `icon:`, else
  // inferred from its name/group/description) — so `lawyer` gets ⚖, `accountant`
  // a graph, etc. Builder keeps a distinct amber tab.
  const agent = discoverAgents().find((a) => a.name === name);
  const icon = iconForAgent(agent ?? { name });
  const color = name === 'aios-builder' ? 'terminal.ansiYellow' : 'terminal.ansiCyan';
  runNew(`spawn ${name}${task && task.trim() ? ` ${shellQuote(task.trim())}` : ''}`, { name, icon, color });
}

/**
 * Dispatch a COMMAND-routed task (e.g. `/aios:ingest <url>`) in its OWN fresh
 * terminal+session — the command-shaped sibling of {@link launchSpawn}. Some
 * "Agents can handle" tasks route to a `/command` (ingests especially) rather
 * than a named `[[agent]]`; go-with-agents dispatches those here so they get the
 * same one-terminal-per-task treatment. Named (`--name`) from the task label when
 * it reduces to a clean token, so it shows in the Running list; the source `arg`
 * (a URL) is appended to the slash. Flag-with-value before the prompt is safe
 * (`--name` takes its value, the slash is the positional initial-prompt).
 */
export async function launchCommandInNewSession(command: string, arg?: string, label?: string): Promise<void> {
  const slash = `${command}${arg && arg.trim() ? ` ${arg.trim()}` : ''}`;
  const base = (label || command.replace(/^\/(?:aios:)?/, ''))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = base && /^[a-z0-9]/.test(base) ? base.slice(0, 28).replace(/-+$/, '') : '';
  const nameArg = name ? `--name ${name} ` : '';
  runNew(`${claudeBin()} ${nameArg}${shellQuote(slash)}`, { name: name || 'AIOS', icon: 'play', color: 'terminal.ansiCyan' });
}

/**
 * Launch the primary session: if it's already running, focus it; otherwise run
 * the named primary wrapper in a fresh terminal to begin everything.
 */
export async function launchPrimary(name: string): Promise<void> {
  const running = await listRunningAgents();
  if (running.some((a) => a.name === name)) {
    await revealAgentTerminal(name);
    return;
  }
  runNew(name, { name, icon: 'aios-mark', color: 'terminal.ansiMagenta' });
}

/** Resume a Claude conversation — always a new terminal with the session picker. */
/**
 * Resume picker. The operator picks the session INSIDE Claude's TUI, so Glass
 * can't name the terminal up front — but once picked, the session registers in
 * `~/.claude/sessions` with its real name and its pid descends from this
 * terminal's shell. Poll for that match and adopt the name as the terminal name
 * too. Best-effort vanity: renameWithArg only acts on the ACTIVE terminal, so we
 * rename the moment the match lands while the operator is still in it (retrying
 * while they are elsewhere); give up silently after 3 min or on terminal close.
 */
export async function launchResume(): Promise<void> {
  const t = newTerminal({ name: 'resume', icon: 'history', color: 'terminal.ansiBlue' });
  t.show(true);
  t.sendText(`${claudeBin()} --resume`);

  const shellPid = await t.processId;
  if (!shellPid) return;
  let closed = false;
  const sub = vscode.window.onDidCloseTerminal((x) => { if (x === t) { closed = true; sub.dispose(); } });
  const started = Date.now();

  const tick = async (): Promise<void> => {
    if (closed || Date.now() - started > 180000) { sub.dispose(); return; }
    try {
      const agents = await listRunningAgents();
      const ppidOf = await getPpidMap();
      for (const a of agents) {
        if (!a.name || a.name === '(unnamed)') continue;
        // Walk the session pid's ancestry — if it passes through our shell, it's
        // the session the operator just resumed in this terminal.
        let cur = a.pid;
        let ours = false;
        for (let i = 0; i < 64; i++) {
          if (cur === shellPid) { ours = true; break; }
          const pp = ppidOf.get(cur);
          if (pp === undefined || pp <= 1) break;
          cur = pp;
        }
        if (ours) {
          if (vscode.window.activeTerminal === t) {
            try { await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: a.name }); } catch { /* best effort */ }
            sub.dispose();
            return;
          }
          break; // matched but terminal not active — retry next tick
        }
      }
    } catch { /* best effort */ }
    setTimeout(() => { void tick(); }, 2000);
  };
  setTimeout(() => { void tick(); }, 3000);
}

/** Kill a running spawned worker via spawn-kill. */
export async function launchKill(name: string): Promise<void> {
  runNew(`spawn-kill ${name}`, { name: `kill ${name}`, icon: 'trash', color: 'terminal.ansiRed' });
}

/** pid → ppid map from `ps`, for walking the process tree. */
function getPpidMap(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 }, (err, out) => {
      const m = new Map<number, number>();
      if (!err && out) {
        for (const line of out.split('\n')) {
          const mm = line.trim().match(/^(\d+)\s+(\d+)$/);
          if (mm) m.set(Number(mm[1]), Number(mm[2]));
        }
      }
      resolve(m);
    });
  });
}

/**
 * Reveal a running worker's integrated terminal. Matches by PROCESS TREE
 * (rename-proof): finds the integrated terminal whose shell is an ancestor of
 * the agent's claude PID. (Renaming a tab doesn't update VS Code's
 * `terminal.name`, so name-matching misses spawned workers.)
 */
async function findAgentTerminal(name: string, pid?: number): Promise<vscode.Terminal | undefined> {
  if (pid) {
    const ppidOf = await getPpidMap();
    const ancestors = new Set<number>([pid]);
    let cur = pid;
    for (let i = 0; i < 256; i++) {
      const pp = ppidOf.get(cur);
      if (pp === undefined || pp === 0 || pp === 1) break;
      ancestors.add(pp);
      cur = pp;
    }
    for (const t of vscode.window.terminals) {
      const sp = await t.processId;
      if (sp && ancestors.has(sp)) return t;
    }
  }
  // Fallback: name match in this window.
  return vscode.window.terminals.find((t) => t.name === name || t.name.includes(name));
}

export async function revealAgentTerminal(name: string, pid?: number): Promise<void> {
  const t = await findAgentTerminal(name, pid);
  if (t) { t.show(false); return; }
  void vscode.window.showInformationMessage(`AIOS Glass: "${name}" isn't a terminal in this window — it may be running in another window.`);
}

/**
 * Run /aios:close-session in a specific running session's terminal — captures the
 * session (daily-note block / project report) BEFORE you kill it, so the work
 * isn't lost. Reveals + focuses the terminal (close-session is interactive — it
 * asks for a label etc.) and sends the command into its live Claude. Falls back to
 * a notice if it isn't an integrated terminal in this window.
 */
export async function closeSessionInTerminal(name: string, pid?: number): Promise<void> {
  const t = await findAgentTerminal(name, pid);
  if (t) { t.show(); t.sendText('/aios:close-session'); return; }
  void vscode.window.showInformationMessage(`AIOS Glass: "${name}" isn't a terminal in this window — open it there to run /aios:close-session.`);
}

/**
 * Interrupt a running session — send Esc to its terminal, exactly like pressing
 * Escape, stopping Claude mid-task. Doesn't steal focus (the row's status dot
 * flips busy→idle on the next poll). No-op-with-notice if it's not in this window.
 */
export async function interruptSessionTerminal(name: string, pid?: number): Promise<void> {
  const t = await findAgentTerminal(name, pid);
  if (t) { t.sendText('\u001b', false); return; } // ESC, no newline
  void vscode.window.showInformationMessage(`AIOS Glass: "${name}" isn't a terminal in this window.`);
}

/**
 * Close a running session's terminal — like clicking the IDE terminal's trash.
 * Disposing the terminal SIGHUPs the shell + its children (claude + respawn
 * loop), so it stops cleanly. Falls back to `spawn-kill` only when the session
 * isn't an integrated terminal in this window (e.g. another window / machine).
 */
export async function disposeAgentTerminal(name: string, pid?: number): Promise<void> {
  const t = await findAgentTerminal(name, pid);
  if (t) { t.dispose(); return; }
  runNew(`spawn-kill ${name}`, { name: `kill ${name}`, icon: 'trash', color: 'terminal.ansiRed' });
}

/** Launch native Claude with a natural-language prompt — fresh terminal. */
export async function launchPrompt(text: string): Promise<void> {
  runNew(`${claudeBin()} ${shellQuote(text)}`, { name: 'AIOS', icon: 'aios-mark' });
}

/**
 * "Ask AIOS" — route a natural-language intent to a FRESH session that finds and
 * runs the best-matching AIOS action (agent / command / skill / task). Claude is
 * the semantic engine; Glass just hands it the words. Terminal + session are
 * named from the intent (e.g. `ask-social-media`) so the Running list reads
 * what it's about.
 */
export function askAios(intent: string): void {
  const t = intent.trim();
  if (!t) return;
  // Name from the intent's CONTENT words, not its filler — "i need a social
  // media strategy" → ask-social-media-strategy, not ask-i-need-a-social-….
  const STOP = new Set(['i', 'a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'at', 'by', 'my', 'me', 'our', 'we', 'us', 'you', 'your', 'it', 'is', 'are', 'am', 'and', 'or', 'with', 'about', 'need', 'needs', 'want', 'wants', 'please', 'can', 'could', 'should', 'would', 'like', 'help', 'make', 'create', 'do', 'get', 'give', 'let', 'lets', 'some', 'this', 'that', 'new', 'have', 'has']);
  const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const core = (words.length ? words : ['intent']).slice(0, 3).join('-');
  const name = ('ask-' + core).slice(0, 28).replace(/-+$/, '');
  const prompt =
    `Find the right AIOS action for this intent and run it: "${t}". ` +
    `Search my agents, /aios: commands, skills, and frequent tasks; pick the best match, ` +
    `tell me in one line which you chose and why, then execute it. If nothing fits, say so and suggest the 2-3 closest options.`;
  runNew(`${claudeBin()} --name ${name} ${shellQuote(prompt)}`, { name, icon: 'sparkle', color: 'terminal.ansiYellow' });
}

/**
 * QuickPick wrapper with the "Ask AIOS" fallback: whatever's typed becomes an
 * alwaysShow ask-item, so a search that matches nothing still resolves — Claude
 * picks the action by MEANING instead of the picker's lexical fuzzy match.
 * Resolves the chosen item, or undefined (cancelled / routed to Ask AIOS).
 */
export function pickWithAsk<T extends vscode.QuickPickItem>(
  items: T[],
  opts: { title?: string; placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }
): Promise<T | undefined> {
  type AskItem = vscode.QuickPickItem & { __ask?: boolean };
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<T | AskItem>();
    qp.title = opts.title;
    qp.placeholder = opts.placeHolder;
    qp.matchOnDescription = !!opts.matchOnDescription;
    qp.matchOnDetail = !!opts.matchOnDetail;
    let done = false;
    const finish = (val: T | undefined) => { if (!done) { done = true; resolve(val); } qp.hide(); };
    // ONE stable Ask item (no echoed value — the input box already shows what you
    // typed). Appended only while there's a query, and ONLY when that query toggles
    // empty↔typed — never per keystroke. (Reassigning qp.items on each character
    // resets the highlighted row and makes native filtering flicker — the glitch.)
    const askItem: AskItem = { label: '$(sparkle) Ask AIOS with what you typed', description: 'no exact match? — Claude matches your ask to the right context & tools and runs it', alwaysShow: true, __ask: true };
    qp.items = items;
    let hasQuery = false;
    qp.onDidChangeValue((v) => {
      const now = v.trim().length > 0;
      if (now === hasQuery) return;
      hasQuery = now;
      qp.items = now ? [...items, askItem] : items;
    });
    qp.onDidAccept(() => {
      const s = qp.selectedItems[0] as (T & AskItem) | undefined;
      if (s && s.__ask) { const v = qp.value.trim(); finish(undefined); if (v) askAios(v); return; }
      finish(s as T | undefined);
    });
    qp.onDidHide(() => { if (!done) { done = true; resolve(undefined); } qp.dispose(); });
    qp.show();
  });
}

/** Run a bare claude subcommand (e.g. `auth login`) in a fresh, named terminal. */
export async function launchClaude(subcommand: string): Promise<void> {
  const tag = subcommand.split(/\s+/)[0] || 'claude'; // e.g. "auth"
  runNew(`${claudeBin()} ${subcommand}`, { name: tag, icon: 'account', color: 'terminal.ansiWhite' });
}

/**
 * Silent account swap — runs `claude-identity.sh switch <email>` HEADLESSLY (no
 * terminal): it swaps the Keychain creds + ~/.claude.json oauthAccount in place,
 * logs to ~/.claude/swap-log.jsonl, and the statusline (context-monitor.py)
 * shows the swap banner for its TTL. Nothing restarts; in-session work continues.
 */
export async function launchAccountSwap(email: string): Promise<void> {
  const root = frameworkRoot();
  if (!root) { void vscode.window.showWarningMessage('AIOS Glass: framework path not found — cannot swap account.'); return; }
  const script = path.join(root, 'hooks', 'claude-identity', 'claude-identity.sh');
  const claudeJson = path.join(os.homedir(), '.claude.json');
  const readAccount = (): string => {
    try { return JSON.parse(fs.readFileSync(claudeJson, 'utf8'))?.oauthAccount?.emailAddress || ''; } catch { return ''; }
  };
  const fromEmail = readAccount(); // outgoing account, for the statusline banner
  return new Promise((resolve) => {
    execFile('bash', [script, 'switch', email], { timeout: 20000 }, (err, _out, stderr) => {
      if (err) { void vscode.window.showWarningMessage(`AIOS Glass: account swap failed — ${(stderr || err.message).slice(0, 160)}`); return resolve(); }
      // The manual `switch` only logs; write the swap-notification marker the
      // statusline (context-monitor.py) reads, so the swap banner shows for its
      // TTL — exactly what the autopilot (_watch.py) does after its swaps.
      try {
        fs.writeFileSync(
          path.join(os.homedir(), '.claude', 'swap-notification.json'),
          JSON.stringify({ from: fromEmail, to: readAccount() || email, ts: Math.floor(Date.now() / 1000), reason: 'manual (AIOS Glass)' })
        );
      } catch { /* banner is best-effort */ }
      vscode.window.setStatusBarMessage(`$(arrow-swap) Swapped to ${email}`, 5000);
      resolve();
    });
  });
}
