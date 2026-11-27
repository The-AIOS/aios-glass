/* Glass lists the same sessions as the App: the operator's (isOperatorSession) AND in scope
   (agents/sessionScope, the App's core/sessionScope copied unchanged). The-AIOS/aios-app#226. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { operatorSessions, type RunningAgent } from '../agents/running';
import type { SessionScope } from '../agents/sessionScope';

const s = (name: string, cwd: string, extra: Partial<RunningAgent> = {}): RunningAgent => ({
  pid: 1, name, status: 'idle', sessionId: `id-${name}`, cwd, spawned: true, startedAt: 0, updatedAt: 0,
  version: '', kind: 'interactive', entrypoint: 'cli', ...extra,
} as RunningAgent);

const scope: SessionScope = {
  paneSessionIds: new Set(['id-in-a-tab']), primaries: new Set(['jarvis']), busNames: new Set(['worker']),
  roots: ['/Users/op/aios', '/Users/op/code/project'], caseInsensitive: false,
};

test('a session outside every root, not in a tab of this window, not primary and never messaged is not listed', () => {
  const all = [s('probe', '/Users/op/code/x')];
  assert.deepEqual(operatorSessions(all, scope).map((a) => a.name), []);
});

test('any one reason puts a session in: a tab of this window, a primary, the bus, or a root', () => {
  const all = [
    s('in-a-tab', '/Users/op/code/x'),
    s('Jarvis', '/tmp'),
    s('worker', '/elsewhere'),
    s('framework', '/Users/op/aios/vault'),
    s('project', '/Users/op/code/project'),
    s('neighbour', '/Users/op/code/project-two'),
  ];
  assert.deepEqual(operatorSessions(all, scope).map((a) => a.name), ['in-a-tab', 'Jarvis', 'worker', 'framework', 'project']);
});

test('headless and background sessions stay out whatever the scope; no scope keeps the old rule', () => {
  const all = [s('bg', '/Users/op/aios', { kind: 'bg' }), s('sdk', '/Users/op/aios', { entrypoint: 'sdk-py' }), s('x', '/anywhere')];
  assert.deepEqual(operatorSessions(all, scope).map((a) => a.name), []);
  assert.deepEqual(operatorSessions(all).map((a) => a.name), ['x']);
});
