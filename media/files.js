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

  // ── theme (no toggle here — the explorer follows the shared aiosGlass.theme) ──
  const applyTheme = (t) => document.body.classList.toggle('light', t === 'light');

  // ── fs bridge: postMessage round-trip exposed as an awaitable, so the tree can
  //    recurse the same way a synchronous fs would. Each request carries a reqId
  //    the extension echoes back on its listing reply. ──
  let reqSeq = 0;
  const pending = new Map();
  function fsList(dir) {
    return new Promise((resolve) => { const id = ++reqSeq; pending.set(id, resolve); vscode.postMessage({ type: 'list', dir, reqId: id }); });
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
      const row = el('div', 'xrow' + (e.dir ? ' dir' : ''));
      row.style.paddingLeft = (8 + depth * 13) + 'px';
      const ic = el('span', 'xicon'); ic.innerHTML = e.dir ? icon('chevR', 11) : icon('file', 12);
      const nm = el('span', 'xname');
      const pm = e.dir ? e.name.match(/^(\d+ - )(.+)$/) : null; // dim the "00 - " ordering prefix
      if (pm) { nm.append(el('span', 'xpre', pm[1]), document.createTextNode(pm[2])); }
      else nm.textContent = e.dir ? e.name : e.name.replace(/\.md$/i, '');
      row.append(ic, nm);
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
    else if (msg.type === 'roots') { if (msg.theme) applyTheme(msg.theme); places = msg.places || []; void paintExplorer(); }
    else if (msg.type === 'theme') { applyTheme(msg.theme); }
  });

  vscode.postMessage({ type: 'ready' });
