/** Claude's language is the operator's own choice, beside Glass's: never changed with it, only asked about (parity with the AIOS App 0.17.0). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { claudeLanguageFor, claudeLanguageSuggestion, CLAUDE_LANGUAGES } from '../core/claudeLanguage';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('every shipped catalog has a Claude language; English matching means "the language you write in"', () => {
  const langs = (JSON.parse(read('package.json')).contributes.configuration.properties['aiosGlass.language'].enum as string[]).filter((l) => l !== 'auto');
  for (const l of langs) assert.ok(CLAUDE_LANGUAGES.some((c) => c.locale === l), `${l} has no Claude language`);
  assert.equal(claudeLanguageFor('en'), null);
  assert.equal(claudeLanguageFor('fr'), 'French');
});

test('the shared module is byte-identical to the App\'s, when the App is checked out beside Glass', () => {
  const app = path.join(ROOT, '..', 'aios-app', 'src', 'core', 'claudeLanguage.ts');
  if (!fs.existsSync(app)) return;
  assert.equal(read('src/core/claudeLanguage.ts'), fs.readFileSync(app, 'utf8'));
});

test('matching is suggested only when Claude does not already match', () => {
  assert.deepEqual(claudeLanguageSuggestion('fr', null), { value: 'French' });
  assert.equal(claudeLanguageSuggestion('fr', 'french'), null);
  assert.deepEqual(claudeLanguageSuggestion('en', 'French'), { value: null });
  assert.equal(claudeLanguageSuggestion('en', null), null);
});

test('nothing writes Claude\'s language at activation or on a language change: it only asks', () => {
  const ext = read('src/extension.ts');
  const cfg = read('src/home/config.ts');
  assert.doesNotMatch(ext + cfg, /syncClaudeLanguage/, 'the automatic sync is gone');
  assert.doesNotMatch(ext, /askClaudeLanguage/, 'not from the config listener: the setting is global, so every window would ask (review)');
  assert.match(read('src/home/configMenu.ts'), /await setLanguage\(choice\.value\);\n\s*HomeViewProvider\.current\?\.rerender\(\);\n[\s\S]{0,300}?await askClaudeLanguage\(\);/, 'asked in the window where the language was picked');
  assert.match(read('src/home/configMenu.ts'), /id: 'claudelang'/, 'the choice is in the config menu');
  assert.match(cfg, /const j = readJsonForWrite\(p\);\n    if \(!j\) return false;/, 'a settings file that does not parse is never rewritten');
});

test('every catalog ships French with the same keys and placeholders as English', () => {
  const ph = (s: string): string => (s.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join(',');
  for (const [en, fr] of [['l10n/bundle.l10n.json', 'l10n/bundle.l10n.fr.json'], ['package.nls.json', 'package.nls.fr.json'], ['media/i18n/strings.en.json', 'media/i18n/strings.fr.json']]) {
    const a = JSON.parse(read(en)) as Record<string, string>; const b = JSON.parse(read(fr)) as Record<string, string>;
    assert.deepEqual(Object.keys(b), Object.keys(a), fr);
    for (const k of Object.keys(a)) if (!k.startsWith('_')) assert.equal(ph(b[k]), ph(a[k]), `${fr} ${k}`);
  }
});
