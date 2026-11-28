/**
 * The-AIOS/aios#430: where the watcher rotates (5-hour and weekly limits) and whether it rotates on its own are ONE
 * setting, owned by the framework. The Config menu shows and edits it, as the AIOS App does in Settings: read from
 * `--availability` (`rotation_setting`), changed only through `claude-identity.sh rotation --set`. Glass writes no
 * file and keeps no number. A framework that does not send the setting has no such command, so no entry is shown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRotationSetting, readRotationAnswer, rotationSetArgs, readSwapRule } from '../home/swapRule';

const ROOT = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SETTING = (over: Record<string, unknown> = {}) => ({
  five_hour: { value: 90, source: 'file' }, seven_day: { value: 98, source: 'default' },
  enabled: { value: true, source: 'default' }, min: 50, max: 98, ignored: [], ...over,
});
const NONE = Symbol('no rotation_setting');   // an older framework's row
const row = (email: string, setting: unknown = SETTING()) => ({
  email, state: 'available', rotate_at: { five_hour: 90, seven_day: 98 }, swap_offer_at: { five_hour: 87, seven_day: 95 },
  rotation_paused_until: null, ...(setting === NONE ? {} : { rotation_setting: setting }),
});

test('the setting is read from the framework answer, with where each value comes from', () => {
  assert.deepEqual(readRotationSetting(JSON.stringify([row('a@toy.test'), row('b@toy.test')])), {
    fiveHour: { value: 90, source: 'file' }, sevenDay: { value: 98, source: 'default' },
    enabled: { value: true, source: 'default' }, min: 50, max: 98, ignored: [],
  });
  assert.deepEqual(readSwapRule(JSON.stringify([row('a@toy.test')])), { offerFiveHour: 87, offerSevenDay: 95, pausedUntil: null }, 'the swap rule still reads the same answer');
  assert.equal(readRotationSetting(JSON.stringify([row('a@toy.test', NONE)])), null, 'an older framework: no setting, so no entry');
  assert.equal(readRotationSetting(JSON.stringify([row('a', SETTING()), row('b', SETTING({ min: 60 }))])), null, 'rows that disagree are not a setting');
  for (const bad of [
    SETTING({ five_hour: { value: '90', source: 'file' } }), SETTING({ five_hour: { value: 90.5, source: 'file' } }),
    SETTING({ five_hour: { value: 90, source: 'plist' } }), SETTING({ enabled: { value: 'false', source: 'file' } }),
    SETTING({ min: 99, max: 98 }), 'on', null,
  ]) assert.equal(readRotationSetting(JSON.stringify([row('a', bad)])), null, JSON.stringify(bad));
  for (const bad of ['', 'not json', '{}', '[]']) assert.equal(readRotationSetting(bad), null, JSON.stringify(bad));
  assert.equal(readRotationAnswer(JSON.stringify(SETTING({ enabled: { value: false, source: 'file' } })))?.enabled.value, false);
});

test('what is sent to the framework: only values it accepts, in its own words', () => {
  const s = readRotationSetting(JSON.stringify([row('a')]));
  assert.deepEqual(rotationSetArgs({ fiveHour: 90, sevenDay: 95 }, s), { args: ['5h=90', '7d=95'] });
  assert.deepEqual(rotationSetArgs({ enabled: false }, s), { args: ['off'] });
  for (const bad of [{ fiveHour: 99 }, { fiveHour: 49 }, { sevenDay: 90.5 }, { fiveHour: NaN }, {}]) assert.ok('error' in rotationSetArgs(bad, s), JSON.stringify(bad));
  assert.ok('error' in rotationSetArgs({ fiveHour: 90 }, null), 'no setting from the framework: nothing is sent');
});

test('config changes it only through the framework command, and writes nothing itself', () => {
  const src = read('src', 'home', 'config.ts');
  const fn = src.slice(src.indexOf('export function setRotation('), src.indexOf('/** After a swap the cached answer'));
  assert.match(fn, /rotationSetArgs\(change, cur\)/, 'checked against what the framework reported');
  assert.match(fn, /execFile\(bash, \[identityScript\(\) as string, 'rotation', '--set', \.\.\.built\.args\]/, 'the framework\'s own command, through Git Bash');
  assert.match(fn, /accountsChanged\(\);/, 'the swap button follows the new numbers at once');
  assert.doesNotMatch(fn, /fs\.|writeFile|quota-rotation/, 'Glass never writes the file');
  assert.match(src, /rotation: readRotationSetting\(out\)/, 'read from the same answer as the rows');
});

test('the Config menu: an entry only when the framework sends the setting, and every word translated', () => {
  const menu = read('src', 'home', 'configMenu.ts');
  assert.match(menu, /\.\.\.\(rotation \? \[\{ label: '\$\(sync\) ' \+ t\('Account rotation'\), description: rotationSummary\(rotation\), id: 'rotation' \}\] : \[\]\)/);
  assert.match(menu, /case 'rotation': \{\s*await rotationMenu\(\);/);
  const body = menu.slice(menu.indexOf('function rotationSummary('), menu.indexOf('/** Human label for the Glass language setting. */'));
  assert.match(body, /source === 'environment'/, 'a value set outside Glass is said, not edited');
  assert.match(body, /validateInput: .*s\.min.*s\.max/, 'the range is the framework\'s');
  const keys = [...body.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1].replace(/\\'/g, "'"));
  assert.ok(keys.length >= 12, `found ${keys.length} strings`);
  for (const loc of ['', '.es', '.pt-br', '.fr', '.el']) {
    const b = JSON.parse(read('l10n', `bundle.l10n${loc}.json`));
    for (const k of keys) {
      if (['on', 'off', 'On', 'Off', 'currently'].includes(k)) continue;   // shared words, translated where the bundle already carries them
      assert.ok(typeof b[k] === 'string' && b[k].trim(), `bundle.l10n${loc}.json: ${k}`);
      assert.doesNotMatch(b[k], /quota-rotation|CLAUDE_QUOTA|watcher|json/i, `${loc}: ${k} names no mechanism`);
    }
  }
});
