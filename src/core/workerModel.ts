/**
 * The worker's model, as a spawn-inbox request names it (aios-app#230). Pure: no vscode, no fs.
 *
 * Two fields decide what a new worker runs on, and both used to fail in silence here:
 *  · `tier` was matched against a closed, case-sensitive list. A rung the list did not know
 *    (`Fast`, or one added to the framework next month) left the flag empty, and the worker
 *    started on the default model with no dead letter. There is no list here now: which rungs
 *    exist, and what each starts, is the framework's `hooks/pipeline/resolve-tier` alone.
 *  · `model` outside the accepted characters was dropped the same way.
 * A value that cannot be used is REFUSED naming the field, never dropped.
 *
 * The App holds the same shape and the same decision (its core/commandBus and core/tierResolve);
 * both move into the shared package with aios-app#229.
 */

/**
 * What a `model` may look like: letters, digits, dot, dash and underscore, starting with a letter
 * or digit, optionally ending in the literal `[1m]`. Strict on purpose: the value lands on a
 * command line typed into a live shell. Anchored at both ends, no whitespace, no quotes, no shell
 * metacharacters, and no leading dash (a `--flag` is not a model).
 */
export const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\[1m\])?$/;

/** A rung is checked by SHAPE only (a safe token to hand to resolve-tier), never by membership. */
const TIER_SHAPE = /^[a-z][a-z0-9-]{1,23}$/;

export interface FieldError { field: string; value: string; reason: string }

/** How a refused value is quoted in a dead letter: cut, and with no control characters. */
function quoted(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw);
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 60);
}

/** `model` as written: absent, passable, or a refusal that names it. */
export function modelField(raw: unknown): { model?: string; fieldError?: FieldError } {
  if (raw === undefined || raw === null || raw === '') return {};
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (MODEL_SHAPE.test(s)) return { model: s };
  const value = quoted(raw);
  return { fieldError: { field: 'model', value, reason: `model '${value}' was not passed: a model is letters, digits, dot, dash and underscore, optionally ending in [1m] (a model id, or an alias the claude binary takes). Not started on another model instead` } };
}

/** `tier` as written: absent, a safe lower-case token for resolve-tier, or a refusal that names it. */
export function tierField(raw: unknown): { tier?: string; fieldError?: FieldError } {
  if (raw === undefined || raw === null || raw === '') return {};
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (TIER_SHAPE.test(s)) return { tier: s };
  const value = quoted(raw);
  return { fieldError: { field: 'tier', value, reason: `tier '${value}' is not a rung name: hooks/pipeline/resolve-tier --list prints the valid ones. Not started on the default model instead` } };
}

export interface HookRun { status: number; stdout: string; stderr: string }

/**
 * What a rung starts, from the script's answer. Glass launches through the `spawn` wrapper, so
 * the three outcomes are:
 *  · exit 0 + text   → pass `--model <text>` to the wrapper
 *  · exit 0 + EMPTY  → a real answer (`judgment`): pass NO flag, and the wrapper starts its own
 *                      pinned model, with the operator's $CLAUDE_MODEL winning over it
 *  · non-zero        → refuse, quoting the script, which lists the valid rungs
 */
export function resolveTierWith(tier: string, run: (args: string[]) => HookRun): { model?: string } | { error: string } {
  const plain = run([tier]);
  if (plain.status !== 0) {
    const why = plain.stderr.trim() || 'resolve-tier failed';
    return { error: `tier '${tier}' rejected (exit ${plain.status}): ${why.split('\n').join(' · ')}` };
  }
  const model = plain.stdout.trim();
  if (!model) return {};
  return MODEL_SHAPE.test(model) ? { model }
    : { error: `tier '${tier}': resolve-tier answered something that is not a model id — not started` };
}

/** One row of `resolve-tier --list`: a rung and the model id it starts (absent = the launcher's default). */
export interface LadderRung { rung: string; model?: string }

/** Parse `resolve-tier --list` (`<rung> <model id>` per line; `<inherit default>` = no id). */
export function parseLadder(out: string): LadderRung[] {
  const rows: LadderRung[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*([a-z][a-z0-9-]{1,23})\s+(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    rows.push(MODEL_SHAPE.test(m[2]) ? { rung: m[1], model: m[2] } : { rung: m[1] });
  }
  return rows;
}

/**
 * The model picker's choices, from the ladder: one per distinct model id, labelled by the rungs
 * that start it. `launcherDefault` is the id the launcher starts for a rung with no id of its own
 * (`resolve-tier --launch-model <rung>`, when the framework has it).
 */
export function ladderModelOptions(ladder: LadderRung[], launcherDefault: (rung: string) => string | undefined): { value: string; rungs: string[] }[] {
  const out: { value: string; rungs: string[] }[] = [];
  for (const row of ladder) {
    const raw = row.model ?? launcherDefault(row.rung);
    if (!raw || !MODEL_SHAPE.test(raw)) continue;
    const hit = out.find((o) => o.value === raw);
    if (hit) hit.rungs.push(row.rung); else out.push({ value: raw, rungs: [row.rung] });
  }
  return out;
}
