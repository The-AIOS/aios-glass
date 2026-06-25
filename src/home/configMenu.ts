import * as vscode from 'vscode';
import {
  MODEL_OPTIONS, MODE_OPTIONS, TERMINAL_OPTIONS,
  setGlobalModel, setMode, setTerminalMode,
  currentModel, currentMode, currentTerminalMode, modelLabel, currentAccount,
  remoteControlOn, setRemoteControl,
  currentAnthropicAccount, anthropicAccounts,
  automaticUpdates, setAutomaticUpdates,
  showHints, setShowHints,
  showNudges, setShowNudges,
  nativeTabsEnabled, setNativeTabs,
  currentTheme, setTheme, setAiosTheme, isAiosWorkbenchTheme,
  fileIconsEnhanced, setFileIcons,
  showHiddenFiles, setShowHidden,
  autoReveal, setAutoReveal,
  showMemory, setShowMemory,
  currentLanguage, setLanguage, GlassLang,
  openNotesIn, setOpenNotesIn, OpenNotesMode
} from './config';
import { launchClaude, launchInSession, launchAccountSwap } from '../rituals/runner';
import { HomeViewProvider } from './homePanel';
import { t } from '../i18n';

/** Human label for the Glass language setting. */
function langLabel(l: GlassLang): string {
  return l === 'es' ? 'Español' : l === 'pt-br' ? 'Português (BR)' : l === 'en' ? 'English' : 'Auto (IDE)';
}

/** Human label for the open-notes-in setting. */
function openNotesLabel(m: OpenNotesMode): string {
  return m === 'editor' ? t('editor') : t('preview to the side');
}

