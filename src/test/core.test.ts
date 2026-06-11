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
