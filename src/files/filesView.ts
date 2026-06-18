import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { swallow } from '../log';
import { frameworkRoot, vaultRoot } from '../home/vault';
import { currentTheme, setTheme } from '../home/config';
import { stateGet, stateSet } from '../state';

/**
 * AIOS Files — a Finder-style explorer that lives PERMANENTLY beside Home (a
 * second view in the AIOS container), not a transient editor tab. Big folder
 * tiles, breadcrumbs, single-click to open. Glass, not engine: it lists real
 * folders and opens files through the same viewer logic the Home panel uses
 * (aios.openOutput); it owns no AIOS logic.
 *
 * It is RESPONSIVE — the roomy tile-grid when it has width (e.g. dragged to the
 * secondary side bar), a comfortable Finder list when it's a narrow sidebar.
 *
 * Three "places" mirror how the AIOS is actually organised:
 *   - VAULT     — the operator's own notes, calendar, projects, context
 *   - INFRA     — the framework itself (agents, skills, plugins, commands, …)
 *   - WORKSPACE — operator-added folders (repos, drives), persisted in glass state
 */

const WORKSPACE_KEY = 'filesWorkspaceFolders'; // string[] of absolute folder paths, in glass state
// Folders/files that are noise for a non-technical operator — hidden everywhere.
const NOISE = new Set(['node_modules', 'out', 'dist', '.git', '.glass', '.vscode', '.github', 'package-lock.json', '.DS_Store']);

interface Place { id: 'vault' | 'infra' | 'workspace'; label: string; sub: string; path: string; }
interface Entry { name: string; dir: boolean; ext: string; path: string; }
interface Crumb { label: string; path: string; }

export class FilesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aios.files';
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) =>
      void Promise.resolve(this.onMessage(msg)).catch((e) => swallow('files message ' + (msg && msg.type), e)));
    // Re-skin live when the shared theme setting flips (Home toggle or the cog).
    const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiosGlass.theme')) this.post({ type: 'theme', theme: currentTheme() });
    });
    webviewView.onDidDispose(() => cfg.dispose());
  }

  /** The current places (recomputed each call — paths and the workspace list can change). */
  private places(): Place[] {
    const out: Place[] = [];
    const v = vaultRoot();
    if (v) out.push({ id: 'vault', label: 'Vault', sub: 'your notes, calendar, projects', path: v });
    const fw = frameworkRoot();
    if (fw) out.push({ id: 'infra', label: 'Framework', sub: 'agents, skills, plugins, commands', path: fw });
    for (const p of this.workspaceFolders()) {
      out.push({ id: 'workspace', label: path.basename(p), sub: p, path: p });
    }
    return out;
  }

  private workspaceFolders(): string[] {
    const raw = stateGet<string[]>(WORKSPACE_KEY);
    return Array.isArray(raw) ? raw.filter((p) => typeof p === 'string' && dirExists(p)) : [];
  }

  /** A requested absolute path is allowed only if it sits inside one of the place roots. */
  private isAllowed(target: string): boolean {
    let real = target;
    try { real = fs.realpathSync(target); } catch { /* may not exist yet */ }
    return this.places().some((pl) => {
      let root = pl.path;
      try { root = fs.realpathSync(pl.path); } catch { /* keep */ }
      return real === root || real.startsWith(root + path.sep);
    });
  }

  private list(dirPath: string): Entry[] {
    let names: string[] = [];
    try { names = fs.readdirSync(dirPath); } catch { return []; }
    const entries: Entry[] = [];
    for (const name of names) {
      if (name.startsWith('.') || NOISE.has(name)) continue;
      let dir = false;
      const full = path.join(dirPath, name);
      try { dir = fs.statSync(full).isDirectory(); } catch { continue; }
      entries.push({ name, dir, ext: dir ? '' : (name.split('.').pop() || '').toLowerCase(), path: full });
    }
    // Folders first, then files; each alphabetical (locale-aware, numeric-prefix friendly).
    return entries.sort((a, b) =>
      a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** Breadcrumb trail from a place root down to the current dir (root label supplied by the caller). */
  private crumbs(root: string, rootLabel: string, dir: string): Crumb[] {
    const trail: Crumb[] = [{ label: rootLabel, path: root }];
    if (dir === root || !dir.startsWith(root + path.sep)) return trail;
    const rest = dir.slice(root.length + 1).split(path.sep).filter(Boolean);
    let acc = root;
    for (const seg of rest) { acc = path.join(acc, seg); trail.push({ label: seg, path: acc }); }
    return trail;
  }

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready': {
        this.post({ type: 'roots', places: this.places(), theme: currentTheme() });
        return;
      }
      case 'list': {
        if (typeof msg.dir !== 'string' || !this.isAllowed(msg.dir)) return;
        const root = typeof msg.root === 'string' && this.isAllowed(msg.root) ? msg.root : msg.dir;
        const rootLabel = typeof msg.rootLabel === 'string' ? msg.rootLabel : path.basename(root);
        this.post({ type: 'listing', dir: msg.dir, entries: this.list(msg.dir), crumbs: this.crumbs(root, rootLabel, msg.dir) });
        return;
      }
      case 'open': {
        if (typeof msg.file !== 'string' || !this.isAllowed(msg.file)) return;
        await vscode.commands.executeCommand('aios.openOutput', msg.file, !!msg.source);
        return;
      }
      case 'reveal': {
        // Reveal the file/folder in the OS file manager (Finder) — the "show in Finder" affordance.
        if (typeof msg.path !== 'string' || !this.isAllowed(msg.path)) return;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        return;
      }
      case 'addFolder': {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
          openLabel: 'Add to workspace', title: 'Add a folder to AIOS Files',
        });
        if (!picked?.length) return;
        const p = picked[0].fsPath;
        const folders = this.workspaceFolders();
        if (!folders.includes(p)) { folders.push(p); await stateSet(WORKSPACE_KEY, folders); }
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), focus: p });
        return;
      }
      case 'removeFolder': {
        if (typeof msg.path !== 'string') return;
        const folders = this.workspaceFolders().filter((p) => p !== msg.path);
        await stateSet(WORKSPACE_KEY, folders);
        this.post({ type: 'roots', places: this.places(), theme: currentTheme() });
        return;
      }
      case 'setTheme': {
        if (msg.theme === 'dark' || msg.theme === 'light') await setTheme(msg.theme);
        return;
      }
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';`;
    try {
      const page = fs.readFileSync(vscode.Uri.joinPath(media, 'files.html').fsPath, 'utf8');
      return page
        .replace('<body>', currentTheme() === 'light' ? '<body class="light">' : '<body>')
        .replace(/{{CSP}}/g, csp)
        .replace(/{{NONCE}}/g, nonce)
        .replace(/{{CSS_URI}}/g, webview.asWebviewUri(vscode.Uri.joinPath(media, 'files.css')).toString())
        .replace(/{{JS_URI}}/g, webview.asWebviewUri(vscode.Uri.joinPath(media, 'files.js')).toString());
    } catch (e) {
      return `<!DOCTYPE html><html><body><p>AIOS Files: failed to load the UI — ${String(e)}</p></body></html>`;
    }
  }
}

function dirExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
