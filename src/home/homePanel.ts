import * as vscode from 'vscode';
import { getMonthData, openDailyNote } from './calendar';
import * as path from 'path';
import * as fs from 'fs';
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

      // Refresh the update badge the moment `.aios-update` changes — a sync run
      // in a terminal (or any session outside Glass) bumps the tracker hash, so
      // the badge re-checks live instead of waiting for a hide→show visibility
      // flip (which leaves it stale-showing "behind" when you're actually current).
      const auw = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(fwRoot), '.aios-update')
      );
      const onTracker = () => this.recheck();
      auw.onDidChange(onTracker);
      auw.onDidCreate(onTracker);
      auw.onDidDelete(onTracker);
      webviewView.onDidDispose(() => auw.dispose());
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
    // Project label = the session cwd's basename; omitted when it's just the
    // framework root (the default vault session — labeling it adds no signal).
    let fwReal = '';
    try { fwReal = fs.realpathSync(frameworkRoot() || ''); } catch { /* ignore */ }
    const projOf = (cwd: string): string => {
      if (!cwd) return '';
      let real = cwd;
      try { real = fs.realpathSync(cwd); } catch { /* keep raw */ }
      return fwReal && real === fwReal ? '' : path.basename(real);
    };
    this.post({
      type: 'running',
      running: running.map((a) => ({
        name: a.name, pid: a.pid, status: a.status,
        proj: projOf(a.cwd), updatedAt: a.updatedAt,
      })),
      quota,
    });
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
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    // style-src needs the webview origin for the external stylesheet; scripts stay nonce-gated.
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';`;
    // The panel UI lives in media/home.{html,css,js} — real files (lintable, smoke-
    // testable, shareable with a future standalone shell), not a template literal
    // the compiler can't see into. Only CSP/nonce/URIs are injected at load.
    try {
      const page = fs.readFileSync(vscode.Uri.joinPath(media, 'home.html').fsPath, 'utf8');
      return page
        .replace(/{{CSP}}/g, csp)
        .replace(/{{NONCE}}/g, nonce)
        .replace(/{{CSS_URI}}/g, webview.asWebviewUri(vscode.Uri.joinPath(media, 'home.css')).toString())
        .replace(/{{JS_URI}}/g, webview.asWebviewUri(vscode.Uri.joinPath(media, 'home.js')).toString());
    } catch (e) {
      return `<!DOCTYPE html><html><body><p>AIOS Glass: failed to load the panel UI — ${String(e)}</p></body></html>`;
    }
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
