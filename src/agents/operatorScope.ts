import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { frameworkRoot } from '../home/vault';
import { busLogPath } from '../bus/busSent';
import { identityNamesIn } from '../core/sessionName';
import { busNamesFrom, type SessionScope } from './sessionScope';
import { appWorkspaceFolders, scopeRoots, sessionsUnder, parsePidTable } from './scopeRoots';
import { setScopeSource, type RunningAgent } from './running';
import { swallow } from '../log';

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

/** The process table as pid → ppid: `ps` on macOS and Linux, PowerShell on Windows (no `ps` there;
 *  the AIOS App reads Win32_Process too). Empty when it cannot be read: no tab membership then, and
 *  the other rules still apply. */
function ppidTable(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    const done = (err: Error | null, out: string | Buffer) => resolve(!err && out ? parsePidTable(String(out)) : new Map());
    try {
      if (process.platform === 'win32') {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }'],
          { maxBuffer: 8 * 1024 * 1024, timeout: 10000, windowsHide: true }, done);
        return;
      }
      execFile('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 }, done);
    } catch { resolve(new Map()); }
  });
}

/** Session ids whose process descends from the shell of a terminal of this window. */
async function sessionsInMyTabs(all: readonly RunningAgent[]): Promise<Set<string>> {
  if (!all.length || !vscode.window.terminals.length) return new Set();
  const shells = new Set((await Promise.all(vscode.window.terminals.map((t) => t.processId))).filter((p): p is number => !!p));
  if (!shells.size) return new Set();
  return sessionsUnder(all, shells, await ppidTable());
}

let pending: { key: string; p: Promise<SessionScope> } | undefined;

async function buildScope(all: readonly RunningAgent[]): Promise<SessionScope> {
  const fw = frameworkRoot();
  const windowFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const shellPids = (await Promise.all(vscode.window.terminals.map((t) => t.processId))).filter((p): p is number => !!p);
  const key = `${fw ?? ''}|${windowFolders.join('|')}|${all.map((a) => a.pid).join(',')}|${shellPids.join(',')}`;
  if (cache && cache.key === key && Date.now() - cache.at < 1500) return cache.scope;
  // The attention bar and the Home poll can ask at the same moment: one build serves both.
  if (pending && pending.key === key) return pending.p;
  const p = build(all, fw, windowFolders, key).finally(() => { if (pending?.p === p) pending = undefined; });
  pending = { key, p };
  return p;
}

async function build(all: readonly RunningAgent[], fw: string | undefined, windowFolders: string[], key: string): Promise<SessionScope> {
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
  setScopeSource((all) => buildScope(all).catch((e: unknown) => { swallow('operatorScope', e); throw e; }));
}
