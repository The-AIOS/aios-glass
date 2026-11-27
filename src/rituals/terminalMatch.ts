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
 * Parse the Windows process table — one `pid,ppid` row per line, as printed by
 * WIN_PPID_COMMAND — into the same pid → ppid map.
 */
export function parseWinPpidTable(out: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const line of out.split(/\r?\n/)) {
    const mm = line.trim().match(/^(\d+),(\d+)$/);
    if (mm) m.set(Number(mm[1]), Number(mm[2]));
  }
  return m;
}

/** PowerShell that prints the process table as `pid,ppid` rows (Windows has no `ps`). */
export const WIN_PPID_COMMAND =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }';

/**
 * Index of the terminal holding session `name` (running as `pid`, when known), or -1.
 *
 * A terminal holds a session when its shell is an ancestor of the session's process. That is
 * the only evidence accepted: a terminal's name is not an identity. A session in another
 * window used to resolve to any terminal here whose name merely CONTAINED its name, and a
 * bus `send` or a close was then typed into the wrong terminal.
 *
 * One exception, and only one: when the process table could not be read at all (`ppidOf`
 * empty) ancestry is unknowable, so an EXACT name match is accepted rather than losing every
 * session in the window. Never a substring. With a table and no ancestry the answer is -1:
 * the session is not in this window.
 */
export function matchTerminal(
  terminals: readonly TerminalRef[],
  name: string,
  pid: number | undefined,
  ppidOf: ReadonlyMap<number, number>,
): number {
  if (ppidOf.size === 0) return terminals.findIndex((t) => t.name === name);
  if (!pid) return -1;
  const ancestors = ancestorsOf(pid, ppidOf);
  return terminals.findIndex((t) => !!t.shellPid && ancestors.has(t.shellPid));
}
