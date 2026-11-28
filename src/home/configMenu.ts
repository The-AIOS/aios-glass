import * as vscode from 'vscode';
import {
  MODEL_OPTIONS, MODE_OPTIONS, TERMINAL_OPTIONS,
  setGlobalModel, setMode, setTerminalMode,
  currentModel, currentMode, currentTerminalMode, modelLabel, currentAccount,
  remoteControlOn, setRemoteControl,
  currentAnthropicAccount, anthropicAccounts, accountRows, accountsError, accountsAskedYet, refreshAccounts, frameworkHasAvailability,
  rotationSetting, setRotation,
  automaticUpdates, setAutomaticUpdates,
  showHints, setShowHints,
  showNudges, setShowNudges,
  nativeTabsEnabled, setNativeTabs,
  currentTheme, setTheme, setAiosTheme, isAiosWorkbenchTheme,
  fileIconsEnhanced, setFileIcons,
  showHiddenFiles, setShowHidden,
  autoReveal, setAutoReveal,
  showMemory, setShowMemory,
  showWeekNumbers, setShowWeekNumbers,
  currentLanguage, setLanguage, GlassLang,
  openNotesIn, setOpenNotesIn, OpenNotesMode
} from './config';
import { canSwitchTo, rowLabel } from '../core/accounts';
import type { RotationSetting, RotationChange } from './swapRule';
import { launchClaude, launchInSession, launchAccountSwap } from '../rituals/runner';
import { HomeViewProvider } from './homePanel';
import { t } from '../i18n';
import { getClaudeLanguage, setClaudeLanguage } from './config';

/* Claude's language, as its own choice (App parity, 0.17.0): "the language you write in" (no value) or one language. */
const CLAUDE_LANGS: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: '' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Español' },
  { value: 'Brazilian Portuguese', label: 'Português (BR)' },
  { value: 'Greek', label: 'Ελληνικά' },
  { value: 'French', label: 'Français' },
];
function claudeLangLabel(v: string | null): string {
  if (v === null) return t('The language you write in');
  const hit = CLAUDE_LANGS.find((l) => l.value && l.value.toLowerCase() === v.toLowerCase());
  return hit ? hit.label : v;
}
/** Save a pick and say what it did: saved, saved but Claude's own settings still apply, or not saved. */
async function chooseClaudeLanguage(v: string | null): Promise<void> {
  const ok = setClaudeLanguage(v);
  const cl = getClaudeLanguage();
  if (!ok) { void vscode.window.showWarningMessage(t("AIOS Glass: could not save Claude's language")); return; }
  if (v === null && cl.elsewhere) { void vscode.window.showInformationMessage(t("Saved. Claude's own settings still say {lang}, so it keeps answering in it").replace('{lang}', cl.elsewhere)); return; }
  void vscode.window.showInformationMessage(t("Claude's language saved"));
}
/** After Glass's language changed: ask, once, whether Claude should match. Never changes it by itself. */
export async function askClaudeLanguage(): Promise<void> {
  const s = getClaudeLanguage().suggest;
  if (!s) return;
  const q = s.value === null
    ? t('Should Claude answer in the language you write in again?')
    : t('Glass is in {lang} now. Should Claude answer in {lang} too?').split('{lang}').join(claudeLangLabel(s.value));
  const yes = t('Yes, match'), no = t('No, keep it');
  const pick = await vscode.window.showInformationMessage(q, yes, no);
  if (pick === yes) await chooseClaudeLanguage(s.value);
}

/* ── Account rotation (#430) ── where the watcher rotates and whether it rotates on its own: one setting, owned by the
   framework, changed only through its own command (setRotation). Glass stores nothing. The AIOS App shows the same rows in
   its Settings. A value set on the computer outside Glass wins over the stored one: shown, not editable. */
