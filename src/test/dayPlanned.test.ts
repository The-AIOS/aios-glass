/* "Plan your day" asks whether the day was planned, not whether today's note exists, and the
   post-it harvest never loses the note or the post-its (#57, part of The-AIOS/aios-app#226). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dayPlanned, asksToPlan } from '../core/dayPlanned';
import { harvestAppendix, HARVEST_HEADING } from '../agents/sessionNotesParse';
import { appendHarvestToNote } from '../agents/harvestWrite';

const SRC = path.join(__dirname, '..', '..', 'src');
const notes = [{ text: 'reply to the vendor', ts: 1 }, { text: 'rerun the suite', ts: 2 }];

const SESSION_BLOCK = '## Session — 05:36 | worker: closed\n<!-- close-session: x -->\n\n**Wins:**\n- shipped\n';
const CLOSE_OF_DAY = '## Close of Day\n\n### Shipped\n- a\n\n### Rhythm check\n- ok\n';

test('a note /aios:today wrote counts as planned, including a first run and a title in another language', () => {
  assert.equal(dayPlanned('# 2026-11-28 — Daily Plan\n\n## Claude\'s take\nx\n\n## Rhythm\n### Morning — Create\n'), true);
  assert.equal(dayPlanned('# Viernes 4 de septiembre de 2026\n\n## Calendar\n\n## Today I ship\nx\n\n## Rhythm\n'), true);
  assert.equal(dayPlanned('# 2026-11-28 — Day One\n\n> Day one.\n\n## Recommended next step\n'), true);
  assert.equal(dayPlanned('# Day\n\n## 🤖 Agents can handle\n- 🤖 x\n'), true, 'a symbol may lead the heading');
  assert.equal(dayPlanned('# Day\n\n## Parking lot\n- [ ] x\n'), true);
});

test('a note only appenders wrote is not planned: session blocks, a close-day, harvested post-its', () => {
  assert.equal(dayPlanned(''), false);
  assert.equal(dayPlanned('---\n\n' + SESSION_BLOCK), false, '/close-session creates the note with its block');
  assert.equal(dayPlanned(SESSION_BLOCK + '\n' + CLOSE_OF_DAY), false, '`### Rhythm check` is close-day\'s, not a plan');
  assert.equal(dayPlanned(harvestAppendix('', 'worker', '2026-11-28 02:40', notes)), false, 'the note a harvest creates');
  assert.equal(dayPlanned('# Viernes 9 de octubre de 2026\n\n> Semana\n\n' + SESSION_BLOCK), false, 'a title alone');
});

test('a note rebuilt after the fact is not planned: neither the plan tag nor a "Daily Plan" title counts', () => {
  assert.equal(dayPlanned('---\ntags: [daily, plan, vault]\nreconstructed: partial\n---\n# Day\n\n' + SESSION_BLOCK), false);
  assert.equal(dayPlanned('# 2026-05-06 — Daily Plan\n\n## Calendar\n\n' + CLOSE_OF_DAY), false);
});

test('a heading quoted in a code block does not count; CRLF line endings do', () => {
  assert.equal(dayPlanned(SESSION_BLOCK + '\n```md\n## Rhythm\n```\n'), false);
  assert.equal(dayPlanned(SESSION_BLOCK + '\n~~~\n## Parking lot\n~~~\n'), false);
  assert.equal(dayPlanned('# Day\r\n\r\n## Rhythm\r\n- x\r\n'), true);
  assert.equal(dayPlanned('```\nnot closed\n## Rhythm\n'), true, 'an unclosed fence hides nothing');
  assert.equal(dayPlanned('````md\n```\n## Rhythm\n```\n````\n'), false, 'a longer fence holds a shorter one');
  assert.equal(dayPlanned('````md\nx\n````\n\n## Rhythm\n\n```\ny\n```\n'), true, 'and closes on its own run');
  assert.equal(dayPlanned('```inline``` code\n\n## Rhythm\n\n```\ny\n```\n'), true, 'inline code is not a fence');
});

test('when the nudge asks to plan, hour by hour', () => {
  const unplanned = '---\n\n' + SESSION_BLOCK;
  const planned = '# Day\n\n## Rhythm\n- [ ] x\n';
  /* hour → [no note, unplanned, planned, unplanned but closed] */
  const table: Record<number, [boolean, boolean, boolean, boolean]> = {
    0: [true, true, false, false],
    14: [true, true, false, false],
    15: [true, false, false, false], // from 15:00 an unplanned day behaves as it did before
    16: [true, false, false, false],
    17: [true, false, false, false],
    23: [true, false, false, false],
  };
  for (const [h, [none, un, pl, closed]] of Object.entries(table)) {
    const hour = Number(h);
    assert.equal(asksToPlan(null, hour, false), none, `no note at ${hour}h`);
    assert.equal(asksToPlan(unplanned, hour, false), un, `unplanned at ${hour}h`);
    assert.equal(asksToPlan(planned, hour, false), pl, `planned at ${hour}h`);
    assert.equal(asksToPlan(unplanned + '\n' + CLOSE_OF_DAY, hour, true), closed, `closed at ${hour}h`);
  }
});

