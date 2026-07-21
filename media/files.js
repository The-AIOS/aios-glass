  const vscode = acquireVsCodeApi();
  const explorerEl = document.getElementById('explorer');
  let places = [];
  let master = 'name'; // the global default sort — from the host
  let overrides = {};  // { folderPath: 'name' | 'mtime' } — per-folder overrides, any depth
  // effective sort for a dir: its closest-ancestor override, else the master default (mirrors host resolveSort).
  function effectiveSort(dir){ let best = null; for (const k in overrides){ if (dir === k || dir.startsWith(k + '/')){ if (!best || k.length > best.length) best = k; } } return best ? overrides[best] : master; }

  // ── i18n (AI-19) ── mirror of the Home panel's localizer. The host injects
  // `window.__nls` before this runs; NLS(key, fallback) returns the translation or
  // the English fallback (also baked into files.html), so a miss degrades to English.
  const NLS_MAP = (typeof window !== 'undefined' && window.__nls) || {};
  const NLS = (key, fallback) => (key && NLS_MAP[key] != null ? NLS_MAP[key] : (fallback != null ? fallback : ''));
  function localizeStatic(){
    document.querySelectorAll('[data-i18n]').forEach((n) => { const v = NLS_MAP[n.getAttribute('data-i18n')]; if (v != null) n.textContent = v; });
    document.querySelectorAll('[data-i18n-title]').forEach((n) => { const v = NLS_MAP[n.getAttribute('data-i18n-title')]; if (v != null) n.setAttribute('title', v); });
    document.querySelectorAll('[data-i18n-ph]').forEach((n) => { const v = NLS_MAP[n.getAttribute('data-i18n-ph')]; if (v != null) n.setAttribute('placeholder', v); });
  }
  localizeStatic();

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ── icons (stroked, currentColor) — chevrons for folders, a plain doc for files ──
  const ICONS = {
    chevR: '<polyline points="9 18 15 12 9 6"/>',
    chevD: '<polyline points="6 9 12 15 18 9"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  };
  const icon = (name, size) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';

  // ── enhanced file-type icons (modeled on the operator's IDE icon pack) ──
  const DOC = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
  const sv = (color, inner) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  // a lettered badge (TS / JS / PY) — rounded square + monospace-ish caps
  const badge = (color, txt) => '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="2.5" y="4" width="19" height="16" rx="2.6" fill="none" stroke="' + color + '" stroke-width="1.7"/><text x="12" y="15.4" text-anchor="middle" font-family="-apple-system,Inter,Segoe UI,sans-serif" font-size="8.3" font-weight="800" fill="' + color + '">' + txt + '</text></svg>';
  const TERM = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M13 14.5h4"/>';
  function extKey(name) {
    const n = name.toLowerCase();
    if (/^readme/.test(n)) return 'md';
    if (/^(license|copying)/.test(n)) return 'license';            // NOTICE → plain doc, like the IDE
    if (/(^|\.)(gitignore|gitattributes|gitmodules)$/.test(n)) return 'git';
    if (/^package(-lock)?\.json$/.test(n)) return 'node';          // green hexagon
    if (/^tsconfig.*\.json$/.test(n)) return 'ts';                 // TS badge
    if (/(\.lock)$/.test(n) || n === 'yarn.lock') return 'lock';
    return n.includes('.') ? n.split('.').pop() : '';
  }
  // each builder → a colored 14px glyph
  const FAM = {
    md: () => sv('#42a5f5', '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 15.5V9l3 3 3-3v6.5"/><path d="M16.5 9v4.4m0 0 1.8-1.8m-1.8 1.8-1.8-1.8"/>'),
    json: () => sv('#d4a04a', '<path d="M8 4a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3"/><path d="M16 4a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3"/>'),
    node: () => sv('#6cc24a', '<path d="M12 2.6 20 7v10l-8 4.4L4 17V7Z"/>'),
    ts: () => badge('#3178c6', 'TS'),
    js: () => badge('#caa92a', 'JS'),
    py: () => badge('#4b8bbe', 'PY'),
    shell: () => sv('#4caf50', TERM),
    ps: () => sv('#4aa3ff', TERM),
    html: () => sv('#e8913a', '<polyline points="13 4 10 20"/><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/>'),
    css: () => sv('#4aa3ff', '<line x1="9" y1="4" x2="7.5" y2="20"/><line x1="16.5" y1="4" x2="15" y2="20"/><line x1="4" y1="9.5" x2="20" y2="9.5"/><line x1="3.4" y1="14.5" x2="19.4" y2="14.5"/>'),
    image: () => sv('#c586ff', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 21"/>'),
    pdf: () => sv('#e0524a', DOC),
    vsix: () => sv('#41c4d8', '<path d="M14 4.6a1.5 1.5 0 0 0-3 0c0 .3.1.6.2.9H8.2a1 1 0 0 0-1 1v2.6c-.3-.1-.6-.2-.9-.2a1.5 1.5 0 0 0 0 3c.3 0 .6-.1.9-.2V18a1 1 0 0 0 1 1h2.6c-.1.3-.2.6-.2.9a1.5 1.5 0 0 0 3 0c0-.3-.1-.6-.2-.9H18a1 1 0 0 0 1-1v-3.1c.3.1.6.2.9.2a1.5 1.5 0 0 0 0-3c-.3 0-.6.1-.9.2V7.5a1 1 0 0 0-1-1h-3.1c.1-.3.2-.6.2-.9Z"/>'),
    archive: () => sv('#b08968', '<rect x="2.5" y="4" width="19" height="4" rx="1"/><path d="M4.5 8v11a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/>'),
    git: () => sv('#f05133', '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M18 11.4a6 6 0 0 1-6 6H8.4"/>'),
    license: () => sv('#a3a7ad', '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.6a3.4 3.4 0 1 0 0 4.8"/>'),
    lock: () => sv('#9aa0a6', '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    canvas: () => sv('#0099ff', '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h4a2 2 0 0 1 2 2v5"/>'),
    doc: () => sv('#8a8f98', DOC),
  };
  const ICON_FOR = {
    md: 'md', markdown: 'md', mdx: 'md',
    json: 'json', jsonc: 'json', yml: 'json', yaml: 'json', toml: 'json',
    node: 'node',
    ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
    js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    ps1: 'ps', psm1: 'ps',
    html: 'html', htm: 'html', xml: 'html', vue: 'html', svelte: 'html',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image', bmp: 'image',
    pdf: 'pdf', vsix: 'vsix',
    zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', '7z': 'archive',
    git: 'git', canvas: 'canvas', license: 'license', lock: 'lock',
  };
  // a file's icon: enhanced colorful glyph, or the plain neutral doc
  function fileIconSvg(name) {
    if (!iconsEnhanced) return icon('file', 13);
    return (FAM[ICON_FOR[extKey(name)]] || FAM.doc)();
  }

  let iconsEnhanced = true;

  // ── theme + secondary hints + icons (all follow shared settings; no toggles here) ──
  const applyTheme = (t) => document.body.classList.toggle('light', t === 'light');
  const applyHints = (show) => document.body.classList.toggle('no-hints', show === false);

  // ── fs bridge: postMessage round-trip exposed as an awaitable, so the tree can
  //    recurse the same way a synchronous fs would. Each request carries a reqId
  //    the extension echoes back on its listing reply. ──
  let reqSeq = 0;
  const pending = new Map();
  function fsList(dir) {
    // Resolve idempotently, and ALWAYS resolve — a lost 'listing' reply (e.g. the
    // round-trip interrupted by a modal open-dialog) must not strand the awaiting
    // paint forever, or sections built after it (the WORKSPACE group) never render.
    return new Promise((resolve) => {
      const id = ++reqSeq;
      const done = (v) => { if (pending.delete(id)) resolve(v); };
      pending.set(id, done);
      vscode.postMessage({ type: 'list', dir, reqId: id });
      setTimeout(() => done([]), 5000); // safety net: never hang the tree
    });
  }

  // ── live git: reconcile status onto every rendered row (no re-expand) ──
  function applyGit(filesMap, dirtyList, repos) {
    const files = filesMap || {};
    const dirty = new Set(dirtyList || []);
    const roots = repos || [];
    // Only reconcile rows INSIDE the repos this snapshot covers; leave others
    // (e.g. sub-repo folders inside a non-repo workspace container, coloured on
    // expand) untouched so the poll doesn't wipe them.
    const inScope = (p) => !roots.length || roots.some((r) => p === r || p.startsWith(r + '/'));
    explorerEl.querySelectorAll('.xrow[data-path]').forEach((row) => {
      const p = row.dataset.path;
      if (!inScope(p)) return;
      const isDir = row.classList.contains('dir');
      const code = files[p] || (isDir && dirty.has(p) ? 'M' : undefined);
      row.classList.remove('gM', 'gU', 'gA', 'gD', 'gR');
      const old = row.querySelector('.gst, .gdot'); if (old) old.remove();
      if (code) { row.classList.add('g' + code); row.append(isDir ? el('span', 'gdot') : el('span', 'gst', code)); }
    });
  }

  // ── selection ──
  function select(row) {
    for (const r of explorerEl.querySelectorAll('.xrow.sel')) r.classList.remove('sel');
    row.classList.add('sel');
  }

  // ── right-click → "Reveal in Finder" (explicit label; the icon-only diagonal
  //    arrow read as "open in editor", so this is text + a deliberate gesture) ──
  const ctx = document.getElementById('ctx');
  let ctxPath = '';
  const hideCtx = () => { ctx.hidden = true; };
  function attachCtx(row, p) {
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ctxPath = p;
      ctx.hidden = false;
      ctx.style.left = Math.min(ev.clientX, window.innerWidth - 182) + 'px';
      ctx.style.top = Math.min(ev.clientY, window.innerHeight - 110) + 'px';
    });
  }
  document.getElementById('ctxReveal').addEventListener('click', () => { if (ctxPath) vscode.postMessage({ type: 'reveal', path: ctxPath }); hideCtx(); });
  document.getElementById('ctxCopy').addEventListener('click', () => { if (ctxPath) vscode.postMessage({ type: 'copyPath', path: ctxPath }); hideCtx(); });
  document.getElementById('ctxTerminal').addEventListener('click', () => { if (ctxPath) vscode.postMessage({ type: 'pathToTerminal', path: ctxPath }); hideCtx(); });
  document.getElementById('ctxTerminalHere').addEventListener('click', () => { if (ctxPath) vscode.postMessage({ type: 'terminalHere', path: ctxPath }); hideCtx(); });
  window.addEventListener('click', hideCtx);
  window.addEventListener('blur', hideCtx);
  window.addEventListener('scroll', hideCtx, true);

  // ── per-folder sort (AI-58) — a hover-reveal control on each Workspace-folder
  //    header opens this 2-option menu; the choice persists per folder in .glass/. ──
  const sortMenu = document.getElementById('sortMenu');
  let sortTarget = null; // a folder PATH (per-folder override), or 'MASTER' (the global default)
  const hideSort = () => { sortMenu.hidden = true; };
  function openSortMenu(ev, target){
    sortTarget = target;
    sortMenu.hidden = false;
    sortMenu.style.left = Math.min(ev.clientX, window.innerWidth - 190) + 'px';
    sortMenu.style.top = Math.min(ev.clientY, window.innerHeight - 90) + 'px';
    const mode = target === 'MASTER' ? master : effectiveSort(target); // current sort → shown in accent
    document.getElementById('sortName').classList.toggle('on', mode === 'name');
    document.getElementById('sortMtime').classList.toggle('on', mode === 'mtime');
  }
  const setSort = (mode) => {
    if (sortTarget === 'MASTER') vscode.postMessage({ type: 'setMaster', mode });        // set master + clear all overrides
    else if (sortTarget) vscode.postMessage({ type: 'setSort', root: sortTarget, mode }); // per-folder override, any depth
    hideSort();
  };
  document.getElementById('sortName').addEventListener('click', (e) => { e.stopPropagation(); setSort('name'); });
  document.getElementById('sortMtime').addEventListener('click', (e) => { e.stopPropagation(); setSort('mtime'); });
  const masterBtn = document.getElementById('masterSort');
  if (masterBtn) masterBtn.addEventListener('click', (ev) => { ev.stopPropagation(); openSortMenu(ev, 'MASTER'); });
  window.addEventListener('click', hideSort);
  window.addEventListener('blur', hideSort);
  window.addEventListener('scroll', hideSort, true);

  // The neutral sort glyph (⇅ arrows) — mode-independent (a clock read as "loading").
  // The menu's accent + the .active tint (= this folder has its OWN override) carry the mode.
  const sortGlyph = () => '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M4 17l3 3 3-3"/><path d="M13.5 6h6M13.5 11h4.5M13.5 16h3"/></svg>';

  // Attach a hover-reveal per-folder sort control to any header/row — workspace root,
  // Vault/Framework section, OR a nested subfolder. Keyed by its folder path (any depth).
  function attachSortControl(headerEl, path){
    const sb = el('span', 'xsort' + (overrides[path] ? ' active' : ''));
    sb.dataset.sortroot = path;
    sb.title = NLS('files.sort.title', 'Sort this folder');
    sb.innerHTML = sortGlyph();
    sb.addEventListener('click', (ev) => { ev.stopPropagation(); openSortMenu(ev, path); });
    headerEl.appendChild(sb);
  }

  // Reflect a per-folder override's active tint in place (the glyph itself is neutral now).
  function updateSortActive(root){
    const sb = explorerEl.querySelector('.xsort[data-sortroot="' + ((window.CSS && CSS.escape) ? CSS.escape(root) : root) + '"]');
    if (sb) sb.classList.toggle('active', !!overrides[root]);
  }

  // Best-effort native drag — sets the path as text + a file URI so a drop target
  // (e.g. the terminal) inserts it. Webview→terminal DnD isn't guaranteed across the
  // iframe boundary, so "Send path to terminal" / "Copy path" (right-click) are the
  // reliable routes; this just makes drag work where the host allows it.
  function attachDrag(row, p) {
    row.draggable = true;
    row.addEventListener('dragstart', (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.setData('text/plain', p);
      ev.dataTransfer.setData('text/uri-list', 'file://' + encodeURI(p));
      ev.dataTransfer.effectAllowed = 'copy';
    });
  }

  // path → its children-container element (a section box or a folder's .xkids), so a
  // single changed folder can be re-listed in place without touching the rest of the tree.
  const dirContainers = new Map();

  // Build ONE row (file or folder) with all its wiring, and return it (not appended —
  // buildTree appends in bulk; relistFolder inserts a single new row in order).
  function makeRow(e, depth, base) {
    const row = el('div', 'xrow' + (e.dir ? ' dir' : '') + (e.git ? ' g' + e.git : '') + (e.name.startsWith('.') ? ' hidden' : ''));
    row.dataset.path = e.path; // lets live git pushes find + recolor this row
    row.style.paddingLeft = ((base || 14) + depth * 9) + 'px'; // content nests under its section (tight)
    const ic = el('span', 'xicon'); ic.innerHTML = e.dir ? icon('chevR', 11) : fileIconSvg(e.name);
    const nm = el('span', 'xname');
    const pm = e.dir ? e.name.match(/^(\d+ - )(.+)$/) : null; // dim the "00 - " ordering prefix
    if (pm) { nm.append(el('span', 'xpre', pm[1]), document.createTextNode(pm[2])); }
    else nm.textContent = e.dir ? e.name : e.name.replace(/\.md$/i, '');
    row.append(ic, nm);
    if (e.git) row.append(e.dir ? el('span', 'gdot') : el('span', 'gst', e.git)); // folders → dot, files → letter
    attachCtx(row, e.path);
    attachDrag(row, e.path);
    if (e.dir) {
      attachSortControl(row, e.path); // per-folder sort on any subfolder, any depth (v2)
      let kids = null;
      const guideX = ((base || 14) + depth * 9 + 7) + 'px'; // child guide line under this chevron
      const ensure = async () => { // expand-only (used by click + auto-reveal)
        if (!kids) { kids = el('div', 'xkids'); kids.style.setProperty('--g', guideX); row.after(kids); ic.innerHTML = icon('chevD', 11); await buildTree(e.path, kids, depth + 1, undefined, base); applyFilter(); }
        else if (kids.style.display === 'none') { kids.style.display = ''; ic.innerHTML = icon('chevD', 11); }
      };
      ensureExpand.set(e.path, ensure);
      row.addEventListener('click', async (ev) => {
        if (ev.altKey) { vscode.postMessage({ type: 'pathToTerminal', path: e.path }); return; } // ⌥-click → send path to terminal
        select(row);
        if (kids && kids.style.display !== 'none') { kids.style.display = 'none'; ic.innerHTML = icon('chevR', 11); } // collapse
        else await ensure();
      });
    } else {
      // Click opens (md→preview, html→browser, …); ⌘-click opens source; ⌥-click → terminal.
      row.addEventListener('click', (ev) => {
        if (ev.altKey) { vscode.postMessage({ type: 'pathToTerminal', path: e.path }); return; }
        select(row); vscode.postMessage({ type: 'open', file: e.path, source: ev.metaKey || ev.ctrlKey });
      });
    }
    return row;
  }

  // ── the tree — lazy: a folder lists its children only on first expand ──
  async function buildTree(absDir, container, depth, skipName, base) {
    container.dataset.depth = depth; container.dataset.base = (base || 14); // for in-place re-list
    if (skipName) container.dataset.skip = skipName; else delete container.dataset.skip;
    dirContainers.set(absDir, container);
    const entries = await fsList(absDir);
    for (const e of entries) {
      if (skipName && e.name === skipName) continue;
      container.appendChild(makeRow(e, depth, base));
    }
  }

  // ── targeted in-place re-list of ONE folder (the IDE-style auto-update) ──
  // Add rows for new files, drop rows for removed ones, leave every other row +
  // all expansion untouched → no full repaint, no flicker. No-op when the folder
  // isn't currently rendered + visible, so writes in collapsed/hidden dirs cost nothing.
  async function relistFolder(dir) {
    const container = dirContainers.get(dir);
    if (!container || container.offsetParent === null) return; // not rendered / collapsed / hidden
    const depth = +(container.dataset.depth || 0);
    const base = +(container.dataset.base || 14);
    const skipName = container.dataset.skip;
    const entries = (await fsList(dir)).filter((e) => !(skipName && e.name === skipName));
    const want = new Set(entries.map((e) => e.path));
    const rowsNow = () => [...container.children].filter((n) => n.classList && n.classList.contains('xrow'));
    for (const r of rowsNow()) { // drop rows whose file is gone (+ its kids container)
      if (!want.has(r.dataset.path)) { const k = r.nextElementSibling; if (k && k.classList.contains('xkids')) k.remove(); r.remove(); }
    }
    // Re-place EVERY row in the host's sorted order (folders-first, then the folder's
    // mode). Existing DOM nodes are MOVED, not recreated — so expansion, selection and
    // git decorations survive; only genuinely-new files are built. Reordering (not just
    // insert-missing) is what makes a live sort-flip — or an mtime bump from a save —
    // visibly reorder folders AND files in place, with no full repaint and no manual
    // collapse/expand. (AI-58)
    const byPath = new Map(rowsNow().map((r) => [r.dataset.path, r]));
    let prev = null; // the last node placed (a row, or its trailing .xkids container)
    for (const e of entries) {
      const row = byPath.get(e.path) || makeRow(e, depth, base);
      const kids = (row.nextElementSibling && row.nextElementSibling.classList.contains('xkids')) ? row.nextElementSibling : null;
      if (prev) prev.after(row); else container.prepend(row); // moves an existing node into its new slot
      if (kids) row.after(kids); // keep an expanded folder's children directly beneath it
      prev = kids || row;
    }
    applyFilter();
  }

  // ── collapsible sections (state persisted in webview state) ──
  const st0 = (vscode.getState && vscode.getState()) || {};
  const collapsedSet = new Set(Array.isArray(st0.xCollapsed) ? st0.xCollapsed : ['FRAMEWORK']);
  const persistCollapsed = () => { const s = (vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { xCollapsed: [...collapsedSet] })); };
  // path/key → "ensure expanded" fn, for auto-reveal walking down to a file. Rebuilt each paint.
  const ensureExpand = new Map();

  // The AIOS mark (rounded square + offset inner square) for the AIOS group header.
  const MARK = '<svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><rect x="1" y="1" width="16" height="16" rx="2.4" fill="none" stroke="var(--accent)" stroke-width="1.5"/><rect x="9" y="2" width="6" height="6" rx="1" fill="var(--accent)"/></svg>';

  // A collapsible SECTION (FRAMEWORK / VAULT). `key` is the STABLE identity
  // (collapse state + ensureExpand + auto-reveal all key off it, English-fixed);
  // `label` is the translated text shown to the operator (AI-19).
  async function addSection(key, label, opts, buildBody, parent) {
    const head = el('div', 'xsect xsub' + (opts.primary ? ' xprimary' : ''));
    const car = el('span', 'xcaret'); head.appendChild(car);
    if (opts.dot) head.appendChild(el('span', 'xdot' + (opts.dot === 'ring' ? ' ring' : '')));
    head.appendChild(el('span', 'xsectlab', label));
    if (opts.sub) head.appendChild(el('span', 'xsectsub', opts.sub));
    if (opts.sortRoot) attachSortControl(head, opts.sortRoot); // per-folder sort on Vault/Framework (v2)
    const box = el('div', 'xsectbody');
    let collapsed = collapsedSet.has(key);
    const apply = () => { car.innerHTML = icon(collapsed ? 'chevR' : 'chevD', 11); box.style.display = collapsed ? 'none' : ''; };
    head.addEventListener('click', () => {
      collapsed = !collapsed;
      if (collapsed) collapsedSet.add(key); else collapsedSet.delete(key);
      persistCollapsed(); apply();
    });
    ensureExpand.set('sect:' + key, () => { if (collapsed) { collapsed = false; collapsedSet.delete(key); persistCollapsed(); apply(); } });
    (parent || explorerEl).append(head, box);
    apply();
    await buildBody(box);
  }

  // A top-level GROUP (AIOS / WORKSPACE) — the two "main things". AIOS carries the
  // mark + wordmark and holds Framework + Vault; Workspace holds added folders.
  async function addGroup(key, opts, buildBody) {
    const head = el('div', 'xgroup' + (opts.external ? ' xext' : ''));
    const car = el('span', 'xcaret'); head.appendChild(car);
    if (opts.mark) { const m = el('span', 'xmark'); m.innerHTML = MARK; head.appendChild(m); }
    head.appendChild(el('span', 'xglabel', opts.label));
    if (opts.sub) head.appendChild(el('span', 'xsectsub', opts.sub));
    if (opts.add) {
      const addB = el('button', 'xadd'); addB.type = 'button'; addB.title = NLS('files.addFolder', 'Add a folder to your workspace'); addB.textContent = '+';
      addB.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'addFolder' }); });
      head.appendChild(addB);
    }
    const box = el('div', 'xgroupbody');
    let collapsed = collapsedSet.has(key);
    const apply = () => { car.innerHTML = icon(collapsed ? 'chevR' : 'chevD', 11); box.style.display = collapsed ? 'none' : ''; };
    head.addEventListener('click', () => {
      collapsed = !collapsed;
      if (collapsed) collapsedSet.add(key); else collapsedSet.delete(key);
      persistCollapsed(); apply();
    });
    ensureExpand.set('group:' + key, () => { if (collapsed) { collapsed = false; collapsedSet.delete(key); persistCollapsed(); apply(); } });
    explorerEl.append(head, box);
    apply();
    await buildBody(box);
  }

  async function paintExplorer() {
    explorerEl.replaceChildren();
    ensureExpand.clear();
    dirContainers.clear();
    const framework = places.find((p) => p.id === 'infra');
    const vault = places.find((p) => p.id === 'vault');
    const workspace = places.filter((p) => p.id === 'workspace');

    // AIOS — the framework itself: Framework + Vault, nested under one collapsible mark.
    await addGroup('AIOS', { mark: true, label: 'AIOS' }, async (g) => {
      if (framework && (!vault || framework.path !== vault.path)) {
        await addSection('FRAMEWORK', NLS('files.section.framework', 'FRAMEWORK'), { dot: 'ring', sub: NLS('files.sub.frameworkInfra', 'AIOS infra'), sortRoot: framework.path }, (box) => buildTree(framework.path, box, 0, "vault", 14), g);
      }
      if (vault) {
        await addSection('VAULT', NLS('files.section.vault', 'VAULT'), { dot: 'solid', sub: NLS('files.sub.yourNotes', 'your notes'), primary: true, sortRoot: vault.path }, (box) => buildTree(vault.path, box, 0, null, 14), g);
      }
    });

    // WORKSPACE — external folders you add (repos, drives), each removable — not AIOS.
    await addGroup('WORKSPACE', { external: true, label: NLS('files.group.workspace', 'WORKSPACE'), sub: NLS('files.sub.external', 'external'), add: true }, async (g) => {
      for (const w of workspace) {
        const fh = el('div', 'xrow dir xroot');
        fh.dataset.path = w.path; // wire the folder row for git status (the yellow-dot marker)
        fh.style.paddingLeft = '14px'; // match the Vault/Framework top-level folder indent (was 10 — read as a section, not a folder)
        const ic = el('span', 'xicon'); ic.innerHTML = icon('chevR', 11);
        const nm = el('span', 'xname', w.label);
        fh.append(ic, nm);
        attachSortControl(fh, w.path); // hover-reveal per-folder sort (v2)
        const rm = el('span', 'xrm'); rm.title = NLS('files.removeFolder', 'Remove from workspace'); rm.textContent = '×';
        rm.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'removeFolder', path: w.path }); });
        fh.append(rm);
        g.appendChild(fh);
        attachCtx(fh, w.path); attachDrag(fh, w.path);
        let kids = null;
        const ensure = async () => {
          if (!kids) { kids = el('div', 'xkids'); kids.style.setProperty('--g', '21px'); fh.after(kids); ic.innerHTML = icon('chevD', 11); await buildTree(w.path, kids, 0, null, 23); applyFilter(); }
          else if (kids.style.display === 'none') { kids.style.display = ''; ic.innerHTML = icon('chevD', 11); }
        };
        ensureExpand.set(w.path, ensure);
        fh.addEventListener('click', async (ev) => {
          if (ev.altKey) { vscode.postMessage({ type: 'pathToTerminal', path: w.path }); return; }
          select(fh);
          if (kids && kids.style.display !== 'none') { kids.style.display = 'none'; ic.innerHTML = icon('chevR', 11); }
          else await ensure();
        });
      }
      if (!workspace.length) g.appendChild(el('div', 'xempty', NLS('files.empty', 'Add a folder (a repo, a Drive folder) to navigate it here.')));
    });

    vscode.postMessage({ type: 'requestGit' }); // immediate git colors after (re)paint
    applyFilter();
  }

  const findRow = (p) => { for (const r of explorerEl.querySelectorAll('.xrow[data-path]')) if (r.dataset.path === p) return r; return null; };

  // ── auto-reveal: expand the section + ancestor folders down to a file, then select it ──
  async function revealPath(abs) {
    const place = places.find((p) => abs === p.path || abs.startsWith(p.path + '/'));
    if (!place) return;
    if (place.id === 'workspace') { await ensureExpand.get('group:WORKSPACE')?.(); await ensureExpand.get(place.path)?.(); }
    else { await ensureExpand.get('group:AIOS')?.(); await ensureExpand.get('sect:' + (place.id === 'infra' ? 'FRAMEWORK' : 'VAULT'))?.(); }
    const parts = abs.slice(place.path.length + 1).split('/').filter(Boolean);
    let acc = place.path;
    for (let i = 0; i < parts.length - 1; i++) { acc += '/' + parts[i]; const fn = ensureExpand.get(acc); if (fn) await fn(); }
    const target = findRow(abs);
    if (target) { select(target); target.scrollIntoView({ block: 'nearest' }); }
  }

  // ── collapse-all (title-bar ⊟): fold the INNER folders only — the AIOS / FRAMEWORK
  //    / VAULT / WORKSPACE headers keep whatever expanded/collapsed state they had ──
  function collapseAll() {
    explorerEl.querySelectorAll('.xrow.dir').forEach((row) => {
      const n = row.nextElementSibling;
      if (n && n.classList.contains('xkids') && n.style.display !== 'none') {
        n.style.display = 'none';
        const ic = row.querySelector('.xicon'); if (ic) ic.innerHTML = icon('chevR', 11);
      }
    });
  }

  // ── refresh: re-read the tree (pick up new/removed files) while keeping the SAME
  //    folders expanded + the same row selected. The tree is lazy and out-of-workspace
  //    watchers are unreliable, so this is how added files surface (button + on-focus). ──
  let refreshing = false;
  async function refreshTree() {
    if (refreshing || !places.length) return; // skip overlap + the pre-paint initial load
    refreshing = true;
    try {
      const open = [...explorerEl.querySelectorAll('.xrow.dir[data-path]')]
        .filter((r) => { const n = r.nextElementSibling; return n && n.classList.contains('xkids') && n.style.display !== 'none'; })
        .map((r) => r.dataset.path);
      const sel = explorerEl.querySelector('.xrow.sel')?.dataset.path;
      await paintExplorer();
      // re-expand shallow→deep so each parent registers its children's ensure first
      for (const p of open.sort((a, b) => a.split('/').length - b.split('/').length)) { const fn = ensureExpand.get(p); if (fn) await fn(); }
      if (sel) { const r = findRow(sel); if (r) select(r); }
    } finally { refreshing = false; }
  }

  // ── filter: show rows whose name matches + their ancestors ──
  let filterQ = '';
  let searchExpanded = false;     // tree fully expanded for the current search
  let expanding = false;          // guards re-entrant expandAll while typing
  const filterInput = document.getElementById('xfilterInput');
  const filterClear = document.getElementById('xfClear');

  // A real search has to see the WHOLE tree, not just what's rendered. Expand every
  // group/section + recurse all folders (lazy tree → expand-until-stable), so buried
  // matches surface. Bounded; runs once when search opens, not per keystroke.
  async function expandAll() {
    if (expanding) return; expanding = true;
    try {
      for (const key of ['group:AIOS', 'group:WORKSPACE', 'sect:FRAMEWORK', 'sect:VAULT']) { const f = ensureExpand.get(key); if (f) await f(); }
      for (let guard = 0; guard < 80; guard++) {
        const closed = [...explorerEl.querySelectorAll('.xrow.dir[data-path]')].filter((r) => {
          const n = r.nextElementSibling; return !(n && n.classList.contains('xkids') && n.style.display !== 'none');
        });
        if (!closed.length) break;
        for (const r of closed) { const f = ensureExpand.get(r.dataset.path); if (f) await f(); }
      }
    } finally { expanding = false; }
  }

  function applyFilter() {
    const rows = [...explorerEl.querySelectorAll('.xrow[data-path]')];
    if (!filterQ) { rows.forEach((r) => r.classList.remove('fhide')); return; }
    const matches = new Set();
    for (const r of rows) { if ((r.dataset.path.split('/').pop() || '').toLowerCase().includes(filterQ)) matches.add(r.dataset.path); }
    rows.forEach((r) => {
      const p = r.dataset.path;
      const keep = matches.has(p) || [...matches].some((m) => m.startsWith(p + '/'));
      r.classList.toggle('fhide', !keep);
    });
  }

  filterInput.addEventListener('input', async () => {
    filterQ = filterInput.value.trim().toLowerCase();
    filterClear.hidden = !filterInput.value;
    if (filterQ) { if (!searchExpanded) { searchExpanded = true; await expandAll(); } applyFilter(); }
    else { searchExpanded = false; await paintExplorer(); } // cleared → tidy default tree back
  });
  const clearFilter = async () => { filterInput.value = ''; filterQ = ''; filterClear.hidden = true; searchExpanded = false; await paintExplorer(); filterInput.focus(); };
  filterClear.addEventListener('click', clearFilter);
  filterInput.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && filterInput.value) { ev.preventDefault(); void clearFilter(); } });

  // ── keyboard nav: movement starts from the SELECTED (clicked) row ──
  const visibleRows = () => [...explorerEl.querySelectorAll('.xrow')].filter((r) => r.offsetParent !== null && !r.classList.contains('fhide'));
  const isOpen = (row) => { const n = row.nextElementSibling; return n && n.classList.contains('xkids') && n.style.display !== 'none'; };
  const moveSel = (row) => { if (!row) return; select(row); row.scrollIntoView({ block: 'nearest' }); };
  explorerEl.addEventListener('keydown', (ev) => {
    const rows = visibleRows(); if (!rows.length) return;
    const sel = explorerEl.querySelector('.xrow.sel'); // anchor = the clicked/selected row
    const i = sel ? rows.indexOf(sel) : -1;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveSel(rows[Math.min(rows.length - 1, i + 1)] || rows[0]); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveSel(i <= 0 ? rows[0] : rows[i - 1]); }
    else if (ev.key === 'Enter') { if (sel) { ev.preventDefault(); sel.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey })); } } // ⌘-Enter → source
    else if (ev.key === 'ArrowRight') { if (sel && sel.classList.contains('dir')) { ev.preventDefault(); if (!isOpen(sel)) sel.click(); else moveSel(rows[i + 1]); } }
    else if (ev.key === 'ArrowLeft') {
      if (!sel) return; ev.preventDefault();
      if (sel.classList.contains('dir') && isOpen(sel)) sel.click();
      else { const pp = sel.dataset.path; const parent = pp && findRow(pp.slice(0, pp.lastIndexOf('/'))); if (parent) moveSel(parent); }
    }
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'listing') { const r = pending.get(msg.reqId); if (r) r(msg.entries || []); } // r() deletes from pending
    else if (msg.type === 'roots') {
      if (msg.theme) applyTheme(msg.theme); applyHints(msg.hints);
      if (msg.iconsEnhanced != null) iconsEnhanced = msg.iconsEnhanced;
      places = msg.places || [];
      if (msg.master) master = msg.master;           // the global default sort
      if (msg.overrides) overrides = msg.overrides;   // per-folder overrides (any depth)
      // Await the repaint, then reveal a just-added folder (msg.focus) — expands the
      // WORKSPACE group to it + selects it, so adding a folder gives instant feedback.
      paintExplorer().then(() => { if (msg.focus) void revealPath(msg.focus); });
    }
    else if (msg.type === 'theme') { applyTheme(msg.theme); }
    else if (msg.type === 'hints') { applyHints(msg.show); }
    else if (msg.type === 'icons') { iconsEnhanced = !!msg.enhanced; void paintExplorer(); }
    else if (msg.type === 'git') { applyGit(msg.files, msg.dirty, msg.repos); }
    else if (msg.type === 'reload') { void paintExplorer(); }
    else if (msg.type === 'revealPath') { void revealPath(msg.path); }
    else if (msg.type === 'collapseAll') { collapseAll(); }
    else if (msg.type === 'refresh') { void refreshTree(); }
    else if (msg.type === 'sortChanged') {
      // Re-list the affected dirs IN PLACE (relistFolder reorders) — folders reorder live,
      // no repaint, no collapse/expand. Collapsed dirs no-op and re-fetch fresh on next expand.
      if (msg.all) {
        // MASTER change — the host cleared every override; the whole tree re-sorts.
        master = msg.master || master; overrides = {};
        explorerEl.querySelectorAll('.xsort.active').forEach((sb) => sb.classList.remove('active'));
        for (const d of [...dirContainers.keys()]) void relistFolder(d);
      } else {
        // per-folder override on msg.root — only its subtree re-sorts.
        overrides[msg.root] = msg.mode;
        updateSortActive(msg.root);
        const root = msg.root;
        for (const d of [...dirContainers.keys()]) { if (d === root || d.startsWith(root + '/')) void relistFolder(d); }
      }
    }
    else if (msg.type === 'relist') { for (const d of (msg.dirs || [])) void relistFolder(d); } // targeted auto-update
  });

  vscode.postMessage({ type: 'ready' });
