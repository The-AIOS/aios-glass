import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The folders that put a session in the operator's scope (agents/sessionScope): the framework root,
 * the AIOS App's workspace folders, and the folders open in this VS Code window. vscode-free.
 *
 * The App's folders live in `<framework>/.glass/shell.json` (`workspaceFolders`). Any session can
 * write that file; here it only decides which sessions are LISTED, never what is opened or read.
 *
 * `tooBroadFolder` is the AIOS App's (src/main/aios.ts), copied unchanged: a filesystem root, the
 * home folder, anything above it, a volume's root or a temporary folder is never a workspace, so it
 * never puts every session in scope. Candidate for the shared package (The-AIOS/aios-app#228),
 * with sessionScope.ts.
 */
export type BroadReason = 'root' | 'home' | 'aboveHome' | 'volume' | 'temporary';
export function tooBroadFolder(p: string, home: string = os.homedir(), platform: NodeJS.Platform = process.platform): BroadReason | null {
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  let abs = p;
  // Resolve symlinks only on the platform we are running on (a link to `/` is still `/`).
  if (platform === process.platform) { try { abs = fs.realpathSync(p); } catch { /* keep as given */ } }
  const fold = (x: string) => {
    const r = pathMod.resolve(x);
    const trimmed = r.length > pathMod.parse(r).root.length ? r.replace(/[\\/]+$/, '') : r;
    return platform === 'win32' || platform === 'darwin' ? trimmed.toLowerCase() : trimmed;   // case-insensitive file systems
  };
  const a = fold(abs), h = fold(home);
  if (a === fold(pathMod.parse(pathMod.resolve(abs)).root)) return 'root';
  if (platform === 'darwin' && a === '/system/volumes/data') return 'root';
  if (a === h) return 'home';
  if (h.startsWith(a + pathMod.sep)) return 'aboveHome';
  if (platform === 'darwin' && /^\/volumes\/[^/]+$/.test(a)) return 'volume';
  /* A system temp folder is never a workspace: its contents vanish, and it is where a browser
     image dropped on the App lands (operator-reported 2026-09-28). */
  const temps = [os.tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'].map(fold);
  if (platform !== 'win32' && temps.some((t) => a === t || a.startsWith(t + pathMod.sep))) return 'temporary';
  if (platform === 'win32' && platform === process.platform && (a === fold(os.tmpdir()) || a.startsWith(fold(os.tmpdir()) + pathMod.sep))) return 'temporary';
  return null;
}

/** The App's workspace folders, as the App reads them: strings that exist and are not too broad. */
export function appWorkspaceFolders(frameworkRoot: string | undefined,
  broad: (p: string) => BroadReason | null = tooBroadFolder): string[] {
  if (!frameworkRoot) return [];
  let raw: unknown[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(frameworkRoot, '.glass', 'shell.json'), 'utf8'));
    raw = Array.isArray(j.workspaceFolders) ? j.workspaceFolders : [];
  } catch { return []; }
  return raw.filter((p): p is string => typeof p === 'string' && fs.existsSync(p) && !broad(p));
}

const realOr = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };

/** Framework root + the App's folders + this window's folders (too-broad ones dropped), as real paths, once each. */
export function scopeRoots(frameworkRoot: string | undefined, appFolders: readonly string[], windowFolders: readonly string[],
  broad: (p: string) => BroadReason | null = tooBroadFolder): string[] {
  const all = [...(frameworkRoot ? [frameworkRoot] : []), ...appFolders, ...windowFolders.filter((p) => !broad(p))].map(realOr);
  return [...new Set(all)];
}
