/* Opening a day never creates its note (The-AIOS/aios-app#226): the one-line file Glass used to write
   silenced the "Plan your day" nudge. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { dayOpenDecision, localIso } from '../home/dayOpen';

test('an existing note opens; today without a note offers to plan the day; any other day without one says so', () => {
  assert.equal(dayOpenDecision('2026-11-27', true, '2026-11-27'), 'open');
  assert.equal(dayOpenDecision('2026-11-20', true, '2026-11-27'), 'open');
  assert.equal(dayOpenDecision('2026-11-27', false, '2026-11-27'), 'offer-plan');
  assert.equal(dayOpenDecision('2026-11-20', false, '2026-11-27'), 'no-note', 'a past day');
  assert.equal(dayOpenDecision('2026-12-01', false, '2026-11-27'), 'no-note', 'a future day');
});

test('the day is the local one, zero-padded', () => {
  assert.equal(localIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the calendar module writes no file and makes no folder, and offers /aios:today instead', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'home', 'calendar.ts'), 'utf8');
  assert.doesNotMatch(src, /writeFileSync|mkdirSync|appendFileSync|writeFile\(/, 'opening a day must not create anything');
  assert.match(src, /dayOpenDecision\(/, 'the decision is the shared pure one');
  assert.match(src, /runInPrimarySession\('\/aios:today'\)/, 'planning the day is /aios:today in the primary session, as the nudge does');
});