function rotationSummary(s: RotationSetting): string {
  return t('{state} · 5-hour limit {five} % · weekly limit {seven} %')
    .replace('{state}', s.enabled.value ? t('on') : t('off'))
    .replace('{five}', String(s.fiveHour.value)).replace('{seven}', String(s.sevenDay.value));
}
async function saveRotation(change: RotationChange): Promise<void> {
  const r = await setRotation(change);
  if (r.ok) { void vscode.window.showInformationMessage(t('Account rotation saved')); return; }
  /* The script's own words name files and paths: they go to the log, and the popup says only that it failed. */
  console.warn('[rotation] rotation --set failed:', r.message);
  void vscode.window.showWarningMessage(t('Could not save account rotation'));
}
async function rotationMenu(): Promise<void> {
  const s = rotationSetting();
  if (!s) return;
  const elsewhere = t('set on this computer outside Glass');
  const items: (vscode.QuickPickItem & { id: string })[] = [
    { label: '$(sync) ' + t('Rotate accounts automatically'), description: s.enabled.source === 'environment' ? elsewhere : (s.enabled.value ? t('on') : t('off')), id: 'auto' },
    { label: '$(watch) ' + t('5-hour limit'), description: s.fiveHour.source === 'environment' ? `${s.fiveHour.value} % · ${elsewhere}` : `${s.fiveHour.value} %`, id: 'fiveHour' },
    { label: '$(calendar) ' + t('Weekly limit'), description: s.sevenDay.source === 'environment' ? `${s.sevenDay.value} % · ${elsewhere}` : `${s.sevenDay.value} %`, id: 'sevenDay' },
  ];
  if (s.ignored.length) items.push({ label: '$(warning) ' + t('A saved value was not valid and is not in use. Saving here replaces it.'), id: 'none' });
  const pick = await vscode.window.showQuickPick(items, { title: t('Account rotation'), placeHolder: t('When the account in use nears its limit, the next account in the list takes over') });
  if (!pick || pick.id === 'none') return;
  if (pick.id === 'auto') {
    if (s.enabled.source === 'environment') { void vscode.window.showInformationMessage(elsewhere); return; }
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(sync) ' + t('On'), description: t('the next account in the list takes over near the limit'), value: true },
        { label: '$(circle-slash) ' + t('Off'), description: t('stays on the current account; the button to change account still appears'), value: false }
      ],
      { title: `${t('Rotate accounts automatically')} — ${t('currently')} ${s.enabled.value ? t('on') : t('off')}` }
    );
    if (choice && choice.value !== s.enabled.value) await saveRotation({ enabled: choice.value });
    return;
  }
  const key = pick.id as 'fiveHour' | 'sevenDay';
  const cur = s[key];
  if (cur.source === 'environment') { void vscode.window.showInformationMessage(elsewhere); return; }
  const range = (m: string) => m.replace('{min}', String(s.min)).replace('{max}', String(s.max));
  const typed = await vscode.window.showInputBox({
    title: key === 'fiveHour' ? t('5-hour limit') : t('Weekly limit'),
    prompt: range(t('Usage percent at which it rotates, from {min} to {max}. The button to change account appears a little before')),
    value: String(cur.value),
    validateInput: (v) => (/^\d{1,3}$/.test(v.trim()) && +v >= s.min && +v <= s.max ? undefined : range(t('Use a whole number from {min} to {max}'))),
  });
  if (typed === undefined) return;
  const n = Number(typed.trim());
  if (n !== cur.value) await saveRotation({ [key]: n });
}

/** Human label for the Glass language setting. */
function langLabel(l: GlassLang): string {
  return l === 'es' ? 'Español' : l === 'pt-br' ? 'Português (BR)' : l === 'el' ? 'Ελληνικά' : l === 'fr' ? 'Français' : l === 'en' ? 'English' : 'Auto (IDE)';
}

/** Human label for the open-notes-in setting. */
function openNotesLabel(m: OpenNotesMode): string {
  return m === 'editor' ? t('editor') : t('preview to the side');
}

