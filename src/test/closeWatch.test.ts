import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCloseWatch, closeWatchStep, watchKey, type WatchedSession } from '../tasks/closeWatch';

const s = (sessionId: string, status: string, name = 'worker'): WatchedSession => ({ sessionId, pid: 1, name, status });

test('busy → idle is finished; a session never seen busy is left alone', () => {
  const a = s('a', 'busy', 'alpha'), b = s('b', 'idle', 'beta');
  const w = newCloseWatch([watchKey(a), watchKey(b)]);
  assert.deepEqual(closeWatchStep(w, [a, b]), { finished: [], gone: [] });
  assert.deepEqual(closeWatchStep(w, [s('a', 'idle', 'alpha'), b]), { finished: [watchKey(a)], gone: [] });
  assert.deepEqual([...w.watching], [watchKey(b)]);
});

test('a session that left the registry is gone, not finished', () => {
  const a = s('a', 'busy');
  const w = newCloseWatch([watchKey(a)]);
  closeWatchStep(w, [a]);
  assert.deepEqual(closeWatchStep(w, []), { finished: [], gone: [watchKey(a)] });
});

test('busy → waiting is NOT finished: the session needs the operator, the capture is not over', () => {
  const a = s('a', 'busy');
  const w = newCloseWatch([watchKey(a)]);
  closeWatchStep(w, [a]);
  assert.deepEqual(closeWatchStep(w, [s('a', 'waiting')]), { finished: [], gone: [] });
  assert.ok(w.watching.has(watchKey(a)), 'still watched while it waits');
  // the operator answers, close-session resumes and ends
  assert.deepEqual(closeWatchStep(w, [s('a', 'busy')]), { finished: [], gone: [] });
  assert.deepEqual(closeWatchStep(w, [s('a', 'idle')]), { finished: [watchKey(a)], gone: [] });
});

test('only idle finishes: shell or an unknown status keeps the session watched', () => {
  for (const st of ['shell', '', 'input needed']) {
    const a = s('a', 'busy');
    const w = newCloseWatch([watchKey(a)]);
    closeWatchStep(w, [a]);
    assert.deepEqual(closeWatchStep(w, [s('a', st)]), { finished: [], gone: [] }, `status "${st}"`);
  }
});

test('two sessions with one name are watched apart, by session id', () => {
  const a = s('a', 'busy', 'ingest'), b = s('b', 'busy', 'ingest');
  assert.notEqual(watchKey(a), watchKey(b));
  const w = newCloseWatch([watchKey(a), watchKey(b)]);
  closeWatchStep(w, [a, b]);
  // `a` ends while `b` is still capturing — in either registry order
  assert.deepEqual(closeWatchStep(w, [s('a', 'idle', 'ingest'), b]), { finished: [watchKey(a)], gone: [] });
  assert.deepEqual([...w.watching], [watchKey(b)]);
});
