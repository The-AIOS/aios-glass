/** AI-190 — Glass follows the editor's theme until the operator picks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveGlassTheme } from '../home/themeResolve';

const ROOT = path.join(__dirname, '..', '..');

test('auto follows the editor theme kind; an explicit pick always wins', () => {
  assert.equal(resolveGlassTheme('auto', 1), 'light', 'Light Modern → light Home, not a dark panel in a light IDE');
  assert.equal(resolveGlassTheme('auto', 4), 'light', 'high-contrast light');
  assert.equal(resolveGlassTheme('auto', 2), 'dark');
  assert.equal(resolveGlassTheme('auto', 3), 'dark', 'high-contrast dark');
  assert.equal(resolveGlassTheme(undefined, 1), 'light', 'unset = auto');
  assert.equal(resolveGlassTheme('dark', 1), 'dark', 'the sun/moon pick survives a light editor');
  assert.equal(resolveGlassTheme('light', 2), 'light');
});

test('the setting defaults to auto, and the docs no longer say terminals always stay dark', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const prop = pkg.contributes.configuration.properties
    ? pkg.contributes.configuration.properties['aiosGlass.theme']
    : (pkg.contributes.configuration as { properties: Record<string, { default: string; enum: string[]; markdownDescription: string }> }[])
        .map((c) => c.properties['aiosGlass.theme']).find(Boolean);
  assert.equal(prop.default, 'auto');
  assert.deepEqual(prop.enum, ['auto', 'dark', 'light']);
  assert.doesNotMatch(prop.markdownDescription, /always stay dark/);
});

test('both Glass webviews repaint when the editor theme changes', () => {
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  const files = fs.readFileSync(path.join(ROOT, 'src', 'files', 'filesView.ts'), 'utf8');
  assert.match(ext, /onDidChangeActiveColorTheme\(\(\) => \{ if \(themePref\(\) === 'auto'\) HomeViewProvider\.current\?\.refresh\(\); \}\)/);
  assert.match(files, /onDidChangeActiveColorTheme\(\(\) => this\.post\(\{ type: 'theme', theme: currentTheme\(\) \}\)\)/);
});
