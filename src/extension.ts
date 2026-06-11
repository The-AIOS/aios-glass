import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runRitual, launchAios, launchSkill, runRitualPicker, launchResume, launchKill, revealAgentTerminal, disposeAgentTerminal, closeSessionInTerminal, interruptSessionTerminal, askAios, launchPrimary, launchSpawn, launchAccountSwap, runInPrimarySession, runInActiveClaude, terminalHasClaude } from './rituals/runner';
import { openDailyNote } from './home/calendar';
import { runFrequentTask, openFrequentMenu, listFrequentTasks } from './tasks/frequent';
import { listRoutines, runRoutine } from './tasks/routines';
import { runReports } from './tasks/reports';
import { goWithAgents } from './tasks/goWithAgents';
import { primaryName, contextDir, ContextKind } from './home/vault';
import { AiosCommand, resolveCommandsDir, discoverCommands } from './aios/commands';
import { HomeViewProvider } from './home/homePanel';
import { spawnAgentFlow, spawnWorker } from './agents/spawn';
import { Agent, discoverAgents, iconForAgent } from './agents/agents';
import { Capability, skillsPicker, discoverSkills } from './capabilities/capabilities';
import { companyAction, collaborateAction } from './spaces/spacesActions';
import { openConfigMenu } from './home/configMenu';
import { TERMINAL_OPTIONS, setTerminalMode } from './home/config';
import { createCustom, CreateKind, CREATE_KINDS } from './create/create';
import { listRunningAgents } from './agents/running';
import { swallow, logChannel } from './log';
import { initGlassState } from './state';
import { frameworkRoot } from './home/vault';

const DOC_FILES: Record<string, string> = {
  cheatsheet: 'CHEATSHEET.md',
  intent: 'INTENT.md',
  user: 'USER.md',
  tools: 'TOOLS.md',
  readme: 'README.md'
};

