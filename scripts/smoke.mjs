#!/usr/bin/env node
/**
 * Webview smoke test — boots the REAL panel (media/home.{html,css,js}) in
 * headless Chrome and fails on any uncaught script error.
 *
 * Why this exists: the panel's JS is invisible to tsc (it ships as plain files,
 * and historically lived inside a template literal) — a boot-killing bug (e.g.
 * the 2026-06-05 TDZ crash) compiles green and renders a dead panel. This is
 * the gate for that whole bug class: if home.js throws during load, CI goes red.
 *
 * No dependencies: stubs acquireVsCodeApi, assembles a harness in a temp dir,
 * runs `chrome --headless --dump-dom`, and asserts the PASS marker in <title>.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const media = join(root, 'media');

// ── settings-parity guard ──────────────────────────────────────────────────
// The recurring mistake: a setting added to package.json shows up in VS Code's
// NATIVE settings UI but is invisible in Glass's OWN cog menu — where operators
// actually look. This fails the smoke run when an everyday `aiosGlass.*` setting
// isn't reachable from the cog (a `config.ts` getter/setter the cog uses, or a
// direct reference in `configMenu.ts`). Low-level settings that are set another
// way live in COG_EXEMPT — adding one there is a DELIBERATE choice, not a silent
// skip. (Runs regardless of Chrome, so it gates even where the panel boot can't.)
function checkSettingsParity() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const conf = pkg.contributes && pkg.contributes.configuration;
  const props = Array.isArray(conf)
    ? Object.assign({}, ...conf.map((c) => c.properties || {}))
    : (conf && conf.properties) || {};
  const keys = Object.keys(props).filter((k) => k.startsWith('aiosGlass.')).map((k) => k.slice('aiosGlass.'.length));
  const COG_EXEMPT = new Set(['frameworkPath', 'claudeCommand']); // set via a dedicated command / low-level override — not everyday cog toggles
  const cfg = readFileSync(join(root, 'src/home/config.ts'), 'utf8');
  const cog = readFileSync(join(root, 'src/home/configMenu.ts'), 'utf8');
  const surfaced = (k) => [`'${k}'`, `"${k}"`].some((q) => cfg.includes(q) || cog.includes(q));
  const missing = keys.filter((k) => !surfaced(k) && !COG_EXEMPT.has(k));
  if (missing.length) {
    console.error('smoke: SETTINGS PARITY FAILED — these aiosGlass.* settings are in package.json but NOT reachable from the Glass cog:');
    for (const m of missing) { console.error('  · aiosGlass.' + m); }
    console.error("  (They appear in VS Code's native settings UI but not in Glass's cog, where operators look.)");
    console.error('  Fix: surface each in src/home/configMenu.ts (a cog item + a handler case), or add it to COG_EXEMPT here with a reason.');
    return false;
  }
  console.log(`smoke: settings parity ✓ — ${keys.length} aiosGlass.* settings all reachable from the cog (or explicitly exempt)`);
  return true;
}
if (!checkSettingsParity()) { process.exit(1); }

// ── locate Chrome: env override → CI linux → macOS app bundles ──
const candidates = [
  process.env.CHROME_PATH,
  'google-chrome', // GitHub ubuntu runners
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
let chrome;
for (const c of candidates) {
  try { execFileSync(c.includes('/') ? c : 'which', c.includes('/') ? ['--version'] : [c], { stdio: 'pipe' }); chrome = c; break; } catch { /* next */ }
}
if (!chrome) { console.error('smoke: no Chrome/Chromium found (set CHROME_PATH)'); process.exit(2); }

// ── assemble the harness: real html/css/js + a vscode-api stub + error trap ──
// Everything is INLINED into one document: file:// treats external file scripts
// as cross-origin and MUTES their errors (window.onerror never fires — verified:
// an injected TDZ crash sailed through the external-script variant of this
// harness). Same-document scripts always report. Every Glass webview panel
// (home, files, …) is booted the same way — add a panel name to PANELS and its
// boot is gated too.
const PANELS = ['home', 'files'];
const trap = `<script>
  window.__smokeErrors = [];
  window.onerror = (msg, src, line, col) => { window.__smokeErrors.push(msg + ' @' + line + ':' + col); return false; };
  window.acquireVsCodeApi = () => ({ postMessage(){}, getState(){ return undefined; }, setState(){} });
  window.addEventListener('load', () => {
    document.title = window.__smokeErrors.length
      ? 'SMOKE_FAIL ' + window.__smokeErrors.join(' | ')
      : 'SMOKE_PASS';
  });
</script>`;

function bootPanel(name) {
  const dir = mkdtempSync(join(tmpdir(), 'glass-smoke-'));
  const css = readFileSync(join(media, name + '.css'), 'utf8');
  const js = readFileSync(join(media, name + '.js'), 'utf8');
  if (js.includes('</script')) { console.error(`smoke: ${name}.js contains </script — fix before inlining`); process.exit(2); }
  let html = readFileSync(join(media, name + '.html'), 'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') // testing boot, not CSP
    .replace(/{{NONCE}}/g, 'smoke')
    .replace(/{{CSP}}/g, '')
    .replace(/{{NLS}}/g, '') // no i18n catalog in smoke → home.js falls back to the English baked into the HTML
    .replace(/<link rel="stylesheet"[^>]*{{CSS_URI}}[^>]*\/>/, '<style>' + css.replace(/\$/g, '$$$$') + '</style>')
    .replace(/<script[^>]*{{JS_URI}}[^>]*><\/script>/, () => '<script>' + js + '</script>');
  // trap must run BEFORE the inlined panel script — top of <head>
  html = html.replace('<head>', '<head>\n' + trap);
  writeFileSync(join(dir, name + '.html'), html);

  let dom = '';
  try {
    dom = execFileSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=2000',
      '--dump-dom', 'file://' + join(dir, name + '.html'),
    ], { encoding: 'utf8', timeout: 60000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Read the verdict from <title> ONLY — the dumped DOM also contains the trap
  // script's own source, so a whole-document `includes('SMOKE_PASS')` always
  // matches its own literal and can never fail (caught by the negative test).
  const title = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  if (title.trim() === 'SMOKE_PASS') { console.log(`smoke: ${name} panel boots clean ✓`); return true; }
  console.error(`smoke: ${name.toUpperCase()} PANEL FAILED TO BOOT`);
  console.error(title ? title : '(no verdict in <title> — page may not have loaded at all)');
  return false;
}

const ok = PANELS.map(bootPanel).every(Boolean);
process.exit(ok ? 0 : 1);
