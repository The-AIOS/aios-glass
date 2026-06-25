import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AIOS Glass localization.
 *
 * Two layers, two mechanisms — same source of truth (`vscode.env.language`):
 *
 *  1. EXTENSION HOST (TypeScript) — VS Code's native `vscode.l10n`. Strings in
 *     `.ts` are wrapped with `vscode.l10n.t(...)`; translations live in
 *     `l10n/bundle.l10n.<locale>.json` and `package.json` declares `"l10n": "./l10n"`.
 *     Static `package.json` titles use `%key%` resolved from `package.nls*.json`.
 *     The editor picks the bundle automatically by display language; we don't
 *     load it ourselves.
 *
 *  2. WEBVIEW (media/home.{html,js}) — `vscode.l10n` does NOT reach into a
 *     webview (separate origin, no Node). So we load a per-locale JSON catalog
 *     from `media/i18n/strings.<locale>.json` here in the host and inject it
 *     into the page as an inline `window.__nls = {...}` script. `home.js`'s tiny
 *     localizer applies it to `[data-i18n]` / `[data-i18n-title]` nodes and via
 *     `NLS(key)` for dynamic strings. English text stays baked into the HTML as
 *     the literal fallback, so a missing catalog (or a missing key) degrades to
 *     English rather than to a blank.
 *
 * Locale resolution maps the editor's BCP-47 language to one of the three
 * shipped catalogs (en / es / pt-br). Anything else → en.
 */

export type GlassLocale = 'en' | 'es' | 'pt-br';

/** Map `vscode.env.language` (e.g. "es", "es-419", "pt-br", "pt") to a shipped catalog. */
export function resolveLocale(lang?: string): GlassLocale {
  const l = (lang ?? vscode.env.language ?? 'en').toLowerCase();
  if (l === 'pt-br' || l.startsWith('pt')) return 'pt-br';
  if (l.startsWith('es')) return 'es';
  return 'en';
}

/**
 * The locale the webview should render in. Honors the `aiosGlass.language`
 * override first (en / es / pt-br); `auto` (or unset) follows the IDE display
 * language. Host chrome (package.json titles, vscode.l10n) still follows the
 * IDE display language only — VS Code owns that and it needs a reload.
 */
export function effectiveLocale(): GlassLocale {
  const override = vscode.workspace.getConfiguration('aiosGlass').get<string>('language', 'auto');
  if (override && override !== 'auto') return resolveLocale(override);
  return resolveLocale();
}

// ── Host-string translation (QuickPicks, InputBoxes, notifications) ──
//
// `vscode.l10n.t` follows the IDE display language and can't be overridden at
// runtime, so it ignores the `aiosGlass.language` setting. To make the cog-menu
// switcher govern the popups too (instantly, no IDE reload), we read the SAME
// `l10n/bundle.l10n.<locale>.json` bundles ourselves, keyed by the effective
// locale. Keys are the English source string (the vscode.l10n convention), so a
// missing key degrades to English. `en` returns the source verbatim.
let _extensionRoot: string | undefined;
let cachedHostCatalogs: Partial<Record<GlassLocale, Record<string, string>>> = {};

/** Record the extension root so the host translator can find its bundles. Call once at activation. */
export function initI18n(extensionUri: vscode.Uri): void {
  _extensionRoot = extensionUri.fsPath;
}

function hostCatalog(locale: GlassLocale): Record<string, string> {
  if (locale === 'en' || !_extensionRoot) return {};
  if (cachedHostCatalogs[locale]) return cachedHostCatalogs[locale]!;
  try {
    const p = path.join(_extensionRoot, 'l10n', `bundle.l10n.${locale}.json`);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
    delete (raw as Record<string, unknown>)._comment;
    cachedHostCatalogs[locale] = raw;
    return raw;
  } catch {
    return {};
  }
}

/**
 * Translate a host-side popup string, following `aiosGlass.language`. Drop-in
 * for `vscode.l10n.t(message)`; falls back to the English source on any miss.
 */
export function t(message: string): string {
  const loc = effectiveLocale();
  if (loc === 'en') return message;
  return hostCatalog(loc)[message] ?? message;
}

let cachedCatalogs: Partial<Record<GlassLocale, Record<string, string>>> = {};

/** Load (and cache) the webview string catalog for a locale, falling back to en. */
export function webviewCatalog(extensionUri: vscode.Uri, locale: GlassLocale): Record<string, string> {
  if (cachedCatalogs[locale]) return cachedCatalogs[locale]!;
  const read = (loc: GlassLocale): Record<string, string> => {
    try {
      const p = path.join(extensionUri.fsPath, 'media', 'i18n', `strings.${loc}.json`);
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
      // Drop the `_note` documentation key — never surfaced.
      delete (raw as Record<string, unknown>)._note;
      return raw;
    } catch {
      return {};
    }
  };
  const en = read('en');
  const loc = locale === 'en' ? en : { ...en, ...read(locale) }; // locale overrides en; missing keys keep en
  cachedCatalogs[locale] = loc;
  return loc;
}

/** Clear the catalog cache (used by tests / when files change on disk). */
export function clearCatalogCache(): void {
  cachedCatalogs = {};
}
