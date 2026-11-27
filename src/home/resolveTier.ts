import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { frameworkRoot } from './vault';
import { resolveBash } from './resolveBash';
import { resolveTierWith, parseLadder, ladderModelOptions, type HookRun } from '../core/workerModel';

/**
 * Ask the framework's `resolve-tier` (aios-app#230). THE LOOKING lives here; the deciding lives
 * in src/core/workerModel.ts, so every branch is testable without a framework or a shell.
 *
 * Every failure to ask is a refusal with its reason, never a default model: no framework root,
 * no script (it arrives with /aios:update), no bash for this process (Windows: Git for Windows).
 */
function hookRunner(): ((args: string[]) => HookRun) | { error: string } {
  const root = frameworkRoot();
  if (!root) return { error: 'no framework root found' };
  /* hooks/pipeline/resolve-tier since framework v0.8.19, hooks/resolve-tier before: the new place first. */
  const hook = ['hooks/pipeline/resolve-tier', 'hooks/resolve-tier'].map((r) => path.join(root, r)).find((f) => fs.existsSync(f));
  if (!hook) return { error: `${path.join(root, 'hooks', 'pipeline', 'resolve-tier')} is missing — run /aios:update to sync it, or pass an explicit "model" instead` };
  const bash = resolveBash();
  if (!bash) {
    return { error: 'no bash interpreter found for this process (checked $SHELL, PATH and the Git for Windows locations). '
      + 'Install Git for Windows, or pass an explicit "model" instead — resolve-tier is a bash hook' };
  }
  return (args) => {
    try {
      const out = execFileSync(bash, [hook, ...args], { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stdout: out, stderr: '' };
    } catch (e) {
      const err = e as { stderr?: Buffer | string; status?: number; message?: string };
      return { status: typeof err.status === 'number' && err.status !== 0 ? err.status : 1, stdout: '', stderr: String(err.stderr ?? '').trim() || err.message || '' };
    }
  };
}

/** A rung → the model the wrapper is told to start (none = the wrapper's own default), or a refusal. */
export function resolveTier(tier: string): { model?: string } | { error: string } {
  const run = hookRunner();
  if (typeof run !== 'function') return { error: `cannot resolve tier '${tier}': ${run.error}` };
  return resolveTierWith(tier, run);
}

/** The models the ladder starts, for the model picker. Empty when the framework cannot be asked. */
export function ladderModels(): { value: string; rungs: string[] }[] {
  const run = hookRunner();
  if (typeof run !== 'function') return [];
  const list = run(['--list']);
  if (list.status !== 0) return [];
  return ladderModelOptions(parseLadder(list.stdout), (rung) => {
    const r = run(['--launch-model', rung]);          // a framework without it exits non-zero: no row
    return r.status === 0 ? r.stdout.trim() : undefined;
  });
}
