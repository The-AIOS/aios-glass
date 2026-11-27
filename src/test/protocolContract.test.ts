import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as crypto from 'crypto';

/* WHAT THIS SURFACE OWES THE BUS PROTOCOL.
 *
 * The protocol itself (the timings, the decision table, the verb rule, name resolution, presence)
 * lives in `@the-aios/core`, the package Glass and the App both run, and is tested there. One
 * published version, so there is no copy here to pin by hash.
 *
 * What stays in this repo is what only this repo can check: that Glass's own dispatcher
 * (src/extension.ts) consults the shared rules in the right order, and the three files that are
 * still one file in two repos (resumeIndex, privateRun, handoffDir), pinned by hash until they
 * move into the package too.
 */
test('the delivery cap gates the SEND, not just the log line', () => {
  /* Parity with the App's guard, added 2026-08-14 — Glass had the same fix in its code (the
     comment above its gate says so) and no test holding it there. A 'wait' verdict does
     `continue`, which re-enters the delivery branch, so a cap enforced only in the after-a-miss
     decision caps NOTHING: the loop keeps re-typing for the whole hold budget.
     Pinned to the ORDER of gate-then-counter, not to the cap expression, so a legitimate change
     to how the cap is computed does not turn this red. */
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const gate = src.search(/attempts >= (maxAttemptsFor\(|TIMINGS\.MAX_DELIVERY_ATTEMPTS)/);
  assert.ok(gate > 0, 'the cap must be checked BEFORE delivering, whatever the cap expression is');
  const bump = src.indexOf('attempts++', gate);
  assert.ok(bump > gate, 'the guard must precede the attempt counter, or it runs too late');
  assert.match(src, /maxAttemptsFor\(/, 'the send gate must use the per-text cap');
});

test('the presence file lives OUTSIDE the inbox — the watchers claim *.json', () => {
  /* A presence record written into the inbox would be picked up as a request and "fulfilled".
     Asserted because the mistake is invisible until something tries to spawn a session named after
     a surface. */
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const m = /['"`]\.aios['"`],\s*['"`]surfaces['"`]/.exec(src);
  assert.ok(m, 'presence must be written under ~/.aios/surfaces');
  assert.doesNotMatch(src, /spawn-inbox['"`]\),\s*`\$\{[a-zA-Z_]*[Ss]urface\}\.json`/,
    'never inside the inbox directory');
});

test('the generated inbox README does not enumerate rungs — one table, and it is not ours', () => {
  /* The rung-table fix's second half, and Glass is where it actually bit. The App shipped this fix in
     v0.9.2 and it did NOT reach the operator's disk, because `shouldWrite` defers to a current
     Glass-stamped doc by design ("if (byGlass) return false") — so on any machine with the
     extension installed, GLASS is the writer and Glass's copy was the stale one.
     It documented `"tier": "mechanical" | "judgment"` — a closed set of two — after the ladder
     had grown to five, while the file it writes says of itself that it is "rewritten to match
     the handler actually running". Worse than ordinary drift: `CLAUDE.md` names this README the
     protocol's AUTHORITY, so an agent following the documented path concluded `fast` and
     `scale` were invalid and fell back to a legacy alias.
     The fix is not a longer list — a generated doc must not restate a fact it does not own.
     `aios-app`'s src/test/inboxReadme.test.ts carries the identical assertions, so either repo
     drifting fails its own suite. */
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  assert.doesNotMatch(src, /"tier":\s*\\?"mechanical\\?"\s*\|\s*\\?"judgment\\?"/,
    'a closed rung list drifts, and this file is treated as authoritative');
  assert.match(src, /resolve-tier --list/, 'it must say where the real list lives');
  assert.match(src, /MODEL-ROUTING\.md/, 'and where the meaning of each rung lives');
  assert.match(src, /refused with a dead letter/, 'and that guessing is safe');
});

test('every keyboard chord is unique, and opening Glass has one that works from cold', () => {
  /* Two findings, one test, because they were found together.
     (1) NO CHORD IS DUPLICATED. `aios.openHome` was nearly bound to `cmd+alt+g g`, which
     `aios.goWithAgents` already owned — the mistake came from reading a TRUNCATED list of the
     keybindings and concluding the letter was free. A duplicate chord does not error; the IDE
     silently picks one, so nothing would have surfaced it.
     (2) OPENING GLASS NEEDS A COLD-START PATH. `cmd+alt+g h` → `aios.toggleHome` calls
     `HomeViewProvider.current?.toggleHome()`, which no-ops when the provider has never been
     instantiated — i.e. exactly when the operator cannot find the status-bar button and reaches
     for the keyboard. `aios.openHome` runs `aios.home.focus`, which reveals from cold, and it
     had no binding at all: the button was the only way in. */
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as
    { contributes: { keybindings: { command: string; key: string; mac?: string }[] } };
  const kb = pkg.contributes.keybindings;

  const macs = kb.map((k) => k.mac ?? k.key);
  const dupes = macs.filter((m, i) => macs.indexOf(m) !== i);
  assert.deepEqual(dupes, [], `duplicate chords bind silently: ${dupes.join(', ')}`);

  const open = kb.filter((k) => k.command === 'aios.openHome');
  assert.equal(open.length, 1, 'aios.openHome needs exactly one chord — it is the cold-start path');

  const src = fs.readFileSync('src/extension.ts', 'utf8');
  assert.match(src, /'aios\.openHome', \(\) => vscode\.commands\.executeCommand\('aios\.home\.focus'\)/,
    'openHome must REVEAL the view, not toggle a provider that may not exist');
});

test('presence is WIRED to the shared decision, on all three paths', () => {
  /* Presence, glass half. The App shipped its side in v0.9.2; a `glass.json` advertising a pid
     dead since 2026-08-14 sat beside it for three weeks. The liveness check is still the real
     defence — a crashed extension host cannot clean up.
     WHAT is decided now lives in core/presence and is tested purely there. What this asserts is
     the WIRING, because that is where the defect was: the retract checked ownership and the
     announce checked nothing, so the record belonged to whoever wrote last. The previous version
     of this test asserted the literal text of the retract — the one path that was already
     right — and said nothing about the entrance. Two IDE windows is all it took. */
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  assert.match(src, /presenceVerdict\([\s\S]{0,80}?'leave'/,
    'ARRIVING must defer to a live incumbent — this is the half that was missing');
  assert.match(src, /mayRetract\(parsePresenceRecord\(readRec\(\)\), root\)/,
    'LEAVING must not delete a record it does not own');
  assert.match(src, /setInterval\(\(\) => \{ try \{ claim\('re-claimed'\)/,
    'and a heal re-claims a record naming nobody alive — the only path that survives a crash');
  assert.match(src, /clearInterval\(heal\)/, 'the heal timer is disposed with the extension');

  /* Liveness by signal, never by process name — this surface cannot be identified by name, which
     is the whole reason the record holds a pid. */
  assert.match(src, /process\.kill\(pid, 0\)/, 'signal 0 is the liveness probe');
  assert.match(src, /!== 'ESRCH'/,
    'only ESRCH proves absence: EPERM is a process that exists and is not ours to signal');

  assert.match(src, /context\.subscriptions\.push\(\{\s*\n\s*dispose: \(\) => \{/,
    'a disposable, not deactivate() — the host disposes on unload, reload AND update');
  assert.match(src, /fs\.unlinkSync\(pfile\)/);
});

/* Where this surface reads the verb, and where it acts on it. The App parses in core and
   dispatches in main; Glass does both in extension.ts. Only these bindings differ. */
const VERB_PARSER = 'src/extension.ts';
const DISPATCHER = 'src/extension.ts';
const DISPATCH_FN = 'const consumeSpawnRequest';
const LAUNCH = 'launchSpawn(';

test('PROTOCOL: this surface refuses an unknown verb before launching anything', () => {
  /* Each surface implements the dispatch itself, so this reads the source rather than the
     module: the shared rule is only worth having if the local dispatcher actually consults it
     and stops. */
  const strip = (f: string) => fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const parser = strip(VERB_PARSER);
  assert.doesNotMatch(parser, /back-compat with plain/, 'the comment stripper did not strip');
  assert.match(parser, /function |=>/, 'the comment stripper ate the code');
  assert.match(parser, /normalizeVerb\(/, 'the verb must be read through the shared rule, not restated');
  /* Scoped to the dispatch function's own body: searching the whole file would match
     the launcher's DEFINITION (and its import), both of which legitimately precede the check. */
  const whole = strip(DISPATCHER);
  const body = whole.slice(whole.indexOf(DISPATCH_FN));
  assert.ok(whole.includes(DISPATCH_FN), 'the dispatch function must exist — this guard reads the wrong file otherwise');
  const refusal = body.indexOf("=== 'unknown'");
  assert.ok(refusal > 0, 'the dispatcher must handle the unknown verb explicitly');
  const launch = body.indexOf(LAUNCH);
  assert.ok(launch > 0, 'the launcher must be called from the dispatcher — this guard proves nothing otherwise');
  assert.ok(refusal < launch, 'the refusal must come before any launcher runs');
});

/* The resume index is ONE file in two repos (Glass agents/resumeIndex.ts, App
   main/resumeIndex.ts). Pinned whole: an edit on one side alone goes red.
   The digest moved once without the code changing: the file's one import of the name-resolution
   rule now names the package (`@the-aios/core/resumeTarget`) where it named `../core/resumeTarget`
   (2932f09b4970ba40 before). The App's copy carries the same line and this same digest. */
const RESUME_INDEX_SHA = '9f096265ba399889';
test('PROTOCOL: the resume index is byte-identical across both fulfillers', () => {
  const src = fs.readFileSync('src/agents/resumeIndex.ts', 'utf8');
  assert.equal(crypto.createHash('sha256').update(src).digest('hex').slice(0, 16), RESUME_INDEX_SHA,
    'resumeIndex.ts changed: make the same edit in the sibling repo and update RESUME_INDEX_SHA in BOTH.');
});

const PRIVATE_RUN_SHA = '6383fdd3758496ab';
test('PROTOCOL: private run files are written by byte-identical code in both surfaces', () => {
  const src = fs.readFileSync('src/bus/privateRun.ts', 'utf8');
  assert.equal(crypto.createHash('sha256').update(src).digest('hex').slice(0, 16), PRIVATE_RUN_SHA,
    'privateRun.ts changed: make the same edit in the sibling repo and update PRIVATE_RUN_SHA in BOTH.');
});

const HANDOFF_DIR_SHA = 'ca911564e51186b7';
test('PROTOCOL: handed-over files get their own folder by byte-identical code in both surfaces', () => {
  const src = fs.readFileSync('src/bus/handoffDir.ts', 'utf8');
  assert.equal(crypto.createHash('sha256').update(src).digest('hex').slice(0, 16), HANDOFF_DIR_SHA,
    'handoffDir.ts changed: make the same edit in the sibling repo and update HANDOFF_DIR_SHA in BOTH.');
});
