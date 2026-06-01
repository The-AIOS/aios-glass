import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { frameworkRoot } from './vault';

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
export interface RateLimit { email: string; fiveHourPct: number; sevenDayPct: number; max: number; }
export function rateLimit(): RateLimit | undefined {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'rate-limit-cache.json'), 'utf8'));
    const f = Number(d.five_hour_pct) || 0;
    const s = Number(d.seven_day_pct) || 0;
    return { email: d.email || '', fiveHourPct: f, sevenDayPct: s, max: Math.max(f, s) };
  } catch { return undefined; }
}

/** Next account to rotate to (round-robin after the current); '' if <2 accounts. */
export function nextAccount(): string {
  const accts = anthropicAccounts();
  if (accts.length < 2) return '';
  const i = accts.indexOf(currentAnthropicAccount());
  return accts[(i + 1) % accts.length] || accts[0];
}

/** Accounts listed in USER.md → "## Anthropic accounts" (numbered `email` rows). */
export function anthropicAccounts(): string[] {
  const root = frameworkRoot();
  if (!root) return [];
  let md: string;
  try { md = fs.readFileSync(path.join(root, 'USER.md'), 'utf8'); } catch { return []; }
  const out: string[] = [];
  let inSection = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^##\s+Anthropic accounts/i.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection) continue;
    const m = line.match(/^\s*\d+\.\s*`([^`]+)`/); // "1. `you@example.com` — primary…"
    if (m) out.push(m[1].trim());
  }
  return out;
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

export const TERMINAL_OPTIONS = ['ask', 'active'];

export function currentTerminalMode(): string {
  return vscode.workspace.getConfiguration('aiosGlass').get<string>('terminalMode', 'ask') || 'ask';
}

export async function setTerminalMode(value: string): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('terminalMode', value, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: terminal mode set to ${value}.`);
}

/** Whether to show secondary hint texts — button hints (.k) + header subtitles (.sub). Default true. */
export function showHints(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showHints', true);
}

export async function setShowHints(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showHints', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: secondary hints ${on ? 'shown' : 'hidden'}.`);
}

/** Whether to show the contextual ritual nudge banner (morning/daytime/evening). Default true. */
export function showNudges(): boolean {
  return vscode.workspace.getConfiguration('aiosGlass').get<boolean>('showNudges', true);
}

export async function setShowNudges(on: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('aiosGlass').update('showNudges', on, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`AIOS Glass: ritual nudges ${on ? 'on' : 'off'}.`);
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
