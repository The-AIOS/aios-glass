/**
 * What a `kill` does, and which terminal a session left behind — the decision half of
 * disposeAgentTerminal.
 *
 * A terminal outlives its session: after `/exit` the `spawn` wrapper returns to the shell
 * prompt and the tab stays open. Nothing in the terminal says which session ran there, and a
 * name is not an identity (see terminalMatch), so Glass keeps a ledger: shell pid → the last
 * session seen running in that terminal. A kill for a session that already ended closes the
 * terminal the ledger names, never one that merely looks like it.
 *
 * Pure and vscode-free so it can be tested without an editor host.
 */

/** The last session seen in a terminal. */
export interface TabNote { name: string; sessionId?: string; }

/** Shell pid (as a string key) → the last session seen in that terminal. */
export type TabLedger = Record<string, TabNote>;

/** The ledger with `shellPid` noted as holding `note`. A newer session replaces the older one. */
export function noteTab(ledger: TabLedger, shellPid: number, note: TabNote): TabLedger {
  const cur = ledger[String(shellPid)];
  if (cur && cur.name === note.name && (cur.sessionId ?? '') === (note.sessionId ?? cur.sessionId ?? '')) return ledger;
  return { ...ledger, [String(shellPid)]: { name: note.name, ...(note.sessionId ? { sessionId: note.sessionId } : {}) } };
}

/** The ledger without the terminals that are no longer open. */
export function pruneLedger(ledger: TabLedger, openShellPids: readonly number[]): TabLedger {
  const open = new Set(openShellPids.map(String));
  const keys = Object.keys(ledger);
  if (keys.every((k) => open.has(k))) return ledger;
  const out: TabLedger = {};
  for (const k of keys) if (open.has(k)) out[k] = ledger[k];
  return out;
}

/** Shell pids of the open terminals whose last session was `name`. */
export function tabsLeftBy(ledger: TabLedger, name: string, openShellPids: readonly number[]): number[] {
  return openShellPids.filter((p) => ledger[String(p)]?.name === name);
}

/** Direct children of `pid` in a pid → ppid map. */
export function childrenOf(pid: number, ppidOf: ReadonlyMap<number, number>): number[] {
  const out: number[] = [];
  for (const [child, parent] of ppidOf) if (parent === pid) out.push(child);
  return out;
}

/** A terminal that is not closed because something is running in its shell. */
export interface BusyTab { shellPid: number; running: number[]; }

export interface KillFacts {
  /** The session's terminal was found in this window (by process ancestry). */
  terminalHere: boolean;
  /** The session is in the registry (a process to kill exists somewhere). */
  live: boolean;
  /** Open terminals the ledger says this session left (tabsLeftBy). */
  left: readonly number[];
  /** pid → ppid; empty when the process table could not be read. */
  ppidOf: ReadonlyMap<number, number>;
}

export type KillPlan =
  | { do: 'dispose' }
  | { do: 'spawn-kill' }
  | { do: 'close-left'; close: number[]; busy: BusyTab[] }
  | { do: 'nothing' };

export function killPlan(f: KillFacts): KillPlan {
  return f.terminalHere ? { do: 'dispose' } : { do: 'spawn-kill' };
}
