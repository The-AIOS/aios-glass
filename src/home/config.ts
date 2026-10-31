import { resolveGlassTheme, shouldSyncToWorkbench } from './themeResolve';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { frameworkRoot } from './vault';
import { parseAvailability, rowsFromUserMd, nextDestination, type AccountRow } from '../core/accounts';

/**
 * Read/write Claude Code's own global configuration. Glass surfaces these as
 * a Config card; the source of truth stays in Claude's files (`~/.claude.json`
 * for the signed-in account, `~/.claude/settings.json` for the default model).
 */

const globalSettingsPath = (): string => path.join(os.homedir(), '.claude', 'settings.json');
const claudeJsonPath = (): string => path.join(os.homedir(), '.claude.json');

/** The currently signed-in Anthropic account email (from ~/.claude.json). */
export function currentAnthropicAccount(): string {
  try {
    const d = JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8'));
    return d?.oauthAccount?.emailAddress || '';
  } catch { return ''; }
}

function userMdPath(): string | undefined {
  const r = frameworkRoot();
  return r ? path.join(r, 'USER.md') : undefined;
}

/** Read USER.md → ## Settings → "Automatic updates" (default true if absent). */
export function automaticUpdates(): boolean {
  const p = userMdPath();
  if (!p) return true;
  try {
    const md = fs.readFileSync(p, 'utf8');
    const m = md.match(/automatic updates:\s*\**\s*(yes|no|on|off|true|false)/i);
    return m ? /^(yes|on|true)$/i.test(m[1]) : true;
  } catch { return true; }
}

/** Write the Automatic-updates setting; create the ## Settings section if absent (idempotent). */
export async function setAutomaticUpdates(on: boolean): Promise<void> {
  const p = userMdPath();
  if (!p) return;
  let md = '';
  try { md = fs.readFileSync(p, 'utf8'); } catch { /* new file */ }
  const val = on ? 'yes' : 'no';
  if (/automatic updates:/i.test(md)) {
    md = md.replace(/(automatic updates:\**\s*)(yes|no|on|off|true|false)/i, `$1${val}`);
  } else {
    const block = `## Settings\n\n> Operator preferences Claude and AIOS Glass read every session. Toggle from Glass's config (the cog).\n\n- **Automatic updates:** ${val} — when \`yes\`, \`/today\` and \`/close-day\` auto-pull framework updates when your vault is BEHIND; \`no\` = nudge only.\n\n`;
    if (/^## Session cascade/m.test(md)) md = md.replace(/^## Session cascade/m, block + '## Session cascade');
    else md = md.replace(/\s*$/, '\n') + '\n' + block;
  }
  fs.writeFileSync(p, md);
}

/** Rate-limit usage from the statusline cache (~/.claude/rate-limit-cache.json). */
export interface RateLimit { email: string; fiveHourPct: number; sevenDayPct: number; max: number; fiveHourResetsAt: number; sevenDayResetsAt: number; }
export function rateLimit(): RateLimit | undefined {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'rate-limit-cache.json'), 'utf8'));
    const f = Number(d.five_hour_pct) || 0;
    const s = Number(d.seven_day_pct) || 0;
    return {
      email: d.email || '', fiveHourPct: f, sevenDayPct: s, max: Math.max(f, s),
      // epoch seconds; 0 when the cache predates the fields
      fiveHourResetsAt: Number(d.five_hour_resets_at) || 0,
      sevenDayResetsAt: Number(d.seven_day_resets_at) || 0,
    };
  } catch { return undefined; }
}

// ── Anthropic accounts ─────────────────────────────────────────────────────
// The script owns the list and who can take you (see core/accounts.ts). Asking it starts a bash
// and a Python, and the Home panel asks on a 2s poll, so the panel reads the last answer and
// ACCOUNTS_MAX_AGE_MS decides when to ask again, in the background.
const ACCOUNTS_MAX_AGE_MS = 60_000;
let accountsCache: { rows: AccountRow[]; error: string; at: number } = { rows: [], error: '', at: 0 };
let accountsAsking: Promise<void> | undefined;

function identityScript(): string | undefined {
  const root = frameworkRoot();
  return root ? path.join(root, 'hooks', 'claude-identity', 'claude-identity.sh') : undefined;
}

/** Whether this framework has `--availability`. Checked by file and never by trying: an older
 *  script reads an unknown flag as an email to switch to, and captures the seat on the way. */