export function activate(context: vscode.ExtensionContext): void {
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

    vscode.commands.registerCommand('aios.companyAction', (name?: string) => companyAction(name)),
    vscode.commands.registerCommand('aios.collaborateAction', () => collaborateAction()),
    vscode.commands.registerCommand('aios.updateFramework', () => launchAios('update')),

    vscode.commands.registerCommand('aios.openConfigMenu', () => openConfigMenu()),
    vscode.commands.registerCommand('aios.terminalMode', async () => {
      const pick = await vscode.window.showQuickPick(TERMINAL_OPTIONS, { title: 'Terminal control', placeHolder: 'ask · active' });
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
        void vscode.window.showInformationMessage(`AIOS Glass: no notes in ${kind}.`);
        return;
      }
      const labels: Record<ContextKind, string> = {
        declared: 'Declared — what you’ve told Claude',
        observed: 'Observed — what Claude has learned',
        projects: 'Projects'
      };
      const pick = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.replace(/\.md$/, ''), file: f })),
        { title: labels[kind], placeHolder: 'Open a note' }
      );
      if (pick) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(dir, pick.file)));
    }),
    vscode.commands.registerCommand('aios.runRitualPicker', () => runRitualPicker()),
    vscode.commands.registerCommand('aios.skillsPicker', () => skillsPicker()),
    vscode.commands.registerCommand('aios.createCustom', async (kind?: CreateKind) => {
      if (!kind) {
        const pick = await vscode.window.showQuickPick(
          CREATE_KINDS.map((k) => ({ label: `New ${k}`, value: k })),
          { title: 'Add a custom element', placeHolder: 'Launches the AIOS builder' }
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
        title: 'Ask AIOS',
        prompt: 'What do you need? Claude matches your ask to the right context & tools in your AIOS — and puts them to work',
        placeHolder: "e.g. 'prep tomorrow's investor call' · 'post about our launch'",
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
        { label: '$(sun) Plan my day', description: '/today', d: '/aios:today', primary: true },
        { label: '$(book) Close session', description: '/close-session', d: '/aios:close-session', primary: false },
        { label: '$(moon) Close the day', description: '/close-day', d: '/aios:close-day', primary: true }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Daily ritual', placeHolder: 'Run a daily ritual' });
      if (!pick) return;
      if (pick.primary) await runInPrimarySession(pick.d); else await runInActiveClaude(pick.d);
    }),

    vscode.commands.registerCommand('aios.workspacesPicker', async () => {
      const items: (vscode.QuickPickItem & { id: string })[] = [
        { label: '$(organization) Companies', description: 'mount · sync', id: 'companies' },
        { label: '$(live-share) Collaboration', description: 'shared spaces', id: 'collab' },
        { label: '$(folder) Projects', description: 'your work', id: 'projects' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Workspaces' });
      if (!pick) return;
      if (pick.id === 'companies') await companyAction();
      else if (pick.id === 'collab') await collaborateAction();
      else await vscode.commands.executeCommand('aios.browseContext', 'projects');
    }),

    vscode.commands.registerCommand('aios.personalizationsPicker', async () => {
      const items: (vscode.QuickPickItem & { key: string })[] = [
        { label: 'INTENT.md', description: 'autonomy · trust', key: 'intent' },
        { label: 'USER.md', description: 'identity · settings', key: 'user' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Personalizations' });
      if (pick) await vscode.commands.executeCommand('aios.openDoc', pick.key);
    }),

    vscode.commands.registerCommand('aios.contextPicker', async () => {
      const items: (vscode.QuickPickItem & { ck: string })[] = [
        { label: 'Declared', description: 'what you told Claude', ck: 'declared' },
        { label: 'Observed', description: 'what Claude has learned', ck: 'observed' }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Context — about you' });
      if (pick) await vscode.commands.executeCommand('aios.browseContext', pick.ck);
    }),

    vscode.commands.registerCommand('aios.runningPicker', async () => {
      const sessions = await listRunningAgents();
      const sessionNames = new Set(sessions.map((a) => a.name));
      type RunItem = vscode.QuickPickItem & { rk: 'session' | 'terminal'; name?: string; pid?: number; term?: vscode.Terminal };
      const items: RunItem[] = sessions.map((a) => ({ label: `$(server-process) ${a.name}`, description: a.status || 'session', rk: 'session', name: a.name, pid: a.pid }));
      for (const t of vscode.window.terminals) {
        if (sessionNames.has(t.name)) continue;
        if (await terminalHasClaude(t)) continue;
        items.push({ label: `$(terminal) ${t.name}`, description: 'terminal', rk: 'terminal', term: t });
      }
      if (!items.length) { void vscode.window.showInformationMessage('AIOS Glass: nothing running.'); return; }
      const pick = await vscode.window.showQuickPick<RunItem>(items, { title: 'Running — sessions & terminals', placeHolder: 'Arrows to navigate · type to filter · Enter to reveal' });
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

    // Reveal a running session's terminal directly (used by clicking a name in
    // the Home running-agents list). name + pid match by process-tree ancestry.
    vscode.commands.registerCommand('aios.revealAgent', (name?: string, pid?: number) => {
      if (typeof name === 'string') return revealAgentTerminal(name, typeof pid === 'number' ? pid : undefined);
    }),

    // Close a running session's terminal (kill) directly from the Home list.
    vscode.commands.registerCommand('aios.closeAgent', (name?: string, pid?: number) => {
      if (typeof name === 'string') return disposeAgentTerminal(name, typeof pid === 'number' ? pid : undefined);
    }),

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
        pk?: 'session' | 'routine' | 'task' | 'agent' | 'command' | 'skill' | 'ask';
        id?: string;
        name?: string;
        pid?: number;
        cmd?: AiosCommand;
      };
      const sep = (label: string): PalItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
      const items: PalItem[] = [];

      const sessions = await listRunningAgents();
      if (sessions.length) {
        items.push(sep('Sessions'));
        items.push(...sessions.map((s) => ({
          label: '$(terminal) ' + s.name, description: s.status || 'session', pk: 'session' as const, name: s.name, pid: s.pid,
        })));
      }
      const routines = listRoutines();
      if (routines.length) {
        items.push(sep('Routines'));
        items.push(...routines.map((r) => ({
          label: '$(run-all) ' + r.label,
          description: `routine · ${r.taskIds.length} tasks`,
          pk: 'routine' as const, id: r.id,
        })));
      }
      const tasks = listFrequentTasks();
      if (tasks.length) {
        items.push(sep('Tasks'));
        items.push(...tasks.map((t) => ({ label: '$(star) ' + t.label, description: t.hint, pk: 'task' as const, id: t.id })));
      }
      const agents = discoverAgents();
      if (agents.length) {
        items.push(sep('Agents'));
        items.push(...agents.map((a) => ({ label: '$(person) ' + a.name, description: a.group, detail: a.description + (a.keywords ? ' · ' + a.keywords : ''), pk: 'agent' as const, name: a.name })));
      }
      const cmds = discoverCommands();
      if (cmds.length) {
        items.push(sep('Commands'));
        items.push(...cmds.map((c) => ({ label: '$(terminal-bash) /aios:' + c.name, description: c.description, pk: 'command' as const, cmd: c })));
      }
      const skills = discoverSkills();
      if (skills.length) {
        items.push(sep('Skills'));
        items.push(...skills.map((s) => ({ label: '$(sparkle) ' + s.name, description: s.description, pk: 'skill' as const, name: s.name })));
      }

      const qp = vscode.window.createQuickPick<PalItem>();
      qp.title = 'AIOS — everything';
      qp.placeholder = 'Type to find a session, routine, task, agent, command, or skill';
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      // Semantic fallback: the picker's fuzzy match is lexical (names +
      // descriptions). When intent doesn't match words, hand the words to Claude
      // — the engine that CAN search by meaning. ONE stable item, toggled only on
      // empty↔typed (per-keystroke qp.items churn resets the highlight + flickers).
      const askItem: PalItem = { label: '$(sparkle) Ask AIOS with what you typed', description: 'Claude matches your ask to the right context & tools in your AIOS — and puts them to work', alwaysShow: true, pk: 'ask' as const };
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
        await vscode.env.openExternal(vscode.Uri.file(file));
        vscode.window.setStatusBarMessage('$(globe) Opened in browser', 3000);
        return;
      }
      if (/\.md$/i.test(file)) return vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
      return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),

    // Ingest content — ask for the source(s), then run /aios:ingest in-session.
    vscode.commands.registerCommand('aios.ingest', async () => {
      const src = await vscode.window.showInputBox({
        title: 'Ingest content',
        prompt: 'One or more sources — URLs, file paths, or a topic (blank to be guided)',
        placeHolder: 'e.g. https://… · ~/Downloads/notes.pdf · "the Q3 board call"',
        ignoreFocusOut: true,
      });
      if (src === undefined) return;
      await launchAios('ingest', src.trim() || undefined);
    }),

    vscode.commands.registerCommand('aios.manageAgents', async () => {
      const running = await listRunningAgents();
      if (running.length === 0) {
        void vscode.window.showInformationMessage('AIOS Glass: no running sessions detected.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        running.map((a) => ({
          label: a.name,
          description: `pid ${a.pid}${a.spawned ? '' : ' · not spawn-managed'}`,
          agent: a
        })),
        { title: 'Running sessions', placeHolder: 'Pick a session' }
      );
      if (!pick) return;

      const actions = [
        { label: '$(eye) Reveal terminal', id: 'reveal' },
        { label: '$(copy) Copy name', id: 'copy' },
        { label: '$(trash) Close Terminal (Kill)', id: 'kill' }
      ];
      const action = await vscode.window.showQuickPick(actions, { title: pick.agent.name, placeHolder: 'Action' });
      if (!action) return;
      if (action.id === 'reveal') await revealAgentTerminal(pick.agent.name, pick.agent.pid);
      else if (action.id === 'copy') { await vscode.env.clipboard.writeText(pick.agent.name); void vscode.window.showInformationMessage(`Copied “${pick.agent.name}”.`); }
      else if (action.id === 'kill') await disposeAgentTerminal(pick.agent.name, pick.agent.pid);
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
      if (e.affectsConfiguration('aiosGlass.frameworkPath') || e.affectsConfiguration('aiosGlass.showHints') || e.affectsConfiguration('aiosGlass.showNudges')) HomeViewProvider.current?.refresh();
    })
  );

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
