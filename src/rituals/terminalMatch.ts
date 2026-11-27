/**
 * Which integrated terminal holds a session — the decision half of findAgentTerminal.
 *
 * Pure and vscode-free so it can be tested without an editor host; runner.ts reads the
 * process table and the terminals' shell pids and hands them in.
 */

/** A terminal as this module sees it: its API name and its shell's pid (if known). */
export interface TerminalRef {
  name: string;
  shellPid?: number;
}

/** Parse `ps -axo pid=,ppid=` output into a pid → ppid map. */
export function parsePpidTable(out: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const line of out.split('\n')) {
    const mm = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (mm) m.set(Number(mm[1]), Number(mm[2]));
  }
  return m;
}

/** `pid` and every ancestor of it, walking the pid → ppid map. */
export function ancestorsOf(pid: number, ppidOf: ReadonlyMap<number, number>): Set<number> {
  const ancestors = new Set<number>([pid]);
  let cur = pid;
  for (let i = 0; i < 256; i++) {
    const pp = ppidOf.get(cur);
    if (pp === undefined || pp === 0 || pp === 1) break;
    ancestors.add(pp);
    cur = pp;
  }
  return ancestors;
}

/**
 * Index of the terminal holding session `name` (running as `pid`, when known), or -1.
 * A terminal holds a session when its shell is an ancestor of the session's process.
 */
export function matchTerminal(
  terminals: readonly TerminalRef[],
  name: string,
  pid: number | undefined,
  ppidOf: ReadonlyMap<number, number>,
): number {
  if (pid) {
    const ancestors = ancestorsOf(pid, ppidOf);
    const i = terminals.findIndex((t) => !!t.shellPid && ancestors.has(t.shellPid));
    if (i !== -1) return i;
  }
  // Fallback: name match in this window.
  return terminals.findIndex((t) => t.name === name || t.name.includes(name));
}