export function frameworkHasAvailability(): boolean {
  const script = identityScript();
  return !!script && fs.existsSync(path.join(path.dirname(script), '_accounts.py'));
}

/** Ask the script again. A failure keeps the last good rows and records why. */
export function refreshAccounts(): Promise<void> {
  if (!frameworkHasAvailability()) return Promise.resolve();
  if (accountsAsking) return accountsAsking;
  accountsAsking = new Promise<void>((resolve) => {
    execFile('bash', [identityScript() as string, 'switch', '--availability'], { timeout: 20_000 }, (err, out, stderr) => {
      const rows = err ? null : parseAvailability(out);
      accountsCache = rows
        ? { rows, error: '', at: Date.now() }
        : { ...accountsCache, error: String(stderr || (err && err.message) || 'unreadable answer').trim().slice(0, 300), at: Date.now() };
      accountsAsking = undefined;
      resolve();
    });
  });
  return accountsAsking;
}

/** Why the last ask failed, or ''. A malformed list must be seen, not read as "no accounts". */
export function accountsError(): string {
  return frameworkHasAvailability() ? accountsCache.error : '';
}

/** The accounts, from the last answer. Never blocks: a stale answer also asks for a new one. */
export function accountRows(): AccountRow[] {
  if (!frameworkHasAvailability()) {
    const root = frameworkRoot();
    if (!root) return [];
    try { return rowsFromUserMd(fs.readFileSync(path.join(root, 'USER.md'), 'utf8'), currentAnthropicAccount()); } catch { return []; }
  }
  if (Date.now() - accountsCache.at > ACCOUNTS_MAX_AGE_MS) void refreshAccounts();
  return accountsCache.rows;
}

/** The account a swap should go to; '' when none can take you. */
export function nextAccount(): string {
  return nextDestination(accountRows(), currentAnthropicAccount());
}

export function anthropicAccounts(): string[] {
  return accountRows().map((r) => r.email);
}

export interface ModelOption {
  label: string;
  value: string;
}

/** Curated model choices (latest Claude family) + a clear-to-default option. */
export const MODEL_OPTIONS: ModelOption[] = [
  { label: 'Opus 4.8 — 1M context', value: 'claude-opus-4-8[1m]' },
  { label: 'Opus 4.8', value: 'claude-opus-4-8' },
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5' },
  { label: 'Default (clear the override)', value: '' }
];

export const MODE_OPTIONS = ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions'];

export const TERMINAL_OPTIONS = ['auto', 'ask', 'active'];

export function currentTerminalMode(): string {
  return vscode.workspace.getConfiguration('aiosGlass').get<string>('terminalMode', 'auto') || 'auto';
}

export async function setTerminalMode(value: string): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('terminalMode', value, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: terminal mode set to ${value}.`);
}

/** Glass Home panel language. `auto` follows the IDE display language. */
export type GlassLang = 'auto' | 'en' | 'es' | 'pt-br' | 'el';
export function currentLanguage(): GlassLang {
  return vscode.workspace.getConfiguration('aiosGlass').get<GlassLang>('language', 'auto') || 'auto';
}
export async function setLanguage(value: GlassLang): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('language', value, vscode.ConfigurationTarget.Global);
}

/** Whether to show secondary hint texts — button hints (.k) + header subtitles (.sub). Default true. */
export function showHints(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showHints', true);
}

export async function setShowHints(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showHints', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: secondary hints ${on ? 'shown' : 'hidden'}.`);
}

/** Whether to show the ISO week-number column in the Home calendar. Default true. */
export function showWeekNumbers(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showWeekNumbers', true);
}

export async function setShowWeekNumbers(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showWeekNumbers', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: calendar week numbers ${on ? 'shown' : 'hidden'}.`);
}

/** How Glass opens a Markdown note on plain click — Calendar days AND Explorer files.
 *  'previewToSide' (Foam-rendered, beside the source — default) or 'editor' (raw source, faster).
 *  Legacy 'preview' (full-tab) migrates to 'previewToSide'. */
export type OpenNotesMode = 'previewToSide' | 'editor';
export function openNotesIn(): OpenNotesMode {
  return vscode.workspace.getConfiguration('aiosGlass').get<string>('openNotesIn', 'previewToSide') === 'editor' ? 'editor' : 'previewToSide';
}
export async function setOpenNotesIn(value: OpenNotesMode): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('openNotesIn', value, vscode.ConfigurationTarget.Global);
}

/** Whether the explorer shows dotfiles (.gitignore, .vscode, …). Default false. */
export function showHiddenFiles(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showHidden', false);
}

