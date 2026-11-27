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
 * title bar) opens the real file the operator's usual way, which from then on is not the bus's.
 *
 * The URI is `aios-open:/<n>/<file name>`: the number keeps two snapshots of one name apart, and the
 * name is what the tab shows.
 */
import * as vscode from 'vscode';
import * as path from 'path';

export const SNAPSHOT_SCHEME = 'aios-open';

interface Snapshot { bytes: Uint8Array; real: string; by: string; at: number }
const MAX_SNAPSHOTS = 50;

export class SnapshotFs implements vscode.FileSystemProvider {
  private readonly items = new Map<string, Snapshot>();
  private seq = 0;
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  /** Keep a snapshot and return the URI that shows it. The oldest go beyond MAX_SNAPSHOTS. */
  add(real: string, bytes: Uint8Array, by: string): vscode.Uri {
    const key = `/${++this.seq}/${path.basename(real)}`;
    this.items.set(key, { bytes, real, by, at: Date.now() });
    while (this.items.size > MAX_SNAPSHOTS) this.items.delete(this.items.keys().next().value as string);
    return vscode.Uri.from({ scheme: SNAPSHOT_SCHEME, path: key });
  }
  /** The real file behind a snapshot URI, for "Open to edit". */
  realPathOf(uri: vscode.Uri): string | undefined { return this.items.get(uri.path)?.real; }

  watch(): vscode.Disposable { return new vscode.Disposable(() => { /* a snapshot never changes */ }); }
  stat(uri: vscode.Uri): vscode.FileStat {
    const s = this.items.get(uri.path);
    if (!s) {
      if (/^\/\d+$/.test(uri.path) || uri.path === '/') return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0, permissions: vscode.FilePermission.Readonly };
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