/** The cog menu — Claude account, model, permission mode, terminal mode. */
export async function openConfigMenu(): Promise<void> {
  const account = currentAccount() || t('not signed in');
  const multiAccount = anthropicAccounts().length > 1; // swap only matters with 2+
  const sep = (label: string): vscode.QuickPickItem & { id?: string } => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const onOff = (b: boolean) => (b ? t('on') : t('off'));
  const shownHidden = (b: boolean) => (b ? t('shown') : t('hidden'));
  const items: (vscode.QuickPickItem & { id?: string })[] = [
    // ── Appearance — how the Glass surfaces look ──
    sep(t('Appearance')),
    { label: '$(globe) ' + t('Language'), description: langLabel(currentLanguage()), id: 'language' },
    { label: '$(color-mode) ' + t('Theme (Glass + IDE)'), description: isAiosWorkbenchTheme() ? `${currentTheme()} · ${t('IDE synced')}` : `${t('Glass')}: ${currentTheme()}`, id: 'theme' },
    { label: '$(eye) ' + t('Secondary hints'), description: onOff(showHints()), id: 'hints' },
    { label: '$(bell) ' + t('Ritual nudges'), description: onOff(showNudges()), id: 'nudges' },
    { label: '$(pulse) ' + t('Session memory'), description: shownHidden(showMemory()), id: 'memory' },
    // ── Explorer — the file tree ──
    sep(t('Explorer')),
    { label: '$(go-to-file) ' + t('Open notes in'), description: openNotesLabel(openNotesIn()), id: 'openin' },
    { label: '$(symbol-file) ' + t('File icons'), description: fileIconsEnhanced() ? t('enhanced') : t('plain'), id: 'fileicons' },
    { label: '$(eye) ' + t('Hidden files'), description: shownHidden(showHiddenFiles()), id: 'hidden' },
    { label: '$(target) ' + t('Auto-reveal active file'), description: onOff(autoReveal()), id: 'autoreveal' },
    // ── Claude — the engine behind the surfaces ──
    sep(t('Claude')),
    { label: '$(server) ' + t('Model'), description: modelLabel(currentModel()), id: 'model' },
    { label: '$(shield) ' + t('Permission mode'), description: currentMode(), id: 'mode' },
    { label: '$(terminal) ' + t('Terminal mode'), description: currentTerminalMode(), id: 'terminal' },
    { label: '$(list-flat) ' + t('Native terminal tabs'), description: shownHidden(nativeTabsEnabled()), id: 'nativetabs' },
    { label: '$(broadcast) ' + t('Remote control'), description: onOff(remoteControlOn()), id: 'remote' },
    { label: '$(sync) ' + t('Automatic updates'), description: onOff(automaticUpdates()), id: 'autoupdate' },
    // ── Session — kick off a focused run ──
    sep(t('Session')),
    { label: '$(target) ' + t('Set a session goal'), description: '/goal', id: 'goal' },
    { label: '$(check-all) ' + t('Fewer permission prompts'), description: '/fewer-permission-prompts', id: 'fewerperms' },
    { label: '$(clock) ' + t('Schedule work'), description: '/schedule', id: 'schedule' },
    // ── Account ──
    sep(t('Account')),
    ...(multiAccount ? [{ label: '$(arrow-swap) ' + t('Swap account'), description: currentAnthropicAccount(), id: 'swap' }] : []),
    { label: '$(account) ' + t('Login'), description: account, id: 'login' },
    { label: '$(sign-out) ' + t('Logout'), id: 'logout' },
    { label: '$(info) ' + t('Auth status'), id: 'status' },
    // ── Help ──
    sep(t('Help')),
    { label: '$(rocket) ' + t('Getting started'), description: t('the six-step walkthrough'), id: 'walkthrough' },
    { label: '$(output) ' + t('Show logs'), description: t('diagnostics — swallowed action failures'), id: 'logs' }
  ];
  const pick = await vscode.window.showQuickPick(items, { title: t('AIOS Glass — Config'), placeHolder: t('Account · model · mode · updates') });
  if (!pick) return;

  switch (pick.id) {
    case 'walkthrough':
      await vscode.commands.executeCommand('aios.openWalkthrough');
      return;
    case 'logs':
      await vscode.commands.executeCommand('aios.showLogs');
      return;
    case 'language': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(globe) ' + t('Auto'), description: t('follow the IDE display language'), value: 'auto' as const },
          { label: 'English', value: 'en' as const },
          { label: 'Español', description: t('LATAM neutral'), value: 'es' as const },
          { label: 'Português', description: 'Brasil', value: 'pt-br' as const }
        ],
        { title: `${t('Glass language')} — ${t('currently')} ${langLabel(currentLanguage())}`, placeHolder: t('Home panel language · IDE menus follow Configure Display Language') }
      );
      if (choice) {
        await setLanguage(choice.value);
        HomeViewProvider.current?.rerender();
        if (choice.value !== 'auto') {
          void vscode.window.showInformationMessage(
            `${t('Glass Home is now in')} ${langLabel(choice.value)}. ${t('To also translate IDE command titles & native menus, set the display language.')}`,
            t('Configure Display Language')
          ).then((p) => { if (p === t('Configure Display Language')) void vscode.commands.executeCommand('workbench.action.configureLocale'); });
        }
      }
      return;
    }
    case 'theme': {
      const onAios = isAiosWorkbenchTheme();
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(circle-filled) AIOS Dark', description: t('Glass + IDE — deep black + coral'), mode: 'dark' as const, full: true },
          { label: '$(circle-outline) AIOS Light', description: t('Glass + IDE — paper canvas + coral'), mode: 'light' as const, full: true },
          { label: '$(paintcan) ' + t('Glass dark only'), description: t('Glass only — keep your IDE theme'), mode: 'dark' as const, full: false },
          { label: '$(paintcan) ' + t('Glass light only'), description: t('Glass only — keep your IDE theme'), mode: 'light' as const, full: false }
        ],
        { title: `${t('Theme — Glass')} ${currentTheme()}${onAios ? ` · ${t('IDE on AIOS (in lockstep)')}` : ''}`, placeHolder: t('AIOS = Glass + IDE together · Glass-only leaves your IDE theme alone') }
      );
      if (choice) await (choice.full ? setAiosTheme(choice.mode) : setTheme(choice.mode));
      return;
    }
    case 'hidden': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye-closed) ' + t('Hidden'), description: t('hide dotfiles (.gitignore, .vscode, …)'), value: false },
          { label: '$(eye) ' + t('Shown'), description: t('show dotfiles in the explorer'), value: true }
        ],
        { title: `${t('Hidden files')} — ${t('currently')} ${shownHidden(showHiddenFiles())}` }
      );
      if (choice) await setShowHidden(choice.value);
      return;
    }
    case 'memory': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) ' + t('Shown'), description: t("each session's process-tree RAM in the Sessions card"), value: true },
          { label: '$(eye-closed) ' + t('Hidden'), description: t('hide the per-session memory readout'), value: false }
        ],
        { title: `${t('Session memory')} — ${t('currently')} ${shownHidden(showMemory())}` }
      );
      if (choice) await setShowMemory(choice.value);
      return;
    }
    case 'autoreveal': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(target) ' + t('On'), description: t('explorer follows the active editor — expand to + select it'), value: true },
          { label: '$(circle-slash) ' + t('Off'), description: t('explorer stays put when you switch tabs'), value: false }
        ],
        { title: `${t('Auto-reveal active file')} — ${t('currently')} ${onOff(autoReveal())}` }
      );
      if (choice) await setAutoReveal(choice.value);
      return;
    }
    case 'openin': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(split-horizontal) ' + t('Preview to the side'), description: t('Foam-rendered wikilinks beside the source — Obsidian-style'), value: 'previewToSide' as const },
          { label: '$(code) ' + t('Editor'), description: t('raw source — faster, skips the preview webview'), value: 'editor' as const }
        ],
        { title: `${t('Open notes in')} — ${t('currently')} ${openNotesLabel(openNotesIn())}`, placeHolder: t('Calendar days + Explorer files · ⌘/Ctrl-click always opens the source') }
      );
      if (choice) await setOpenNotesIn(choice.value);
      return;
    }
    case 'fileicons': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(symbol-color) ' + t('Enhanced'), description: t('colorful per-type icons (md, json, code, images…)'), value: 'enhanced' as const },
          { label: '$(symbol-file) ' + t('Plain'), description: t('one neutral document icon for every file'), value: 'plain' as const }
        ],
        { title: `${t('Explorer icons')} — ${t('currently')} ${fileIconsEnhanced() ? t('enhanced') : t('plain')}` }
      );
      if (choice) await setFileIcons(choice.value);
      return;
    }
    case 'model': {
      const m = await vscode.window.showQuickPick(
        MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
        { title: t('Default model — writes ~/.claude/settings.json') }
      );
      if (m) await setGlobalModel(m.value);
      return;
    }
    case 'mode': {
      const m = await vscode.window.showQuickPick(MODE_OPTIONS, {
        title: t('Permission mode — writes permissions.defaultMode')
      });
      if (m) await setMode(m);
      return;
    }
    case 'terminal': {
      const m = await vscode.window.showQuickPick(TERMINAL_OPTIONS, {
        title: t('Terminal mode — where rituals/actions run')
      });
      if (m) await setTerminalMode(m);
      return;
    }
    case 'remote': {
      const choice = await vscode.window.showQuickPick(['on', 'off'], {
        title: t('Remote control — append --remote-control to Glass launches')
      });
      if (choice) await setRemoteControl(choice === 'on');
      return;
    }
    case 'hints': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) ' + t('On'), description: t('show button hints + header subtitles'), value: true },
          { label: '$(eye-closed) ' + t('Off'), description: t('cleaner, label-only view (counts + helpers stay)'), value: false }
        ],
        { title: `${t('Secondary hints')} — ${t('currently')} ${onOff(showHints())}` }
      );
      if (choice) await setShowHints(choice.value);
      return;
    }
    case 'nudges': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(bell) ' + t('On'), description: t('morning ritual · midday session-wrap · evening close-day'), value: true },
          { label: '$(bell-slash) ' + t('Off'), description: t('no nudge banner at all'), value: false }
        ],
        { title: `${t('Ritual nudges')} — ${t('currently')} ${onOff(showNudges())}` }
      );
      if (choice) await setShowNudges(choice.value);
      return;
    }
    case 'nativetabs': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) ' + t('Shown'), description: t("VS Code's native terminal tabs"), value: true },
          { label: '$(eye-closed) ' + t('Hidden'), description: t("manage terminals from Glass's Sessions card"), value: false }
        ],
        { title: `${t('Native terminal tabs')} — ${t('currently')} ${shownHidden(nativeTabsEnabled())}` }
      );
      if (choice) await setNativeTabs(choice.value);
      return;
    }
    case 'goal': return launchInSession('/goal', { name: 'goal', icon: 'target', color: 'terminal.ansiBlue' });
    case 'fewerperms': return launchInSession('/fewer-permission-prompts', { name: 'permissions', icon: 'shield', color: 'terminal.ansiBlue' });
    case 'schedule': return launchInSession('/schedule', { name: 'schedule', icon: 'clock', color: 'terminal.ansiBlue' });
    case 'autoupdate': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(check) ' + t('On'), description: t('/today & /close-day auto-pull updates when BEHIND'), value: true },
          { label: '$(circle-slash) ' + t('Off'), description: t('only nudge — never auto-run /aios:update'), value: false }
        ],
        { title: `${t('Automatic updates')} — ${t('currently')} ${onOff(automaticUpdates())}`, placeHolder: t('Writes USER.md → ## Settings') }
      );
      if (choice) {
        await setAutomaticUpdates(choice.value);
        void vscode.window.showInformationMessage(`${t('Automatic updates')} ${onOff(choice.value)} — ${t('saved to USER.md.')}`);
      }
      return;
    }
    case 'swap': {
      const cur = currentAnthropicAccount();
      const others = anthropicAccounts().filter((a) => a && a !== cur);
      if (!others.length) {
        void vscode.window.showInformationMessage(`${t('Only one Anthropic account is configured')}${cur ? ` (${cur})` : ''}. ${t('Add more under USER.md → ## Anthropic accounts.')}`);
        return;
      }
      const pick = await vscode.window.showQuickPick(others, {
        title: `${t('Swap account — now:')} ${cur || t('unknown')}`,
        placeHolder: t('Switch to… (silent — claude-switch)')
      });
      if (pick) await launchAccountSwap(pick);
      return;
    }
    case 'login': return launchClaude('auth login');
    case 'logout': return launchClaude('auth logout');
    case 'status': return launchClaude('auth status');
  }
}
