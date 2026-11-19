/** Claude answers in Glass's language, without ever overriding a language the operator chose (parity with the AIOS App). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { decideClaudeLanguage, claudeLanguageFor } from '../core/claudeLanguage';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('every shipped catalog has a Claude language entry; English leaves Claude matching the operator', () => {
  const langs = (JSON.parse(read('package.json')).contributes.configuration.properties['aiosGlass.language'].enum as string[]).filter((l) => l !== 'auto');
  for (const l of langs) assert.ok(l === 'en' ? claudeLanguageFor(l) === null : typeof claudeLanguageFor(l) === 'string', `${l} has no Claude language`);
  assert.equal(claudeLanguageFor('fr'), 'French');
});

test('the rules: follow the surface, never override the operator', () => {
  assert.deepEqual(decideClaudeLanguage({ target: 'French' }), { kind: 'set', value: 'French' });
  assert.deepEqual(decideClaudeLanguage({ local: 'French', synced: 'French', target: 'Greek' }), { kind: 'set', value: 'Greek' });
  assert.deepEqual(decideClaudeLanguage({ local: 'French', synced: 'French', target: null }), { kind: 'unset' });
  assert.deepEqual(decideClaudeLanguage({ local: 'japanese', synced: 'French', target: 'Greek' }), { kind: 'keep' });
  assert.deepEqual(decideClaudeLanguage({ local: 'French', synced: 'French', elsewhere: 'english', target: 'French' }), { kind: 'unset' });
  assert.deepEqual(decideClaudeLanguage({ elsewhere: 'english', target: 'French' }), { kind: 'keep' });
});

test('the sync runs at activation and when the language or framework path changes', () => {
  const ext = read('src/extension.ts');
  assert.match(ext, /initI18n\(context\.extensionUri\);[^\n]*\n\s*syncClaudeLanguage\(\);/, 'activation');
  assert.match(ext, /affectsConfiguration\('aiosGlass\.language'\)[^\n]*syncClaudeLanguage\(\)/, 'on change');
});

test('every catalog ships French with the same keys and placeholders as English', () => {
  const ph = (s: string): string => (s.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join(',');
  for (const [en, fr] of [['l10n/bundle.l10n.json', 'l10n/bundle.l10n.fr.json'], ['package.nls.json', 'package.nls.fr.json'], ['media/i18n/strings.en.json', 'media/i18n/strings.fr.json']]) {
    const a = JSON.parse(read(en)) as Record<string, string>; const b = JSON.parse(read(fr)) as Record<string, string>;
    assert.deepEqual(Object.keys(b), Object.keys(a), fr);
    for (const k of Object.keys(a)) if (!k.startsWith('_')) assert.equal(ph(b[k]), ph(a[k]), `${fr} ${k}`);
  }
});