/** The cog menu — Claude account, model, permission mode, terminal mode. */
export async function openConfigMenu(): Promise<void> {
  const account = currentAccount() || t('not signed in');
  // Ask first when nothing has yet: the Home panel's poll may never have run, and an empty answer
  // here would hide the swap entry from an operator with several accounts.
  // Only the FIRST time (review, 0.5.14): a one-account install answers with an empty list on purpose, and waiting
  // on the script at every open made this whole menu slow for them. Later opens use the cache, which refreshes itself.
  if (!anthropicAccounts().length && !accountsAskedYet()) await refreshAccounts();
  // A list that could not be read keeps the entry, saying so: hiding it was how a broken list went unnoticed.
  const accountsBroken = !anthropicAccounts().length && !!accountsError();
  const multiAccount = anthropicAccounts().length > 1 || accountsBroken; // swap only matters with 2+
  const sep = (label: string): vscode.QuickPickItem & { id?: string } => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const onOff = (b: boolean) => (b ? t('on') : t('off'));
  const rotation = rotationSetting();
  const shownHidden = (b: boolean) => (b ? t('shown') : t('hidden'));
  const items: (vscode.QuickPickItem & { id?: string })[] = [
    // ── Appearance — how the Glass surfaces look ──
    sep(t('Appearance')),
    { label: '$(globe) ' + t('Language'), description: langLabel(currentLanguage()), id: 'language' },
    { label: '$(color-mode) ' + t('Theme (Glass + IDE)'), description: isAiosWorkbenchTheme() ? `${currentTheme()} · ${t('IDE synced')}` : `${t('Glass')}: ${currentTheme()}`, id: 'theme' },
    { label: '$(eye) ' + t('Secondary hints'), description: onOff(showHints()), id: 'hints' },
    { label: '$(bell) ' + t('Ritual nudges'), description: onOff(showNudges()), id: 'nudges' },
    { label: '$(pulse) ' + t('Session memory'), description: shownHidden(showMemory()), id: 'memory' },
    { label: '$(calendar) ' + t('Calendar week numbers'), description: onOff(showWeekNumbers()), id: 'weeknums' },
    // ── Explorer — the file tree ──
    sep(t('Explorer')),
    { label: '$(go-to-file) ' + t('Open files in'), description: openNotesLabel(openNotesIn()), id: 'openin' },
    { label: '$(symbol-file) ' + t('File icons'), description: fileIconsEnhanced() ? t('enhanced') : t('plain'), id: 'fileicons' },
    { label: '$(eye) ' + t('Hidden files'), description: shownHidden(showHiddenFiles()), id: 'hidden' },
    { label: '$(target) ' + t('Auto-reveal active file'), description: onOff(autoReveal()), id: 'autoreveal' },
    // ── Claude — the engine behind the surfaces ──
    sep(t('Claude')),
    { label: '$(comment-discussion) ' + t('Claude answers in'), description: (() => { const cl = getClaudeLanguage(); return claudeLangLabel(cl.local ?? cl.elsewhere); })(), id: 'claudelang' },
    { label: '$(server) ' + t('Model'), description: modelLabel(currentModel()), id: 'model' },
    { label: '$(shield) ' + t('Permission mode'), description: currentMode(), id: 'mode' },
    { label: '$(terminal) ' + t('Terminal mode'), description: currentTerminalMode(), id: 'terminal' },
    { label: '$(trash) ' + t('Kill behavior'), description: vscode.workspace.getConfiguration('aiosGlass').get<string>('killBehavior', 'ask'), id: 'killbehavior' },
    { label: '$(bell) ' + t('Session alerts'), description: vscode.workspace.getConfiguration('aiosGlass').get<string>('attention', 'banner'), id: 'attention' },
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
    ...(multiAccount ? [{ label: (accountsBroken ? '$(warning) ' : '$(arrow-swap) ') + t('Swap account'), description: accountsBroken ? t('could not read the account list') : currentAnthropicAccount(), id: 'swap' }] : []),
    { label: '$(account) ' + t('Login'), description: account, id: 'login' },
    // #430: the framework's rotation setting, only when it sends one (an older framework has no command to change it).
    ...(rotation ? [{ label: '$(sync) ' + t('Account rotation'), description: rotationSummary(rotation), id: 'rotation' }] : []),
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
    case 'claudelang': {
      const cl = getClaudeLanguage();
      const cur = cl.local ?? cl.elsewhere;
      const choice = await vscode.window.showQuickPick(
        CLAUDE_LANGS.map((l) => ({ label: l.value === null ? t('The language you write in') : l.label, description: l.value === null ? t('default') : undefined, value: l.value })),
        { title: `${t('Claude answers in')} — ${t('currently')} ${claudeLangLabel(cur)}`, placeHolder: t("For sessions started from your vault; separate from Glass's language") }
      );
      if (choice) await chooseClaudeLanguage(choice.value);
      return;
    }
    case 'language': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(globe) ' + t('Auto'), description: t('follow the IDE display language'), value: 'auto' as const },
          { label: 'English', value: 'en' as const },
          { label: 'Español', description: t('LATAM neutral'), value: 'es' as const },
          { label: 'Português', description: 'Brasil', value: 'pt-br' as const },
          { label: 'Ελληνικά', description: 'Greek', value: 'el' as const },
          { label: 'Français', description: 'French', value: 'fr' as const }
        ],
        { title: `${t('Glass language')} — ${t('currently')} ${langLabel(currentLanguage())}`, placeHolder: t('Home panel language · IDE menus follow Configure Display Language') }
      );
      if (choice) {
        await setLanguage(choice.value);
        HomeViewProvider.current?.rerender();
        /* Claude's language is only ASKED about, never changed with Glass's (App parity). Here, in the window where the
           language was picked: the setting is global, so a config listener would ask in every open window (review). */
        await askClaudeLanguage();
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
        { title: `${t('Open files in')} — ${t('currently')} ${openNotesLabel(openNotesIn())}`, placeHolder: t('Calendar days + Explorer files · ⌘/Ctrl-click always opens the source') }
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
    case 'killbehavior': {
      const cfg = vscode.workspace.getConfiguration('aiosGlass');
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(question) ' + t('Ask'), description: t('confirm each time — Capture · Kill · Cancel'), value: 'ask' },
          { label: '$(trash) ' + t('Kill now'), description: t('always close immediately, no prompt'), value: 'kill' },
          { label: '$(book) ' + t('Capture & close'), description: t('always /close-session first, then close'), value: 'capture' },
        ],
        { title: `${t('Kill behavior')} — ${t('currently')} ${cfg.get<string>('killBehavior', 'ask')}` }
      );
      if (choice) { await cfg.update('killBehavior', choice.value, vscode.ConfigurationTarget.Global); }
      return;
    }
    /* #22 — how a session blocked on you reaches you outside the terminal. Three rungs rather
       than a toggle, because the two useful ways to want less are different: some operators
       want the count without the interruption. Work that FINISHED unseen only ever adds to the
       counter at every rung — a finished job is not worth a notification. */
    case 'attention': {
      const cfg = vscode.workspace.getConfiguration('aiosGlass');
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(bell-dot) ' + t('Counter + notification'), description: t('one notification per block, plus the status-bar count'), value: 'banner' },
          { label: '$(bell) ' + t('Counter only'), description: t('the status-bar count, never a notification'), value: 'badge' },
          { label: '$(bell-slash) ' + t('Off'), description: t('no counter, no notifications'), value: 'off' },
        ],
        { title: `${t('Session alerts')} — ${t('currently')} ${cfg.get<string>('attention', 'banner')}` }
      );
      if (choice) { await cfg.update('attention', choice.value, vscode.ConfigurationTarget.Global); }
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
    case 'weeknums': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(eye) ' + t('On'), description: t('show the ISO week-number column (e.g. W30)'), value: true },
          { label: '$(eye-closed) ' + t('Off'), description: t("hide it — for when you don't work in week numbers"), value: false }
        ],
        { title: `${t('Calendar week numbers')} — ${t('currently')} ${onOff(showWeekNumbers())}` }
      );
      if (choice) await setShowWeekNumbers(choice.value);
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
    case 'rotation': {
      await rotationMenu();
      return;
    }
    case 'swap': {
      const cur = currentAnthropicAccount();
      await refreshAccounts();
      const problem = accountsError();
      if (problem) void vscode.window.showWarningMessage(`AIOS Glass: ${problem}`);
      const others = accountRows().filter((r) => r.email !== cur);
      if (!others.length) {
        void vscode.window.showInformationMessage(`${t('Only one Anthropic account is configured')}${cur ? ` (${cur})` : ''}. ${(frameworkHasAvailability() ? t('Add more with claude-switch --add.') : t('Add more under USER.md → ## Anthropic accounts.'))}`);
        return;
      }
      // All of them, with why: an account missing from a menu reads as lost, not as expired.
      const pick = await vscode.window.showQuickPick(others.map((row) => ({
        label: `${canSwitchTo(row) ? '' : '$(warning) '}${rowLabel(row)}`,
        description: row.state === 'unknown' ? '' : row.state,
        detail: row.detail,
        row,
      })), {
        title: `${t('Swap account — now:')} ${cur || t('unknown')}`,
        placeHolder: t('Switch to… (silent — claude-switch)')
      });
      if (pick && !canSwitchTo(pick.row)) {
        void vscode.window.showWarningMessage(`${pick.row.email}: ${pick.row.detail || pick.row.state}`);
        return;
      }
      if (pick) await launchAccountSwap(pick.row.email);
      return;
    }
    case 'login': return launchClaude('auth login');
    case 'logout': return launchClaude('auth logout');
    case 'status': return launchClaude('auth status');
  }
}
