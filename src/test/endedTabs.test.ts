/* A kill for a session that already ended closes the terminal that session left, by a ledger of
   which session each terminal last held — never by a name (The-AIOS/aios-glass#40). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { killPlan, killReport, noteTab, pruneLedger, tabsLeftBy, childrenOf, type TabLedger } from '../rituals/endedTabs';
import { parsePpidTable } from '../rituals/terminalMatch';

// shells 100 and 200 are terminals; 300 runs under shell 200
const TABLE = parsePpidTable(['  100 1', '  200 1', '  300 200'].join('\n'));

test('a live session with its terminal here is disposed; live elsewhere goes to spawn-kill', () => {
  assert.deepEqual(killPlan({ terminalHere: true, live: true, left: [], ppidOf: TABLE }), { do: 'dispose' });
  assert.deepEqual(killPlan({ terminalHere: false, live: true, left: [], ppidOf: TABLE }), { do: 'spawn-kill' });
});

test('an ended session closes the terminal it left, and opens no spawn-kill terminal', () => {
  assert.deepEqual(killPlan({ terminalHere: false, live: false, left: [100], ppidOf: TABLE }), { do: 'close-left', close: [100], busy: [] });
});

test('a terminal with something running in its shell is not closed, and is named', () => {
  assert.deepEqual(killPlan({ terminalHere: false, live: false, left: [200], ppidOf: TABLE }),
    { do: 'close-left', close: [], busy: [{ shellPid: 200, running: [300] }] });
  assert.deepEqual(killPlan({ terminalHere: false, live: false, left: [100, 200], ppidOf: TABLE }),
    { do: 'close-left', close: [100], busy: [{ shellPid: 200, running: [300] }] }, 'the idle one closes, the busy one stays');
});

test('when the process table could not be read, an idle shell cannot be told from a busy one: nothing is closed', () => {
  assert.deepEqual(killPlan({ terminalHere: false, live: false, left: [100], ppidOf: new Map() }),
    { do: 'close-left', close: [], busy: [{ shellPid: 100, running: [] }] });
});

test('an ended session that left no terminal does nothing: no spawn-kill terminal for nothing to kill', () => {
  assert.deepEqual(killPlan({ terminalHere: false, live: false, left: [], ppidOf: TABLE }), { do: 'nothing' });
});

test('the ledger names a terminal by its shell pid, never by a name that resembles the session', () => {
  let ledger: TabLedger = {};
  ledger = noteTab(ledger, 100, { name: 'ingest', sessionId: 's-1' });
  ledger = noteTab(ledger, 200, { name: 'ingest-notes' });
  assert.deepEqual(tabsLeftBy(ledger, 'ingest', [100, 200]), [100], 'ingest-notes is another session');
  assert.deepEqual(tabsLeftBy(ledger, 'notes', [100, 200]), []);
  assert.deepEqual(tabsLeftBy(ledger, 'ingest', [200]), [], 'a terminal that is no longer open is not offered');
});

test('a newer session in the same terminal replaces the older one; a closed terminal is forgotten', () => {
  let ledger = noteTab({}, 100, { name: 'old', sessionId: 's-1' });
  ledger = noteTab(ledger, 100, { name: 'new', sessionId: 's-2' });
  assert.deepEqual(tabsLeftBy(ledger, 'old', [100]), [], 'a kill for the old name must not close the new session');
  assert.deepEqual(tabsLeftBy(ledger, 'new', [100]), [100]);
  const same = noteTab(ledger, 100, { name: 'new' });
  assert.equal(same, ledger, 'noting what is already known changes nothing (and keeps the session id)');
  assert.deepEqual(pruneLedger(noteTab(ledger, 200, { name: 'x' }), [200]), { '200': { name: 'x' } });
  assert.deepEqual(childrenOf(200, TABLE), [300]);
  assert.deepEqual(childrenOf(100, TABLE), []);
});

test('a name lives in one terminal: when a session of that name is seen in another, the older terminal is forgotten', () => {
  let ledger = noteTab({}, 100, { name: 'w', sessionId: 's-1' });   // w ran in 100, ended
  ledger = noteTab(ledger, 200, { name: 'w', sessionId: 's-2' });   // w runs again in 200
  assert.deepEqual(tabsLeftBy(ledger, 'w', [100, 200]), [200], 'a kill closes the terminal of the latest w, never the old one');
});

test('a recycled shell pid is not the terminal the session left: the shell start time must match', () => {
  const ledger = noteTab({}, 100, { name: 'w', shellStart: 1_000_000 });
  assert.deepEqual(tabsLeftBy(ledger, 'w', [100], new Map([[100, 1_000_500]])), [100], 'same shell (within tolerance)');
  assert.deepEqual(tabsLeftBy(ledger, 'w', [100], new Map([[100, 9_000_000]])), [], 'a new shell holding the old pid is left alone');
  const renoted = noteTab(ledger, 100, { name: 'w' });
  assert.equal(renoted, ledger, 'noting the same session without a start keeps the recorded one');
});

test('the log line says what happened, and never "closed" when nothing closed', () => {
  assert.equal(killReport('w', { did: 'nothing', closed: 0, busy: [] }), "kill 'w': no live session and no terminal left by one: nothing to close");
  assert.equal(killReport('w', { did: 'closed-left', closed: 1, busy: [] }), "kill 'w': no live session; closed the terminal it left");
  const kept = killReport('w', { did: 'closed-left', closed: 0, busy: [{ shellPid: 200, running: [300] }] });
  assert.doesNotMatch(kept, /closed/);
  assert.match(kept, /left 1 open because something is running in it \(shell 200 is running pid 300\)/);
  assert.match(killReport('w', { did: 'spawn-kill', closed: 0, busy: [] }), /ran spawn-kill/);
});
