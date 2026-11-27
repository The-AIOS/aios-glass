/**
 * "Is today closed?" is answered by one line: the `## Close of Day` heading that /aios:close-day
 * writes and /aios:today's precondition greps for (`^## Close of Day`). The nudge used to accept
 * the words anywhere in the note, so a task that mentions them silenced the evening reminder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDayClosed } from '../insights/dayClosed';

test('only the heading /aios:close-day writes closes the day', () => {
  assert.equal(isDayClosed('# Fri\n\n## Close of Day\n\nShipped.\n'), true);
  assert.equal(isDayClosed('# Fri\r\n\r\n## Close of Day\r\n'), true, 'CRLF note');
  assert.equal(isDayClosed('## Close of Day — 3 shipped\n'), true, 'text after the heading');
});

test('a mention of closing the day is not a closed day', () => {
  for (const md of [
    '- [ ] Prep close of day review\n',
    '- [ ] Run /aios:close-day tonight\n',
    'Notes for the close-of-day block.\n',
    '> 💡 `/aios:drift` _before close of day_\n',
    '### Close the day checklist\n',
    '## Session — close the day early\n',
    '### Close of Day\n',
    '  ## Close of Day\n',
    '## close of day\n',
    'x\r## Close of Day',
    '',
  ]) assert.equal(isDayClosed(md), false, JSON.stringify(md));
});

test('the nudge asks isDayClosed, and nothing else, whether the day is closed', () => {
  // insights.ts imports the editor API, so it cannot be loaded here: read how it decides.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'insights', 'insights.ts'), 'utf8');
  const body = src.slice(src.indexOf('export function nudgeState('));
  assert.match(body, /const isClosed = isDayClosed\(md\);/);
  assert.doesNotMatch(src, /close\[\\s-\]\?of/, 'the unanchored expression is gone');
});
