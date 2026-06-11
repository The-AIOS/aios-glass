import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { frameworkRoot } from './home/vault';
import { swallow } from './log';

/**
 * Glass operator state — frequent tasks, routines, removed defaults — lives in
 * the VAULT (`<frameworkRoot>/.glass/state.json`), not in per-machine
 * globalState. The vault is the system's one sanctioned state home: it git-syncs
 * across the operator's machines (same pattern as `.aios-update`), and a future
 * standalone shell reads the identical file. globalState remains as (a) the
 * one-time migration source for pre-existing values and (b) the fallback when no
 * framework root resolves.
 *
 * Reads hit the file each call — it's tiny, and that makes an external change
 * (git pull from another machine) visible on the next picker open, no watcher.
 */
let memento: vscode.Memento | undefined;

/** Wire the migration/fallback store — call once from activate(). */
export function initGlassState(ctx: vscode.ExtensionContext): void {
  memento = ctx.globalState;
}

function stateFile(): string | undefined {
  const r = frameworkRoot();
  return r ? path.join(r, '.glass', 'state.json') : undefined;
}

function readAll(p: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return {}; // absent or unparsable → empty (absence is normal)
  }
}

export function stateGet<T>(key: string): T | undefined {
  const p = stateFile();
  if (!p) return memento?.get<T>(key);
  const all = readAll(p);
  if (key in all) return all[key] as T;
  // One-time migration: a value this machine kept in globalState moves into the
  // vault on first read, then the file owns it.
  const legacy = memento?.get<T>(key);
  if (legacy !== undefined) {
    void stateSet(key, legacy);
    return legacy;
  }
  return undefined;
}

export async function stateSet(key: string, value: unknown): Promise<void> {
  const p = stateFile();
  if (p) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const all = readAll(p);
      all[key] = value;
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
      fs.renameSync(tmp, p); // atomic-enough swap — no torn reads
      return;
    } catch (e) {
      swallow('state write ' + key, e); // fall through to memento
    }
  }
  await memento?.update(key, value);
}
