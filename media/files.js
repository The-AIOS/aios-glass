  const vscode = acquireVsCodeApi();
  let places = [];      // [{id,label,sub,path}]
  let place = null;     // the active place object
  let dir = '';         // current absolute directory
  let crumbs = [];      // [{label,path}] from the extension

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // ── icons (inline SVG, currentColor) ──────────────────────────────────────
  const SVG = {
    folder: '<svg viewBox="0 0 48 48" width="46" height="46" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 13a3 3 0 0 1 3-3h11l4 5h16a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" fill="currentColor" fill-opacity=".1"/></svg>',
    file: '<svg viewBox="0 0 48 48" width="42" height="42" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 5h15l9 9v26a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" fill="currentColor" fill-opacity=".07"/><path d="M28 5v9h9"/></svg>',
    vault: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5Z"/><path d="M8 3v17"/></svg>',
    infra: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
    workspace: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  };

  // ── theme ────────────────────────────────────────────────────────────────
  function applyTheme(t){ document.body.classList.toggle('light', t === 'light'); }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    vscode.postMessage({ type: 'setTheme', theme: next });
  });

  // ── navigation requests ────────────────────────────────────────────────────
  function listDir(target){
    if (!place) return;
    dir = target;
    vscode.postMessage({ type: 'list', dir: target, root: place.path, rootLabel: place.label });
  }
  function selectPlace(p){
    place = p;
    document.querySelectorAll('.place').forEach((el) => el.classList.toggle('on', el.dataset.path === p.path));
    listDir(p.path);
  }

  // ── places sidebar ─────────────────────────────────────────────────────────
  function renderPlaces(){
    const list = document.getElementById('placeList');
    list.innerHTML = places.map((p) => {
      const ic = SVG[p.id] || SVG.workspace;
      const rm = p.id === 'workspace'
        ? '<button class="prm" data-rm="' + esc(p.path) + '" title="Remove from Files" aria-label="Remove from Files">×</button>' : '';
      // a div (not a button): the workspace remove control is a nested button,
      // and nested <button>s are invalid HTML (the browser un-nests them).
      return '<div class="place" role="button" tabindex="0" data-path="' + esc(p.path) + '">'
        + '<span class="picon">' + ic + '</span>'
        + '<span class="pbody"><span class="plabel">' + esc(p.label) + '</span><span class="psub">' + esc(p.sub) + '</span></span>'
        + rm + '</div>';
    }).join('');
    list.querySelectorAll('.place').forEach((el) => {
      const go = (ev) => {
        if (ev.target.closest('.prm')) { vscode.postMessage({ type: 'removeFolder', path: ev.target.closest('.prm').dataset.rm }); return; }
        const p = places.find((x) => x.path === el.dataset.path);
        if (p) selectPlace(p);
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
    });
  }

  // ── breadcrumb ───────────────────────────────────────────────────────────
  function renderCrumbs(){
    const nav = document.getElementById('crumbs');
    nav.innerHTML = crumbs.map((c, i) => {
      const cur = i === crumbs.length - 1;
      const btn = '<button class="crumb' + (cur ? ' cur' : '') + '" data-path="' + esc(c.path) + '">' + esc(c.label) + '</button>';
      return i ? '<span class="csep">/</span>' + btn : btn;
    }).join('');
    nav.querySelectorAll('.crumb:not(.cur)').forEach((el) =>
      el.addEventListener('click', () => listDir(el.dataset.path)));
    const up = document.getElementById('up');
    up.disabled = crumbs.length < 2;
  }

  // ── grid ─────────────────────────────────────────────────────────────────
  function renderGrid(entries){
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    empty.style.display = entries.length ? 'none' : '';
    grid.innerHTML = entries.map((e) => {
      if (e.dir){
        const m = e.name.match(/^(\d+ - )(.+)$/); // dim the "00 - " ordering prefix
        const label = m ? '<span class="pre">' + esc(m[1]) + '</span>' + esc(m[2]) : esc(e.name);
        return '<button class="tile dir" role="button" data-dir="' + esc(e.path) + '">'
          + '<span class="ic">' + SVG.folder + '</span><span class="label">' + label + '</span></button>';
      }
      const ext = (e.ext || '').slice(0, 4);
      const chip = ext ? '<span class="ext ' + esc(e.ext) + '">' + esc(ext) + '</span>' : '';
      const name = /\.md$/i.test(e.name) ? e.name.replace(/\.md$/i, '') : e.name;
      return '<button class="tile file" role="button" data-file="' + esc(e.path) + '">'
        + '<span class="ic">' + SVG.file + '</span>' + chip + '<span class="label">' + esc(name) + '</span></button>';
    }).join('');
    grid.querySelectorAll('.tile').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (el.dataset.dir) listDir(el.dataset.dir);
        else if (el.dataset.file) vscode.postMessage({ type: 'open', file: el.dataset.file, source: ev.metaKey || ev.ctrlKey });
      });
    });
  }

  // ── toolbar ────────────────────────────────────────────────────────────────
  document.getElementById('up').addEventListener('click', () => { if (crumbs.length > 1) listDir(crumbs[crumbs.length - 2].path); });
  document.getElementById('revealOS').addEventListener('click', () => { if (dir) vscode.postMessage({ type: 'reveal', path: dir }); });
  document.getElementById('addFolder').addEventListener('click', () => vscode.postMessage({ type: 'addFolder' }));

  // ── inbound messages ───────────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'roots'){
      if (msg.theme) applyTheme(msg.theme);
      places = msg.places || [];
      renderPlaces();
      // Pick: a just-added folder, else the current place if it still exists, else the first.
      let next = msg.focus ? places.find((p) => p.path === msg.focus) : null;
      if (!next && place) next = places.find((p) => p.path === place.path);
      if (!next) next = places[0];
      if (next) selectPlace(next);
      else { document.getElementById('crumbs').innerHTML = ''; renderGrid([]); }
    } else if (msg.type === 'listing'){
      if (msg.dir !== dir) return; // stale response (navigated on); ignore
      crumbs = msg.crumbs || [];
      renderCrumbs();
      renderGrid(msg.entries || []);
    } else if (msg.type === 'theme'){
      applyTheme(msg.theme);
    }
  });

  vscode.postMessage({ type: 'ready' });
