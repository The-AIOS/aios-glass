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
  nativeTabsEnabled, setNativeTabs
} from './config';
import { launchClaude, launchInSession, launchAccountSwap } from '../rituals/runner';

/** The cog menu — Claude account, model, permission mode, terminal mode. */
export async function openConfigMenu(): Promise<void> {
  const account = currentAccount() || 'not signed in';
  const multiAccount = anthropicAccounts().length > 1; // swap only matters with 2+
  const items: (vscode.QuickPickItem & { id?: string })[] = [
    { label: '$(server) Model', description: modelLabel(currentModel()), id: 'model' },
    { label: '$(shield) Permission mode', description: currentMode(), id: 'mode' },
    { label: '$(terminal) Terminal mode', description: currentTerminalMode(), id: 'terminal' },
    { label: '$(sync) Automatic updates', description: automaticUpdates() ? 'on' : 'off', id: 'autoupdate' },
    { label: '$(broadcast) Remote control', description: remoteControlOn() ? 'on' : 'off', id: 'remote' },
    { label: '$(eye) Secondary hints', description: showHints() ? 'on' : 'off', id: 'hints' },
    { label: '$(bell) Ritual nudges', description: showNudges() ? 'on' : 'off', id: 'nudges' },
    { label: '$(list-flat) Native terminal tabs', description: nativeTabsEnabled() ? 'shown' : 'hidden', id: 'nativetabs' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(target) Set a session goal', description: '/goal', id: 'goal' },
    { label: '$(check-all) Fewer permission prompts', description: '/fewer-permission-prompts', id: 'fewerperms' },
    { label: '$(clock) Schedule work', description: '/schedule', id: 'schedule' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...(multiAccount ? [{ label: '$(arrow-swap) Swap account', description: currentAnthropicAccount(), id: 'swap' }] : []),
    { label: '$(account) Login', description: account, id: 'login' },
    { label: '$(sign-out) Logout', id: 'logout' },
    { label: '$(info) Auth status', id: 'status' }
  ];
  const pick = await vscode.window.showQuickPick(items, { title: 'AIOS Glass — Config', placeHolder: 'Account · model · mode · updates' });
  if (!pick) return;

  switch (pick.id) {
    case 'model': {
      const m = await vscode.window.showQuickPick(
        MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
        { title: 'Default model — writes ~/.claude/settings.json' }
      );
      if (m) await setGlobalModel(m.value);
      return;
    }
    case 'mode': {
      const m = await vscode.window.showQuickPick(MODE_OPTIONS, {
        title: 'Permission mode — writes permissions.defaultMode'
      });
      if (m) await setMode(m);
      return;
    }
    case 'terminal': {
      const m = await vscode.window.showQuickPick(TERMINAL_OPTIONS, {
        title: 'Terminal mode — where rituals/actions run'
      });
      if (m) await setTerminalMode(m);
      return;
    }
    case 'remote': {
      const choice = await vscode.window.showQuickPick(['on', 'off'], {
        title: 'Remote control — append --remote-control to Glass launches'
      });
      if (choice) await setRemoteControl(choice === 'on');
      return;
    }
    case 'hints': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) On', description: 'show button hints + header subtitles', value: true },
          { label: '$(eye-closed) Off', description: 'cleaner, label-only view (counts + helpers stay)', value: false }
        ],
        { title: `Secondary hints — currently ${showHints() ? 'on' : 'off'}` }
      );
      if (choice) await setShowHints(choice.value);
      return;
    }
    case 'nudges': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(bell) On', description: 'morning ritual · midday session-wrap · evening close-day', value: true },
          { label: '$(bell-slash) Off', description: 'no nudge banner at all', value: false }
        ],
        { title: `Ritual nudges — currently ${showNudges() ? 'on' : 'off'}` }
      );
      if (choice) await setShowNudges(choice.value);
      return;
    }
    case 'nativetabs': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) Shown', description: "VS Code's native terminal tabs", value: true },
          { label: '$(eye-closed) Hidden', description: "manage terminals from Glass's Sessions card", value: false }
        ],
        { title: `Native terminal tabs — currently ${nativeTabsEnabled() ? 'shown' : 'hidden'}` }
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
          { label: '$(check) On', description: '/today & /close-day auto-pull updates when BEHIND', value: true },
          { label: '$(circle-slash) Off', description: 'only nudge — never auto-run /aios:update', value: false }
        ],
        { title: `Automatic updates — currently ${automaticUpdates() ? 'on' : 'off'}`, placeHolder: 'Writes USER.md → ## Settings' }
      );
      if (choice) {
        await setAutomaticUpdates(choice.value);
        void vscode.window.showInformationMessage(`Automatic updates ${choice.value ? 'on' : 'off'} — saved to USER.md.`);
      }
      return;
    }
    case 'swap': {
      const cur = currentAnthropicAccount();
      const others = anthropicAccounts().filter((a) => a && a !== cur);
      if (!others.length) {
        void vscode.window.showInformationMessage(`Only one Anthropic account is configured${cur ? ` (${cur})` : ''}. Add more under USER.md → ## Anthropic accounts.`);
        return;
      }
      const pick = await vscode.window.showQuickPick(others, {
        title: `Swap account — now: ${cur || 'unknown'}`,
        placeHolder: 'Switch to… (silent — claude-switch)'
      });
      if (pick) await launchAccountSwap(pick);
      return;
    }
    case 'login': return launchClaude('auth login');
    case 'logout': return launchClaude('auth logout');
    case 'status': return launchClaude('auth status');
  }
}
