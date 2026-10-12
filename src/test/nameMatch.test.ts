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