export async function setShowHidden(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showHidden', on, vscode.ConfigurationTarget.Global);
}

/** Whether the Sessions card shows each session's process-tree RAM. Default true. */
export function showMemory(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showMemory', true);
}

export async function setShowMemory(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showMemory', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: session memory ${on ? 'shown' : 'hidden'}.`);
}

/** Whether the explorer follows the active editor (expand to + select it). Default true. */
export function autoReveal(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('autoReveal', true);
}

export async function setAutoReveal(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('autoReveal', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: auto-reveal active file ${on ? 'on' : 'off'}.`);
}

/** Explorer file icons — 'enhanced' (colorful per-type) or 'plain' (one neutral doc). */
export function fileIconsEnhanced(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<string>('fileIcons', 'enhanced') !== 'plain';
}

export async function setFileIcons(value: 'enhanced' | 'plain'): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('fileIcons', value, vscode.ConfigurationTarget.Global);
}

/** Glass surface theme, resolved. Shared across every Glass webview (Home + Files) so a single
 *  toggle reskins them all consistently. `auto` (the default) follows the editor's theme kind;
 *  an explicit 'dark'/'light' (what the sun/moon writes) always wins. */
export function currentTheme(): 'dark' | 'light' {
  return resolveGlassTheme(themePref(), vscode.window.activeColorTheme.kind);
}

/** The stored preference: 'auto' unless the operator picked. */
export function themePref(): 'auto' | 'dark' | 'light' {
  const v = vscode.workspace.getConfiguration('aiosGlass').get<string>('theme', 'auto');
  return v === 'dark' || v === 'light' ? v : 'auto';
}

/** The bundled workbench theme names, keyed by Glass mode. */
export const AIOS_WORKBENCH_THEME = { dark: 'AIOS Dark', light: 'AIOS Light' } as const;

/** The active VS Code workbench (editor) color theme. */
export function workbenchThemeName(): string {
  return vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '') || '';
}

/** Is the editor already on one of the AIOS workbench themes? (Gates the co-switch —
 *  we only ever touch the editor theme when the operator has opted into AIOS by
 *  selecting it; a personal theme like GitHub Dark / Tokyo Night is never hijacked.) */
export function isAiosWorkbenchTheme(): boolean {
  const t = workbenchThemeName();
  return t === AIOS_WORKBENCH_THEME.dark || t === AIOS_WORKBENCH_THEME.light;
}

export async function setTheme(value: 'dark' | 'light'): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('theme', value, vscode.ConfigurationTarget.Global);
  // Smart co-switch: move the EDITOR theme to match ONLY if it's already an AIOS theme.
  // Idempotent (skips a no-op write), so the reverse listener can't loop.
  if (isAiosWorkbenchTheme()) {
    const want = AIOS_WORKBENCH_THEME[value];
    if (workbenchThemeName() !== want) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', want, vscode.ConfigurationTarget.Global);
    }
  }
}

/** Explicit "move into the AIOS theme" — sets BOTH Glass panels and the editor theme.
 *  This is the opt-in entry point (cog → Theme → AIOS Dark/Light); once the editor is
 *  on an AIOS theme, every later Glass flip co-switches it automatically. */
export async function setAiosTheme(value: 'dark' | 'light'): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('theme', value, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', AIOS_WORKBENCH_THEME[value], vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: ${AIOS_WORKBENCH_THEME[value]} applied — Glass + IDE in lockstep.`);
}

/** The header sun/moon toggle.
 *  - On an AIOS theme → co-switch Glass + IDE, no prompt (you're clearly in AIOS).
 *  - On any other IDE theme → ALWAYS ask: Glass only, or switch the whole IDE to AIOS?
 *    No sticky memory — each toggle is a fresh choice, so you're never trapped in one mode
 *    (and the moment you pick Glass + IDE you're on AIOS, so it stops asking). */
export async function toggleTheme(mode: 'dark' | 'light'): Promise<void> {
  if (isAiosWorkbenchTheme()) { await setTheme(mode); return; } // co-switch handles the IDE
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(paintcan) Glass only', description: 'just the AIOS panels — keep your IDE theme', full: false },
      { label: '$(color-mode) Glass + IDE', description: 'switch the whole IDE with Glass (AIOS themes)', full: true }
    ],
    { title: 'Theme toggle — what should it switch?', placeHolder: 'Asked while your IDE is on a non-AIOS theme · pick Glass + IDE to stop asking' }
  );
  if (!pick) return; // cancelled → change nothing (the webview no longer flips optimistically)
  if (pick.full) await setAiosTheme(mode); else await setTheme(mode);
}

