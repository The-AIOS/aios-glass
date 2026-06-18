import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { swallow } from '../log';
import { frameworkRoot, vaultRoot } from '../home/vault';
import { currentTheme, showHints, fileIconsEnhanced, showHiddenFiles, autoReveal } from '../home/config';
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
// Always hidden — never useful to browse, even with "show hidden files" on.
// (`.glass` is NOT here — it's a normal dotfile, revealed by "show hidden files".)
const ALWAYS_HIDE = new Set(['node_modules', 'out', 'dist', '.git', '.DS_Store']);

interface Place { id: 'vault' | 'infra' | 'workspace'; label: string; sub: string; path: string; }
interface Entry { name: string; dir: boolean; ext: string; path: string; git?: string }
interface GitInfo { at: number; files: Map<string, string>; dirty: Set<string> }

export class FilesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aios.files';
  public static current: FilesViewProvider | undefined;
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private gitTimer?: ReturnType<typeof setTimeout>;
  private gitPoll?: ReturnType<typeof setInterval>;
  private relistTimer?: ReturnType<typeof setTimeout>;
  private relistDirs = new Set<string>();
  // basename → fsPath for markdown previews we opened — lets auto-reveal follow a
  // preview tab back to its file (preview webviews expose no uri of their own).
  private previewPaths = new Map<string, string>();

  constructor(private readonly extensionUri: vscode.Uri) { FilesViewProvider.current = this; }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) =>
      void Promise.resolve(this.onMessage(msg)).catch((e) => swallow('files message ' + (msg && msg.type), e)));
    // Re-skin live when the shared theme setting flips (Home toggle or the cog).
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiosGlass.theme')) this.post({ type: 'theme', theme: currentTheme() });
      if (e.affectsConfiguration('aiosGlass.showHints')) this.post({ type: 'hints', show: showHints() });
      if (e.affectsConfiguration('aiosGlass.fileIcons')) this.post({ type: 'icons', enhanced: fileIconsEnhanced() });
      if (e.affectsConfiguration('aiosGlass.showHidden')) this.post({ type: 'reload' });
      if (e.affectsConfiguration('files.exclude')) { this.excludeRe = undefined; this.post({ type: 'reload' }); }
    }));
    // Mirror this view's visibility to Home so the files button shows active (and
    // toggles). Fires on show/hide (including when another container takes over).
    this.syncVisibility();
    this.disposables.push(webviewView.onDidChangeVisibility(() => { this.syncVisibility(); if (this.isVisible()) this.scheduleGit(80); }));
    // Auto-reveal: when the active tab changes to a file under a section, tell the
    // webview to expand to + select it (IDE-style orientation). Uses the Tabs API so
    // it follows non-text editors too — PDFs/images (custom editors) and markdown
    // PREVIEWS (webview, matched back to the file we opened) — not just source tabs.
    const revealActive = () => {
      if (!autoReveal()) return; // operator can turn following off (cog → Auto-reveal)
      const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri; modified?: vscode.Uri; viewType?: string } | undefined;
      const label = vscode.window.tabGroups.activeTabGroup?.activeTab?.label;
      let p = input?.uri?.fsPath ?? input?.modified?.fsPath; // text / custom (pdf, image) / notebook / diff
      if (!p && input?.viewType && /markdown/i.test(input.viewType) && label) {
        p = this.previewPaths.get(label.replace(/^Preview\s+/i, '').trim()); // md preview → its file
      }
      if (!p) p = vscode.window.activeTextEditor?.document?.uri?.fsPath;
      if (p && this.isAllowed(p)) this.post({ type: 'revealPath', path: p });
    };
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(revealActive));
    this.disposables.push(vscode.window.tabGroups.onDidChangeTabs(revealActive));
    // Live git status: watch working-tree edits under each section root + each
    // repo's .git/index (commits), debounced → recompute and push to the webview.
    this.watchGit();
    // Watchers are unreliable for paths OUTSIDE the opened workspace (all three
    // sections are), so also poll git while the view is visible — guarantees
    // markers appear/clear for every repo (incl. added Workspace folders).
    this.gitPoll = setInterval(() => { if (this.isVisible()) this.pushGit(); }, 3000);
    webviewView.onDidDispose(() => {
      if (this.gitPoll) { clearInterval(this.gitPoll); this.gitPoll = undefined; }
      if (this.relistTimer) { clearTimeout(this.relistTimer); this.relistTimer = undefined; }
      while (this.disposables.length) try { this.disposables.pop()?.dispose(); } catch { /* ignore */ }
      while (this.gitWatchers.length) try { this.gitWatchers.pop()?.dispose(); } catch { /* ignore */ }
    });
  }

  private gitWatchers: vscode.Disposable[] = [];

  /** (Re)build the git watchers for the CURRENT places — re-run whenever a
   *  workspace folder is added/removed so newly-added repos get live status too
   *  (not just the places that existed when the view first resolved). */
  private watchGit(): void {
    while (this.gitWatchers.length) { try { this.gitWatchers.pop()?.dispose(); } catch { /* ignore */ } }
    const repos = new Set<string>();
    const fire = () => this.scheduleGit();
    // create/delete change the tree's SHAPE — also queue a TARGETED re-list of just the
    // changed file's parent folder (the webview no-ops unless that folder is visible),
    // so a new file surfaces on its own without a full repaint. Plain change = git only.
    const fireStructural = (u: vscode.Uri) => { this.scheduleGit(); this.scheduleRelist(u); };
    for (const pl of this.places()) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(pl.path), '**/*'));
      w.onDidChange(fire); w.onDidCreate(fireStructural); w.onDidDelete(fireStructural);
      this.gitWatchers.push(w);
      const r = this.repoRoot(pl.path);
      if (r) repos.add(r);
    }
    for (const r of repos) { // .git/index changes on commit/stage → status flips (e.g. all clean)
      const gw = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(r), '.git/index'));
      gw.onDidChange(fire); gw.onDidCreate(fire);
      this.gitWatchers.push(gw);
    }
  }

  private scheduleGit(delay = 350): void {
    if (this.gitTimer) clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => this.pushGit(), delay);
  }

  /** Debounced, parent-dir-scoped re-list. Coalesces a burst (a build / git checkout
   *  writing many files) into one message carrying the unique changed folders; the
   *  webview re-lists only those that are actually rendered. Cheap — no full repaint. */
  private scheduleRelist(uri: vscode.Uri): void {
    this.relistDirs.add(path.dirname(uri.fsPath));
    if (this.relistTimer) clearTimeout(this.relistTimer);
    this.relistTimer = setTimeout(() => {
      const dirs = [...this.relistDirs]; this.relistDirs.clear();
      this.post({ type: 'relist', dirs });
    }, 300);
  }

  private repoListCache = new Map<string, { at: number; repos: string[] }>();

  /** The git repos under a section root: the place itself if it's (in) a repo,
   *  else a bounded scan for nested `.git`s (a non-repo container like `~/code`).
   *  Cached ~20s — repos don't come and go often; only `git status` re-runs per poll. */
  private reposUnder(placePath: string): string[] {
    const own = this.repoRoot(placePath);
    if (own) return [own];
    const c = this.repoListCache.get(placePath);
    const now = Date.now();
    if (c && now - c.at < 20000) return c.repos;
    const repos: string[] = [];
    const ex = this.excludeMatchers();
    const walk = (dir: string, depth: number): void => {
      if (depth > 6) return;
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const name of names) {
        if (ALWAYS_HIDE.has(name) || name.startsWith('.') || ex.some((re) => re.test(name))) continue;
        const full = path.join(dir, name);
        try { if (!fs.statSync(full).isDirectory()) continue; } catch { continue; }
        if (fs.existsSync(path.join(full, '.git'))) repos.push(full); // a repo — record, don't descend
        else walk(full, depth + 1);
      }
    };
    walk(placePath, 0);
    this.repoListCache.set(placePath, { at: now, repos });
    return repos;
  }

  /** Recompute git status (fresh) for every repo under every section and push a
   *  snapshot the webview reconciles onto its rendered rows — no re-expand. Each
   *  change bubbles up to its section root, so EVERY ancestor folder (incl. non-repo
   *  containers like `~/code`) shows the dirty marker — your "where are edits happening"
   *  radar across sessions. */
  private pushGit(): void {
    const files: Record<string, string> = {};
    const dirty = new Set<string>();
    const covered: string[] = [];
    for (const pl of this.places()) {
      covered.push(pl.path);
      for (const r of this.reposUnder(pl.path)) {
        this.gitCache.delete(r);
        const gs = this.gitStatus(r);
        for (const [k, v] of gs.files) {
          files[k] = v;
          for (let d = path.dirname(k); d.startsWith(pl.path) && d.length >= pl.path.length; d = path.dirname(d)) {
            dirty.add(d);
            if (d === pl.path) break;
          }
        }
      }
    }
    this.post({ type: 'git', files, dirty: [...dirty], repos: covered });
  }

  /** True when the Files view is currently on screen. */
  isVisible(): boolean { return !!this.view?.visible; }

  /** Collapse the tree to the top (the ⊟ title-bar action). */
  collapseAll(): void { this.post({ type: 'collapseAll' }); }

  /** Full re-read preserving expansion (the ⟳ title-bar action) — the manual catch-all.
   *  Automatic updates happen in place via scheduleRelist (per-folder, no repaint); this
   *  is the heavier "rebuild everything" fallback for when you just want a clean re-read. */
  refresh(): void { this.post({ type: 'refresh' }); }

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
    const showHidden = showHiddenFiles();
    const entries: Entry[] = [];
    const excluded = this.excludeMatchers();
    for (const name of names) {
      if (ALWAYS_HIDE.has(name)) continue;
      if (!showHidden && name.startsWith('.')) continue;
      if (excluded.some((re) => re.test(name))) continue; // honor the editor's files.exclude
      let dir = false;
      const full = path.join(dirPath, name);
      try { dir = fs.statSync(full).isDirectory(); } catch { continue; }
      entries.push({ name, dir, ext: dir ? '' : (name.split('.').pop() || '').toLowerCase(), path: full });
    }
    // Git status (IDE-style): mark changed files + folders with changed descendants.
    const root = this.repoRoot(dirPath);
    const gs = root ? this.gitStatus(root) : null;
    for (const e of entries) {
      if (gs) e.git = e.dir ? (gs.files.get(e.path) || (gs.dirty.has(e.path) ? 'M' : undefined)) : gs.files.get(e.path);
      // A directory that is ITS OWN repo (e.g. a repo nested inside a non-repo
      // workspace folder like `~/code`) — mark it dirty if that repo has changes.
      if (e.dir && !e.git) {
        try { if (fs.existsSync(path.join(e.path, '.git')) && this.gitStatus(e.path).files.size > 0) e.git = 'M'; } catch { /* ignore */ }
      }
    }
    // Folders first, then files; each alphabetical (locale-aware, numeric-prefix friendly).
    return entries.sort((a, b) =>
      a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  private excludeRe: RegExp[] | undefined;

  /** Compile the editor's `files.exclude` globs to basename matchers (cached) so the
   *  explorer hides what the IDE hides (e.g. `_archive`, `_workspaces`). We match the
   *  entry name against each active glob — covers the common `**​/x`, `x`, `*.ext` forms. */
  private excludeMatchers(): RegExp[] {
    if (this.excludeRe) return this.excludeRe;
    const cfg = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude') || {};
    const res: RegExp[] = [];
    for (const [glob, val] of Object.entries(cfg)) {
      if (!val) continue; // false → not excluded; a `when`-object is truthy → treat as excluded
      let g = glob.replace(/^(\*\*\/)+/, '');
      if (g.includes('/')) g = g.split('/').pop() || g; // approximate path globs by basename
      if (!g) continue;
      const src = '^' + [...g].map((c) => c === '*' ? '[^/]*' : c === '?' ? '.' : '.+^${}()|[]\\'.includes(c) ? '\\' + c : c).join('') + '$';
      try { res.push(new RegExp(src)); } catch { /* skip an unparseable glob */ }
    }
    this.excludeRe = res;
    return res;
  }

  /** Nearest ancestor dir that holds a `.git` — the repo root for `dir`, or undefined. */
  private repoRoot(dir: string): string | undefined {
    let d = dir;
    for (let i = 0; i < 40; i++) {
      try { if (fs.existsSync(path.join(d, '.git'))) return d; } catch { /* keep walking */ }
      const parent = path.dirname(d);
      if (parent === d) break;
      d = parent;
    }
    return undefined;
  }

  private gitCache = new Map<string, GitInfo>();

  /** `git status --porcelain` for a repo root → changed-file map + dirty-folder set.
   *  Cached ~2s so expanding folders in the same repo doesn't re-shell each time.
   *  A failed call caches an EMPTY result with a timestamp (so it expires and
   *  retries) — never a permanent null. */
  private gitStatus(repoRoot: string): GitInfo {
    const cached = this.gitCache.get(repoRoot);
    const now = Date.now();
    if (cached && now - cached.at < 2000) return cached;
    let out = '';
    try {
      out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8', timeout: 4000, maxBuffer: 1 << 22 });
    } catch { const empty = { at: now, files: new Map<string, string>(), dirty: new Set<string>() }; this.gitCache.set(repoRoot, empty); return empty; }
    const files = new Map<string, string>();
    const dirty = new Set<string>();
    for (const line of out.split('\n')) {
      if (line.length < 4) continue;
      const xy = line.slice(0, 2);
      let p = line.slice(3);
      if (p.includes(' -> ')) p = p.split(' -> ')[1]; // rename → the new path
      p = p.replace(/^"(.*)"$/, '$1').replace(/\/$/, '');
      const abs = path.join(repoRoot, p);
      const code = xy.includes('?') ? 'U' : xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : 'M';
      files.set(abs, code);
      for (let d = path.dirname(abs); d.startsWith(repoRoot); d = path.dirname(d)) { dirty.add(d); if (d === repoRoot) break; }
    }
    const info: GitInfo = { at: now, files, dirty };
    this.gitCache.set(repoRoot, info);
    return info;
  }

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready': {
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints(), iconsEnhanced: fileIconsEnhanced() });
        return;
      }
      case 'list': {
        // Reply even on a disallowed/missing path (empty) so the requesting promise resolves.
        const entries = (typeof msg.dir === 'string' && this.isAllowed(msg.dir)) ? this.list(msg.dir) : [];
        this.post({ type: 'listing', dir: msg.dir, entries, reqId: msg.reqId });
        return;
      }
      case 'requestGit': { this.pushGit(); return; } // webview repainted → send fresh git colors now
      case 'open': {
        if (typeof msg.file !== 'string' || !this.isAllowed(msg.file)) return;
        const uri = vscode.Uri.file(msg.file);
        const ext = path.extname(msg.file).toLowerCase();
        // ⌘-click / ⌘-Enter → force the RAW source text editor (persistent tab).
        if (msg.source) {
          await vscode.window.showTextDocument(uri, { preview: false });
          return;
        }
        // Plain click/Enter → the file's NATURAL view (source is reserved for ⌘).
        if (/^\.html?$/.test(ext)) {
          // Notify first (visible toast), then hand off to the browser — the toast
          // shows whether or not openExternal resolves.
          vscode.window.showInformationMessage(`Opened ${path.basename(msg.file)} in your browser`);
          await vscode.env.openExternal(uri); // HTML can't render in-editor → browser
        } else if (ext === '.md' || ext === '.markdown') {
          this.previewPaths.set(path.basename(msg.file), msg.file); // so auto-reveal can follow the preview tab
          await vscode.commands.executeCommand('markdown.showPreview', uri); // rendered note, not raw source
        } else {
          // pdf / image / etc. → their default editor renders them; code → its source.
          // preview:false makes it a PERSISTENT tab so the explorer can follow the active editor.
          await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
        }
        return;
      }
      case 'reveal': {
        // Reveal the file/folder in the OS file manager (Finder) — the "show in Finder" affordance.
        if (typeof msg.path !== 'string' || !this.isAllowed(msg.path)) return;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        return;
      }
      case 'copyPath': {
        if (typeof msg.path !== 'string' || !this.isAllowed(msg.path)) return;
        await vscode.env.clipboard.writeText(msg.path);
        vscode.window.setStatusBarMessage('$(check) Path copied — paste into a terminal', 2500);
        return;
      }
      case 'pathToTerminal': {
        // Insert the path into the active terminal (no newline) — the reliable
        // "drag to terminal" alternative when a real DnD into the terminal isn't possible.
        if (typeof msg.path !== 'string' || !this.isAllowed(msg.path)) return;
        const t = vscode.window.activeTerminal;
        if (t) { t.show(true); t.sendText(quotePath(msg.path) + ' ', false); }
        else vscode.window.setStatusBarMessage('$(info) No active terminal — open one first', 2500);
        return;
      }
      case 'terminalHere': {
        // Open a terminal cd'd into this folder (a file → its parent dir).
        if (typeof msg.path !== 'string' || !this.isAllowed(msg.path)) return;
        let dir = msg.path;
        try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch { dir = path.dirname(dir); }
        vscode.window.createTerminal({ cwd: dir, name: path.basename(dir) }).show();
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
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints(), iconsEnhanced: fileIconsEnhanced(), focus: p });
        this.watchGit();        // wire live git for the new folder's repo
        this.scheduleGit(120);  // and push its status onto the freshly-rendered rows
        return;
      }
      case 'removeFolder': {
        if (typeof msg.path !== 'string') return;
        const folders = this.workspaceFolders().filter((p) => p !== msg.path);
        await stateSet(WORKSPACE_KEY, folders);
        this.post({ type: 'roots', places: this.places(), theme: currentTheme(), hints: showHints(), iconsEnhanced: fileIconsEnhanced() });
        this.watchGit(); // drop the removed folder's watchers
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

/** Shell-quote a path only if it needs it (spaces / specials). */
function quotePath(p: string): string {
  return /[^A-Za-z0-9._/\-]/.test(p) ? "'" + p.replace(/'/g, "'\\''") + "'" : p;
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
