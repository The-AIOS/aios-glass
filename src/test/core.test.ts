/**
 * Unit tests for the pure core — runs via `node --test out/test/` (node:test,
 * built into Node 20: zero new dependencies). These cover the logic where the
 * shipped bug classes actually lived: frontmatter parsing, task migration,
 * routine step assembly, ask-session naming.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseFrontmatter } from '../core/frontmatter';
import { slug, migrateTask, stepText, askSessionName, FreqTask } from '../core/taskModel';

// ── frontmatter ──────────────────────────────────────────────────────────────

test('parseFrontmatter: block-list tags + scalars', () => {
  const fm = parseFrontmatter(`---
name: lawyer
description: "Reviews contracts"
icon: law
keywords: derecho argentino, contrato, laboral
argument-hint: <topic>
tags:
  - agent
  - finance-legal
---
# body`);
  assert.equal(fm.name, 'lawyer');
  assert.equal(fm.description, 'Reviews contracts');
  assert.equal(fm.icon, 'law');
  assert.equal(fm.keywords, 'derecho argentino, contrato, laboral');
  assert.equal(fm.argumentHint, '<topic>');
  assert.deepEqual(fm.tags, ['agent', 'finance-legal']);
});

test('parseFrontmatter: inline tags form', () => {
  const fm = parseFrontmatter(`---
tags: [agent, sales]
---`);
  assert.deepEqual(fm.tags, ['agent', 'sales']);
});

test('parseFrontmatter: no frontmatter → empty', () => {
  const fm = parseFrontmatter('# just a doc\ntags: [not-frontmatter]');
  assert.equal(fm.name, undefined);
  assert.deepEqual(fm.tags, []);
});

// ── slug ─────────────────────────────────────────────────────────────────────

test('slug: symbols collapse, edges trim, empty falls back', () => {
  assert.equal(slug('Review Diego’s PRs!'), 'review-diego-s-prs');
  assert.equal(slug('  Monday Kickoff — plan  '), 'monday-kickoff-plan');
  assert.equal(slug('???'), 'task');
});

// ── migrateTask (the legacy "question" → fixed assignment migration) ─────────

const base: FreqTask & { prompt?: string } = { id: 'u-x-1', label: 'X', kind: 'agent', target: 'lawyer', hint: '' };

test('migrateTask: user agent task promotes legacy prompt to assignment', () => {
  const t = migrateTask({ ...base, prompt: 'Review the open PRs' });
  assert.equal(t.assignment, 'Review the open PRs');
  assert.equal((t as { prompt?: string }).prompt, undefined);
});

test('migrateTask: bundled defaults drop the stale question', () => {
  const t = migrateTask({ ...base, id: 'email', prompt: 'What is the email about?' });
  assert.equal(t.assignment, undefined);
});

test('migrateTask: prompt-kind keeps its instruction in target, never migrates', () => {
  const t = migrateTask({ ...base, kind: 'prompt', target: 'Do the thing', prompt: 'leftover' });
  assert.equal(t.assignment, undefined);
});

test('migrateTask: an existing assignment is never overwritten', () => {
  const t = migrateTask({ ...base, assignment: 'keep me', prompt: 'not me' });
  assert.equal(t.assignment, 'keep me');
});

// ── stepText (routine assembly) ──────────────────────────────────────────────

test('stepText: phrasing per mechanism', () => {
  assert.match(stepText({ ...base, assignment: 'draft the brief' }, 1), /^1\. Wear the lawyer agent hat .* and draft the brief\.$/);
  assert.equal(stepText({ ...base, kind: 'command', target: 'ingest', assignment: 'this url' }, 2), '2. Run /aios:ingest with: this url.');
  assert.equal(stepText({ ...base, kind: 'command', target: 'today' }, 3), '3. Run /aios:today.');
  assert.equal(stepText({ ...base, kind: 'prompt', target: 'Full instruction here' }, 4), '4. Full instruction here');
});

// ── askSessionName ───────────────────────────────────────────────────────────

test('askSessionName: content words, stopwords stripped, max 3', () => {
  assert.equal(askSessionName('i need a social media strategy'), 'ask-social-media-strategy');
  assert.equal(askSessionName('please help me do it'), 'ask-intent');
});

test('askSessionName: caps length without trailing dash', () => {
  const n = askSessionName('extraordinarily comprehensive organizational restructuring');
  assert.ok(n.length <= 28, n);
  assert.ok(!n.endsWith('-'), n);
});

// ── ttlMemo (discovery cache) ────────────────────────────────────────────────

import { ttlMemo } from '../core/memo';

test('ttlMemo: caches within TTL, recomputes after, injectable clock', () => {
  let clock = 0;
  let calls = 0;
  const f = ttlMemo(() => ++calls, 5000, () => clock);
  assert.equal(f(), 1);
  clock = 4999; assert.equal(f(), 1); // within TTL → cached
  clock = 5001; assert.equal(f(), 2); // expired → recomputed
  clock = 5002; assert.equal(f(), 2);
});

import { parseAgentSection } from '../tasks/agentParse';

test('parseAgentSection: counts pending agent + command suggestions', () => {
  const md = [
    '## 🤖 Agents can handle',
    '- **Ingest the YouTube talk** → `/aios:ingest` https://youtu.be/abc',
    '- **Review the contract** → agent: [[lawyer]]',
    '## Next section',
  ].join('\n');
  const s = parseAgentSection(md);
  assert.equal(s.length, 2);
  assert.equal(s[0].command, '/aios:ingest');
  assert.equal(s[0].arg, 'https://youtu.be/abc');
  assert.deepEqual(s[1].agents, ['lawyer']);
});

test('parseAgentSection: skips inline-marked done lines (checkbox, strike, 🚀)', () => {
  const md = [
    '## Agents can handle',
    '- [x] **Done task** → agent: [[lawyer]]',
    '- 🤖 ~~Struck task~~ → agent: [[accountant]]',
    '- **In-flight task** → agent: [[writer]] 🚀',
    '- **Real pending** → agent: [[lawyer]]',
  ].join('\n');
  const s = parseAgentSection(md);
  assert.equal(s.length, 1);
  assert.equal(s[0].task, 'Real pending');
});

test('parseAgentSection: drops a suggestion when its canonical task is done in ANOTHER section', () => {
  // The over-count case: ledger struck the canonical copy in the timeline, but the
  // mirror under "Agents can handle" was never marked. Identity-match catches it.
  const md = [
    '## ✅ Today',
    '- [x] 09:00 🤖 Ingest the YouTube talk ✅ → notes filed in #reflections',
    '## Agents can handle',
    '- **Ingest the YouTube talk** → `/aios:ingest`',
    '- **Draft the Q3 memo** → agent: [[writer]]',
  ].join('\n');
  const s = parseAgentSection(md);
  assert.equal(s.length, 1, 'the done-elsewhere ingest should drop out');
  assert.equal(s[0].task, 'Draft the Q3 memo');
});

test('parseAgentSection: ignores prose header + footer that mention a /command', () => {
  // The real /today output: a count header above and an instruction footer below
  // the list. The footer names `/ghost`; only the list item is a real task.
  const md = [
    '## Agents can handle',
    '🤖 **1 task an agent can handle:**',
    '- 🤖 **Draft the forum post** _(→ agent: [[content-writer]])_',
    '',
    'Say "go with agents" to spawn it, or `/ghost` to write it in this session.',
  ].join('\n');
  const s = parseAgentSection(md);
  assert.equal(s.length, 1, 'the prose footer mentioning /ghost must not count as a task');
  assert.equal(s[0].task, 'Draft the forum post');
});

test('parseAgentSection: does not false-match distinct tasks', () => {
  const md = [
    '## Today',
    '- [x] Call the bank',
    '## Agents can handle',
    '- **Draft the investor update** → agent: [[writer]]',
  ].join('\n');
  assert.equal(parseAgentSection(md).length, 1);
});

// ── AI-58 per-folder sort (pure comparator + pref map) ───────────────────────

import { compareEntries, sortEntries, setFolderSort, getFolderSort, owningRoot } from '../files/sort';

const E = (name: string, dir: boolean, mtime: number) => ({ name, dir, mtime });

test('sort: folders always precede files, in BOTH modes', () => {
  assert.ok(compareEntries(E('z-dir', true, 1), E('a-file', false, 9), 'name') < 0);
  assert.ok(compareEntries(E('z-dir', true, 1), E('a-file', false, 9), 'mtime') < 0);
});

test('sort: name mode is A→Z, numeric-prefix aware', () => {
  const out = sortEntries([E('10 - x', false, 1), E('2 - a', false, 2), E('1 - b', false, 3)], 'name').map((e) => e.name);
  assert.deepEqual(out, ['1 - b', '2 - a', '10 - x']);
});

test('sort: mtime mode is newest-first with a stable name tiebreak', () => {
  const out = sortEntries([E('old', false, 100), E('new', false, 900), E('tieB', false, 500), E('tieA', false, 500)], 'mtime').map((e) => e.name);
  assert.deepEqual(out, ['new', 'tieA', 'tieB', 'old']);
});

test('sort: setFolderSort prunes the default, stores non-default', () => {
  const m1 = setFolderSort({}, '/code', 'mtime');
  assert.equal(getFolderSort(m1, '/code'), 'mtime');
  const m2 = setFolderSort(m1, '/code', 'name'); // back to default → pruned
  assert.equal('/code' in m2, false);
  assert.equal(getFolderSort(m2, '/code'), 'name'); // default read still works
});

test('sort: owningRoot picks the longest-matching workspace root', () => {
  const roots = ['/code', '/code/nested'];
  assert.equal(owningRoot(roots, '/code/nested/src/x.ts'), '/code/nested');
  assert.equal(owningRoot(roots, '/code/other/y.ts'), '/code');
  assert.equal(owningRoot(roots, '/elsewhere/z.ts'), undefined);
});

// ── AI-18 session post-its — backward-compatible note parsing ────────────────

import { parseStoredNotes } from '../agents/sessionNotesParse';

test('parseStoredNotes: legacy bare strings coerce to notes with ts=0', () => {
  const out = parseStoredNotes(['review the diff', '  merge PR #12  ']);
  assert.deepEqual(out, [
    { text: 'review the diff', ts: 0 },
    { text: 'merge PR #12', ts: 0 },
  ]);
});

test('parseStoredNotes: timestamped objects keep text + ts', () => {
  const out = parseStoredNotes([{ t: 'ship it', ts: 1_700_000_000_000 }]);
  assert.deepEqual(out, [{ text: 'ship it', ts: 1_700_000_000_000 }]);
});

test('parseStoredNotes: mixed shapes, empties + garbage dropped', () => {
  const out = parseStoredNotes([
    'keep me',
    '   ',                       // empty string → dropped
    { t: '  trimmed  ', ts: 5 }, // trimmed, ts kept
    { t: '' },                   // empty object text → dropped
    { ts: 9 },                   // no text → dropped
    42,                          // non-note → dropped
    null,                        // → dropped
  ]);
  assert.deepEqual(out, [
    { text: 'keep me', ts: 0 },
    { text: 'trimmed', ts: 5 },
  ]);
});

test('parseStoredNotes: non-array (absent / corrupt) → empty list', () => {
  assert.deepEqual(parseStoredNotes(undefined), []);
  assert.deepEqual(parseStoredNotes('not an array'), []);
  assert.deepEqual(parseStoredNotes({}), []);
});

// ── AI-7 needs-input registry reader (TTL + parse) ───────────────────────────

import { readAttention, ATTENTION_TTL_MS } from '../agents/attention';
import * as os from 'node:os';
import * as fsx from 'node:fs';
import * as pathx from 'node:path';

test('readAttention: fresh markers in, stale ones swept, garbage skipped', () => {
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'glass-attn-'));
  const now = 1_000_000_000_000;
  fsx.writeFileSync(pathx.join(dir, 'sess-a.json'), JSON.stringify({ sessionId: 'sess-a', message: 'waiting', ts: now - 1000 }));
  fsx.writeFileSync(pathx.join(dir, 'sess-b.json'), JSON.stringify({ sessionId: 'sess-b', message: 'old', ts: now - ATTENTION_TTL_MS - 1 })); // stale
  fsx.writeFileSync(pathx.join(dir, 'broken.json'), '{ not json');
  try {
    const map = readAttention(now, dir);
    assert.equal(map.size, 1);
    assert.equal(map.get('sess-a')?.message, 'waiting');
    assert.equal(map.has('sess-b'), false);
    assert.equal(fsx.existsSync(pathx.join(dir, 'sess-b.json')), false, 'stale marker should be swept');
  } finally {
    fsx.rmSync(dir, { recursive: true, force: true });
  }
});

test('readAttention: missing registry dir → empty map (the normal state)', () => {
  assert.equal(readAttention(Date.now(), pathx.join(os.tmpdir(), 'glass-attn-does-not-exist-xyz')).size, 0);
});
