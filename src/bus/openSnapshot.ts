/**
 * A file a SESSION asked Glass to show (spawn-inbox contract 5, the `open` verb), as a read-only
 * snapshot in an editor tab.
 *
 * The decision is the shared one (@the-aios/core/openRequest). What is Glass's own is how the file is
 * shown, and the rule is the App's (decision of 27/11): a snapshot, read only, never reloaded from
 * disk, with a way for the operator to open it as their own.
 *
 * VS Code would read and watch a `file:` document by its path, so a session could swap the file for a
 * link to a key after the open and the editor would show the key. So the snapshot is served from a
 * file system of Glass's own, scheme `aios-open`, holding the bytes main read from the file it checked
 * (readChecked). It is registered READ ONLY, with a message VS Code shows when the operator tries to
 * type, and it never changes: nothing watches the real file for it. "Open to edit" (in the editor's
 * title bar) checks the real file again and opens it the operator's usual way.
 *
 * The URI is `aios-open:/<activation>-<n>/<file name>`. The activation part is random per window
 * start: VS Code restores tabs across a reload, and without it a restored tab would show whichever new
 * snapshot reused its number. Snapshots are dropped when their tab closes, and the store is bounded by
 * count and by bytes.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

export const SNAPSHOT_SCHEME = 'aios-open';

export interface Snapshot { bytes: Uint8Array; real: string; by: string; at: number; identity: { dev: number; ino: number }; asset: boolean }
const MAX_SNAPSHOTS = 50;
const MAX_BYTES = 256 * 1024 * 1024;

export class SnapshotFs implements vscode.FileSystemProvider {
  private readonly items = new Map<string, Snapshot>();
  private readonly activation = crypto.randomBytes(4).toString('hex');
  private seq = 0;
  private bytes = 0;
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  /** Keep a snapshot and return the URI that shows it. The oldest go beyond the count or byte bound. */
  add(s: Omit<Snapshot, 'at'>): vscode.Uri {
    const key = `/${this.activation}-${++this.seq}/${path.basename(s.real)}`;
    this.items.set(key, { ...s, at: Date.now() });
    this.bytes += s.bytes.length;
    /* Over a bound, the oldest snapshot no tab shows goes first; only then the oldest at all. */
    while (this.items.size > MAX_SNAPSHOTS || (this.bytes > MAX_BYTES && this.items.size > 1)) {
      const shown = new Set(snapshotTabs().map((t) => tabUri(t)?.path));
      const victim = [...this.items.keys()].find((k) => k !== key && !shown.has(k)) ?? (this.items.keys().next().value as string);
      this.drop(victim);
    }
    return vscode.Uri.from({ scheme: SNAPSHOT_SCHEME, path: key });
  }
  /** The snapshot behind a URI, for "Open to edit". */
  get(uri: vscode.Uri): Snapshot | undefined { return this.items.get(uri.path); }
  /** Forget a snapshot (its tab closed). */
  drop(key: string): void {
    const s = this.items.get(key);
    if (s) { this.bytes -= s.bytes.length; this.items.delete(key); }
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => { /* a snapshot never changes */ }); }
  stat(uri: vscode.Uri): vscode.FileStat {
    const s = this.items.get(uri.path);
    if (!s) {
      if (/^\/[0-9a-f]+-\d+$/.test(uri.path) || uri.path === '/') return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0, permissions: vscode.FilePermission.Readonly };
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: s.at, mtime: s.at, size: s.bytes.length, permissions: vscode.FilePermission.Readonly };
  }
  readFile(uri: vscode.Uri): Uint8Array {
    const s = this.items.get(uri.path);
    if (!s) throw vscode.FileSystemError.FileNotFound(uri);
    return s.bytes;
  }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
  writeFile(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
  delete(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
  rename(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
}

/** The URI a tab shows, for text and image editors alike. */
export function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const i = tab?.input;
  return i instanceof vscode.TabInputText || i instanceof vscode.TabInputCustom ? i.uri : undefined;
}

/** Every open tab showing a snapshot. */
export function snapshotTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => tabUri(t)?.scheme === SNAPSHOT_SCHEME);
}
