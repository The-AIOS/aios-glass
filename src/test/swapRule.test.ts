/**
 * The Home panel's account swap: offered at the usage the framework names, the same rule as the
 * AIOS App. Before, Glass offered it at 5h 95 / 7d 99 from constants of its own while the watcher
 * rotated at 98. Those numbers stay only as the fallback for a framework that does not say its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readSwapRule, swapOffer, LEGACY_SWAP_RULE } from '../home/swapRule';

const ROOT = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const row = (email: string, extra: Record<string, unknown> = {}) => ({
  email, alias: '', plan: '', rotation: true, reason: '', state: 'available', detail: '', ...extra,
});
const NEW = (paused: number | null = null) => ({ rotate_at: { five_hour: 98, seven_day: 98 }, swap_offer_at: { five_hour: 95, seven_day: 95 }, rotation_paused_until: paused });

test('the rule is read from the framework answer; an older answer has none', () => {
  const json = JSON.stringify([row('a@toy.test', { state: 'active', ...NEW() }), row('b@toy.test', NEW())]);
  assert.deepEqual(readSwapRule(json), { offerFiveHour: 95, offerSevenDay: 95, pausedUntil: null });
  assert.equal(readSwapRule(JSON.stringify([row('a@toy.test'), row('b@toy.test')])), null, 'an older framework: no rule');
  assert.equal(readSwapRule(JSON.stringify([row('a@toy.test', NEW()), row('b@toy.test', { ...NEW(), swap_offer_at: { five_hour: 90, seven_day: 95 } })])), null, 'rows that disagree are not a rule');
  for (const bad of ['', 'not json', '{}', '[]', JSON.stringify([row('a', { swap_offer_at: { five_hour: 0, seven_day: 95 } })])]) {
    assert.equal(readSwapRule(bad), null, JSON.stringify(bad));
  }
  assert.equal(readSwapRule(JSON.stringify([row('a', NEW(1795820000))]))?.pausedUntil, 1795820000);
});

test('the button: at the framework\'s usage, in either window, only with two accounts or more', () => {
  const rule = { offerFiveHour: 95, offerSevenDay: 95, pausedUntil: null };
  const at = (fiveHour: number, sevenDay: number, accounts = 2, next = 'b@toy.test') => swapOffer({ fiveHour, sevenDay, accounts, rule, next });
  assert.equal(at(94, 10).showSwap, false);
  assert.deepEqual(at(95, 10), { showSwap: true, to: 'b@toy.test', pausedUntil: null });
  assert.equal(at(10, 95).showSwap, true, 'the weekly window at the same margin (Glass used to wait for 99)');
  assert.equal(at(99, 99, 1).showSwap, false, 'one account: nothing to swap to');
  assert.deepEqual(at(97, 10, 2, ''), { showSwap: true, to: '', pausedUntil: null }, 'nowhere to go: still shown');
  assert.equal(swapOffer({ fiveHour: 96, sevenDay: 0, accounts: 2, rule: { ...rule, pausedUntil: 1795820000 }, next: 'b' }).pausedUntil, 1795820000);
});

test('an older framework keeps Glass\'s previous numbers, and only then', () => {
  assert.deepEqual(LEGACY_SWAP_RULE, { offerFiveHour: 95, offerSevenDay: 99, pausedUntil: null });
  const legacy = (f: number, s: number) => swapOffer({ fiveHour: f, sevenDay: s, accounts: 2, rule: LEGACY_SWAP_RULE, next: 'b' }).showSwap;
  assert.equal(legacy(95, 0), true);
  assert.equal(legacy(0, 98), false, 'as before: 7d waited for 99');
  assert.equal(legacy(0, 99), true);
});

test('the Home panel decides through the framework rule, and says when it falls back', () => {
  const home = read('src', 'home', 'homePanel.ts');
  assert.match(home, /const rule = swapRule\(\);/);
  assert.match(home, /rule: rule \?\? LEGACY_SWAP_RULE/);
  assert.match(home, /log\('quota: the account answer carries no rotation thresholds/);
  assert.doesNotMatch(home, /fiveHourPct >= 95|sevenDayPct >= 99/, 'no inline threshold left in the panel');
  const cfg = read('src', 'home', 'config.ts');
  assert.match(cfg, /\{ rows, error: '', at: Date\.now\(\), rule: readSwapRule\(out\) \}/, 'the rule comes from the same answer the rows do');
  assert.match(read('src', 'rituals', 'runner.ts'), /accountsChanged\(\);/, 'after a swap the answer is asked again');
  assert.match(cfg, /if \(accountsAsking\) void accountsAsking\.then\(again\); else again\(\);/, 'an ask started before the swap is followed by a new one');
  const js = read('media', 'home.js');
  assert.match(js, /NLS\('running\.quotaWarn\.paused', 'rotation paused until \{time\}'\)/);
  assert.match(js, /q\.pausedUntil \* 1000 > Date\.now\(\)/, 'an ended pause is not shown');
});

test('the pause line exists in every locale', () => {
  for (const loc of ['en', 'es', 'fr', 'pt-br', 'el']) {
    const m = JSON.parse(read('media', 'i18n', `strings.${loc}.json`));
    assert.match(m['running.quotaWarn.paused'] ?? '', /\{time\}/, loc);
  }
});
