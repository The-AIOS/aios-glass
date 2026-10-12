/** app#58's idea, both surfaces: a request reaches a session whatever its name's case. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionKey, resolveSessionName } from '../core/nameMatch';

test('an exact name wins; otherwise the one live session with the same handle', () => {
  assert.equal(resolveSessionName('market-desk', ['Market-desk', 'buddai']), 'Market-desk', 'capitals in the registry');
  assert.equal(resolveSessionName('market-desk', ['market-desk', 'Market-desk']), 'market-desk', 'exact match wins');
  assert.equal(resolveSessionName('market-desk', ['Market-Desk', 'MARKET-desk']), undefined, 'two candidates: ambiguous, refuse rather than guess');
  assert.equal(resolveSessionName('nobody', ['buddai']), undefined);
  assert.equal(resolveSessionName('', ['buddai']), undefined);
  assert.equal(sessionKey(' Market Desk! '), 'market-desk');
});

test('security: a registry name with shell characters is never returned', () => {
  assert.equal(resolveSessionName('x-rm-rf', ['x; rm -rf ~']), undefined, 'cleans to a near-handle but is unsafe');
  assert.equal(resolveSessionName('market-desk', ['Market-desk$(whoami)', 'Market-desk']), 'Market-desk', 'only the safe one is a candidate');
  assert.equal(resolveSessionName('a', ['a`id`']), undefined);
});
