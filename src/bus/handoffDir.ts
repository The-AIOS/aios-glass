/* aios#231, scoped — A FILE HANDED TO A SESSION LIVES IN A FOLDER OF ITS OWN.
 *
 * A worker told to read a run file is granted that file's folder with `--add-dir`. The folder
 * used to be the run dir itself, so the grant reached every other session's task, the report
 * snapshots, and run/setup — scripts a surface later EXECUTES. On Windows the run dir is the whole
 * temp folder. Granting a working directory means the session may edit there, too.
 *
 * So each handed-over file is written into a fresh private folder (0700 via runDir, a random
 * name) that holds only it, and that folder is what `--add-dir` names. Folders older than a day
 * are swept: the worker reads its file at startup, so a day is far past any reader.
 */
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDir, writePrivateFile } from './privateRun';

export const HANDOFF_PREFIX = 'handoff-';

/** Write `content` as `name` in a new private folder of its own; return the file's path. Throws on refusal. */
export function writeHandoffFile(name: string, content: string): string {
  return writePrivateFile(runDir(HANDOFF_PREFIX + randomBytes(8).toString('hex')), name, content);
}

/** Remove handoff folders older than `maxAgeMs`. Never throws. */
export function sweepHandoffDirs(maxAgeMs = 24 * 60 * 60 * 1000,
  opts: { home?: string; platform?: NodeJS.Platform; now?: number } = {}): number {
  const platform = opts.platform ?? process.platform;
  /* Where runDir(sub) puts them: ~/.aios/run/<sub> on POSIX, <tmp>/aios-<sub> on Windows. */
  const base = platform === 'win32' ? os.tmpdir() : path.join(opts.home ?? os.homedir(), '.aios', 'run');
  const prefix = platform === 'win32' ? 'aios-' + HANDOFF_PREFIX : HANDOFF_PREFIX;
  let removed = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(base); } catch { return 0; }
  for (const n of names) {
    if (!n.startsWith(prefix) || !/^[0-9a-f]{16}$/.test(n.slice(prefix.length))) continue;
    const d = path.join(base, n);
    try {
      const st = fs.lstatSync(d);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if ((opts.now ?? Date.now()) - st.mtimeMs <= maxAgeMs) continue;
      fs.rmSync(d, { recursive: true, force: true });
      removed++;
    } catch { /* gone, or not ours to remove */ }
  }
  return removed;
}