test('the harvest appends: a new note gets the section, an existing one only the entry, separated by one blank line', () => {
  const fresh = harvestAppendix('', 'worker', '2026-11-28 02:40', notes);
  assert.ok(fresh.startsWith(HARVEST_HEADING + '\n\n> '), fresh);
  assert.match(fresh, /\*\*worker\*\* _\(2026-11-28 02:40\)_\n\n- reply to the vendor\n- rerun the suite\n$/);

  const withSection = '# Day\n\n' + fresh;
  const next = harvestAppendix(withSection, 'other', '2026-11-28 03:00', [notes[0]]);
  assert.equal(next, '\n**other** _(2026-11-28 03:00)_\n\n- reply to the vendor\n', 'no second heading');

  assert.ok(harvestAppendix('# Day\n\n## Rhythm', 'w', 's', notes).startsWith('\n\n' + HARVEST_HEADING));
  assert.ok(harvestAppendix('# Day\n\n## Rhythm\n', 'w', 's', notes).startsWith('\n' + HARVEST_HEADING));
  assert.ok(harvestAppendix('# Day\n\n## Rhythm\n\n', 'w', 's', notes).startsWith(HARVEST_HEADING));

  const crlf = harvestAppendix('# Day\r\n\r\n## Rhythm\r\n', 'w', 's', notes);
  assert.ok(crlf.startsWith('\r\n' + HARVEST_HEADING + '\r\n\r\n'), JSON.stringify(crlf));
  assert.doesNotMatch(crlf, /[^\r]\n/, 'a CRLF note gets CRLF only');
  assert.ok(harvestAppendix('# Day\r\n\r\n', 'w', 's', notes).startsWith(HARVEST_HEADING), 'a blank CRLF line already separates');
});

test('on disk: a missing note is created, an existing one keeps every byte, and an unreadable one is not touched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-harvest-'));
  try {
    const created = path.join(dir, '2026-11', '2026-11-28.md');
    appendHarvestToNote(created, 'worker', '2026-11-28 02:40', notes);
    assert.match(fs.readFileSync(created, 'utf8'), /^## Session notes \(harvested\)[\s\S]*- rerun the suite\n$/);

    const planned = path.join(dir, 'planned.md');
    const before = '# 2026-11-28 — Daily Plan\n\n## Rhythm\n- [ ] the day\n\n' + SESSION_BLOCK;
    fs.writeFileSync(planned, before);
    appendHarvestToNote(planned, 'worker', '2026-11-28 02:40', notes);
    const after = fs.readFileSync(planned, 'utf8');
    assert.ok(after.startsWith(before), 'the note is appended to, never rewritten');
    assert.equal(dayPlanned(after), true);

    /* A path that exists but cannot be read as a file (EISDIR here; EACCES or a lock elsewhere).
       It used to read as '' and the write replaced the note with the post-its alone. */
    const unreadable = path.join(dir, 'unreadable.md');
    fs.mkdirSync(unreadable);
    assert.throws(() => appendHarvestToNote(unreadable, 'worker', 's', notes), /EISDIR/);
    assert.deepEqual(fs.readdirSync(unreadable), [], 'nothing was written');

    /* The case that destroyed a note: readable no, writable yes. POSIX permissions only, and
       root reads anything, so it is skipped where it cannot be set up. */
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const writeOnly = path.join(dir, 'write-only.md');
      fs.writeFileSync(writeOnly, before);
      fs.chmodSync(writeOnly, 0o200);
      assert.throws(() => appendHarvestToNote(writeOnly, 'worker', 's', notes), /EACCES/);
      fs.chmodSync(writeOnly, 0o600);
      assert.equal(fs.readFileSync(writeOnly, 'utf8'), before, 'the day\'s note is intact');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the nudge and the harvest use these pieces', () => {
  const insights = fs.readFileSync(path.join(SRC, 'insights', 'insights.ts'), 'utf8');
  const nudge = insights.slice(insights.indexOf('export function nudgeState'));
  assert.match(nudge, /if \(asksToPlan\(md, hour, isClosed\)\) return plan;/, 'the shared rule decides');
  assert.ok(nudge.indexOf('asksToPlan(') < nudge.indexOf('hour >= 17'), 'before every other nudge');

  const harvest = fs.readFileSync(path.join(SRC, 'agents', 'sessionNotes.ts'), 'utf8');
  assert.doesNotMatch(harvest, /writeFileSync/, 'the daily note is appended to, never rewritten');
  assert.match(harvest, /appendHarvestToNote\(daily,/);
  assert.match(harvest, /if \(!daily\) return 0;/, 'no vault: the post-its are kept, not cleared unwritten');
});

test('the shared module is byte-identical to the App\'s, when the App is checked out beside Glass', () => {
  const app = path.join(SRC, '..', '..', 'aios-app', 'src', 'core', 'dayPlanned.ts');
  if (!fs.existsSync(app)) return;
  assert.equal(fs.readFileSync(path.join(SRC, 'core', 'dayPlanned.ts'), 'utf8'), fs.readFileSync(app, 'utf8'));
});
