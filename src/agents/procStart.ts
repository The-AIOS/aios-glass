/* #78 twin — the side-effecting half: when the process holding a pid started. The comparison
   itself is pure and shared with the App: src/core/procStart.ts. */
import { execFile } from 'child_process';
import { parseLstartUtc } from '../core/procStart';
export { PROC_START_TOLERANCE_MS, parseLstartUtc, parseFiletime, recordedStart, sameProcessStart } from '../core/procStart';

/* ── reading the actual start time (side effects; cached) ─────────────────────────────── */

const CACHE_MS = 30_000;
const cache = new Map<number, { at: number; start: number | undefined }>();

function run(cmd: string, args: string[], timeout: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } },
        (err, out) => resolve(err ? undefined : String(out)));
    } catch { resolve(undefined); }
  });
}

/** When the process now holding `pid` started (epoch ms), or undefined when it cannot be read. */
export async function processStartMs(pid: number, platform: NodeJS.Platform = process.platform): Promise<number | undefined> {
  const hit = cache.get(pid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.start;
  let start: number | undefined;
  if (platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[DateTimeOffset]::new((Get-Process -Id ${Math.trunc(pid)} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`], 5000);
    const n = Number((out ?? '').trim());
    start = out && Number.isFinite(n) && n > 0 ? n : undefined;
  } else {
    start = parseLstartUtc(await run('ps', ['-o', 'lstart=', '-p', String(Math.trunc(pid))], 3000));
  }
  cache.set(pid, { at: Date.now(), start });
  return start;
}
