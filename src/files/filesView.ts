import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { swallow } from '../log';
import { frameworkRoot, vaultRoot } from '../home/vault';
import { currentTheme, showHints } from '../home/config';
import { stateGet, stateSet } from '../state';
import { setFilesVisible } from './filesState';
import { HomeViewProvider } from '../home/homePanel';

/**
 * AIOS Files — a tidy collapsible file TREE in its own activity-bar container.
 * Glass, not engine: it lists real folders and opens files through the same
 * viewer logic the Home panel uses (aios.openOutput); it owns no AIOS logic.
 *
 * Three sections mirror how the AIOS is actually organised (the webview renders
 * them; this class just supplies the roots + per-directory listings):
 *   - INFRA / FRAMEWORK — the framework itself (agents, skills, plugins, …); its
 *                         own `vault/` is hidden here (it's the VAULT section)
 *   - VAULT     — the operator's own notes, calendar, projects, context
 *   - WORKSPACE — operator-added folders (repos, drives), persisted in glass state
 *
 * The webview can't touch the fs, so directory reads come back over postMessage
 * (reqId-correlated) — see media/files.js `fsList`.
 */

const WORKSPACE_KEY = 'filesWorkspaceFolders'; // string[] of absolute folder paths, in glass state
// Folders/files that are noise for a non-technical operator — hidden everywhere.
const NOISE = new Set(['node_modules', 'out', 'dist', '.git', '.glass', '.vscode', '.github', 'package-lock.json', '.DS_Store']);

interface Place { id: 'vault' | 'infra' | 'workspace'; label: string; sub: string; path: string; }
interface Entry { name: string; dir: boolean; ext: string; path: string; }

export class FilesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aios.files';
  public static current: FilesViewProvider | undefined;
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) { FilesViewProvider.current = this; }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) =>
      void Promise.resolve(this.onMessage(msg)).catch((e) => swallow('files message ' + (msg && msg.type), e)));
    // Re-skin live when the shared theme setting flips (Home toggle or the cog).
    const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiosGlass.theme')) this.post({ type: 'theme', theme: currentTheme() });
      if (e.affectsConfiguration('aiosGlass.showHints')) this.post({ type: 'hints', show: showHints() });
    });
    webviewView.onDidDispose(() => cfg.dispose());
    // Mirror this view's visibility to Home so the files button shows active (and
    // toggles). Fires on show/hide (including when another container takes over).
    this.syncVisibility();
    webviewView.onDidChangeVisibility(() => this.syncVisibility());
  }

  /** True when the Files view is currently on screen. */
  isVisible(): boolean { return !!this.view?.visible; }

  /** Open the Files view if hidden; hide it if shown. VS Code can't say which bar a
   *  view sits in, so we probe. Files lives in the PRIMARY sidebar by default (its own
   *  activity icon), so hide that first — a clean one-step close that doesn't flash the
   *  secondary bar (where Home is usually docked). Only if Files is somewhere else do we
   *  undo and toggle the secondary bar. */
  toggle(): void {
    if (!this.view?.visible) { void vscode.commands.executeCommand('aios.files.focus'); return; }
    void vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
    setTimeout(() => {
      if (this.view?.visible) {
        void vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
        void vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
      }
    }, 120);
  }

  private syncVisibility(): void {
    const v = this.isVisible();
    setFilesVisible(v);
    HomeViewProvider.current?.setFilesOpen(v);
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

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready': {
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints() });
        return;
      }
      case 'list': {
        // Reply even on a disallowed/missing path (empty) so the requesting promise resolves.
        const entries = (typeof msg.dir === 'string' && this.isAllowed(msg.dir)) ? this.list(msg.dir) : [];
        this.post({ type: 'listing', dir: msg.dir, entries, reqId: msg.reqId });
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
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints(), focus: p });
        return;
      }
      case 'removeFolder': {
        if (typeof msg.path !== 'string') return;
        const folders = this.workspaceFolders().filter((p) => p !== msg.path);
        await stateSet(WORKSPACE_KEY, folders);
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints() });
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
