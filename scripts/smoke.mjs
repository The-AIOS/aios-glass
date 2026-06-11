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
// harness). Same-document scripts always report.
const dir = mkdtempSync(join(tmpdir(), 'glass-smoke-'));
const css = readFileSync(join(media, 'home.css'), 'utf8');
const js = readFileSync(join(media, 'home.js'), 'utf8');
if (js.includes('</script')) { console.error('smoke: home.js contains </script — fix before inlining'); process.exit(2); }
let html = readFileSync(join(media, 'home.html'), 'utf8')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') // testing boot, not CSP
  .replace(/{{NONCE}}/g, 'smoke')
  .replace(/{{CSP}}/g, '')
  .replace(/<link rel="stylesheet"[^>]*{{CSS_URI}}[^>]*\/>/, '<style>' + css.replace(/\$/g, '$$$$') + '</style>')
  .replace(/<script[^>]*{{JS_URI}}[^>]*><\/script>/, () => '<script>' + js + '</script>');
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
// trap must run BEFORE the inlined panel script — top of <head>
html = html.replace('<head>', '<head>\n' + trap);
writeFileSync(join(dir, 'home.html'), html);

// ── boot it ──
let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=2000',
    '--dump-dom', 'file://' + join(dir, 'home.html'),
  ], { encoding: 'utf8', timeout: 60000 });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Read the verdict from <title> ONLY — the dumped DOM also contains the trap
// script's own source, so a whole-document `includes('SMOKE_PASS')` always
// matches its own literal and can never fail (caught by the negative test).
const title = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
if (title.trim() === 'SMOKE_PASS') { console.log('smoke: panel boots clean ✓'); process.exit(0); }
console.error('smoke: PANEL FAILED TO BOOT');
console.error(title ? title : '(no verdict in <title> — page may not have loaded at all)');
process.exit(1);
