#!/usr/bin/env node
/**
 * Does the .vsix carry the one runtime dependency, and nothing else from node_modules?
 *
 * Glass has no bundler: `out/` is plain compiled files that `require('@the-aios/core/…')` at
 * activation. For years the extension had no runtime dependency at all, so it was packaged with
 * `--no-dependencies` and `.vscodeignore` dropped `node_modules/` whole. Packaged that way today
 * the .vsix builds, installs, and fails on its first require, in the operator's editor.
 *
 * Two questions, both from the archive's own file list:
 *   1. every module of the installed @the-aios/core is in the .vsix, with its package.json
 *      (the subpath imports resolve through its `exports`);
 *   2. nothing else under node_modules is. A second dependency that slips in unannounced ships
 *      to every operator; adding one is a decision, made by listing it here.
 *
 *   node scripts/check-vsix.mjs aios-glass.vsix
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vsix = process.argv[2];
const fail = (msg) => { console.error(`check-vsix ✗ ${msg}`); process.exit(1); };
if (!vsix || !existsSync(vsix)) fail(`no such file: ${vsix || '(none given)'}`);

/* The runtime dependencies that are allowed inside the .vsix. */
const ALLOWED = ['@the-aios/core'];

const entries = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean);
// control: the listing has to be the extension, or "nothing unexpected" means nothing
if (!entries.includes('extension/out/extension.js')) fail('the archive has no extension/out/extension.js — is this the .vsix?');

const NM = 'extension/node_modules/';
const inModules = entries.filter((e) => e.startsWith(NM) && !e.endsWith('/'));
const stray = inModules.filter((e) => !ALLOWED.some((d) => e.startsWith(`${NM}${d}/`)));
if (stray.length) {
  fail(`the .vsix carries node_modules it should not (${stray.length} file(s)), e.g.:\n  ${stray.slice(0, 8).join('\n  ')}`);
}

for (const dep of ALLOWED) {
  const dist = join(root, 'node_modules', ...dep.split('/'), 'dist');
  if (!existsSync(dist)) fail(`${dep} is not installed here (run npm ci) — cannot tell what the .vsix should carry`);
  const modules = readdirSync(dist).filter((f) => f.endsWith('.js'));
  if (!modules.length) fail(`${dep} is installed with an empty dist/`);
  const missing = [`${NM}${dep}/package.json`, ...modules.map((m) => `${NM}${dep}/dist/${m}`)]
    .filter((f) => !entries.includes(f));
  if (missing.length) {
    fail(`the .vsix is missing ${missing.length} file(s) of ${dep}; the extension would fail on its first require:\n  ${missing.slice(0, 8).join('\n  ')}`);
  }
  console.log(`check-vsix ✓ ${dep}: ${modules.length} modules and package.json are in the .vsix`);
}
console.log(`check-vsix ✓ nothing else from node_modules (${inModules.length} file(s), all allowed)`);
