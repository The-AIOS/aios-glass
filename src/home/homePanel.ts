import * as vscode from 'vscode';
import { getMonthData, openDailyNote } from './calendar';
import * as path from 'path';
import { operatorName, primaryName, countNotes, vaultRoot, frameworkRoot } from './vault';
import { launchAios, runInPrimarySession, runInActiveClaude, terminalHasClaude } from '../rituals/runner';
import { discoverAgents } from '../agents/agents';
import { listRunningAgents } from '../agents/running';
import { discoverSkills } from '../capabilities/capabilities';
import { discoverCommands } from '../aios/commands';
import { countAgentSuggestions } from '../tasks/goWithAgents';
import { frequentTaskCount } from '../tasks/frequent';
import { recentLearnings, nudgeState, observedDirPath, recentOutputs } from '../insights/insights';
import { recentReports } from '../tasks/reports';
import { readCompanies, readCollabSpaces, readFrameworkStatus, checkForUpdates } from '../spaces/spaces';
import { currentTerminalMode, rateLimit, nextAccount, anthropicAccounts, showHints, showNudges } from './config';

/**
 * The AIOS Home dashboard — a branded webview VIEW that docks in a sidebar.
 * Drag it to the secondary side bar to sit to the right of your editor +
 * terminal (no tab, persistent). Glass, not engine: cards surface and trigger
 * existing AIOS mechanisms; the view owns no AIOS logic of its own.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aios.home';
  public static current: HomeViewProvider | undefined;

  private view?: vscode.WebviewView;
  private runningTimer?: ReturnType<typeof setInterval>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private pendingCalendar = false;
  private lastRunningCount = 0;

  constructor(private readonly extensionUri: vscode.Uri) {
    HomeViewProvider.current = this;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    // Re-check status/running each time the view becomes visible again (e.g.
    // after running /aios:update in a terminal and switching back), and poll
    // the running list WHILE visible so newly-spawned sessions and busy⇄idle
    // status changes show up live without a manual refresh. Polling stops when
    // the view is hidden (no wasted cycles). Reading the session registry is
    // cheap (small dir + JSON parse + liveness check).
    const startPolling = () => {
      if (this.runningTimer) return;
      this.runningTimer = setInterval(() => void this.refreshRunning(), 2000);
    };
    const stopPolling = () => { if (this.runningTimer) { clearInterval(this.runningTimer); this.runningTimer = undefined; } };
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) { this.recheck(); startPolling(); } else { stopPolling(); }
    });
    webviewView.onDidDispose(() => stopPolling());
    startPolling();
    // Keep the Terminals list live as terminals open/close (event-driven, not polled).
    const openSub = vscode.window.onDidOpenTerminal(() => void this.postTerminals());
    const closeSub = vscode.window.onDidCloseTerminal(() => void this.postTerminals());
    webviewView.onDidDispose(() => { openSub.dispose(); closeSub.dispose(); });

    // Refresh state (incl. the Go-with-agents count) when a daily note changes —
    // so editing/generating today's note updates the count without a manual poke.
    const v = vaultRoot();
    if (v) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.join(v, '01 - calendar')), '**/*.md')
      );
      const onNote = () => this.scheduleRefresh({ calendar: true });
      watcher.onDidChange(onNote);
      watcher.onDidCreate(onNote);
      watcher.onDidDelete(onNote);
      webviewView.onDidDispose(() => watcher.dispose());
    }
    // Refresh "What Claude's learned" when observed-context files change.
    const obs = observedDirPath();
    if (obs) {
      const ow = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(obs), '*.md'));
      const onObs = () => this.scheduleRefresh();
      ow.onDidChange(onObs);
      ow.onDidCreate(onObs);
      webviewView.onDidDispose(() => ow.dispose());
    }
    // Refresh "Recent outputs" when a deliverable lands under 03 - export/.
    if (v) {
      const ew = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(v, '03 - export')), '**/*'));
      const onExp = () => this.scheduleRefresh();
      ew.onDidChange(onExp);
      ew.onDidCreate(onExp);
      ew.onDidDelete(onExp);
      webviewView.onDidDispose(() => ew.dispose());
    }
    // Refresh the Projects count AND Collaboration list when project notes change
    // — both read from `00 - notes/projects/` (collab spaces are `space-*.md`
    // there). Recursive so adds/removes/moves into subfolders all fire; the
    // counts/lists are recomputed by their own functions, so no taxonomy lives here.
    if (v) {
      const pw = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.join(v, '00 - notes', 'projects')), '**/*.md')
      );
      const onProj = () => this.scheduleRefresh();
      pw.onDidChange(onProj);
      pw.onDidCreate(onProj);
      pw.onDidDelete(onProj);
      webviewView.onDidDispose(() => pw.dispose());
    }
    // Refresh the Companies list when USER.md changes — the Companies table is
    // parsed from USER.md → `## Companies (mounted)`, so mounting/unmounting a
    // company shows up live without a reload.
    const fwRoot = frameworkRoot();
    if (fwRoot) {
      const uw = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(fwRoot), 'USER.md')
      );
      const onUser = () => this.scheduleRefresh();
      uw.onDidChange(onUser);
      uw.onDidCreate(onUser);
      uw.onDidDelete(onUser);
      webviewView.onDidDispose(() => uw.dispose());
    }
    webviewView.onDidDispose(() => { if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; } });
  }

  /**
   * Debounced full-state refresh. All file watchers route through this instead
   * of calling postState() directly, so a burst of events (autosave while
   * editing a daily note, the multi-file PDF export pipeline, a company sync)
   * collapses into ONE re-scan ~250ms after the last event. postState() is
   * heavy (walks agents/ + skills/, three countNotes, reads USER.md + learnings
   * + outputs + reports), so coalescing matters. `calendar` also re-renders the
   * calendar grid once the dust settles.
   */
  private scheduleRefresh(opts?: { calendar?: boolean }): void {
    if (opts?.calendar) this.pendingCalendar = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.postState();
      if (this.pendingCalendar) { this.post({ type: 'calendarDirty' }); this.pendingCalendar = false; }
    }, 250);
  }

  refresh(): void {
    this.recheck();
  }

  /** Collapse/expand all cards at once (the ⌘⌥G M chord). */
  toggleCards(): void {
    this.post({ type: 'toggleAllCards' });
  }

  /** Show/hide Glass (the ⌘⌥G H chord). Closed → reveal+focus. Open → hide.
   *  VS Code doesn't expose which bar a view sits in, so we detect it: try the
   *  secondary-bar toggle (Glass's recommended dock); if Glass is still visible
   *  a beat later it wasn't there (it's in the primary sidebar) — so undo the
   *  empty bar we opened and toggle the primary sidebar instead. Net: a clean
   *  show/hide wherever Glass is docked. */
  toggleHome(): void {
    if (!this.view?.visible) { void vscode.commands.executeCommand('aios.home.focus'); return; }
    void vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    setTimeout(() => {
      if (this.view?.visible) {
        void vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar'); // undo: Glass wasn't in the aux bar
        void vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility'); // hide the primary sidebar instead
      }
    }, 120);
  }

  /** Re-pull live state: counts, running sessions, and the update-status badge. */
  private recheck(): void {
    if (!this.view) return;
    this.postState();
    void this.refreshRunning();
    void this.postTerminals();
    void checkForUpdates().then((state) => this.post({ type: 'updateStatus', state, framework: readFrameworkStatus() ?? null }));
  }

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready': {
        const now = new Date();
        this.post({ type: 'month', data: getMonthData(now.getFullYear(), now.getMonth() + 1) });
        this.recheck();
        return;
      }
      case 'recheck':
        this.recheck();
        return;
      case 'navMonth':
        this.post({ type: 'month', data: getMonthData(msg.year, msg.month) });
        return;
      case 'openDay':
        if (typeof msg.date === 'string') await openDailyNote(msg.date, { forceEditor: !!msg.edit });
        return;
      case 'ritual':
        if (typeof msg.name === 'string') {
          // /today + /close-day belong to the primary session;
          // /close-session must land in an existing live session, never a new one.
          if (msg.name === 'today' || msg.name === 'close-day') await runInPrimarySession(`/aios:${msg.name}`);
          else if (msg.name === 'close-session') await runInActiveClaude('/aios:close-session');
          else await launchAios(msg.name);
        }
        return;
      case 'newTerminal':
        vscode.window.createTerminal().show();
        return;
      case 'focusTerminal':
      case 'closeTerminal':
        if (typeof msg.pid === 'number') {
          for (const t of vscode.window.terminals) {
            if ((await t.processId) === msg.pid) {
              if (msg.type === 'focusTerminal') t.show(); else t.dispose();
              break;
            }
          }
        }
        return;
      case 'nudgeRun':
        // Morning/evening nudge → run the suggested ritual in the primary session.
        // The note writes commands inconsistently (bare `/7plan`, `/aios:close-day`,
        // legacy `/vault-commands:…`, or a builtin like `/fewer-permission-prompts`),
        // so normalize: a namespaced or known-aios command → `/aios:<cmd>`; an
        // unknown bare command (a Claude builtin) is left as-is.
        if (typeof msg.command === 'string') {
          let cmd = msg.command.trim();
          const m = cmd.match(/^\/(?:(aios|vault-commands):)?(\S+)(.*)$/);
          if (m) {
            const base = m[2], rest = m[3] || '';
            if (m[1] || discoverCommands().some((c) => c.name === base)) cmd = `/aios:${base}${rest}`;
          }
          await runInPrimarySession(cmd);
        }
        return;
      case 'cmd':
        if (typeof msg.command === 'string') {
          await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
          // NB: don't refresh after closeAgent — the process isn't dead yet, so it'd
          // re-add the row we just optimistically removed. The webview filters it out
          // (killed set) and the 2s poll reconciles once the registry drops it.
          if (msg.command === 'aios.manageAgents') void this.refreshRunning();
        }
        return;
    }
  }

  private async refreshRunning(): Promise<void> {
    const running = await listRunningAgents();
    this.lastRunningCount = running.length; // feeds the daytime "wrap your sessions" nudge
    // Usage line (green→red) + swap button. Read live each 2s poll (the cache
    // updates ~per statusline turn). The swap is offered only with 2+ accounts.
    // TESTING: QUOTA_SWAP_ALWAYS forces the button visible to tune the UX —
    // flip to false to gate it on ≥95% (the real behavior).
    const QUOTA_SWAP_ALWAYS = false; // gated: swap button shows at 5h≥95% / 7d≥99%
    const rl = rateLimit();
    const multi = anthropicAccounts().length > 1;
    // 5h is the binding constraint; 7d only escalates at the extreme (≥99).
    const showSwap = !!rl && multi && (QUOTA_SWAP_ALWAYS || rl.fiveHourPct >= 95 || rl.sevenDayPct >= 99);
    const quota = rl
      ? { has: true, fiveHour: rl.fiveHourPct, sevenDay: rl.sevenDayPct, showSwap, to: multi ? nextAccount() : '' }
      : { has: false, fiveHour: 0, sevenDay: 0, showSwap: false, to: '' };
    this.post({ type: 'running', running: running.map((a) => ({ name: a.name, pid: a.pid, status: a.status })), quota });
    void this.postTerminals(new Set(running.map((a) => a.name))); // reconcile Terminals vs the live registry each poll
  }

  /** Open integrated terminals that aren't live Claude sessions — the Terminals list
   *  in the Sessions card, so terminals stay manageable with the native tabs hidden. */
  private async postTerminals(sessionNames?: Set<string>): Promise<void> {
    const names = sessionNames ?? new Set((await listRunningAgents()).map((a) => a.name));
    // A terminal is "plain" only if it's neither a live session (by name) nor
    // running Claude (catches a just-spawned session before it hits the registry —
    // the open-event can fire before the process registers). The 2s poll calls this
    // with the fresh session names, so any brief leak reconciles within a poll.
    const plain: { name: string; pid: number }[] = [];
    for (const t of vscode.window.terminals) {
      if (names.has(t.name)) continue;
      if (await terminalHasClaude(t)) continue;
      plain.push({ name: t.name, pid: (await t.processId) ?? 0 });
    }
    this.post({ type: 'terminals', terminals: plain });
  }

  private postState(): void {
    const now = new Date();
    this.post({
      type: 'state',
      operator: operatorName(),
      primary: primaryName(),
      agents: discoverAgents().length,
      skills: discoverSkills().length,
      commands: discoverCommands().length,
      frequent: frequentTaskCount(),
      showHints: showHints(),
      companies: readCompanies().map((c) => ({ name: c.name, lastSync: c.lastSync })),
      collab: readCollabSpaces().map((s) => ({ name: s.name })),
      framework: readFrameworkStatus() ?? null,
      terminalMode: currentTerminalMode(),
      declared: countNotes('declared'),
      observed: countNotes('observed'),
      projects: countNotes('projects'),
      goAgents: countAgentSuggestions(),
      learnings: recentLearnings(4).map((l) => ({ title: l.title, date: l.date, source: l.source, file: l.file, line: l.line })),
      nudge: showNudges() ? nudgeState(now.getHours(), now.getDay(), this.lastRunningCount) : null,
      outputs: recentOutputs(6).map((o) => ({ name: o.name, group: o.group, path: o.path })),
      reports: recentReports(5).map((r) => ({ name: r.name, path: r.path }))
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style nonce="${nonce}">
  :root{
    --canvas:#0a0a0a; --surface-1:#111111; --surface-2:#181818; --surface-3:#1f1f1f;
    --line:#262626; --ink:#fafafa; --muted:#c4c4c4; --subtle:#707070;
    --accent:#ff5d4d; --accent-glow:rgba(255,93,77,.18); --accent-soft:#ffb3a8; --accent-line:rgba(255,93,77,.45);
    --ok:#5ad19a;
    --font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --mono:"JetBrains Mono","SF Mono",Menlo,Monaco,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--canvas); color:var(--ink); font-family:var(--font);
    padding:30px clamp(20px,5vw,56px); line-height:1.6; -webkit-font-smoothing:antialiased; font-feature-settings:"cv11","ss01","ss03";}
  ::selection{background:var(--accent); color:var(--canvas)}
  header{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:28px}
  .brand{display:flex; align-items:center; gap:11px}
  .brand .mark{display:inline-flex}
  .brand .mark .o{stroke:var(--accent)} .brand .mark .i{fill:var(--accent)}
  h1{font-weight:700; font-size:clamp(1.5rem,2.4vw,2.1rem); letter-spacing:-.022em; line-height:1; margin:0}
  .headright{display:flex; align-items:center; gap:14px}
  .greet{color:var(--muted); font-size:14px}
  .cog{background:transparent; border:1px solid var(--line); color:var(--muted); border-radius:9px;
    width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:border-color .15s,color .15s}
  .cog:hover{border-color:var(--accent-line); color:var(--accent)}
  .hbadge{background:transparent; border:1px solid var(--line); color:var(--subtle); border-radius:9px;
    width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:default; transition:border-color .15s,color .15s}
  .hbadge.ok{color:var(--ok); border-color:rgba(90,209,154,.4)}
  .hbadge.upd{color:var(--accent); border-color:var(--accent-line); cursor:pointer}
  .hbadge.upd:hover{background:var(--accent-glow)}
  .cols{display:grid; grid-template-columns:1fr; gap:16px; align-items:start}
  @media(min-width:760px){ .cols{grid-template-columns:1fr 1fr} }
  @media(min-width:1100px){ .cols{grid-template-columns:1.25fr 1.25fr 0.7fr} }
  .col{display:flex; flex-direction:column; gap:16px; min-width:0}
  .col.minor .ctitle{color:var(--subtle)}
  .col.minor .card{background:transparent}
  .card{background:var(--surface-1); border:1px solid var(--line); border-radius:16px; padding:18px}
  .card.hero{border-color:var(--accent-line)}
  .ctitle{font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.14em; color:var(--subtle);
    margin:0 0 14px; display:flex; align-items:center; gap:8px}
  .ctitle:not(:first-child){margin-top:22px}
  .ctitle::before{content:""; width:6px;height:6px;border-radius:50%; background:var(--accent); flex:0 0 auto}
  .ctitle{cursor:pointer}
  .ctitle:focus-visible{outline:1.5px solid var(--accent-line); outline-offset:3px; border-radius:4px}
  .ctitle::after{content:'▾'; margin-left:auto; font-size:10px; color:var(--subtle); opacity:.5; font-weight:400; letter-spacing:0}
  .card.collapsed .ctitle::after{content:'▸'}
  .card.collapsed .ctitle{margin-bottom:0}
  .card.collapsed > :not(.ctitle){display:none}
  .ctitle .sub{text-transform:none; letter-spacing:0; font-weight:400; font-size:12px; color:var(--subtle); font-style:italic}
  .btn{display:block; width:100%; text-align:left; background:var(--surface-2); color:var(--ink);
    border:1px solid var(--line); border-radius:10px; padding:12px 14px; font-size:14px; cursor:pointer;
    transition:border-color .15s, background .15s; margin-bottom:10px; font-family:var(--font)}
  .btn:last-child{margin-bottom:0}
  /* Secondary-hints toggle (cog → Secondary hints): hide button hints + header
     subtitles for a label-only view. Scoped to .btn/.ctitle so functional labels
     elsewhere stay — the 5h-usage label (.quotarow .k) and session-item status
     (.runitem .k). Counts (.val) and helper lines (.muted) are also unaffected. */
  body.no-hints .btn .k, body.no-hints .ctitle .sub{display:none}
  /* Keyboard shortcuts — its own collapsible section (independent of the hints toggle). */
  .shortcuts{margin:18px 2px 6px}
  .scbar{display:flex; align-items:center; gap:6px; width:100%; background:transparent; border:0; color:var(--subtle); font-size:11.5px; font-family:var(--font); cursor:pointer; padding:4px 0; text-align:left}
  .scbar:hover{color:var(--ink)}
  .scbar .scsub{color:var(--subtle); opacity:.65; font-size:10.5px; font-family:var(--mono)}
  .scgrid{display:grid; grid-template-rows:repeat(9, auto); grid-auto-flow:column; grid-auto-columns:1fr; gap:4px 16px; margin:7px 0 0; font-size:11px; color:var(--subtle); font-family:var(--mono)}
  .scgrid.collapsed{display:none}
  .scgrid kbd{display:inline-block; min-width:14px; text-align:center; color:var(--ink); background:var(--surface-2); border:1px solid var(--line); border-radius:5px; padding:0 5px; font-family:var(--mono); font-size:10.5px; margin-right:5px}
  /* Compact density — tightens spacing so more actionables fit in one view. */
  body.compact .cols{gap:10px}
  body.compact .col{gap:10px}
  body.compact .card{padding:11px}
  body.compact .ctitle{margin:0 0 8px}
  body.compact .ctitle:not(:first-child){margin-top:13px}
  body.compact .btn{padding:7px 11px; font-size:13px; margin-bottom:6px}
  body.compact .muted{margin-top:5px; font-size:11.5px}
  body.compact .runitem{padding:2px 6px}
  .cog.active{color:var(--accent)}
  .nudge{display:flex; align-items:center; gap:6px; width:100%; background:color-mix(in srgb, var(--accent) 14%, var(--surface-1)); border:1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); color:var(--ink); border-radius:12px; padding:11px 14px; margin-bottom:16px}
  .nudge:hover{background:color-mix(in srgb, var(--accent) 22%, var(--surface-1))}
  .nudgebody{flex:1; min-width:0; text-align:left; background:transparent; border:0; color:var(--ink); font-size:13.5px; line-height:1.35; cursor:pointer; font-family:var(--font); padding:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden}
  .nudgex{flex:0 0 auto; background:transparent; border:0; color:var(--subtle); font-size:12px; line-height:1; cursor:pointer; padding:3px 5px; border-radius:6px; opacity:.55}
  .nudgex:hover{opacity:1; color:var(--ink); background:color-mix(in srgb, var(--accent) 18%, transparent)}
  .quota{display:block; width:100%; text-align:left; background:color-mix(in srgb, #f5a623 16%, var(--surface-1)); border:1px solid color-mix(in srgb, #f5a623 55%, var(--line)); color:var(--ink); border-radius:10px; padding:9px 12px; font-size:13px; cursor:pointer; margin-bottom:10px; font-family:var(--font)}
  .quota:hover{background:color-mix(in srgb, #f5a623 26%, var(--surface-1))}
  .quotarow{display:flex; align-items:center; gap:8px; margin:2px 0 9px}
  .quotarow .k{flex:0 0 auto; color:var(--subtle); font-size:11px; font-family:var(--mono)}
  .quotabar{height:4px; flex:1; background:var(--surface-2); border-radius:3px; overflow:hidden; cursor:default}
  .quotabar .qfill{height:100%; width:0; border-radius:3px; transition:width .3s ease, background .3s ease; background:#3ec77a}
  .quotabar.yellow .qfill{background:#e8c44a}
  .quotabar.orange .qfill{background:#f5a623}
  .quotabar.red .qfill{background:#f5564a}
  .learnlist{display:flex; flex-direction:column; gap:5px}
  .learnitem{display:flex; align-items:baseline; gap:7px; font-size:12.5px; cursor:pointer; padding:3px 5px; border-radius:6px}
  .learnitem:hover{background:var(--surface-2)}
  .learnitem .lsrc{flex:0 0 auto; font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; font-family:var(--mono); color:var(--subtle); border:1px solid var(--line); border-radius:4px; padding:1px 4px}
  .learnitem .lsrc.growth{color:#3ec77a; border-color:color-mix(in srgb,#3ec77a 40%,var(--line))}
  .learnitem .lsrc.rule{color:#f5a623; border-color:color-mix(in srgb,#f5a623 40%,var(--line))}
  .learnitem .ltitle{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink)}
  .learnitem .ldate{flex:0 0 auto; font-size:10.5px; color:var(--muted); font-family:var(--mono)}
  .btn:hover{border-color:var(--accent-line); background:var(--surface-3)}
  .btn .k{color:var(--subtle); font-size:12px; margin-left:6px; font-family:var(--mono)}
  .btn .val{float:right; color:var(--accent); font-family:var(--mono); font-size:12px}
  .runlist{margin:2px 0 8px; padding:0 2px}
  .runitem{display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink); padding:3px 6px; border-radius:6px; cursor:pointer}
  .runitem:hover{background:var(--surface-2)}
  .runitem:focus-visible{outline:1px solid var(--accent); outline-offset:0}
  .runitem .rname{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .lhead{display:flex; align-items:center; gap:6px; margin-bottom:6px}
  .lhead .btn{flex:1; margin-bottom:0}
  .lhead-add{flex:0 0 auto; width:30px; height:30px; background:var(--surface-2); border:1px solid var(--line); color:var(--subtle); border-radius:8px; cursor:pointer; font-size:14px; line-height:1; display:flex; align-items:center; justify-content:center}
  .lhead-add:hover{border-color:var(--accent-line); color:var(--accent)}
  .runkill{margin-left:auto; flex:0 0 auto; background:transparent; border:0; color:var(--subtle); padding:2px 3px; border-radius:4px; cursor:pointer; opacity:0; display:flex; align-items:center}
  .runitem:hover .runkill{opacity:1}
  .runkill:hover{color:#f5564a; background:color-mix(in srgb, #f5564a 16%, transparent)}
  .runitem .k{margin-left:0; font-size:11px}
  .runitem .dot{width:7px; height:7px; border-radius:50%; flex:0 0 auto; background:var(--subtle)}
  .runitem .dot.busy{background:#f5a623; box-shadow:0 0 0 2px color-mix(in srgb, #f5a623 22%, transparent)}
  .runitem .dot.idle{background:#3ec77a}
  .runitem .dot.input{background:#4aa3ff; box-shadow:0 0 0 2px color-mix(in srgb, #4aa3ff 24%, transparent)}
  .runitem .dot.error{background:#f5564a; box-shadow:0 0 0 2px color-mix(in srgb, #f5564a 24%, transparent)}
  .runitem .dot.unk{background:var(--subtle)}
  .btn.accent{border:1px solid color-mix(in srgb, var(--accent) 55%, var(--line)); background:color-mix(in srgb, var(--accent) 12%, var(--surface-2))}
  .btn.accent:hover{background:color-mix(in srgb, var(--accent) 20%, var(--surface-2))}
  .btn.accent .val{color:var(--accent)}
  .btn.dim{opacity:.5}
  .launch{display:flex; gap:8px; margin-bottom:2px}
  .launch .btn{margin-bottom:0; width:auto}
  .launch .primary{flex:1}
  .btn.primary{background:var(--accent); color:#0a0a0a; border-color:var(--accent); font-weight:700; text-align:center; padding:14px}
  .btn.primary:hover{background:var(--accent-soft); border-color:var(--accent-soft)}
  .btn.ghost{text-align:center; color:var(--muted)}
  .muted{color:var(--muted); font-size:13px; margin:8px 0 0}
  .badge{display:inline-block; font-size:11px; font-weight:600; padding:2px 9px; border-radius:999px; border:1px solid var(--line); color:var(--subtle)}
  .badge.ok{color:var(--ok); border-color:rgba(90,209,154,.4)}
  .badge.upd{color:var(--accent); border-color:var(--accent-line)}
  .badge.live{color:var(--accent); border-color:var(--accent-line)}
  /* calendar */
  .calhead{display:flex; align-items:center; gap:4px; margin-bottom:12px}
  .calhead .label{flex:1; text-align:center; font-weight:600; font-size:1.0625rem; letter-spacing:-.01em}
  .vtoggle{background:var(--surface-2); border:1px solid var(--line); color:var(--subtle); font-size:11px; font-family:var(--mono); padding:2px 8px; border-radius:6px; cursor:pointer; margin-left:6px}
  .vtoggle:hover{color:var(--ink); border-color:var(--accent)}
  .nav{background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1; transition:border-color .15s,color .15s}
  .nav:hover{border-color:var(--accent-line);color:var(--accent)}
  table{width:100%; border-collapse:collapse}
  th{font-size:11px; font-weight:600; color:var(--subtle); padding:6px 0; text-transform:uppercase; letter-spacing:.06em}
  td{text-align:center; padding:1px}
  .cell{position:relative; min-height:32px; display:flex; align-items:center; justify-content:center; border-radius:8px; font-size:13px; color:var(--ink); border:1px solid transparent}
  .cell.has{cursor:pointer}
  .cell.has:hover{background:var(--surface-2); border-color:var(--line)}
  .cell.today{border-color:var(--accent-line); background:var(--accent-glow)}
  .cell.day:not(.has) .num{color:var(--subtle); font-weight:400}
  .cell.day.has .num{color:var(--accent-soft); font-weight:500}
  .cell.day.today .num{color:var(--accent); font-weight:600}
</style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="mark"><svg viewBox="0 0 18 18" width="22" height="22" aria-hidden="true"><rect class="o" x="1" y="1" width="16" height="16" rx="2.4" fill="none" stroke-width="1.5"/><rect class="i" x="9" y="2" width="6" height="6" rx="1"/></svg></span>
      <h1>AIOS Glass</h1>
    </div>
    <div class="headright">
      <button class="hbadge" id="updBadge" title="Checking framework status…"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg></button>
      <button class="cog" id="density" title="Toggle compact view (tighter spacing, more in view)">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.5-2.3 1.6 1.6 0 0 1 1.4-2.4H17a4 4 0 0 0 4-4c0-4.4-4-7.3-9-7.3Z"/><circle cx="7.6" cy="11.6" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.9" r="1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="9" r="1" fill="currentColor" stroke="none"/></svg>
      </button>
      <button class="cog" id="onboard" title="New here? Get oriented with the AIOS guide">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4v1.6"/><circle cx="12" cy="2.7" r="0.7" fill="currentColor" stroke="none"/><rect x="4.5" y="5.5" width="15" height="12" rx="3.2"/><circle cx="9.2" cy="11.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="11.2" r="1" fill="currentColor" stroke="none"/><path d="M9.4 14.2a3 3 0 0 0 5.2 0"/></svg>
      </button>
    </div>
  </header>

  <div class="nudge" id="nudgeCard" style="display:none">
    <button class="nudgebody" id="nudgeAction"></button>
    <button class="nudgex" id="nudgeDismiss" title="Dismiss for now" aria-label="Dismiss">✕</button>
  </div>

  <div class="cols">
    <div class="col">
      <div class="launch">
        <button class="btn primary" id="launchPrimary">▶ Launch <span id="vPrimary">aios</span></button>
        <button class="btn ghost" id="resume">Resume</button>
      </div>

      <section class="card hero">
        <p class="ctitle">Daily <span class="sub">discipline compounds</span></p>
        <button class="btn" data-ritual="today">Plan my day <span class="k">/today</span></button>
        <button class="btn" data-ritual="close-session">Close session <span class="k">/close-session</span></button>
        <button class="btn" data-ritual="close-day">Close the day <span class="k">/close-day</span></button>
        <button class="btn accent" id="goWithAgents" title="Spawn the agents your latest daily note suggests under “Agents can handle” — one terminal each">🤖 Go with agents <span class="k">multi spawn</span> <span class="val" id="vGoAgents">—</span></button>
      </section>

      <section class="card">
        <p class="ctitle">Calendar</p>
        <div class="calhead">
          <button class="nav" id="prev" aria-label="Previous">‹</button>
          <span class="label" id="calLabel">—</span>
          <button class="nav" id="next" aria-label="Next">›</button>
          <button class="vtoggle" id="calToggle" title="Switch month / week view">Week</button>
        </div>
        <table><thead><tr id="dow"></tr></thead><tbody id="cal"></tbody></table>
        <p class="muted">Click to read · ⌘-click to edit.</p>
      </section>
    </div>

    <div class="col">
      <section class="card">
        <p class="ctitle">Quick</p>
        <button class="btn" id="frequentMenu" title="Your frequent tasks — pick one to run, or add / remove your own">Frequent tasks <span class="k">add your own</span> <span class="val" id="vFrequent">—</span></button>
        <button class="btn" id="browseAgents" title="Browse and spawn any agent — bundled, custom, or company">Launch an agent <span class="k">browse · task</span> <span class="val" id="vAgents">—</span></button>
        <button class="btn" id="skillsPicker" title="Browse and load any registered skill">Load a skill <span class="k">browse · run</span> <span class="val" id="vSkills">—</span></button>
        <button class="btn" id="cmdPicker" title="Browse and run any /aios: command">Run a command <span class="k">aios plugins</span> <span class="val" id="vCommands">—</span></button>
        <button class="btn" id="ingestQuick" title="Turn one or more sources (URLs, files, transcripts) into structured vault context">Ingest content <span class="k">→ vault context</span></button>
        <button class="btn" id="spawnWorker" title="Spawn a session you name (e.g. feat-checkout) — or leave the name blank for a random handle — with an optional task">Spawn a session <span class="k">name · task</span></button>
      </section>

      <section class="card">
        <p class="ctitle">Running</p>
        <div class="quotarow" id="quotaLine" style="display:none"><div class="quotabar" id="quotaBar"><div class="qfill" id="quotaFill"></div></div><span class="k" id="quotaLabel">5h</span></div>
        <button class="quota" id="quotaWarn" style="display:none" title="Swap to your other account — silent, in-place (statusline shows it)"></button>
        <div class="lhead">
          <button class="btn" id="toggleRunning" title="Show / hide your live Claude sessions"><span id="runCaret">▾</span> Sessions <span class="val" id="vRunning">0</span></button>
          <button class="lhead-add" id="addSession" title="Spawn a session — name it (or blank for a random handle), optional task">＋</button>
        </div>
        <div class="runlist" id="runningList"></div>
        <div class="lhead">
          <button class="btn" id="toggleTerms" title="Show / hide open terminals"><span id="termCaret">▾</span> Terminals <span class="val" id="vTerms">0</span></button>
          <button class="lhead-add" id="addTerm" title="Open a new terminal (not a Claude session)">＋</button>
        </div>
        <div class="runlist" id="termList"></div>
        <p class="muted" id="runHint">Click a session to reveal · trash to kill.</p>
      </section>

      <section class="card">
        <p class="ctitle">Workspaces</p>
        <button class="btn" id="companyAction" title="Mount, sync, or invite to a company's venture context">Companies <span class="k">ventures context</span> <span class="val" id="vCompanies">—</span></button>
        <button class="btn" id="collaborateAction" title="Shared spaces with external collaborators">Collaboration <span class="k">shared spaces</span> <span class="val" id="vCollab">—</span></button>
        <button class="btn" id="browseProjects" title="Your project notes (top-level)">Projects <span class="k">your work</span> <span class="val" id="vProjects">—</span></button>
      </section>
    </div>

    <div class="col minor">
      <section class="card">
        <p class="ctitle">Customize <span class="sub">personalizations</span></p>
        <button class="btn" data-doc="intent">INTENT.md <span class="k">autonomy · trust</span></button>
        <button class="btn" data-doc="user">USER.md <span class="k">identity · settings</span></button>
        <p class="muted">Ask Claude to update them for you.</p>
      </section>

      <section class="card">
        <p class="ctitle">Context <span class="sub">about you</span></p>
        <button class="btn" id="browseDeclared">Declared <span class="k">you stated</span> <span class="val" id="vDeclared">—</span></button>
        <button class="btn" id="browseObserved">Observed <span class="k">claude learned</span> <span class="val" id="vObserved">—</span></button>
      </section>

      <section class="card">
        <p class="ctitle">Learned <span class="sub">lately</span></p>
        <div class="learnlist" id="learnList"></div>
        <p class="muted" id="learnHint">Your second brain, getting smarter — click to read.</p>
      </section>

      <section class="card">
        <p class="ctitle">Shipped <span class="sub">recently</span></p>
        <div class="learnlist" id="outputList"></div>
        <p class="muted" id="outputHint">Click to read · ⌘-click for source.</p>
      </section>

      <section class="card">
        <p class="ctitle">Reports <span class="sub">recent · create new</span></p>
        <button class="btn" id="genReport" title="Generate a report — pick type (role / weekly / status / custom) + period">Generate a report <span class="k">type · period</span></button>
        <div class="learnlist" id="reportList"></div>
        <p class="muted" id="reportHint" style="display:none">Click to read · ⌘-click for source.</p>
      </section>
    </div>
  </div>

  <section class="shortcuts">
    <button class="scbar" id="scToggle"><span id="scCaret">▸</span> ⌨ Key shortcuts <span class="scsub">⌘⌥G then a key</span></button>
    <div class="scgrid collapsed" id="scGrid">
      <div><kbd>D</kbd>daily ritual</div>
      <div><kbd>Y</kbd>today's note</div>
      <div><kbd>G</kbd>go-with-agents</div>
      <div><kbd>X</kbd>context folders</div>
      <div><kbd>P</kbd>personalizations</div>
      <div><kbd>W</kbd>workspaces</div>
      <div><kbd>M</kbd>minimize cards</div>
      <div><kbd>H</kbd>toggle glass</div>
      <div><kbd>,</kbd>open config</div>
      <div><kbd>A</kbd>launch agent</div>
      <div><kbd>K</kbd>load skill</div>
      <div><kbd>C</kbd>run command</div>
      <div><kbd>I</kbd>ingest content</div>
      <div><kbd>R</kbd>running sessions</div>
      <div><kbd>S</kbd>new session</div>
      <div><kbd>T</kbd>new terminal</div>
      <div><kbd>E</kbd>generate report</div>
      <div><kbd>F</kbd>frequent tasks</div>
    </div>
  </section>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let cur = { year: 0, month: 0 };
  const killed = new Set();  // pids killed via 🗑, filtered from the list until the registry confirms
  let calView = 'month';   // 'month' | 'week'
  let weekIdx = 0;         // which week-row to show in week view
  let lastData = null;     // last month payload, for re-render on toggle/week-nav
  let pendingWeek = null;  // 'first' | 'last' — pick edge week after a cross-month nav
  const run = (command, ...args) => vscode.postMessage({ type: 'cmd', command, args });

  document.querySelectorAll('[data-ritual]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ type: 'ritual', name: b.getAttribute('data-ritual') })));
  document.querySelectorAll('[data-doc]').forEach((b) =>
    b.addEventListener('click', (ev) => run('aios.openDoc', b.getAttribute('data-doc'), ev.metaKey || ev.ctrlKey)));
  document.querySelectorAll('[data-create]').forEach((b) =>
    b.addEventListener('click', () => run('aios.createCustom', b.getAttribute('data-create'))));

  // Density toggle (comfortable ⇄ compact) — persisted in webview state.
  const densityBtn = document.getElementById('density');
  function applyDensity(c){ document.body.classList.toggle('compact', !!c); densityBtn.classList.toggle('active', !!c); }
  applyDensity(((vscode.getState && vscode.getState()) || {}).compact);
  densityBtn.addEventListener('click', () => {
    const c = !document.body.classList.contains('compact');
    applyDensity(c);
    vscode.setState(Object.assign({}, (vscode.getState && vscode.getState()) || {}, { compact: c }));
  });

  // Collapsible cards — click a title to fold/unfold; persisted in webview state.
  const cstate0 = (vscode.getState && vscode.getState()) || {};
  const collapsed = new Set(cstate0.collapsed || []);
  function persistCollapsed(){ const s = (vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { collapsed: Array.from(collapsed) })); }
  const titleEls = Array.from(document.querySelectorAll('.card .ctitle'));
  function setCollapsed(card, key, on){ card.classList.toggle('collapsed', on); if (on) collapsed.add(key); else collapsed.delete(key); persistCollapsed(); }
  titleEls.forEach((ct, i) => {
    const card = ct.closest('.card');
    const key = (ct.textContent || '').trim().slice(0, 40);
    ct.tabIndex = 0;
    ct.setAttribute('role', 'button');
    if (collapsed.has(key)) card.classList.add('collapsed');
    ct.addEventListener('click', () => setCollapsed(card, key, !card.classList.contains('collapsed')));
    ct.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown'){ e.preventDefault(); (titleEls[i + 1] || titleEls[0]).focus(); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); (titleEls[i - 1] || titleEls[titleEls.length - 1]).focus(); }
      else if (e.key === 'ArrowRight'){ e.preventDefault(); setCollapsed(card, key, false); }
      else if (e.key === 'ArrowLeft'){ e.preventDefault(); setCollapsed(card, key, true); }
      else if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setCollapsed(card, key, !card.classList.contains('collapsed')); }
    });
  });
  // Minimize / expand ALL cards (⌘⌥G M): if any is open, collapse all; else expand all.
  function toggleAllCards(){
    const titles = Array.from(document.querySelectorAll('.card .ctitle'));
    const anyOpen = titles.some((ct) => !ct.closest('.card').classList.contains('collapsed'));
    titles.forEach((ct) => {
      const card = ct.closest('.card'); const key = (ct.textContent || '').trim().slice(0, 40);
      if (anyOpen) { card.classList.add('collapsed'); collapsed.add(key); }
      else { card.classList.remove('collapsed'); collapsed.delete(key); }
    });
    persistCollapsed();
  }

  document.getElementById('frequentMenu').addEventListener('click', () => run('aios.frequentMenu'));
  document.getElementById('ingestQuick').addEventListener('click', () => run('aios.ingest'));
  document.getElementById('onboard').addEventListener('click', () => run('aios.onboarding'));
  // Dismiss is session-scoped: held in memory (not persisted), so it survives
  // view-switches (retainContextWhenHidden) but a window reload brings the nudge
  // back. Keyed by kind, so dismissing the morning nudge never suppresses the
  // evening close-day one. The cog "Ritual nudges" toggle is the permanent off.
  const nudgeDismissed = new Set();
  function renderNudge(n){
    const card=document.getElementById('nudgeCard'), act=document.getElementById('nudgeAction');
    if(!n || nudgeDismissed.has(n.kind)){ card.style.display='none'; act.dataset.kind=''; return; }
    act.textContent='';
    act.append(document.createTextNode(n.icon + ' '));
    if(n.cmdLabel){ const b=document.createElement('b'); b.textContent=n.cmdLabel; act.append(b, document.createTextNode(' ')); }
    act.append(document.createTextNode(n.label));
    act.dataset.kind = n.kind;
    act.dataset.command = n.command || '';
    act.title = n.command ? ('Run ' + n.command) : '';
    card.style.display='';
  }
  document.getElementById('nudgeAction').addEventListener('click', (e) => {
    const k=e.currentTarget.dataset.kind, cmd=e.currentTarget.dataset.command;
    if(k==='sessions') vscode.postMessage({ type:'ritual', name:'close-session' });
    else if(cmd) vscode.postMessage({ type:'nudgeRun', command:cmd });
  });
  document.getElementById('nudgeDismiss').addEventListener('click', () => {
    const k=document.getElementById('nudgeAction').dataset.kind;
    if(k) nudgeDismissed.add(k);
    document.getElementById('nudgeCard').style.display='none';
  });
  document.getElementById('learnList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-file')) run('aios.openLearning', it.getAttribute('data-file'), Number(it.getAttribute('data-line')) || 0);
  });
  document.getElementById('outputList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-path')) run('aios.openOutput', it.getAttribute('data-path'), ev.metaKey || ev.ctrlKey);
  });
  document.getElementById('genReport').addEventListener('click', () => run('aios.reports'));
  document.getElementById('reportList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-path')) run('aios.openOutput', it.getAttribute('data-path'), ev.metaKey || ev.ctrlKey);
  });
  document.getElementById('goWithAgents').addEventListener('click', () => run('aios.goWithAgents'));

  // Click (or Enter) a running-session row → reveal its terminal. Delegated so
  // it survives the list re-rendering on every refresh.
  const runningList = document.getElementById('runningList');
  if (runningList) {
    const itemNP = (el) => ({ n: el.getAttribute('data-name'), p: Number(el.getAttribute('data-pid')) || undefined });
    const reveal = (el) => { if (!el) return; const { n, p } = itemNP(el); if (n) run('aios.revealAgent', n, p); };
    runningList.addEventListener('click', (ev) => {
      const item = ev.target.closest('.runitem'); if (!item) return;
      if (ev.target.closest('.runkill')) { const { n, p } = itemNP(item); if (n) { if (p) killed.add(p); run('aios.closeAgent', n, p); item.remove(); applyRunOpen(); } return; }
      reveal(item);
    });
    runningList.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); reveal(ev.target.closest('.runitem')); } });
  }

  document.getElementById('launchPrimary').addEventListener('click', () => run('aios.launchPrimary'));
  document.getElementById('spawnWorker').addEventListener('click', () => run('aios.spawnWorker'));
  document.getElementById('resume').addEventListener('click', () => run('aios.resume'));
  document.getElementById('cmdPicker').addEventListener('click', () => run('aios.runRitualPicker'));
  let runOpen = true;
  function applyRunOpen(){
    const list = document.getElementById('runningList');
    const hasItems = list.children.length > 0;
    list.style.display = runOpen ? '' : 'none';
    document.getElementById('runHint').style.display = (runOpen && hasItems) ? '' : 'none';
    document.getElementById('runCaret').textContent = runOpen ? '▾' : '▸';
  }
  document.getElementById('toggleRunning').addEventListener('click', () => { runOpen = !runOpen; applyRunOpen(); });
  let termOpen = true;
  function applyTermOpen(){
    document.getElementById('termList').style.display = termOpen ? '' : 'none';
    document.getElementById('termCaret').textContent = termOpen ? '▾' : '▸';
  }
  document.getElementById('toggleTerms').addEventListener('click', () => { termOpen = !termOpen; applyTermOpen(); });
  // Key-shortcuts section — own collapse, default collapsed, persisted (independent of hints).
  let scOpen = !!(((vscode.getState && vscode.getState()) || {}).scOpen);
  function applyShortcuts(){ document.getElementById('scGrid').classList.toggle('collapsed', !scOpen); document.getElementById('scCaret').textContent = scOpen ? '▾' : '▸'; }
  applyShortcuts();
  document.getElementById('scToggle').addEventListener('click', () => { scOpen = !scOpen; const s=(vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { scOpen })); applyShortcuts(); });
  document.getElementById('addSession').addEventListener('click', (e) => { e.stopPropagation(); run('aios.spawnWorker'); });
  document.getElementById('addTerm').addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'newTerminal' }); });
  document.getElementById('termList').addEventListener('click', (ev) => {
    const item = ev.target.closest('.runitem'); if (!item) return;
    const pid = Number(item.getAttribute('data-tpid')) || 0; if (!pid) return;
    if (ev.target.closest('[data-tclose]')) { vscode.postMessage({ type: 'closeTerminal', pid }); item.remove(); }
    else vscode.postMessage({ type: 'focusTerminal', pid });
  });
  document.getElementById('quotaWarn').addEventListener('click', () => { const to = document.getElementById('quotaWarn').getAttribute('data-to'); if (to) run('aios.swapTo', to); });
  document.getElementById('browseAgents').addEventListener('click', () => run('aios.spawnAgent'));
  document.getElementById('skillsPicker').addEventListener('click', () => run('aios.skillsPicker'));
  document.getElementById('companyAction').addEventListener('click', () => run('aios.companyAction'));
  document.getElementById('collaborateAction').addEventListener('click', () => run('aios.collaborateAction'));
  document.getElementById('browseProjects').addEventListener('click', () => run('aios.browseContext', 'projects'));
  document.getElementById('browseDeclared').addEventListener('click', () => run('aios.browseContext', 'declared'));
  document.getElementById('browseObserved').addEventListener('click', () => run('aios.browseContext', 'observed'));
  document.getElementById('updBadge').addEventListener('click', () => {
    if (document.getElementById('updBadge').classList.contains('upd')) run('aios.updateFramework');
    else vscode.postMessage({ type: 'recheck' });
  });

  document.getElementById('prev').addEventListener('click', () => step(-1));
  document.getElementById('next').addEventListener('click', () => step(1));
  document.getElementById('calToggle').addEventListener('click', () => {
    calView = calView === 'month' ? 'week' : 'month';
    document.getElementById('calToggle').textContent = calView === 'month' ? 'Week' : 'Month';
    if (calView === 'week') { pendingWeek = null; weekIdx = -1; } // -1 → render() picks today's week
    if (lastData) render(lastData);
  });
  function navMonth(d){ let m = cur.month + d, y = cur.year; if (m<1){m=12;y--;} if (m>12){m=1;y++;} vscode.postMessage({ type:'navMonth', year:y, month:m }); }
  function step(d){
    if (calView === 'month' || !lastData) return navMonth(d);
    const total = lastData.weeks.length;
    const next = weekIdx + d;
    if (next < 0) { pendingWeek = 'last'; navMonth(-1); }
    else if (next > total - 1) { pendingWeek = 'first'; navMonth(1); }
    else { weekIdx = next; render(lastData); }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state'){
      if (msg.primary) document.getElementById('vPrimary').textContent = msg.primary;
      document.body.classList.toggle('no-hints', msg.showHints === false);
      document.getElementById('vFrequent').textContent = (msg.frequent || 0) + '';
      document.getElementById('vAgents').textContent = (msg.agents || 0) + '';
      document.getElementById('vSkills').textContent = (msg.skills || 0) + '';
      document.getElementById('vCommands').textContent = (msg.commands || 0) + '';
      document.getElementById('vCompanies').textContent = (msg.companies || []).length + '';
      document.getElementById('vCollab').textContent = (msg.collab || []).length + '';
      document.getElementById('vProjects').textContent = (msg.projects || 0) + '';
      document.getElementById('vDeclared').textContent = (msg.declared || 0) + '';
      document.getElementById('vObserved').textContent = (msg.observed || 0) + '';
      const ga = msg.goAgents || 0;
      document.getElementById('vGoAgents').textContent = ga + '';
      document.getElementById('goWithAgents').classList.toggle('dim', ga === 0);
      const ll = msg.learnings || [];
      document.getElementById('learnList').innerHTML = ll.map((x) => {
        const t = (x.title || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-file="' + (x.file||'') + '" data-line="' + (x.line||0) + '" title="' + x.source + ' · ' + x.date + ' — click to read">'
          + '<span class="lsrc ' + x.source + '">' + x.source + '</span><span class="ltitle">' + t + '</span><span class="ldate">' + (x.date||'').slice(5) + '</span></div>';
      }).join('');
      document.getElementById('learnHint').style.display = ll.length ? '' : 'none';
      renderNudge(msg.nudge);
      const outs = msg.outputs || [];
      document.getElementById('outputList').innerHTML = outs.map((o) => {
        const nm = (o.name || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-path="' + (o.path||'') + '" title="' + (o.group||'') + ' — click to read · ⌘-click for source"><span class="lsrc">' + (o.group||'') + '</span><span class="ltitle">' + nm + '</span></div>';
      }).join('');
      document.getElementById('outputHint').style.display = outs.length ? '' : 'none';
      const reps = msg.reports || [];
      document.getElementById('reportList').innerHTML = reps.map((r) => {
        const nm = (r.name || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-path="' + (r.path||'') + '" title="report — click to read · ⌘-click for source"><span class="lsrc">report</span><span class="ltitle">' + nm + '</span></div>';
      }).join('');
      document.getElementById('reportHint').style.display = reps.length ? '' : 'none';
    } else if (msg.type === 'running'){
      const raw = msg.running || [];
      // Self-clean: once the registry no longer lists a killed pid, stop filtering it.
      for (const pid of Array.from(killed)) { if (!raw.some((a) => a.pid === pid)) killed.delete(pid); }
      const r = raw.filter((a) => !killed.has(a.pid));
      const v = document.getElementById('vRunning'); v.textContent = r.length + '';
      v.className = r.length ? 'val' : 'k';
      const list = document.getElementById('runningList');
      if (list){
        list.innerHTML = r.map((a) => {
          const s = statusInfo(a.status);
          const nm = (a.name || '(unnamed)').replace(/</g,'&lt;');
          return '<div class="runitem" role="button" tabindex="0" data-name="' + nm + '" data-pid="' + (a.pid||'') + '" title="' + s.title + ' — click to reveal its terminal">'
            + '<span class="dot ' + s.cls + '"></span><span class="rname">' + nm + '</span><span class="k"> · ' + s.label + '</span>'
            + '<button class="runkill" data-kill="1" title="Close terminal (kill)" aria-label="Close terminal">'
            + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
            + '</button></div>';
        }).join('');
      }
      applyRunOpen();
      const q = msg.quota || {};
      const qline = document.getElementById('quotaLine');
      if (q.has) {
        const f = q.fiveHour || 0, s = q.sevenDay || 0;
        const lvl = (f >= 95 || s >= 99) ? 'red' : f >= 90 ? 'orange' : f >= 85 ? 'yellow' : 'green';
        document.getElementById('quotaBar').className = 'quotabar ' + lvl;
        document.getElementById('quotaFill').style.width = Math.min(100, f) + '%';
        document.getElementById('quotaLabel').textContent = s > 0 ? '5h (7d ' + Math.round(s) + '%)' : '5h';
        qline.title = '5h ' + f + '% · 7d ' + s + '% — Anthropic rate-limit usage';
        qline.style.display = '';
      } else { qline.style.display = 'none'; }
      const qw = document.getElementById('quotaWarn');
      if (q.showSwap && q.to) {
        qw.textContent = '↔ Swap to ' + (q.to.split('@')[0]);
        qw.setAttribute('data-to', q.to);
        qw.style.display = '';
      } else { qw.style.display = 'none'; }
    } else if (msg.type === 'terminals'){
      const terms = msg.terminals || [];
      const vt = document.getElementById('vTerms'); vt.textContent = terms.length + ''; vt.className = terms.length ? 'val' : 'k';
      const tl = document.getElementById('termList');
      if (tl){
        tl.innerHTML = terms.map((t) => {
          const nm = (t.name || 'terminal').replace(/</g,'&lt;');
          return '<div class="runitem" role="button" tabindex="0" data-tpid="' + (t.pid||0) + '" title="Click to focus this terminal">'
            + '<span class="dot unk"></span><span class="rname">' + nm + '</span>'
            + '<button class="runkill" data-tclose="1" title="Close terminal" aria-label="Close terminal">'
            + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
            + '</button></div>';
        }).join('');
      }
      applyTermOpen();
    } else if (msg.type === 'updateStatus'){
      const b = document.getElementById('updBadge');
      const fw = (msg.framework && msg.framework.hash) ? (' · ' + msg.framework.hash) : '';
      const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      const DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>';
      const DASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg>';
      if (msg.state === 'up-to-date'){ b.innerHTML = CHECK; b.className = 'hbadge ok'; b.title = 'Up to date' + fw; }
      else if (msg.state === 'available'){ b.innerHTML = DOWN; b.className = 'hbadge upd'; b.title = 'Updates available — click to run /aios:update' + fw; }
      else { b.innerHTML = DASH; b.className = 'hbadge'; b.title = 'Status unknown' + fw; }
    } else if (msg.type === 'month'){ renderMonth(msg.data); }
    else if (msg.type === 'calendarDirty'){ if (cur.year) vscode.postMessage({ type: 'navMonth', year: cur.year, month: cur.month }); }
    else if (msg.type === 'toggleAllCards'){ toggleAllCards(); }
  });

  // Map a session's registry status → {dot color class, friendly label, tooltip}.
  // Claude currently emits only 'busy' / 'idle'; the input/error buckets are
  // forward-compatible — they light up only IF Claude ever reports such a status.
  function statusInfo(raw){
    const st = (raw||'').toLowerCase();
    if (st === 'idle' || st === 'ready') return { cls:'idle',  label:'ready',       title:'Idle — ready / waiting for you' };
    if (st === 'busy' || st === 'working' || st === 'running') return { cls:'busy', label:'working', title:'Busy — actively working' };
    if (/wait|input|prompt|\bask\b|attention|approv|permission|block/.test(st)) return { cls:'input', label:'needs input', title:'Waiting on you — reveal it' };
    if (/error|fail|crash/.test(st)) return { cls:'error', label: st, title:'Error — reveal it' };
    if (!st) return { cls:'unk', label:'unknown', title:'Status unknown' };
    return { cls:'unk', label: st, title: st };
  }

  function renderMonth(data){
    cur = { year: data.year, month: data.month };
    lastData = data;
    render(data);
  }

  function render(data){
    let weeks = data.weeks;
    let label = data.label;
    if (calView === 'week'){
      // Resolve which week to show: edge after a cross-month nav, else today's week, else clamp.
      if (pendingWeek === 'last') weekIdx = weeks.length - 1;
      else if (pendingWeek === 'first') weekIdx = 0;
      else if (weekIdx < 0) { const ti = weeks.findIndex((w) => w.some((c) => c.isToday)); weekIdx = ti >= 0 ? ti : 0; }
      pendingWeek = null;
      weekIdx = Math.max(0, Math.min(weekIdx, weeks.length - 1));
      weeks = [weeks[weekIdx]];
      label = data.label + ' · week';
    }
    document.getElementById('calLabel').textContent = label;
    document.getElementById('dow').innerHTML = data.weekdays.map((w) => '<th>' + w + '</th>').join('');
    const body = document.getElementById('cal');
    body.innerHTML = weeks.map((week) =>
      '<tr>' + week.map((c) => {
        if (c.date === null) return '<td><div class="cell empty"></div></td>';
        const cls = ['cell','day']; if (c.hasNote) cls.push('has'); if (c.isToday) cls.push('today');
        return '<td><div class="' + cls.join(' ') + '" data-date="' + c.date + '"><span class="num">' + c.day + '</span></div></td>';
      }).join('') + '</tr>'
    ).join('');
    // Only days that already have a note are clickable — no accidental note creation.
    body.querySelectorAll('.cell.has').forEach((el) =>
      el.addEventListener('click', (ev) => vscode.postMessage({ type: 'openDay', date: el.getAttribute('data-date'), edit: ev.metaKey || ev.ctrlKey })));
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
