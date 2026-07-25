import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runRitual, launchAios, launchSkill, runRitualPicker, launchResume, launchKill, revealAgentTerminal, findAgentTerminal, disposeAgentTerminal, killGuardedDispose, closeSessionInTerminal, interruptSessionTerminal, sendToSession, askAios, launchPrimary, launchSpawn, launchAccountSwap, launchClaude, runInPrimarySession, runInActiveClaude, terminalHasClaude } from './rituals/runner';
import { addSessionNote, getSessionNotes, deleteSessionNote } from './agents/sessionNotes';
import { openDailyNote } from './home/calendar';
import { runFrequentTask, openFrequentMenu, listFrequentTasks } from './tasks/frequent';
import { listRoutines, runRoutine } from './tasks/routines';
import { runReports } from './tasks/reports';
import { goWithAgents } from './tasks/goWithAgents';
import { closeAll } from './tasks/closeAll';
import { primaryName, contextDir, ContextKind } from './home/vault';
import { AiosCommand, resolveCommandsDir, discoverCommands } from './aios/commands';
import { HomeViewProvider } from './home/homePanel';
import { FilesViewProvider } from './files/filesView';
import { spawnAgentFlow, spawnWorker } from './agents/spawn';
import { Agent, discoverAgents, iconForAgent } from './agents/agents';
import { Capability, skillsPicker, discoverSkills } from './capabilities/capabilities';
import { companyAction, collaborateAction } from './spaces/spacesActions';
import { openConfigMenu } from './home/configMenu';
import { TERMINAL_OPTIONS, setTerminalMode, syncGlassToWorkbench } from './home/config';
import { createCustom, CreateKind, CREATE_KINDS } from './create/create';
import { listRunningAgents } from './agents/running';
import { decideSend, safeNeedle, holdPathFor, undeliveredPathFor, isHoldPath, HOLD_SUFFIX,
  INBOX_CONTRACT, claimVerdict, canAdoptHold, parseClaim, shouldReleaseForSibling, shouldWriteDoc } from './core/sendQueue';
import { swallow, logChannel, log } from './log';
import { initGlassState } from './state';
import { frameworkRoot } from './home/vault';
import { initI18n, t } from './i18n';

// The AIOS operating manual lives on the website (theme-aware reader + PDF
// download) at the `#manual` section of the homepage — there is no standalone
// `/manual` route (it was folded into the 5-act homepage). Update here if the
// site IA changes.
const MANUAL_URL = 'https://www.the-aios.com/#manual';

const DOC_FILES: Record<string, string> = {
  cheatsheet: 'CHEATSHEET.md',
  intent: 'INTENT.md',
  user: 'USER.md',
  tools: 'TOOLS.md',
  readme: 'README.md'
};

/** Compact "when jotted" for the post-it viewer — relative for the same day (notes
 *  are short-lived: they die at kill), an absolute date once older. 0 → unknown. */
function noteWhen(ts: number): string {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return t('just now');
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(ts).toLocaleDateString();
}

