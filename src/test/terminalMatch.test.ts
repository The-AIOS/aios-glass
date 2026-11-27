import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTerminal, parsePpidTable, parseWinPpidTable, type TerminalRef } from '../rituals/terminalMatch';

/* A process table: session 500 runs under shell 400, which the editor (300) started. */
const table = parsePpidTable(' 300     1\n 400   300\n  500   400\n 900 1\n');

test('the terminal whose shell is an ancestor of the session is the match, whatever its name', () => {
  const terms: TerminalRef[] = [{ name: 'zsh', shellPid: 900 }, { name: 'renamed-by-hand', shellPid: 400 }];
  assert.equal(matchTerminal(terms, 'ingest', 500, table), 1);
});

test('a terminal whose name CONTAINS the session name is not returned', () => {
  // `ingest` runs in another window; this window only has `ingest-notes`.
  const terms: TerminalRef[] = [{ name: 'ingest-notes', shellPid: 900 }];
  assert.equal(matchTerminal(terms, 'ingest', 7777, table), -1);
  assert.equal(matchTerminal(terms, 'ingest', undefined, table), -1);
});

test('with a process table and no ancestry, even an exact name is not a match', () => {
  const terms: TerminalRef[] = [{ name: 'ingest', shellPid: 900 }];
  assert.equal(matchTerminal(terms, 'ingest', 7777, table), -1);
  assert.equal(matchTerminal(terms, 'ingest', undefined, table), -1);
});

test('only when the process table could not be read does an EXACT name match, never a substring', () => {
  const none = new Map<number, number>();
  const terms: TerminalRef[] = [{ name: 'ingest-notes', shellPid: 900 }, { name: 'ingest', shellPid: 901 }];
  assert.equal(matchTerminal(terms, 'ingest', 500, none), 1);
  assert.equal(matchTerminal(terms.slice(0, 1), 'ingest', 500, none), -1);
  assert.equal(matchTerminal(terms.slice(0, 1), 'ingest', undefined, none), -1);
});

test('the Windows process table parses to the same pid → ppid map', () => {
  const out = '300,1\r\n400,300\r\n500,400\r\n\r\nnot a row\r\n';
  assert.deepEqual([...parseWinPpidTable(out)], [[300, 1], [400, 300], [500, 400]]);
  assert.equal(parseWinPpidTable('').size, 0);
});
