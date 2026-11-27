import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { frameworkRoot } from '../home/vault';
import { busLogPath } from '../bus/busSent';
import { identityNamesIn } from '../core/sessionName';
import { busNamesFrom, type SessionScope } from './sessionScope';
import { appWorkspaceFolders, scopeRoots } from './scopeRoots';
import { setScopeSource, type RunningAgent } from './running';

/**
 * The operator's scope for THIS window, as the App builds its own (src/main/aios.ts sessionScope):
 *  - "open in one of my panes" is, in Glass, a session whose process descends from the shell of a
 *    terminal of this window;
 *  - primaries: USER.md's Identity table; bus names: ~/.aios/bus-sent.jsonl, last 14 days;
 *  - roots: the framework, the App's workspace folders, and the folders open in this window.
 * So what is shared shows in every window, and each window adds its own tabs and folders. Two
 * windows with different folders can count differently. Rebuilt at most every 1.5 s, as in the App.
 */
let cache: { at: number; key: string; scope: SessionScope } | undefined;

function ppidTable(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    const m = new Map<number, number>();
    if (process.platform === 'win32') { resolve(m); return; }   // no ps: no tab membership, the other rules still apply
    execFile('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 }, (err, out) => {
      if (!err && out) for (const line of String(out).split('\n')) {
        const mm = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (mm) m.set(Number(mm[1]), Number(mm[2]));
      }
      resolve(m);
    });
  });
}

/** Session ids whose process descends from the shell of a terminal of this window. */
async function sessionsInMyTabs(all: readonly RunningAgent[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!all.length || !vscode.window.terminals.length) return ids;
  const shells = new Set((await Promise.all(vscode.window.terminals.map((t) => t.processId))).filter((p): p is number => !!p));
  if (!shells.size) return ids;
  const ppidOf = await ppidTable();
  for (const a of all) {
    let cur = a.pid;
    for (let i = 0; i < 256 && cur > 1; i++) {
      if (shells.has(cur)) { if (a.sessionId) ids.add(a.sessionId); break; }
      const pp = ppidOf.get(cur);
      if (pp === undefined) break;
      cur = pp;
    }
  }
  return ids;
}

async function buildScope(all: readonly RunningAgent[]): Promise<SessionScope> {
  const fw = frameworkRoot();
  const windowFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const key = `${fw ?? ''}|${windowFolders.join('|')}|${all.map((a) => a.pid).join(',')}|${vscode.window.terminals.length}`;
  if (cache && cache.key === key && Date.now() - cache.at < 1500) return cache.scope;
  let primaries = new Set<string>();
  try { if (fw) primaries = identityNamesIn(fs.readFileSync(path.join(fw, 'USER.md'), 'utf8')); } catch { /* no USER.md */ }
  let busNames = new Set<string>();
  try { busNames = busNamesFrom(fs.readFileSync(busLogPath(), 'utf8'), Math.floor(Date.now() / 1000)); } catch { /* none yet */ }
  const scope: SessionScope = {
    paneSessionIds: await sessionsInMyTabs(all),
    primaries,
    busNames,
    roots: scopeRoots(fw, appWorkspaceFolders(fw), windowFolders),
    caseInsensitive: process.platform !== 'linux',
  };
  cache = { at: Date.now(), key, scope };
  return scope;
}

/** Call once from activate(): from then on every list of the operator's sessions is scoped. */
export function initOperatorScope(): void {
  setScopeSource(buildScope);
}
