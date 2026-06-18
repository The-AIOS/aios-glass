  const vscode = acquireVsCodeApi();
  const explorerEl = document.getElementById('explorer');
  let places = [];

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
    return new Promise((resolve) => { const id = ++reqSeq; pending.set(id, resolve); vscode.postMessage({ type: 'list', dir, reqId: id }); });
  }

  // ── live git: reconcile status onto every rendered row (no re-expand) ──
  function applyGit(filesMap, dirtyList) {
    const files = filesMap || {};
    const dirty = new Set(dirtyList || []);
    explorerEl.querySelectorAll('.xrow[data-path]').forEach((row) => {
      const p = row.dataset.path;
      const isDir = row.classList.contains('dir');
      const code = files[p] || (isDir && dirty.has(p) ? 'M' : undefined);
      row.classList.remove('gM', 'gU', 'gA', 'gD', 'gR');
      const old = row.querySelector('.gst'); if (old) old.remove();
      if (code) { row.classList.add('g' + code); row.append(el('span', 'gst', code)); }
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
  const ctxReveal = document.getElementById('ctxReveal');
  let ctxPath = '';
  const hideCtx = () => { ctx.hidden = true; };
  function attachCtx(row, p) {
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ctxPath = p;
      ctx.hidden = false;
      ctx.style.left = Math.min(ev.clientX, window.innerWidth - 162) + 'px';
      ctx.style.top = Math.min(ev.clientY, window.innerHeight - 48) + 'px';
    });
  }
  ctxReveal.addEventListener('click', () => { if (ctxPath) vscode.postMessage({ type: 'reveal', path: ctxPath }); hideCtx(); });
  window.addEventListener('click', hideCtx);
  window.addEventListener('blur', hideCtx);
  window.addEventListener('scroll', hideCtx, true);

  // ── the tree — lazy: a folder lists its children only on first expand ──
  async function buildTree(absDir, container, depth, skip) {
    const entries = await fsList(absDir);
    for (const e of entries) {
      if (skip && skip(e.name)) continue;
      const row = el('div', 'xrow' + (e.dir ? ' dir' : '') + (e.git ? ' g' + e.git : ''));
      row.dataset.path = e.path; // lets live git pushes find + recolor this row
      row.style.paddingLeft = (6 + depth * 12) + 'px';
      const ic = el('span', 'xicon'); ic.innerHTML = e.dir ? icon('chevR', 11) : fileIconSvg(e.name);
      const nm = el('span', 'xname');
      const pm = e.dir ? e.name.match(/^(\d+ - )(.+)$/) : null; // dim the "00 - " ordering prefix
      if (pm) { nm.append(el('span', 'xpre', pm[1]), document.createTextNode(pm[2])); }
      else nm.textContent = e.dir ? e.name : e.name.replace(/\.md$/i, '');
      row.append(ic, nm);
      if (e.git) row.append(el('span', 'gst', e.git)); // git status letter (M/U/A/D/R)
      container.appendChild(row);
      attachCtx(row, e.path);
      if (e.dir) {
        let kids = null;
        row.addEventListener('click', async () => {
          select(row);
          if (!kids) { kids = el('div'); row.after(kids); ic.innerHTML = icon('chevD', 11); await buildTree(e.path, kids, depth + 1); }
          else { const open = kids.style.display !== 'none'; kids.style.display = open ? 'none' : ''; ic.innerHTML = icon(open ? 'chevR' : 'chevD', 11); }
        });
      } else {
        row.addEventListener('click', () => { select(row); vscode.postMessage({ type: 'open', file: e.path, source: false }); });
      }
    }
  }

  // ── collapsible sections (state persisted in webview state) ──
  const st0 = (vscode.getState && vscode.getState()) || {};
  const collapsedSet = new Set(Array.isArray(st0.xCollapsed) ? st0.xCollapsed : ['FRAMEWORK']);
  const persistCollapsed = () => { const s = (vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { xCollapsed: [...collapsedSet] })); };

  async function addSection(label, opts, buildBody) {
    const head = el('div', 'xsect' + (opts.primary ? ' xprimary' : '') + (opts.external ? ' xext' : ''));
    const car = el('span', 'xcaret'); head.appendChild(car);
    if (opts.dot) { head.appendChild(el('span', 'xdot' + (opts.dot === 'ring' ? ' ring' : ''))); }
    head.appendChild(el('span', 'xsectlab', label));
    if (opts.sub) head.appendChild(el('span', 'xsectsub', opts.sub));
    if (opts.add) {
      const addB = el('button', 'xadd'); addB.type = 'button'; addB.title = 'Add a folder to your workspace'; addB.textContent = '+';
      addB.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'addFolder' }); });
      head.appendChild(addB);
    }
    const box = el('div', 'xsectbody');
    let collapsed = collapsedSet.has(label);
    const apply = () => { car.innerHTML = icon(collapsed ? 'chevR' : 'chevD', 11); box.style.display = collapsed ? 'none' : ''; };
    head.addEventListener('click', () => {
      collapsed = !collapsed;
      if (collapsed) collapsedSet.add(label); else collapsedSet.delete(label);
      persistCollapsed(); apply();
    });
    explorerEl.append(head, box);
    apply();
    await buildBody(box); // built once; hidden when collapsed (deeper levels stay lazy)
  }

  async function paintExplorer() {
    explorerEl.querySelectorAll('.xsect, .xsectbody').forEach((n) => n.remove()); // keep the title
    const framework = places.find((p) => p.id === 'infra');
    const vault = places.find((p) => p.id === 'vault');
    const workspace = places.filter((p) => p.id === 'workspace');

    // FRAMEWORK — the AIOS itself; its own `vault/` folder lives in the VAULT section below
    if (framework && (!vault || framework.path !== vault.path)) {
      await addSection('FRAMEWORK', { dot: 'ring', sub: 'AIOS infra' }, (box) => buildTree(framework.path, box, 0, (n) => n === 'vault'));
    }
    // VAULT — your notes, the primary surface (brightest)
    if (vault) {
      await addSection('VAULT', { dot: 'solid', sub: 'your notes', primary: true }, (box) => buildTree(vault.path, box, 0));
    }
    // WORKSPACE — external folders you add (repos, drives), each removable — not AIOS
    await addSection('WORKSPACE', { external: true, sub: 'external', add: true }, async (box) => {
      for (const w of workspace) {
        const fh = el('div', 'xrow dir xroot');
        const ic = el('span', 'xicon'); ic.innerHTML = icon('chevR', 11);
        const nm = el('span', 'xname', w.label);
        const rm = el('span', 'xrm'); rm.title = 'Remove from workspace'; rm.textContent = '×';
        rm.addEventListener('click', (ev) => { ev.stopPropagation(); vscode.postMessage({ type: 'removeFolder', path: w.path }); });
        fh.append(ic, nm, rm);
        box.appendChild(fh);
        attachCtx(fh, w.path);
        let kids = null;
        fh.addEventListener('click', async () => {
          select(fh);
          if (!kids) { kids = el('div'); fh.after(kids); ic.innerHTML = icon('chevD', 11); await buildTree(w.path, kids, 1); }
          else { const open = kids.style.display !== 'none'; kids.style.display = open ? 'none' : ''; ic.innerHTML = icon(open ? 'chevR' : 'chevD', 11); }
        });
      }
      if (!workspace.length) box.appendChild(el('div', 'xempty', 'Add a folder (a repo, a Drive folder) to navigate it here.'));
    });
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'listing') { const r = pending.get(msg.reqId); if (r) { pending.delete(msg.reqId); r(msg.entries || []); } }
    else if (msg.type === 'roots') { if (msg.theme) applyTheme(msg.theme); applyHints(msg.hints); if (msg.iconsEnhanced != null) iconsEnhanced = msg.iconsEnhanced; places = msg.places || []; void paintExplorer(); }
    else if (msg.type === 'theme') { applyTheme(msg.theme); }
    else if (msg.type === 'hints') { applyHints(msg.show); }
    else if (msg.type === 'icons') { iconsEnhanced = !!msg.enhanced; void paintExplorer(); }
    else if (msg.type === 'git') { applyGit(msg.files, msg.dirty); }
  });

  vscode.postMessage({ type: 'ready' });