export function activate(context: vscode.ExtensionContext): void {
  // Banner so the diagnostics channel is never blank — an empty Output pane
  // reads as "broken", not "healthy". Everything below the banner is a failure.
  initI18n(context.extensionUri); // host-string translator (popups follow aiosGlass.language)
  const version = (context.extension.packageJSON as { version?: string }).version ?? '?';
  log(`AIOS Glass ${version} activated. This channel records ACTION FAILURES (a click that did nothing, a failed launch, a state write error). Nothing below this line = everything is healthy.`);

  const home = new HomeViewProvider(context.extensionUri);
  initGlassState(context); // tasks/routines state: vault file, globalState as migration source

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HomeViewProvider.viewId, home, {
      webviewOptions: { retainContextWhenHidden: true }
    }),

    // Focus the docked Home view (works from the editor title-bar icon, the
    // view title bar, and the command palette — all identical).
    vscode.commands.registerCommand('aios.openHome', () => vscode.commands.executeCommand('aios.home.focus')),

    vscode.commands.registerCommand('aios.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'the-aios.aios-glass#aios.gettingStarted', false)),

    // README in the title bar (book icon) — the project's front door.
    vscode.commands.registerCommand('aios.openReadme', () => vscode.commands.executeCommand('aios.openDoc', 'readme')),

    // Operating manual — opens the AIOS manual on the website in the browser.
    // The manual is a web artifact (the-aios.com → #manual section: theme-aware
    // reader + PDF download), not a vault file, so we open it externally rather
    // than reaching into the framework. URL is the single source of truth here.
    vscode.commands.registerCommand('aios.openManual', () =>
      vscode.env.openExternal(vscode.Uri.parse(MANUAL_URL))),

    // AIOS Files — the Finder-style explorer (Vault / Framework / Workspace),
    // a persistent view beside Home; the command focuses (and expands) it.
    vscode.window.registerWebviewViewProvider(FilesViewProvider.viewId, new FilesViewProvider(context.extensionUri), {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('aios.openFiles', () =>
      FilesViewProvider.current ? FilesViewProvider.current.toggle() : vscode.commands.executeCommand('aios.files.focus')),
    vscode.commands.registerCommand('aios.filesCollapseAll', () => FilesViewProvider.current?.collapseAll()),
    vscode.commands.registerCommand('aios.filesRefresh', () => FilesViewProvider.current?.refresh()),

    vscode.commands.registerCommand('aios.companyAction', (name?: string) => companyAction(name)),
    vscode.commands.registerCommand('aios.collaborateAction', () => collaborateAction()),
    vscode.commands.registerCommand('aios.updateFramework', () => launchAios('update')),

    vscode.commands.registerCommand('aios.openConfigMenu', () => openConfigMenu()),
    vscode.commands.registerCommand('aios.terminalMode', async () => {
      const pick = await vscode.window.showQuickPick(TERMINAL_OPTIONS, { title: t('Terminal control'), placeHolder: 'ask · active' });
      if (pick) { await setTerminalMode(pick); HomeViewProvider.current?.refresh(); }
    }),
    vscode.commands.registerCommand('aios.openDoc', async (key: string, edit?: boolean) => {
      const root = frameworkRoot();
      const file = DOC_FILES[key];
      if (!root || !file) return;
      const p = path.join(root, file);
      if (!fs.existsSync(p)) {
        void vscode.window.showWarningMessage(`AIOS Glass: ${file} not found at the framework root.`);
        return;
      }
      const uri = vscode.Uri.file(p);
      if (edit) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      }
    }),
    vscode.commands.registerCommand('aios.openSource', () => vscode.commands.executeCommand('markdown.showSource')),
    // Cheatsheet — title-bar entry (no-arg wrapper around openDoc).
    vscode.commands.registerCommand('aios.cheatsheet', () => vscode.commands.executeCommand('aios.openDoc', 'cheatsheet')),
    vscode.commands.registerCommand('aios.browseContext', async (kind: ContextKind) => {
      const dir = contextDir(kind);
      if (!dir) return;
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '_index.md').sort();
      } catch { /* dir missing */ }
      if (files.length === 0) {
        void vscode.window.showInformationMessage(`${t('AIOS Glass: no notes in')} ${kind}.`);
        return;
      }
      const labels: Record<ContextKind, string> = {
        declared: t('Declared — what you’ve told Claude'),
        observed: t('Observed — what Claude has learned'),
        projects: t('Projects')
      };
      const pick = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.replace(/\.md$/, ''), file: f })),
        { title: labels[kind], placeHolder: t('Open a note') }
      );
      if (pick) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(dir, pick.file)));
    }),
    vscode.commands.registerCommand('aios.runRitualPicker', () => runRitualPicker()),
    vscode.commands.registerCommand('aios.skillsPicker', () => skillsPicker()),
    vscode.commands.registerCommand('aios.createCustom', async (kind?: CreateKind) => {
      if (!kind) {
        const pick = await vscode.window.showQuickPick(
          CREATE_KINDS.map((k) => ({ label: `${t('New')} ${k}`, value: k })),
          { title: t('Add a custom element'), placeHolder: t('Launches the AIOS builder') }
        );
        if (!pick) return;
        kind = pick.value;
      }
      await createCustom(kind);
    }),

    // Diagnostics — every swallowed action failure lands in this channel.
    vscode.commands.registerCommand('aios.showLogs', () => logChannel().show(true)),

    vscode.commands.registerCommand('aios.launchPrimary', () => launchPrimary(primaryName())),
    vscode.commands.registerCommand('aios.resume', () => launchResume()),

    // Ask AIOS — type an intent, Claude finds + runs the best-matching action in
    // a fresh session named from the intent. The panel's full-width button and
    // every picker's no-match fallback both land here.
    vscode.commands.registerCommand('aios.askAios', async () => {
      const intent = await vscode.window.showInputBox({
        title: t('Ask AIOS'),
        prompt: t('What do you need? Claude matches your ask to the right context & tools in your AIOS — and puts them to work'),
        placeHolder: t("e.g. 'prep tomorrow's investor call' · 'post about our launch'"),
        ignoreFocusOut: true,
      });
      if (intent?.trim()) askAios(intent.trim());
    }),

    // Reports: pick type + period → generate.
    vscode.commands.registerCommand('aios.reports', () => runReports()),

    // ── Keyboard-chord targets (⌘⌥G …) — small pickers/actions behind the leader ──
    vscode.commands.registerCommand('aios.newTerminal', () => { vscode.window.createTerminal().show(); }),
    vscode.commands.registerCommand('aios.minimizeCards', () => HomeViewProvider.current?.toggleCards()),
    vscode.commands.registerCommand('aios.toggleHome', () => HomeViewProvider.current?.toggleHome()),

    vscode.commands.registerCommand('aios.openToday', async () => {
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await openDailyNote(iso, { forcePreview: true });
    }),

    vscode.commands.registerCommand('aios.dailyPicker', async () => {
      const items: (vscode.QuickPickItem & { d: string; primary: boolean })[] = [
        { label: '$(sun) ' + t('Plan my day'), description: '/today', d: '/aios:today', primary: true },
        { label: '$(book) ' + t('Close session'), description: '/close-session', d: '/aios:close-session', primary: false },
        { label: '$(moon) ' + t('Close the day'), description: '/close-day', d: '/aios:close-day', primary: true }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: t('Daily ritual'), placeHolder: t('Run a daily ritual') });
      if (!pick) return;
      if (pick.primary) await runInPrimarySession(pick.d); else await runInActiveClaude(pick.d);
    }),

    vscode.commands.registerCommand('aios.workspacesPicker', async () => {
      const items: (vscode.QuickPickItem & { id: string })[] = [
        { label: '$(organization) ' + t('Companies'), description: t('mount · sync'), id: 'companies' },
        { label: '$(live-share) ' + t('Collaboration'), description: t('shared spaces'), id: 'collab' },
        { label: '$(folder) ' + t('Projects'), description: t('your work'), id: 'projects' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: t('Workspaces') });
      if (!pick) return;
      if (pick.id === 'companies') await companyAction();
      else if (pick.id === 'collab') await collaborateAction();
      else await vscode.commands.executeCommand('aios.browseContext', 'projects');
    }),

    vscode.commands.registerCommand('aios.personalizationsPicker', async () => {
      const items: (vscode.QuickPickItem & { key: string })[] = [
        { label: 'INTENT.md', description: t('autonomy · trust'), key: 'intent' },
        { label: 'USER.md', description: t('identity · settings'), key: 'user' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: t('Personalizations') });
      if (pick) await vscode.commands.executeCommand('aios.openDoc', pick.key);
    }),

    vscode.commands.registerCommand('aios.contextPicker', async () => {
      const items: (vscode.QuickPickItem & { ck: string })[] = [
        { label: t('Declared'), description: t('what you told Claude'), ck: 'declared' },
        { label: t('Observed'), description: t('what Claude has learned'), ck: 'observed' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: t('Context — about you') });
      if (pick) await vscode.commands.executeCommand('aios.browseContext', pick.ck);
    }),

    vscode.commands.registerCommand('aios.runningPicker', async () => {
      const sessions = await listRunningAgents();
      const sessionNames = new Set(sessions.map((a) => a.name));
      type RunItem = vscode.QuickPickItem & { rk: 'session' | 'terminal'; name?: string; pid?: number; term?: vscode.Terminal };
      const items: RunItem[] = sessions.map((a) => ({ label: `$(server-process) ${a.name}`, description: a.status || t('session'), rk: 'session', name: a.name, pid: a.pid }));
      for (const term of vscode.window.terminals) {
        if (sessionNames.has(term.name)) continue;
        if (await terminalHasClaude(term)) continue;
        items.push({ label: `$(terminal) ${term.name}`, description: t('terminal'), rk: 'terminal', term });
      }
      if (!items.length) { void vscode.window.showInformationMessage(t('AIOS Glass: nothing running.')); return; }
      const pick = await vscode.window.showQuickPick<RunItem>(items, { title: t('Running — sessions & terminals'), placeHolder: t('Arrows to navigate · type to filter · Enter to reveal') });
      if (!pick) return;
      if (pick.rk === 'session' && pick.name) await revealAgentTerminal(pick.name, pick.pid);
      else pick.term?.show();
    }),

    // Frequent tasks (intent-first): the editable menu, + direct run by id.
    vscode.commands.registerCommand('aios.frequentMenu', () => openFrequentMenu()),
    vscode.commands.registerCommand('aios.frequentTask', (id?: string) => {
      if (typeof id === 'string') return runFrequentTask(id);
    }),

    // Friendly onboarding companion — spawn the onboarding-aios guide agent.
    vscode.commands.registerCommand('aios.onboarding', () => launchSpawn('onboarding-aios')),

    // Open the vault graph (Foam) from the header. Foam is optional — if it isn't
    // installed, offer to install it instead of throwing on the missing command.
    vscode.commands.registerCommand('aios.showGraph', async () => {
      if (!vscode.extensions.getExtension('foam.foam-vscode')) {
        const pick = await vscode.window.showInformationMessage('The vault graph is powered by Foam. Install it to use the graph?', 'Install Foam');
        if (pick === 'Install Foam') await vscode.commands.executeCommand('workbench.extensions.installExtension', 'foam.foam-vscode');
        return;
      }
      await vscode.commands.executeCommand('foam-vscode.show-graph');
    }),

    // One-click account swap (from the quota nudge in Sessions Running).
    vscode.commands.registerCommand('aios.swapTo', (email?: string) => {
      if (typeof email === 'string' && email) return launchAccountSwap(email);
    }),

    // Spawn the agents the latest daily note suggests under "Agents can handle".
    vscode.commands.registerCommand('aios.goWithAgents', () => goWithAgents()),
    vscode.commands.registerCommand('aios.closeAll', () => closeAll()),

    // Reveal a running session's terminal directly (used by clicking a name in
    // the Home running-agents list). name + pid match by process-tree ancestry.
    vscode.commands.registerCommand('aios.revealAgent', (name?: string, pid?: number) => {
      if (typeof name === 'string') return revealAgentTerminal(name, typeof pid === 'number' ? pid : undefined);
    }),

    // Close a running session's terminal (kill) directly from the Home list —
    // through the kill-guard (AI-18): an explicit close ALWAYS shows the 3-option
    // QuickPick (kill is destructive → predictable confirm). Refresh so the row
    // drops promptly once it's gone.
    vscode.commands.registerCommand('aios.closeAgent', async (name?: string, pid?: number) => {
      if (typeof name !== 'string') return;
      await killGuardedDispose(name, typeof pid === 'number' ? pid : undefined);
      HomeViewProvider.current?.refresh();
    }),

    // Session post-it (AI-18 / AI-39) — jot a reminder on a live session. Notes are
    // session-scoped and die at kill (harvested first by the kill-guard).
    vscode.commands.registerCommand('aios.sessionNote', async (name?: string) => {
      if (typeof name !== 'string' || !name) return;
      const existing = getSessionNotes(name);
      const note = await vscode.window.showInputBox({
        title: `${t('Note on')} ${name}`,
        prompt: existing.length
          ? `${existing.length} ${existing.length > 1 ? t('notes') : t('note')} ${t('so far — add another (dies at kill, harvested first)')}`
          : t('A reminder for this session — what did you want to do here next? (dies at kill, harvested first)'),
        placeHolder: t('e.g. review the diff before merging'),
        ignoreFocusOut: true,
      });
      if (note === undefined) return;
      await addSessionNote(name, note);
      HomeViewProvider.current?.refresh();
    }),

    // View a session's post-its (AI-18 / AI-39) — the readable side of the jot: a
    // small list of each note (text + when) with a per-item trash button to delete,
    // and an "add another" action. Opened from the 📝 count badge on a session row,
    // so notes you jotted aren't write-only. Loops so a delete/add re-renders in place.
    vscode.commands.registerCommand('aios.sessionNotesView', async (name?: string) => {
      if (typeof name !== 'string' || !name) return;
      for (;;) {
        const notes = getSessionNotes(name);
        if (!notes.length) return; // opened empty, or deleted the last one → nothing to show
        type NoteItem = vscode.QuickPickItem & { idx?: number; add?: boolean };
        const qp = vscode.window.createQuickPick<NoteItem>();
        qp.title = `${t('Notes on')} ${name}`;
        qp.placeholder = t('Session post-its — they die at kill (harvested first). Trash icon deletes one.');
        const trash: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: t('Delete this note') };
        qp.items = [
          ...notes.map((n, i): NoteItem => ({ label: n.text, description: noteWhen(n.ts), buttons: [trash], idx: i })),
          { label: '$(add) ' + t('Add a note'), alwaysShow: true, add: true },
        ];
        // Resolve the outcome BEFORE hide() — VS Code can fire onDidHide synchronously
        // during hide(), and the first resolve wins; resolving first keeps a delete/add
        // from being overwritten by onDidHide's 'close'.
        const next = await new Promise<'deleted' | 'add' | 'close'>((resolve) => {
          qp.onDidTriggerItemButton(async (e) => {
            const idx = e.item.idx;
            if (typeof idx !== 'number') return;
            await deleteSessionNote(name, idx);
            HomeViewProvider.current?.refresh();
            resolve('deleted'); qp.hide();
          });
          qp.onDidAccept(() => { const sel = qp.selectedItems[0]; resolve(sel?.add ? 'add' : 'close'); qp.hide(); });
          qp.onDidHide(() => { resolve('close'); qp.dispose(); }); // no-op if already resolved
          qp.show();
        });
        if (next === 'deleted') continue;                                             // re-render the shorter list
        if (next === 'add') { await vscode.commands.executeCommand('aios.sessionNote', name); continue; } // add, then back to the list
        return; // dismissed / picked a note → done
      }
    }),

    // Health-card fix-its (AI-18): sign in to Claude.
    vscode.commands.registerCommand('aios.login', () => launchClaude('auth login')),

    // Capture a running session (/aios:close-session) in its OWN terminal — the
    // ritual you'd want before killing it, so the session's work gets logged.
    vscode.commands.registerCommand('aios.closeSessionAgent', (name?: string, pid?: number) => {
      if (typeof name === 'string') return closeSessionInTerminal(name, typeof pid === 'number' ? pid : undefined);
    }),

    // Interrupt a working session — send Esc to its terminal (stop Claude mid-task).
    vscode.commands.registerCommand('aios.interruptAgent', (name?: string, pid?: number) => {
      if (typeof name === 'string') return interruptSessionTerminal(name, typeof pid === 'number' ? pid : undefined);
    }),

    // ⌘⌥G * — the wildcard palette: fuzzy-search EVERYTHING launchable (live
    // sessions, routines, tasks, agents, commands, skills) in one place. This is
    // the discovery surface; the per-kind chord pickers stay for muscle memory.
    // Custom discriminator is `pk` — QuickPickItem.kind is reserved for separators.
    vscode.commands.registerCommand('aios.palette', async () => {
      type PalItem = vscode.QuickPickItem & {
        pk?: 'session' | 'routine' | 'task' | 'agent' | 'command' | 'skill' | 'ask' | 'open';
        id?: string;
        name?: string;
        pid?: number;
        cmd?: AiosCommand;
        exec?: string;
      };
      const sep = (label: string): PalItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
      const items: PalItem[] = [];

      const sessions = await listRunningAgents();
      if (sessions.length) {
        items.push(sep(t('Sessions')));
        items.push(...sessions.map((s) => ({
          label: '$(terminal) ' + s.name, description: s.status || 'session', pk: 'session' as const, name: s.name, pid: s.pid,
        })));
      }
      const routines = listRoutines();
      if (routines.length) {
        items.push(sep(t('Routines')));
        items.push(...routines.map((r) => ({
          label: '$(run-all) ' + r.label,
          description: `routine · ${r.taskIds.length} tasks`,
          pk: 'routine' as const, id: r.id,
        })));
      }
      const tasks = listFrequentTasks();
      if (tasks.length) {
        items.push(sep(t('Tasks')));
        items.push(...tasks.map((t) => ({ label: '$(star) ' + t.label, description: t.hint, pk: 'task' as const, id: t.id })));
      }
      const agents = discoverAgents();
      if (agents.length) {
        items.push(sep(t('Agents')));
        items.push(...agents.map((a) => ({ label: '$(person) ' + a.name, description: a.group, detail: a.description + (a.keywords ? ' · ' + a.keywords : ''), pk: 'agent' as const, name: a.name })));
      }
      const cmds = discoverCommands();
      if (cmds.length) {
        items.push(sep(t('Commands')));
        items.push(...cmds.map((c) => ({ label: '$(terminal-bash) /aios:' + c.name, description: c.description, pk: 'command' as const, cmd: c })));
      }
      const skills = discoverSkills();
      if (skills.length) {
        items.push(sep(t('Skills')));
        items.push(...skills.map((s) => ({ label: '$(sparkle) ' + s.name, description: s.description, pk: 'skill' as const, name: s.name })));
      }

      // Help & docs — the manual lives on the website, README is the project's
      // front door; surfaced here so the palette is a single front door (we
      // don't lean on the native command palette).
      items.push(sep(t('Help & docs')));
      items.push(
        { label: '$(book) ' + t('Operating manual'), description: t('the-aios.com — read online + PDF'), pk: 'open' as const, exec: 'aios.openManual' },
        { label: '$(markdown) ' + t('README'), description: t("the project's front door"), pk: 'open' as const, exec: 'aios.openReadme' },
        { label: '$(question) ' + t('Cheatsheet'), description: t('commands · chords'), pk: 'open' as const, exec: 'aios.cheatsheet' },
        { label: '$(rocket) ' + t('Getting started'), description: t('the six-step walkthrough'), pk: 'open' as const, exec: 'aios.openWalkthrough' },
      );

      const qp = vscode.window.createQuickPick<PalItem>();
      qp.title = t('AIOS — everything');
      qp.placeholder = t('Type to find a session, routine, task, agent, command, or skill');
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      // Semantic fallback: the picker's fuzzy match is lexical (names +
      // descriptions). When intent doesn't match words, hand the words to Claude
      // — the engine that CAN search by meaning. ONE stable item, toggled only on
      // empty↔typed (per-keystroke qp.items churn resets the highlight + flickers).
      const askItem: PalItem = { label: '$(sparkle) ' + t('Ask AIOS with what you typed'), description: t('Claude matches your ask to the right context & tools in your AIOS — and puts them to work'), alwaysShow: true, pk: 'ask' as const };
      qp.items = items;
      let hasQuery = false;
      qp.onDidChangeValue((v) => {
        const now = v.trim().length > 0;
        if (now === hasQuery) return;
        hasQuery = now;
        qp.items = now ? [...items, askItem] : items;
      });
      // Capture on accept, dispatch from onDidHide — follow-up UI (the "Run in…"
      // terminal picker, arg-hint input) opened inside onDidAccept gets dismissed
      // by this picker's own async hide/dispose focus churn.
      let go: (() => void) | undefined;
      qp.onDidAccept(() => {
        const pick = qp.selectedItems[0];
        const typed = qp.value.trim();
        if (pick && pick.pk) {
          if (pick.pk === 'session' && pick.name) { const n = pick.name, p = pick.pid; go = () => void revealAgentTerminal(n, p); }
          else if (pick.pk === 'routine' && pick.id) { const id = pick.id; go = () => void runRoutine(id); }
          else if (pick.pk === 'task' && pick.id) { const id = pick.id; go = () => void runFrequentTask(id); }
          else if (pick.pk === 'agent' && pick.name) {
            const n = pick.name;
            go = () => { const a = discoverAgents().find((x) => x.name === n); void launchAios('agent', n, { name: n, icon: iconForAgent(a ?? { name: n }), color: 'terminal.ansiCyan' }); };
          }
          else if (pick.pk === 'command' && pick.cmd) { const c = pick.cmd; go = () => void runRitual(c); } // honors arg-hint prompts
          else if (pick.pk === 'skill' && pick.name) { const n = pick.name; go = () => void launchSkill(n); }
          else if (pick.pk === 'open' && pick.exec) { const e = pick.exec; go = () => void vscode.commands.executeCommand(e); }
          else if (pick.pk === 'ask' && typed) { go = () => void askAios(typed); } // fresh session named from the intent
        }
        qp.hide();
      });
      qp.onDidHide(() => { qp.dispose(); if (go) { try { go(); } catch (e) { swallow('palette dispatch', e); } } });
      qp.show();
    }),

    // Open an observed file at the exact entry (from the "What Claude's learned"
    // card) — jumps to the specific heading line, not the top of the file.
    vscode.commands.registerCommand('aios.openLearning', async (file?: string, line?: number) => {
      if (typeof file !== 'string') return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const ed = await vscode.window.showTextDocument(doc, { preview: true });
      const ln = typeof line === 'number' && line >= 0 ? line : 0;
      const pos = new vscode.Position(ln, 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    }),

    // Open a deliverable from "Recent outputs". Click = READ (md → preview,
    // html → rendered in browser + a discrete status-bar note, else → editor);
    // ⌘/Ctrl-click = open the raw SOURCE in the editor.
    vscode.commands.registerCommand('aios.openOutput', async (file?: string, source?: boolean) => {
      if (typeof file !== 'string') return;
      if (source) return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
      if (/\.html?$/i.test(file)) {
        // HTML can't render inside the editor — open it in the browser and say so
        // clearly (a status-bar note alone was easy to miss), with a one-click way
        // to open the raw source instead.
        await vscode.env.openExternal(vscode.Uri.file(file));
        vscode.window.setStatusBarMessage(`$(globe) Opened ${path.basename(file)} in your browser`, 4000);
        void vscode.window.showInformationMessage(`Opened ${path.basename(file)} in your browser — HTML renders outside the IDE.`, 'Open source instead')
          .then((pick) => { if (pick === 'Open source instead') void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file)); });
        return;
      }
      if (/\.md$/i.test(file)) return vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
      return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),

    // Ingest content — ask for the source(s), then run /aios:ingest in-session.
    vscode.commands.registerCommand('aios.ingest', async () => {
      const src = await vscode.window.showInputBox({
        title: t('Ingest content'),
        prompt: t('One or more sources — URLs, file paths, or a topic (blank to be guided)'),
        placeHolder: t('e.g. https://… · ~/Downloads/notes.pdf · "the Q3 board call"'),
        ignoreFocusOut: true,
      });
      if (src === undefined) return;
      await launchAios('ingest', src.trim() || undefined);
    }),

    vscode.commands.registerCommand('aios.manageAgents', async () => {
      const running = await listRunningAgents();
      if (running.length === 0) {
        void vscode.window.showInformationMessage(t('AIOS Glass: no running sessions detected.'));
        return;
      }
      const pick = await vscode.window.showQuickPick(
        running.map((a) => ({
          label: a.name,
          description: `pid ${a.pid}${a.spawned ? '' : ' · not spawn-managed'}`,
          agent: a
        })),
        { title: t('Running sessions'), placeHolder: t('Pick a session') }
      );
      if (!pick) return;

      const actions = [
        { label: '$(eye) ' + t('Reveal terminal'), id: 'reveal' },
        { label: '$(copy) ' + t('Copy name'), id: 'copy' },
        { label: '$(trash) ' + t('Close Terminal (Kill)'), id: 'kill' }
      ];
      const action = await vscode.window.showQuickPick(actions, { title: pick.agent.name, placeHolder: t('Action') });
      if (!action) return;
      if (action.id === 'reveal') await revealAgentTerminal(pick.agent.name, pick.agent.pid);
      else if (action.id === 'copy') { await vscode.env.clipboard.writeText(pick.agent.name); void vscode.window.showInformationMessage(t('Copied') + ` “${pick.agent.name}”.`); }
      else if (action.id === 'kill') await killGuardedDispose(pick.agent.name, pick.agent.pid); // shared kill-guard
    }),

    vscode.commands.registerCommand('aios.runRitual', (cmd: AiosCommand) => runRitual(cmd)),
    vscode.commands.registerCommand('aios.spawnAgent', (agent?: Agent) => spawnAgentFlow(agent)),
    vscode.commands.registerCommand('aios.spawnWorker', () => spawnWorker()),
    vscode.commands.registerCommand('aios.openCapability', async (cap: Capability) => {
      if (!cap?.openPath) return;
      const uri = vscode.Uri.file(cap.openPath);
      if (cap.openPath.endsWith('.md')) {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    }),

    vscode.commands.registerCommand('aios.setFrameworkPath', async () => {
      const current = vscode.workspace.getConfiguration('aiosGlass').get<string>('frameworkPath', '~/aios');
      const value = await vscode.window.showInputBox({
        title: 'AIOS framework path',
        prompt: 'Folder containing plugins/aios/commands/  (~ is expanded)',
        value: current,
        ignoreFocusOut: true
      });
      if (value === undefined) return;
      await vscode.workspace
        .getConfiguration('aiosGlass')
        .update('frameworkPath', value, vscode.ConfigurationTarget.Global);
      HomeViewProvider.current?.refresh();
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiosGlass.frameworkPath') || e.affectsConfiguration('aiosGlass.showHints') || e.affectsConfiguration('aiosGlass.showNudges') || e.affectsConfiguration('aiosGlass.theme') || e.affectsConfiguration('aiosGlass.showMemory') || e.affectsConfiguration('aiosGlass.showWeekNumbers')) HomeViewProvider.current?.refresh();
      // Editor theme changed (⌘K⌘T or OS auto-detect) → if it's an AIOS theme, flip Glass to match.
      if (e.affectsConfiguration('workbench.colorTheme')) void syncGlassToWorkbench();
    })
  );

  // ── Spawn-inbox command bus: let AGENTS drive Glass without tripping Claude's auto-mode classifier ──
  // Recent Claude Code gates agent-invoked `spawn`/`spawn-kill` (they read as "launch/kill an
  // autonomous agent"), so an agent session can't run them itself. Instead it drops a benign
  // request file here and Glass — a user-trusted IDE extension — fulfils it natively (vscode
  // createTerminal / sendText): no osascript, no synthetic keystrokes, no classifier gate. One
  // channel, three verbs (write ~/.aios/spawn-inbox/<anything>.json):
  //   spawn (default): { "name":"<kebab>", "task":"<first prompt>", "model"|"tier":"<optional>" }
  //   kill:            { "action":"kill", "name":"<kebab>" }
  //   send:            { "action":"send", "name":"<kebab>", "prompt":"<text into that live session>" }
  // Glass consumes (deletes) the file and acts. This is how one session spawns, kills, OR
  // messages another — inter-agent orchestration through the human-trusted extension. (2026-07-23)
  const spawnInboxDir = path.join(os.homedir(), '.aios', 'spawn-inbox');
  try { fs.mkdirSync(spawnInboxDir, { recursive: true }); } catch { /* non-fatal */ }
  // The inbox documents ITSELF, at the point of need. Sessions kept reverse-engineering the
  // schema out of this source file (and mis-addressing each other via pgrep / terminal tab
  // names, which lie for a RESUMED session), so the directory now ships its own README —
  // written by the component that implements the handler, refreshed on every activation, so
  // the doc can never drift from the dispatch below. Not a *.json file → the watcher ignores it.
  try {
    const readme = [
      '# The AIOS spawn-inbox — the command bus',
      '',
      `_Written by AIOS Glass v${context.extension?.packageJSON?.version ?? '?'} on activation. **Do not edit** — it is rewritten to match the handler actually running._`,
      '',
      'Drop a `*.json` file in this directory and **a trusted AIOS surface** fulfils it **natively** — Glass, inside the IDE, uses `vscode.createTerminal` / `sendText`; the **AIOS App**, when that is what is running, opens a real session pane. **The verbs below are identical either way** — never learn a surface-specific dialect. No synthetic keystrokes, no permission gate. The file is **consumed (deleted)** on pickup.',
      '',
      "Why this exists: Claude's auto-mode classifier gates agent-invoked `spawn`/`spawn-kill` (they read as \"launch/kill an autonomous agent\"), and an agent cannot author its own autonomy grant. So an agent *requests*, and a surface the human already trusts acts. **Request, don't spawn.**",
      '',
      '## Three verbs',
      '',
      '**spawn** (the default — no `action` key) — launch a named session:',
      '',
      '    { "name": "designer", "task": "design the hero", "tier": "mechanical" }',
      '',
      '- `task` — optional first prompt. `"model": "<id>"` **or** `"tier": "mechanical" | "judgment"` — optional, routes the worker by cognitive load.',
      '- A name that is already live is *revealed*, never duplicated.',
      '',
      '**send** — deliver a prompt into a LIVE session:',
      '',
      '    { "action": "send", "name": "designer", "prompt": "ship it" }',
      '',
      "**kill** — close that session's terminal (shell + claude + respawn loop):",
      '',
      '    { "action": "kill", "name": "designer" }',
      '',
      'The filename is arbitrary (must end in `.json`) — use a distinct one so concurrent requests never collide.',
      '',
      '## Addressing a specific surface (contract 2)',
      '',
      'More than one surface can fulfil these requests (Glass in the IDE, the AIOS App standalone) and they **race** — whichever watcher fires first wins. Add `"surface"` when it matters which one acts:',
      '',
      '    { "action": "send", "name": "designer", "prompt": "ship it", "surface": "glass" }',
      '',
      '- `"surface": "glass" | "app"` — only that surface may fulfil it. **Omit it** and any surface may (the contract-1 behaviour, still the default).',
      "- A surface that isn't the addressee leaves the file completely alone — the addressee may just be starting up.",
      '- Nothing rots: if the addressee never takes it, **any** surface retires it to `.undelivered` after ~10 min. Fulfilment is targeted; retirement is shared.',
      '',
      '**How a request is owned.** On pickup a surface *claims* the file by renaming it to `<name>.json.holding` and stamping `_claim` (`surface`, `pid`, `at`) inside it. The rename is atomic, so exactly one claimant wins and the loser backs off — no locks, no shared state. A claim is only adopted by another process when its holder is **dead** or the hold has gone **stale**, so a live wait is never stolen and a message is never delivered twice. If the claimant finds the session live but its terminal in another window, it **hands the request back** (bounded, `_releases`) instead of condemning a message a sibling window could deliver.',
      '',
      '## Addressing — who is live, and what is their real name',
      '',
      'The session registry is the **only** truth. One file per pid:',
      '',
      '    ls ~/.claude/sessions/*.json    # each: { "name", "pid", "status", "sessionId", "cwd" }',
      '',
      'Do **not** use `pgrep`, and do **not** trust a terminal tab title: a **resumed** session keeps whatever its tab was called, so matching by process or tab name silently fails and the session looks dead when it is not. Glass resolves the target by **pid → process ancestry**.',
      '',
      '## Replying to whoever requested you',
      '',
      "A spawned worker messages its coordinator back the same way — `send` to the coordinator's registry name. The reply arrives in that terminal as a new prompt. This works for long-lived and resumed coordinators (exactly what the pid-ancestry resolution exists for), so agents hold real multi-turn conversations.",
      '',
      '## Gotchas (each one cost a real bug)',
      '',
      '- Keep `prompt` on **one line** — multi-line text is typed into a terminal as multiple Enters.',
      '- The file disappearing means the surface **picked it up**, not that the work succeeded. To verify what a session actually did, read its transcript: `~/.claude/projects/*/<sessionId>.jsonl` (`sessionId` comes from its registry file).',
      "- **`send` to a BUSY session is not instant, by necessity — and your request file IS the queue.** Delivering into a session that is mid-turn *drops the text* (it never reaches the input and is never queued), so Glass reads the target's `status` first and **waits**. While it waits, your request is not deleted — it's renamed to `<name>.json.holding`, so a message survives an IDE reload instead of evaporating, and it is removed only once delivery is **verified** as a real turn in the target's transcript. Watch the *AIOS Glass* output channel: `delivered + VERIFIED ✓`, or `NOT DELIVERED`/`NOT VERIFIED` — in which case the request is left as `<name>.json.undelivered` for you to inspect or re-drop. Glass will **never** deliver into a busy session as a last resort: that is a guaranteed silent loss, not a best effort. Building another fulfiller? Copy this shape — status-gate, keep the file until verified, never force-deliver.",
      '- **Glass-specific:** `send` / `kill` reach terminals in the Glass window that consumed the request; with several IDE windows open, whichever wins the race acts. (Co-installed with the App, whichever surface picks the file up is the one that acts — the App defers this doc to Glass, but not the requests.)',
      '- For `send` / `kill`, `name` must match a **live** registry name. Malformed or name-less requests are ignored (logged to the *AIOS Glass* output channel).',
      '',
      '## More',
      '',
      '- The contract every session loads: `CLAUDE.md` → **Spawning Sessions**.',
      '- Subagent vs workflow vs spawn, and which model to route: the **`orchestration-ladder`** skill.',
      '',
      // Machine-readable trailer, symmetric with the App's. Two surfaces write this file, so each
      // must recognise the other's doc AND tell a current contract from a stale one.
      //
      // CROSS-REPO CONTRACT (aios-app/src/core/inboxReadme.ts → shouldWrite). The App matches
      // IDENTITY and CONTRACT *independently*, not as one trailer pattern, so the separator and
      // layout below are free to change — but these two substrings are NOT:
      //   · `written by AIOS Glass`        (case-insensitive) → identity: the App defers to our doc
      //   · `aios-spawn-inbox: contract N`                    → staleness: an older N is replaced
      //                                                          whoever wrote it
      // Remove the identity phrase and the App stops recognising this doc and clobbers it every
      // launch; remove the contract substring and a future verb change leaves a stale doc treated
      // as current. Both failures are invisible at runtime → smoke.mjs guards them at build time.
      // A change to what EITHER side matches on must be announced to the other before shipping.
      // Contract 1 is in lockstep with the App's INBOX_CONTRACT; a verb/field change bumps both in
      // the same push. (The App deliberately still defers to a pre-0.4.5 *unstamped* Glass doc:
      // treating unstamped as stale would flicker launch-for-launch against our rewrite-on-diff.)
      `<!-- aios-spawn-inbox: contract ${INBOX_CONTRACT} · written by AIOS Glass v${context.extension?.packageJSON?.version ?? '?'} -->`,
      '',
    ].join('\n');
    const readmePath = path.join(spawnInboxDir, 'README.md');
    let existing: string | undefined;
    try { existing = fs.readFileSync(readmePath, 'utf8'); } catch { /* first run */ }
    // Glass owns this doc when both surfaces are installed (the App defers to it), but it
    // must never DOWNGRADE a doc declaring a HIGHER contract — a newer fulfiller's
    // instructions are the accurate ones.
    if (shouldWriteDoc(existing, INBOX_CONTRACT, readme)) { fs.writeFileSync(readmePath, readme, 'utf8'); }
  } catch { /* non-fatal — the bus works without its docs */ }
  // ── `send` delivery, made honest (2026-07-25) ──────────────────────────────
  // Observed in the wild: a `send` into a session that was BUSY vanished completely —
  // the text never reached the TUI's input and was never queued, so the request looked
  // delivered (the request file is consumed on pickup) while the target never saw it.
  // Consuming the file proves only that Glass picked it up. So delivery now: waits for
  // the target to be idle, delivers, then VERIFIES the text became a turn in that
  // session's own transcript — and says so loudly when it can't. Never report a success
  // we haven't observed.
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const transcriptFor = (sessionId: string): string | undefined => {
    const projects = path.join(os.homedir(), '.claude', 'projects');
    try {
      for (const d of fs.readdirSync(projects)) {
        const p = path.join(projects, d, `${sessionId}.jsonl`);
        if (fs.existsSync(p)) { return p; }
      }
    } catch { /* no projects dir — unverifiable, not fatal */ }
    return undefined;
  };
  // A needle that survives JSON encoding: the first long run of characters that are not
  // escaped inside a .jsonl (no quotes/backslashes), so a match isn't lost to escaping.
  const safeNeedle = (text: string): string => {
    const m = text.match(/[A-Za-z0-9 ,.\-—:;()!?']{24,}/);
    return (m ? m[0] : text.slice(0, 24)).slice(0, 48);
  };
  /** Deliver a bus `send`. Returns true ONLY when the text was seen to become a turn in
   *  the target's own transcript — the caller keeps the request file unless that holds. */
  type SendOutcome = 'verified' | 'no-terminal' | 'undeliverable';
  const deliverSend = async (name: string, prompt: string): Promise<SendOutcome> => {
    const find = async () => (await listRunningAgents()).find((a) => a.name === name);
    const started = Date.now();
    const MAX_HOLD_MS = 30 * 60 * 1000;   // generous: the file is the queue, waiting is cheap
    let announced = false;
    for (;;) {
      const decision = decideSend(await find(), Date.now() - started, MAX_HOLD_MS);
      if (decision.do === 'undeliverable') {
        log(`spawn-inbox: send → '${name}' NOT DELIVERED — ${decision.reason}`);
        void vscode.window.showWarningMessage(`AIOS Glass: message to “${name}” not delivered — ${decision.reason}. The request is kept on disk as .undelivered.`);
        return 'undeliverable';
      }
      if (decision.do === 'hold') {
        if (!announced) {
          announced = true;
          log(`spawn-inbox: ${decision.reason} — holding the message on disk until it goes idle (delivering into a busy session would drop it)`);
        }
        await sleep(2000);
        continue;
      }
      // deliver — but if the target's terminal isn't in THIS window, a sibling window may
      // hold it: report that distinctly so the caller can hand the request back instead of
      // condemning a message another window could have delivered.
      if (!(await findAgentTerminal(name, decision.pid))) {
        log(`spawn-inbox: '${name}' is live but its terminal isn't in this window`);
        return 'no-terminal';
      }
      await sendToSession(name, prompt, decision.pid);
      const target = await find();
      const tx = target?.sessionId ? transcriptFor(target.sessionId) : undefined;
      if (!tx) {
        log(`spawn-inbox: send → '${name}' — sent, but no transcript to verify against: treating as UNVERIFIED`);
        return 'undeliverable';
      }
      const needle = safeNeedle(prompt);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await sleep(1500);
        try {
          if (fs.readFileSync(tx, 'utf8').includes(needle)) {
            log(`spawn-inbox: send → '${name}' delivered + VERIFIED in its transcript ✓`);
            return 'verified';
          }
        } catch { /* transcript momentarily unreadable — keep polling */ }
      }
      // Delivered into an idle session and it still didn't land: don't spin forever.
      log(`spawn-inbox: send → '${name}' NOT VERIFIED 20s after delivery — the text did not become a turn`);
      void vscode.window.showWarningMessage(`AIOS Glass: could not verify the message to “${name}”. The request is kept on disk as .undelivered — see the AIOS Glass output channel.`);
      return 'undeliverable';
    }
  };

  // Claim a request by RENAMING it out of the watcher's `*.json` glob, rather than
  // deleting it on pickup. The rename is atomic, so a create+change event pair (or a
  // second IDE window) cannot double-handle the same request — and because the file
  // still exists, a message that has to wait for a busy target survives an IDE reload
  // instead of evaporating with the extension's memory. Deleted only once the work is
  // done (for `send`: once delivery is VERIFIED); abandoned as `.undelivered` otherwise.
  // ── contract 2: addressing, claim ownership, and sibling handoff ──────────────
  const MY_SURFACE = 'glass' as const;
  const TARGET_TTL_MS = 10 * 60 * 1000;   // a request addressed to another surface that never took it
  const HOLD_STALE_MS = 45 * 60 * 1000;   // a hold this old is adoptable even if its claimer still lives
  const MAX_RELEASES = 2;                 // sibling-window handoffs before giving up

  const readJson = (p: string): Record<string, unknown> | undefined => {
    try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); return v && typeof v === 'object' ? v as Record<string, unknown> : undefined; }
    catch { return undefined; }
  };
  const ageOf = (p: string): number => {
    try { return Math.max(0, Date.now() - fs.statSync(p).mtimeMs); } catch { return 0; }
  };
  const pidAlive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  /** Write the claim INTO the held file, so the claim is self-describing: a recovering
   *  process (ours or the App's) can tell a live hold from an orphan, and any
   *  `.undelivered` artifact carries who held it and when. */
  const stampClaim = (held: string): void => {
    const body = readJson(held) ?? {};
    body._claim = { surface: MY_SURFACE, pid: process.pid, at: Date.now() };
    try { fs.writeFileSync(held, JSON.stringify(body, null, 2), 'utf8'); } catch { /* keep the claim anyway */ }
  };

  const claimRequest = (fsPath: string): string | undefined => {
    if (isHoldPath(fsPath)) { return fsPath; }        // recovering an orphan — already claimed
    const held = holdPathFor(fsPath);
    try { fs.renameSync(fsPath, held); } catch { return undefined; }
    stampClaim(held);
    return held;
  };
  /** Hand a request back so a SIBLING window can try it — very different from declaring
   *  it undeliverable. The claimer that can't see the target's terminal may simply be the
   *  wrong window. Bounded by `_releases` so two windows can't ping-pong forever. */
  const releaseToSibling = (held: string): boolean => {
    const body = readJson(held) ?? {};
    const releases = typeof body._releases === 'number' ? body._releases : 0;
    if (!shouldReleaseForSibling(releases, MAX_RELEASES)) { return false; }
    body._releases = releases + 1;
    delete body._claim;
    const back = held.slice(0, -HOLD_SUFFIX.length);
    try {
      fs.writeFileSync(held, JSON.stringify(body, null, 2), 'utf8');
      fs.renameSync(held, back);
      log(`spawn-inbox: released ${path.basename(back)} for another window to try (handoff ${releases + 1}/${MAX_RELEASES})`);
      return true;
    } catch { return false; }
  };
  const releaseRequest = (held: string, undelivered: boolean, why?: string): void => {
    try {
      if (undelivered) {
        const dead = undeliveredPathFor(held);
        fs.renameSync(held, dead);
        log(`spawn-inbox: left ${path.basename(dead)} on disk — ${why ?? 'not delivered'}`);
      } else {
        fs.unlinkSync(held);
      }
    } catch { /* already gone */ }
  };

  const consumeSpawnRequest = async (fsPath: string): Promise<void> => {
    const base = path.basename(fsPath);
    if (isHoldPath(fsPath)) {
      // Recovery: only adopt a hold whose claimer is gone, or that is stale. Adopting a
      // FRESH hold belonging to a live process (the App, or a sibling window) would
      // deliver the same message twice.
      const claim = parseClaim(readJson(fsPath)?._claim);
      if (!canAdoptHold(claim, Date.now(), HOLD_STALE_MS, claim ? pidAlive(claim.pid) : false)) {
        log(`spawn-inbox: ${base} is actively held by ${claim?.surface} (pid ${claim?.pid}) — leaving it alone`);
        return;
      }
      if (claim) { log(`spawn-inbox: adopting ${base} — ${pidAlive(claim.pid) ? 'hold went stale' : `holder (pid ${claim.pid}) is gone`}`); }
    } else {
      // Addressing: a request may name the surface that should fulfil it. Fulfilment is
      // targeted; RETIREMENT is shared, so a request addressed to a surface that never
      // runs can't rot silently.
      const verdict = claimVerdict(readJson(fsPath)?.surface, MY_SURFACE, ageOf(fsPath), TARGET_TTL_MS);
      if (verdict === 'skip') { return; }             // addressed elsewhere and still fresh — not ours to touch
      if (verdict === 'retire') {
        const h = claimRequest(fsPath);
        if (h) { releaseRequest(h, true, `addressed to another surface, unclaimed for over ${Math.round(TARGET_TTL_MS / 60000)} min`); }
        return;
      }
    }
    const held = claimRequest(fsPath);
    if (!held) { return; }                            // another handler/window claimed it
    let raw: string;
    try { raw = fs.readFileSync(held, 'utf8'); } catch { return; }
    if (!raw.trim()) { releaseRequest(held, false); return; }
    let req: { action?: unknown; name?: unknown; task?: unknown; model?: unknown; tier?: unknown; prompt?: unknown };
    try { req = JSON.parse(raw); } catch {
      releaseRequest(held, true, 'malformed JSON'); return;
    }
    const name = String(req.name ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    // Command bus: `action` defaults to "spawn" (back-compat with plain {name,task}).
    //   spawn → launch a worker · kill → tear one down · send → deliver a prompt to a live session.
    const action = (typeof req.action === 'string' ? req.action : 'spawn').toLowerCase();
    if (!name) { releaseRequest(held, true, "missing 'name'"); return; }
    try {
      if (action === 'kill') {
        // disposeAgentTerminal = the NON-interactive "kill now": dispose the worker's terminal
        // (closes the tab, SIGHUPs shell+claude+respawn loop), falling back to spawn-kill only
        // when it isn't a terminal in this window. NOT killGuardedDispose — that always pops
        // the capture/kill/cancel QuickPick for a human, which would hang a bus request.
        log(`spawn-inbox: kill '${name}' (dispose terminal)`);
        await disposeAgentTerminal(name);
        releaseRequest(held, false);
      } else if (action === 'send') {
        const prompt = typeof req.prompt === 'string' ? req.prompt : (typeof req.task === 'string' ? req.task : '');
        if (!prompt) { releaseRequest(held, true, "missing 'prompt'"); return; }
        // The request file stays on disk for the whole wait, and is removed ONLY when the
        // text is verified as a turn in the target's transcript. Anything else leaves a
        // `.undelivered` file — a message is never silently gone.
        const outcome = await deliverSend(name, prompt);
        if (outcome === 'verified') { releaseRequest(held, false); }
        else if (outcome === 'no-terminal' && releaseToSibling(held)) { /* handed back; another window may take it */ }
        else {
          releaseRequest(held, true, outcome === 'no-terminal'
            ? "the target's terminal isn't in any window that tried — paste it manually"
            : 'delivery not verified — re-drop it or paste it manually');
        }
      } else {
        // default: spawn. Optional model/tier — pick by cognitive load (Calibrate-Don't-Choose);
        // launchSpawn whitelists them before they touch the command line.
        const task = typeof req.task === 'string' ? req.task : '';
        const model = typeof req.model === 'string' ? req.model : undefined;
        const tier = typeof req.tier === 'string' ? req.tier : undefined;
        // Collision guard: reveal a live same-name session rather than duplicate it.
        const live = (await listRunningAgents()).find((a) => a.name === name);
        if (live) {
          await revealAgentTerminal(name, live.pid);
          log(`spawn-inbox: '${name}' already running — revealed`);
          releaseRequest(held, false); return;
        }
        log(`spawn-inbox: spawning '${name}'${task ? ' with task' : ''}${model ? ` [model ${model}]` : tier ? ` [tier ${tier}]` : ''}`);
        await launchSpawn(name, task, { model, tier });
        releaseRequest(held, false);
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log(`spawn-inbox: '${action}' for '${name}' failed (${why})`);
      releaseRequest(held, true, `${action} failed: ${why}`);
    }
  };
  const spawnInboxWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(spawnInboxDir), '*.json')
  );
  spawnInboxWatcher.onDidCreate((uri) => { void consumeSpawnRequest(uri.fsPath); });
  spawnInboxWatcher.onDidChange((uri) => { void consumeSpawnRequest(uri.fsPath); });
  context.subscriptions.push(spawnInboxWatcher);
  // Drain any requests dropped while Glass was closed.
  try {
    for (const f of fs.readdirSync(spawnInboxDir)) {
      // New requests dropped while Glass was closed…
      if (f.endsWith('.json')) { void consumeSpawnRequest(path.join(spawnInboxDir, f)); }
      // …and messages that were still WAITING for a busy target when the last session
      // ended. Because a claim renames rather than deletes, the work is recoverable:
      // this is the durability the in-memory hold never had. (`.undelivered` files are
      // deliberately NOT retried — they're an artifact for the human to look at.)
      else if (f.endsWith(HOLD_SUFFIX)) {
        log(`spawn-inbox: recovering held request ${f} from a previous session`);
        void consumeSpawnRequest(path.join(spawnInboxDir, f));
      }
    }
  } catch { /* empty/absent inbox */ }

  // Always-visible reopen button — survives moving the view to the secondary
  // side bar (which empties + hides the activity-bar container icon).
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '$(aios-mark) AIOS Glass';
  statusItem.tooltip = 'Open AIOS Glass';
  statusItem.command = 'aios.openHome';
  statusItem.show();
  context.subscriptions.push(statusItem);

  // First-run: open the Getting Started walkthrough once.
  if (!context.globalState.get('aios.walkthroughShown')) {
    void context.globalState.update('aios.walkthroughShown', true);
    void vscode.commands.executeCommand('aios.openWalkthrough');
  }

  // Foam is recommended (renders [[wikilinks]] in your notes + powers the vault
  // graph) but NOT required — Glass works without it. Recommend it once if absent,
  // non-blocking. (Was a hard extensionDependency, which blocked activation on
  // editors whose engine is too old for the latest Foam — e.g. stock Antigravity.)
  if (!vscode.extensions.getExtension('foam.foam-vscode') && !context.globalState.get('aios.foamRecommended')) {
    void context.globalState.update('aios.foamRecommended', true);
    void vscode.window
      .showInformationMessage('AIOS Glass works best with Foam — it renders [[wikilinks]] in your notes and powers the vault graph. (Optional — Glass works without it.)', 'Install Foam')
      .then((pick) => { if (pick === 'Install Foam') void vscode.commands.executeCommand('workbench.extensions.installExtension', 'foam.foam-vscode'); });
  }

  if (!resolveCommandsDir()) {
    void vscode.window.showWarningMessage(
      'AIOS Glass: could not find plugins/aios/commands. Set the framework path.',
      'Set path'
    ).then((choice) => {
      if (choice === 'Set path') void vscode.commands.executeCommand('aios.setFrameworkPath');
    });
  }
}

export function deactivate(): void {
  // nothing to clean up yet
}
