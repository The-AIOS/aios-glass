import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RunningAgent {
  pid: number;
  name: string;
  /** Claude's session status — e.g. 'busy' | 'idle' (empty if unknown). */
  status: string;
  /** The resumable Claude session id (uuid). */
  sessionId: string;
  /** Working directory the session runs in. */
  cwd: string;
  /** true when this looks like a spawn-managed/named session (spawn-kill applies). */
  spawned: boolean;
  /** Session start (epoch ms; 0 if the registry didn't record it). */
  startedAt: number;
  /** Last status change / activity (epoch ms; 0 if unknown). */
  updatedAt: number;
  /** Claude Code version running the session (may be empty). */
  version: string;
  /** What the session is blocked ON — present only while `status` is 'waiting', absent
   *  otherwise, because Claude Code's writer returns `{status:'waiting', waitingFor:<what>}`
   *  or `{status:'busy'|'idle', waitingFor:undefined}`. Its absence on an idle machine is the
   *  field working, not the field missing. */
  waitingFor?: string;
  /** When the CURRENT status was entered — i.e. how long it has been blocked, without us
   *  having to remember anything, so it survives a restart of the IDE. */
  statusUpdatedAt?: number;
  /** Claude Code's own session kind: 'interactive' for a terminal session, 'bg' for a background
   *  session (including the daemon's pre-started spares). Missing on older CLIs → 'interactive'. */
  kind: string;
  /** CLAUDE_CODE_ENTRYPOINT: 'cli' | 'claude-desktop' | 'claude-vscode' | 'remote' for a person;
   *  'sdk-cli' (`claude -p`) | 'sdk-py' | 'sdk-ts' for a program. */
  entrypoint: string;
}

/**
 * Detect live Claude sessions from Claude Code's OWN per-process registry at
 * `~/.claude/sessions/<pid>.json`. Each file carries the session's `name`,
 * `status` (busy/idle), `sessionId`, and `cwd` — authoritative regardless of
 * how the session launched (named wrapper, bare `claude --resume`, or spawn),
 * so even a resumed session shows its real name. We keep only PIDs still alive.
 *
 * This replaces the old `ps -E` env scan: the registry is cleaner, gives live
 * status for free, and avoids reading the process environment (which carries
 * the operator's secrets). Best-effort; resolves [] on any failure.
 */
export function listRunningAgents(): Promise<RunningAgent[]> {
  return new Promise((resolve) => {
    try {
      const dir = path.join(os.homedir(), '.claude', 'sessions');
      let files: string[];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        return resolve([]); // no registry dir → nothing to report
      }

      const out: RunningAgent[] = [];
      for (const f of files) {
        let d: any;
        try {
          d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch {
          continue; // skip unreadable / partially-written files
        }
        const pid = Number(d?.pid ?? path.basename(f, '.json'));
        if (!Number.isInteger(pid) || pid <= 0) continue;
        if (!isAlive(pid)) continue; // stale registry entry for a dead process

        const name = String(d?.name ?? '').trim() || '(unnamed)';
        out.push({
          pid,
          name,
          status: String(d?.status ?? '').trim(),
          sessionId: String(d?.sessionId ?? ''),
          cwd: String(d?.cwd ?? ''),
          // The registry doesn't record the launch wrapper, so this is a
          // heuristic: a named session is treated as spawn-managed (kill by
          // name via spawn-kill). Plain unnamed sessions aren't.
          spawned: name !== '(unnamed)',
          startedAt: Number(d?.startedAt) || 0,
          updatedAt: Number(d?.updatedAt) || 0,
          version: String(d?.version ?? '').trim(),
          ...(typeof d?.waitingFor === 'string' && d.waitingFor.trim() ? { waitingFor: d.waitingFor.trim() } : {}),
          ...(Number(d?.statusUpdatedAt) > 0 ? { statusUpdatedAt: Number(d.statusUpdatedAt) } : {}),
          kind: String(d?.kind ?? '').trim() || 'interactive',
          entrypoint: String(d?.entrypoint ?? '').trim(),
        });
      }

      // dedupe by pid (one file per pid, but be defensive)
      const seen = new Set<number>();
      resolve(out.filter((a) => (seen.has(a.pid) ? false : (seen.add(a.pid), true))));
    } catch {
      resolve([]);
    }
  });
}

/**
 * AI-165 — the sessions the OPERATOR is running, for everything that shows, alerts or broadcasts.
 *
 * Claude Code's background daemon keeps pre-started spare sessions so a background agent opens
 * instantly. They register like any other session but with no name, so they appeared under their
 * ids, and closing one made the daemon start a replacement (operator-reported 2026-09-24). The
 * registry says which is which: spares are `kind: "bg"`, terminal sessions `kind: "interactive"`
 * (measured in the 2.1.282 binary; Claude Code's own FleetView filters the same way). Same rule as
 * the App (`listOperatorSessions` in aios-app).
 *
 * listRunningAgents() keeps returning everything: name lookups for the spawn-inbox (send/kill)
 * must still reach a named background agent.
 */
/** `kind` marks only the daemon's sessions, so a headless SDK run (a plugin's review, `claude -p`)
 *  registers as `interactive` too; its `entrypoint` (`sdk-*`) is what gives it away. Same rule as
 *  aios-app's isOperatorSession (operator-found 2026-09-25). */
export function isOperatorSession(a: { kind: string; entrypoint: string }): boolean {
  return a.kind === 'interactive' && !/^sdk-/i.test(a.entrypoint);
}

export async function listOperatorSessions(): Promise<RunningAgent[]> {
  return (await listRunningAgents()).filter(isOperatorSession);
}

/** True if the process is still running (ESRCH = dead; EPERM = alive, not ours). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return !!e && e.code === 'EPERM';
  }
}