/** Reverse sync: when the editor theme becomes AIOS Dark/Light (picked via ⌘K⌘T or OS
 *  auto-detect), flip Glass panels to match. No-op for any non-AIOS theme, and skips a
 *  no-op write so it can't loop with setTheme's co-switch. Called from the config listener. */
export async function syncGlassToWorkbench(): Promise<void> {
  const t = workbenchThemeName();
  const mode = t === AIOS_WORKBENCH_THEME.dark ? 'dark' : t === AIOS_WORKBENCH_THEME.light ? 'light' : undefined;
  if (!shouldSyncToWorkbench(themePref(), mode, currentTheme())) return;   // never overwrites `auto`
  await vscode.workspace.getConfiguration('aiosGlass').update('theme', mode, vscode.ConfigurationTarget.Global);
}

/** Whether to show the contextual ritual nudge banner (morning/daytime/evening). Default true. */
export function showNudges(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showNudges', true);
}

export async function setShowNudges(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showNudges', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: ritual nudges ${on ? 'on' : 'off'}.`);
}

/** VS Code's native terminal tabs (terminal.integrated.tabs.enabled). Hide them to manage terminals from Glass. */
export function nativeTabsEnabled(): boolean {
  return vscode.workspace.getConfiguration('terminal.integrated.tabs').get<boolean>('enabled', true);
}

export async function setNativeTabs(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('terminal.integrated.tabs').update('enabled', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: native terminal tabs ${on ? 'shown' : 'hidden'}${on ? '' : ' — manage terminals from the Sessions card'}.`);
}

/** Reads Claude's global `remoteControlAtStartup` (~/.claude/settings.json). */
export function remoteControlOn(): boolean {
  try {
    const json = JSON.parse(fs.readFileSync(globalSettingsPath(), 'utf8'));
    return json?.remoteControlAtStartup !== false; // default on if unset
  } catch {
    return true;
  }
}

/** Writes Claude's global `remoteControlAtStartup` — not a Glass-local flag. */
export async function setRemoteControl(on: boolean): Promise<void> {
  const p = globalSettingsPath();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // start fresh if missing/unparseable
  }
  json.remoteControlAtStartup = on;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
  void vscode.window.showInformationMessage(`AIOS Glass: remote control at startup ${on ? 'enabled' : 'disabled'} (global).`);
}

export function currentAccount(): string {
  try {
    const json = JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8'));
    return json?.oauthAccount?.emailAddress ?? '';
  } catch {
    return '';
  }
}

export function currentModel(): string {
  try {
    const json = JSON.parse(fs.readFileSync(globalSettingsPath(), 'utf8'));
    return typeof json?.model === 'string' ? json.model : '';
  } catch {
    return '';
  }
}

export function currentMode(): string {
  try {
    const json = JSON.parse(fs.readFileSync(globalSettingsPath(), 'utf8'));
    const m = json?.permissions?.defaultMode;
    return typeof m === 'string' ? m : 'default';
  } catch {
    return 'default';
  }
}

/** Pretty label for a model value (falls back to the raw value). */
export function modelLabel(value: string): string {
  if (!value) return 'default';
  return MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value;
}

/**
 * Set (or clear) the default model in `~/.claude/settings.json`. Preserves
 * the rest of the file; creates a minimal file if absent.
 */
export async function setGlobalModel(value: string): Promise<void> {
  const p = globalSettingsPath();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // missing or unparseable — start fresh (rare; settings.json is usually present)
  }
  if (value) json.model = value;
  else delete json.model;

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
  void vscode.window.showInformationMessage(
    value ? `AIOS Glass: default model set to ${modelLabel(value)}.` : 'AIOS Glass: model override cleared.'
  );
}

/**
 * Set the global default permission mode in `~/.claude/settings.json`
 * (`permissions.defaultMode`). Merges into the existing permissions object so
 * allow-lists are preserved; Claude reads this natively on launch.
 */
export async function setMode(value: string): Promise<void> {
  const p = globalSettingsPath();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // start fresh if missing/unparseable
  }
  const permissions = (json.permissions && typeof json.permissions === 'object') ? json.permissions : {};
  permissions.defaultMode = value;
  json.permissions = permissions;

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
  void vscode.window.showInformationMessage(`AIOS Glass: permission mode set to ${value}.`);
}
