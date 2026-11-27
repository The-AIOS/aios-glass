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

/**
 * - Its terminal is here: dispose it (closing the tab stops the shell, claude and the wrapper).
 * - Live, but not in a terminal of this window: `spawn-kill`, which finds the process by name.
 * - Not live: close the terminals it left, except any whose shell has something running, which
 *   is reported and left alone. With no process table an idle shell cannot be told from a busy
 *   one, so nothing is closed. A session that left no terminal has nothing to close: no
 *   `spawn-kill` terminal is opened for it, there being no process to kill.
 */
export function killPlan(f: KillFacts): KillPlan {
  if (f.terminalHere) return { do: 'dispose' };
  if (f.live) return { do: 'spawn-kill' };
  if (f.left.length === 0) return { do: 'nothing' };
  const close: number[] = [];
  const busy: BusyTab[] = [];
  for (const shellPid of f.left) {
    const running = childrenOf(shellPid, f.ppidOf);
    if (f.ppidOf.size > 0 && running.length === 0) close.push(shellPid); else busy.push({ shellPid, running });
  }
  return { do: 'close-left', close, busy };
}

/** What a kill did, for the caller to report truthfully. */
export interface KillOutcome {
  did: 'disposed' | 'spawn-kill' | 'closed-left' | 'nothing';
  /** Terminals closed. */
  closed: number;
  /** Terminals the session left that were NOT closed because their shell is busy. */
  busy: BusyTab[];
}

/** The log line for a kill, one wording for every outcome. It never says "closed" when nothing closed. */
export function killReport(name: string, o: KillOutcome): string {
  if (o.did === 'disposed') return `kill '${name}': closed its terminal`;
  if (o.did === 'spawn-kill') return `kill '${name}': live, but not in a terminal of this window: ran spawn-kill`;
  if (o.did === 'nothing') return `kill '${name}': no live session and no terminal left by one: nothing to close`;
  const kept = o.busy.map((b) => (b.running.length ? `shell ${b.shellPid} is running pid ${b.running.join(', ')}` : `shell ${b.shellPid}: the process table could not be read`)).join('; ');
  if (o.busy.length === 0) return `kill '${name}': no live session; closed the terminal it left`;
  return `kill '${name}': no live session; ${o.closed ? `closed ${o.closed} terminal it left, and ` : ''}left ${o.busy.length} open because something is running in it (${kept})`;
}
