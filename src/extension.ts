import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runRitual, launchAios, runRitualPicker, launchResume, launchKill, revealAgentTerminal, disposeAgentTerminal, launchPrimary, launchSpawn, launchAccountSwap } from './rituals/runner';
import { runFrequentTask, openFrequentMenu, initFrequentTasks } from './tasks/frequent';
import { runReports } from './tasks/reports';
import { goWithAgents } from './tasks/goWithAgents';
import { primaryName, contextDir, ContextKind } from './home/vault';
import { AiosCommand, resolveCommandsDir } from './aios/commands';
import { HomeViewProvider } from './home/homePanel';
import { spawnAgentFlow, spawnWorker } from './agents/spawn';
import { Agent } from './agents/agents';
import { Capability, skillsPicker } from './capabilities/capabilities';
import { companyAction, collaborateAction } from './spaces/spacesActions';
import { openConfigMenu } from './home/configMenu';
import { TERMINAL_OPTIONS, setTerminalMode } from './home/config';
import { createCustom, CreateKind, CREATE_KINDS } from './create/create';
import { listRunningAgents } from './agents/running';
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
  initFrequentTasks(context); // wire frequent-tasks persistence (globalState)

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

    vscode.commands.registerCommand('aios.launchPrimary', () => launchPrimary(primaryName())),
    vscode.commands.registerCommand('aios.resume', () => launchResume()),

    // Reports: pick type + period → generate.
    vscode.commands.registerCommand('aios.reports', () => runReports()),

    // Frequent tasks (intent-first): the editable menu, + direct run by id.
    vscode.commands.registerCommand('aios.frequentMenu', () => openFrequentMenu()),
    vscode.commands.registerCommand('aios.frequentTask', (id?: string) => {
      if (typeof id === 'string') return runFrequentTask(id);
    }),

    // Friendly onboarding companion — spawn the onboarding-aios guide agent.
    vscode.commands.registerCommand('aios.onboarding', () => launchSpawn('onboarding-aios')),

    // Open the vault graph (Foam) from the header.
    vscode.commands.registerCommand('aios.showGraph', () => vscode.commands.executeCommand('foam-vscode.show-graph')),

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
      if (e.affectsConfiguration('aiosGlass.frameworkPath') || e.affectsConfiguration('aiosGlass.showHints')) HomeViewProvider.current?.refresh();
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
