  const vscode = acquireVsCodeApi();
  let cur = { year: 0, month: 0 };
  const killed = new Set();  // pids killed via 🗑, filtered from the list until the registry confirms
  // View persists across reloads (webview state, like collapsed cards). On a
  // week-view restore, weekIdx -1 makes the first render pick today's week.
  let calView = ((((vscode.getState && vscode.getState()) || {}).calView) === 'week') ? 'week' : 'month';
  let weekIdx = calView === 'week' ? -1 : 0; // -1 → render() picks today's week
  let lastData = null;     // last month payload, for re-render on toggle/week-nav
  document.getElementById('calToggle').textContent = calView === 'month' ? 'Week' : 'Month';
  let pendingWeek = null;  // 'first' | 'last' — pick edge week after a cross-month nav
  const run = (command, ...args) => vscode.postMessage({ type: 'cmd', command, args });

  document.querySelectorAll('[data-ritual]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ type: 'ritual', name: b.getAttribute('data-ritual') })));
  document.querySelectorAll('[data-doc]').forEach((b) =>
    b.addEventListener('click', (ev) => run('aios.openDoc', b.getAttribute('data-doc'), ev.metaKey || ev.ctrlKey)));
  document.querySelectorAll('[data-create]').forEach((b) =>
    b.addEventListener('click', () => run('aios.createCustom', b.getAttribute('data-create'))));

  // Density toggle (comfortable ⇄ compact) — persisted in webview state.
  const densityBtn = document.getElementById('density');
  function applyDensity(c){ document.body.classList.toggle('compact', !!c); densityBtn.classList.toggle('active', !!c); }
  applyDensity(((vscode.getState && vscode.getState()) || {}).compact);
  densityBtn.addEventListener('click', () => {
    const c = !document.body.classList.contains('compact');
    applyDensity(c);
    vscode.setState(Object.assign({}, (vscode.getState && vscode.getState()) || {}, { compact: c }));
  });

  // Collapsible cards — click a title to fold/unfold; persisted in webview state.
  const cstate0 = (vscode.getState && vscode.getState()) || {};
  const collapsed = new Set(cstate0.collapsed || []);
  function persistCollapsed(){ const s = (vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { collapsed: Array.from(collapsed) })); }
  const titleEls = Array.from(document.querySelectorAll('.card .ctitle'));
  function setCollapsed(card, key, on){ card.classList.toggle('collapsed', on); if (on) collapsed.add(key); else collapsed.delete(key); persistCollapsed(); }
  titleEls.forEach((ct) => {
    const card = ct.closest('.card');
    // Stable identity BEFORE injecting the move buttons (textContent would drift).
    const key = (ct.textContent || '').trim().slice(0, 40);
    card.dataset.key = key;
    ct.tabIndex = 0;
    ct.setAttribute('role', 'button');
    if (collapsed.has(key)) card.classList.add('collapsed');
    ct.addEventListener('click', () => setCollapsed(card, key, !card.classList.contains('collapsed')));
    // ↑↓ move buttons — every card except the pinned Daily (hero).
    if (!card.classList.contains('hero')){
      const mv = document.createElement('span');
      mv.className = 'cmove';
      mv.innerHTML = '<button data-mv="-1" title="Move card up" aria-label="Move card up">↑</button><button data-mv="1" title="Move card down" aria-label="Move card down">↓</button>';
      mv.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('button'); if (b) moveCard(card, Number(b.getAttribute('data-mv'))); });
      ct.appendChild(mv);
    }
    ct.addEventListener('keydown', (e) => {
      // Alt+arrows MOVE the card; plain arrows navigate (recomputed in DOM order,
      // so navigation follows reorders).
      if (e.altKey && e.key === 'ArrowUp'){ e.preventDefault(); if (!card.classList.contains('hero')) moveCard(card, -1); }
      else if (e.altKey && e.key === 'ArrowDown'){ e.preventDefault(); if (!card.classList.contains('hero')) moveCard(card, 1); }
      else if (e.key === 'ArrowDown'){ e.preventDefault(); const ts = Array.from(document.querySelectorAll('.card .ctitle')); const ci = ts.indexOf(ct); (ts[ci + 1] || ts[0]).focus(); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); const ts = Array.from(document.querySelectorAll('.card .ctitle')); const ci = ts.indexOf(ct); (ts[ci - 1] || ts[ts.length - 1]).focus(); }
      else if (e.key === 'ArrowRight'){ e.preventDefault(); setCollapsed(card, key, false); }
      else if (e.key === 'ArrowLeft'){ e.preventDefault(); setCollapsed(card, key, true); }
      else if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setCollapsed(card, key, !card.classList.contains('collapsed')); }
    });
  });

  // ── Card reordering ── the 1-column stacking (col1→col2→col3) is the canonical
  // order; moving across a column boundary reparents the card, which is the
  // operator's explicit choice. Daily (hero) is pinned: excluded from the movable
  // list, and since it precedes the first movable slot, nothing can pass above it.
  const movableCards = () => Array.from(document.querySelectorAll('.card')).filter((c) => !c.classList.contains('hero'));
  function persistOrder(){ const s = (vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { cardOrder: movableCards().map((c) => c.dataset.key) })); }
  function moveCard(card, dir){
    const list = movableCards();
    const i = list.indexOf(card);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ref = list[j];
    if (dir < 0) ref.parentNode.insertBefore(card, ref);
    else ref.parentNode.insertBefore(card, ref.nextSibling);
    persistOrder();
    const t = card.querySelector('.ctitle'); if (t) t.focus();
  }
  // Boot-apply the saved order. Only moves what's out of place — a never-reordered
  // panel keeps its curated default layout untouched. Cards added by future
  // versions (unknown keys) keep their natural slot at the end.
  (function applyOrder(){
    const saved = cstate0.cardOrder || [];
    if (!saved.length) return;
    const domKeys = movableCards().map((c) => c.dataset.key);
    const target = saved.filter((k) => domKeys.includes(k)).concat(domKeys.filter((k) => !saved.includes(k)));
    for (let i = 0; i < target.length; i++){
      const cur = movableCards();
      if (cur[i].dataset.key !== target[i]){
        const node = cur.find((c) => c.dataset.key === target[i]);
        if (node) cur[i].parentNode.insertBefore(node, cur[i]);
      }
    }
  })();
  // Minimize / expand ALL cards (⌘⌥G M): if any is open, collapse all; else expand all.
  function toggleAllCards(){
    const titles = Array.from(document.querySelectorAll('.card .ctitle'));
    const anyOpen = titles.some((ct) => !ct.closest('.card').classList.contains('collapsed'));
    titles.forEach((ct) => {
      const card = ct.closest('.card'); const key = card.dataset.key || '';
      if (anyOpen) { card.classList.add('collapsed'); collapsed.add(key); }
      else { card.classList.remove('collapsed'); collapsed.delete(key); }
    });
    persistCollapsed();
  }

  document.getElementById('frequentMenu').addEventListener('click', () => run('aios.frequentMenu'));
  document.getElementById('ingestQuick').addEventListener('click', () => run('aios.ingest'));
  document.getElementById('onboard').addEventListener('click', () => run('aios.onboarding'));
  // Dismiss is session-scoped: held in memory (not persisted), so it survives
  // view-switches (retainContextWhenHidden) but a window reload brings the nudge
  // back. Keyed by kind, so dismissing the morning nudge never suppresses the
  // evening close-day one. The cog "Ritual nudges" toggle is the permanent off.
  const nudgeDismissed = new Set();
  function renderNudge(n){
    const card=document.getElementById('nudgeCard'), act=document.getElementById('nudgeAction');
    if(!n || nudgeDismissed.has(n.kind)){ card.style.display='none'; act.dataset.kind=''; return; }
    act.textContent='';
    const ic=document.createElement('span'); ic.className='nicon'; ic.textContent=n.icon + ' '; act.append(ic);
    if(n.cmdLabel){ const b=document.createElement('b'); b.textContent=n.cmdLabel; act.append(b, document.createTextNode(' ')); }
    act.append(document.createTextNode(n.label));
    act.dataset.kind = n.kind;
    act.dataset.command = n.command || '';
    act.title = n.command ? ('Run ' + n.command) : '';
    card.style.display='';
  }
  document.getElementById('nudgeAction').addEventListener('click', (e) => {
    const k=e.currentTarget.dataset.kind, cmd=e.currentTarget.dataset.command;
    if(k==='sessions') vscode.postMessage({ type:'ritual', name:'close-session' });
    else if(cmd) vscode.postMessage({ type:'nudgeRun', command:cmd });
  });
  document.getElementById('nudgeDismiss').addEventListener('click', () => {
    const k=document.getElementById('nudgeAction').dataset.kind;
    if(k) nudgeDismissed.add(k);
    document.getElementById('nudgeCard').style.display='none';
  });
  document.getElementById('learnList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-file')) run('aios.openLearning', it.getAttribute('data-file'), Number(it.getAttribute('data-line')) || 0);
  });
  document.getElementById('outputList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-path')) run('aios.openOutput', it.getAttribute('data-path'), ev.metaKey || ev.ctrlKey);
  });
  document.getElementById('genReport').addEventListener('click', () => run('aios.reports'));
  document.getElementById('reportList').addEventListener('click', (ev) => {
    const it = ev.target.closest('.learnitem');
    if (it && it.getAttribute('data-path')) run('aios.openOutput', it.getAttribute('data-path'), ev.metaKey || ev.ctrlKey);
  });
  document.getElementById('goWithAgents').addEventListener('click', () => run('aios.goWithAgents'));

  // Click (or Enter) a running-session row → reveal its terminal. Delegated so
  // it survives the list re-rendering on every refresh.
  const runningList = document.getElementById('runningList');
  if (runningList) {
    const itemNP = (el) => ({ n: el.getAttribute('data-name'), p: Number(el.getAttribute('data-pid')) || undefined });
    const reveal = (el) => { if (!el) return; const { n, p } = itemNP(el); if (n) run('aios.revealAgent', n, p); };
    runningList.addEventListener('click', (ev) => {
      const item = ev.target.closest('.runitem'); if (!item) return;
      if (ev.target.closest('.runint')) { const { n, p } = itemNP(item); if (n) run('aios.interruptAgent', n, p); return; }
      if (ev.target.closest('.runclose')) { const { n, p } = itemNP(item); if (n) run('aios.closeSessionAgent', n, p); return; }
      if (ev.target.closest('.runkill')) { const { n, p } = itemNP(item); if (n) { if (p) killed.add(p); run('aios.closeAgent', n, p); item.remove(); applyRunOpen(); } return; }
      reveal(item);
    });
    runningList.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); reveal(ev.target.closest('.runitem')); } });
  }

  document.getElementById('launchPrimary').addEventListener('click', () => run('aios.launchPrimary'));
  document.getElementById('askBtn').addEventListener('click', () => run('aios.askAios'));
  document.getElementById('spawnWorker').addEventListener('click', () => run('aios.spawnWorker'));
  document.getElementById('resume').addEventListener('click', () => run('aios.resume'));
  document.getElementById('cmdPicker').addEventListener('click', () => run('aios.runRitualPicker'));
  let runOpen = true;
  function applyRunOpen(){
    const list = document.getElementById('runningList');
    const hasItems = list.children.length > 0;
    list.style.display = runOpen ? '' : 'none';
    document.getElementById('runHint').style.display = (runOpen && hasItems) ? '' : 'none';
    document.getElementById('runCaret').textContent = runOpen ? '▾' : '▸';
  }
  document.getElementById('toggleRunning').addEventListener('click', () => { runOpen = !runOpen; applyRunOpen(); });
  let termOpen = true;
  function applyTermOpen(){
    document.getElementById('termList').style.display = termOpen ? '' : 'none';
    document.getElementById('termCaret').textContent = termOpen ? '▾' : '▸';
  }
  document.getElementById('toggleTerms').addEventListener('click', () => { termOpen = !termOpen; applyTermOpen(); });
  // Key-shortcuts section — own collapse, default collapsed, persisted (independent of hints).
  let scOpen = !!(((vscode.getState && vscode.getState()) || {}).scOpen);
  function applyShortcuts(){ document.getElementById('scGrid').classList.toggle('collapsed', !scOpen); document.getElementById('scCaret').textContent = scOpen ? '▾' : '▸'; }
  applyShortcuts();
  document.getElementById('scToggle').addEventListener('click', () => { scOpen = !scOpen; const s=(vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, s, { scOpen })); applyShortcuts(); });
  document.getElementById('addSession').addEventListener('click', (e) => { e.stopPropagation(); run('aios.spawnWorker'); });
  document.getElementById('addTerm').addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'newTerminal' }); });
  document.getElementById('termList').addEventListener('click', (ev) => {
    const item = ev.target.closest('.runitem'); if (!item) return;
    const pid = Number(item.getAttribute('data-tpid')) || 0; if (!pid) return;
    if (ev.target.closest('[data-tclose]')) { vscode.postMessage({ type: 'closeTerminal', pid }); item.remove(); }
    else vscode.postMessage({ type: 'focusTerminal', pid });
  });
  document.getElementById('quotaWarn').addEventListener('click', () => { const to = document.getElementById('quotaWarn').getAttribute('data-to'); if (to) run('aios.swapTo', to); });
  document.getElementById('browseAgents').addEventListener('click', () => run('aios.spawnAgent'));
  document.getElementById('skillsPicker').addEventListener('click', () => run('aios.skillsPicker'));
  document.getElementById('companyAction').addEventListener('click', () => run('aios.companyAction'));
  document.getElementById('collaborateAction').addEventListener('click', () => run('aios.collaborateAction'));
  document.getElementById('browseProjects').addEventListener('click', () => run('aios.browseContext', 'projects'));
  document.getElementById('browseDeclared').addEventListener('click', () => run('aios.browseContext', 'declared'));
  document.getElementById('browseObserved').addEventListener('click', () => run('aios.browseContext', 'observed'));
  document.getElementById('updBadge').addEventListener('click', () => {
    if (document.getElementById('updBadge').classList.contains('upd')) run('aios.updateFramework');
    else vscode.postMessage({ type: 'recheck' });
  });

  document.getElementById('prev').addEventListener('click', () => step(-1));
  document.getElementById('next').addEventListener('click', () => step(1));
  document.getElementById('calToggle').addEventListener('click', () => {
    calView = calView === 'month' ? 'week' : 'month';
    document.getElementById('calToggle').textContent = calView === 'month' ? 'Week' : 'Month';
    { const st=(vscode.getState && vscode.getState()) || {}; vscode.setState(Object.assign({}, st, { calView })); }
    if (calView === 'week') { pendingWeek = null; weekIdx = -1; } // -1 → render() picks today's week
    if (lastData) render(lastData);
  });
  function navMonth(d){ let m = cur.month + d, y = cur.year; if (m<1){m=12;y--;} if (m>12){m=1;y++;} vscode.postMessage({ type:'navMonth', year:y, month:m }); }
  function step(d){
    if (calView === 'month' || !lastData) return navMonth(d);
    const total = lastData.weeks.length;
    const next = weekIdx + d;
    if (next < 0) { pendingWeek = 'last'; navMonth(-1); }
    else if (next > total - 1) { pendingWeek = 'first'; navMonth(1); }
    else { weekIdx = next; render(lastData); }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state'){
      if (msg.primary) document.getElementById('vPrimary').textContent = msg.primary;
      document.body.classList.toggle('no-hints', msg.showHints === false);
      document.getElementById('vFrequent').textContent = (msg.frequent || 0) + '';
      document.getElementById('vAgents').textContent = (msg.agents || 0) + '';
      document.getElementById('vSkills').textContent = (msg.skills || 0) + '';
      document.getElementById('vCommands').textContent = (msg.commands || 0) + '';
      document.getElementById('vCompanies').textContent = (msg.companies || []).length + '';
      document.getElementById('vCollab').textContent = (msg.collab || []).length + '';
      document.getElementById('vProjects').textContent = (msg.projects || 0) + '';
      document.getElementById('vDeclared').textContent = (msg.declared || 0) + '';
      document.getElementById('vObserved').textContent = (msg.observed || 0) + '';
      const ga = msg.goAgents || 0;
      document.getElementById('vGoAgents').textContent = ga + '';
      document.getElementById('goWithAgents').classList.toggle('dim', ga === 0);
      const ll = msg.learnings || [];
      document.getElementById('learnList').innerHTML = ll.map((x) => {
        const t = (x.title || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-file="' + (x.file||'') + '" data-line="' + (x.line||0) + '" title="' + x.source + ' · ' + x.date + ' — click to read">'
          + '<span class="lsrc ' + x.source + '">' + x.source + '</span><span class="ltitle">' + t + '</span><span class="ldate">' + (x.date||'').slice(5) + '</span></div>';
      }).join('');
      document.getElementById('learnHint').style.display = ll.length ? '' : 'none';
      renderNudge(msg.nudge);
      const outs = msg.outputs || [];
      document.getElementById('outputList').innerHTML = outs.map((o) => {
        const nm = (o.name || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-path="' + (o.path||'') + '" title="' + (o.group||'') + ' — click to read · ⌘-click for source"><span class="lsrc">' + (o.group||'') + '</span><span class="ltitle">' + nm + '</span></div>';
      }).join('');
      document.getElementById('outputHint').style.display = outs.length ? '' : 'none';
      const reps = msg.reports || [];
      document.getElementById('reportList').innerHTML = reps.map((r) => {
        const nm = (r.name || '').replace(/</g,'&lt;');
        return '<div class="learnitem" data-path="' + (r.path||'') + '" title="report — click to read · ⌘-click for source"><span class="lsrc">report</span><span class="ltitle">' + nm + '</span></div>';
      }).join('');
      document.getElementById('reportHint').style.display = reps.length ? '' : 'none';
    } else if (msg.type === 'running'){
      const raw = msg.running || [];
      // Self-clean: once the registry no longer lists a killed pid, stop filtering it.
      for (const pid of Array.from(killed)) { if (!raw.some((a) => a.pid === pid)) killed.delete(pid); }
      const r = raw.filter((a) => !killed.has(a.pid));
      const v = document.getElementById('vRunning'); v.textContent = r.length ? r.length + '' : '';
      v.className = r.length ? 'val' : 'k';
      const list = document.getElementById('runningList');
      if (list){
        const html = r.map((a) => {
          const s = statusInfo(a.status);
          const nm = (a.name || '(unnamed)').replace(/</g,'&lt;');
          // Interrupt (Esc) — only meaningful while the session is actively working.
          const interrupt = s.cls === 'busy'
            ? '<button class="runint" data-int="1" title="Interrupt (Esc)" aria-label="Interrupt (Esc)">'
              + '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
              + '</button>'
            : '';
          // Richer status, inline only: "status + duration · project" (webview
          // tooltips render unreliably in Antigravity, so no hover detail).
          const dur = fmtAgo(a.updatedAt);
          const proj = String(a.proj || '').replace(/</g,'&lt;');
          const statusTxt = s.label + (dur ? ' ' + dur : '');
          return '<div class="runitem" role="button" tabindex="0" data-name="' + nm + '" data-pid="' + (a.pid||'') + '" title="' + s.title + ' — click to reveal its terminal">'
            + '<span class="dot ' + s.cls + '"></span><span class="rname">' + nm + '</span><span class="k"> · ' + statusTxt + (proj ? ' · ' + proj : '') + '</span>'
            + '<span class="runacts">'
            + interrupt
            + '<button class="runclose" data-close="1" title="Close session" aria-label="Close session (close-session)">'
            + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>'
            + '</button>'
            + '<button class="runkill" data-kill="1" title="Kill terminal" aria-label="Kill terminal">'
            + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
            + '</button>'
            + '</span></div>';
        }).join('');
        // replace only on change — the 2s poll otherwise tears down hover/tooltip
        // state (and focus) on every tick even when nothing moved
        if (list.dataset.html !== html) { list.innerHTML = html; list.dataset.html = html; }
      }
      applyRunOpen();
      const q = msg.quota || {};
      const qline = document.getElementById('quotaLine');
      if (q.has) {
        const f = Math.round(q.fiveHour || 0), s = Math.round(q.sevenDay || 0); // cache carries float dust (28.000…004)
        // "resets in 1h32m" — future-time formatter on the cache's resets_at epochs
        const fmtIn = (sec) => {
          if (!sec) return '';
          const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
          if (m < 60) return m + 'm';
          const h = Math.floor(m / 60);
          if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
          return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
        };
        const fin = fmtIn(q.fr), sin = fmtIn(q.sr);
        const lvl = (f >= 95 || s >= 99) ? 'red' : f >= 90 ? 'orange' : f >= 85 ? 'yellow' : 'green';
        document.getElementById('quotaBar').className = 'quotabar ' + lvl;
        document.getElementById('quotaFill').style.width = Math.min(100, f) + '%';
        // Countdown goes INLINE once you're in the amber zone — Antigravity's
        // webview eats title-tooltips (same quirk that killed the session hover
        // detail in 0.1.6), and "when do I get capacity back" only matters when
        // you're running out. Binding constraint wins: 5h≥85, else 7d≥99.
        const reset = (f >= 85 && fin) ? fin : (s >= 99 && sin) ? sin : '';
        document.getElementById('quotaLabel').textContent = reset
          ? '5h ' + Math.round(f) + '% · resets in ' + reset
          : (s > 0 ? '5h (7d ' + Math.round(s) + '%)' : '5h');
        // assign only on change — re-setting title on a hovered element every 2s
        // resets the native tooltip dwell, so it never appears (caught live: the
        // session rows' tooltips worked, this one didn't)
        const qtip = '5h ' + f + '%' + (fin ? ' (resets in ' + fin + ')' : '')
          + ' · 7d ' + s + '%' + (sin ? ' (resets in ' + sin + ')' : '')
          + ' — Anthropic rate-limit usage';
        if (qline.title !== qtip) qline.title = qtip;
        qline.style.display = '';
      } else { qline.style.display = 'none'; }
      const qw = document.getElementById('quotaWarn');
      if (q.showSwap && q.to) {
        qw.textContent = '↔ Swap to ' + (q.to.split('@')[0]);
        qw.setAttribute('data-to', q.to);
        qw.style.display = '';
      } else { qw.style.display = 'none'; }
    } else if (msg.type === 'terminals'){
      const terms = msg.terminals || [];
      const vt = document.getElementById('vTerms'); vt.textContent = terms.length ? terms.length + '' : ''; vt.className = terms.length ? 'val' : 'k';
      const tl = document.getElementById('termList');
      if (tl){
        const thtml = terms.map((t) => {
          const nm = (t.name || 'terminal').replace(/</g,'&lt;');
          return '<div class="runitem" role="button" tabindex="0" data-tpid="' + (t.pid||0) + '" title="Click to focus this terminal">'
            + '<span class="dot unk"></span><span class="rname">' + nm + '</span>'
            + '<span class="runacts"><button class="runkill" data-tclose="1" title="Close this terminal" aria-label="Close terminal">'
            + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
            + '</button></span></div>';
        }).join('');
        if (tl.dataset.html !== thtml) { tl.innerHTML = thtml; tl.dataset.html = thtml; }
      }
      applyTermOpen();
    } else if (msg.type === 'updateStatus'){
      const b = document.getElementById('updBadge');
      const fw = (msg.framework && msg.framework.hash) ? (' · ' + msg.framework.hash) : '';
      const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      const DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>';
      const DASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg>';
      if (msg.state === 'up-to-date'){ b.innerHTML = CHECK; b.className = 'hbadge ok'; b.title = 'Up to date' + fw; }
      else if (msg.state === 'available'){ b.innerHTML = DOWN; b.className = 'hbadge upd'; b.title = 'Updates available — click to run /aios:update' + fw; }
      else { b.innerHTML = DASH; b.className = 'hbadge'; b.title = 'Status unknown' + fw; }
    } else if (msg.type === 'month'){ renderMonth(msg.data); }
    else if (msg.type === 'calendarDirty'){ if (cur.year) vscode.postMessage({ type: 'navMonth', year: cur.year, month: cur.month }); }
    else if (msg.type === 'toggleAllCards'){ toggleAllCards(); }
  });

  // Compact "time since" for session rows — 'now', '4m', '2h 5m', '3d'.
  function fmtAgo(ts){
    if (!ts) return '';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    return Math.floor(h / 24) + 'd';
  }

  // Map a session's registry status → {dot color class, friendly label, tooltip}.
  // Claude currently emits only 'busy' / 'idle'; the input/error buckets are
  // forward-compatible — they light up only IF Claude ever reports such a status.
  function statusInfo(raw){
    const st = (raw||'').toLowerCase();
    if (st === 'idle' || st === 'ready') return { cls:'idle',  label:'ready',       title:'Idle — ready / waiting for you' };
    if (st === 'busy' || st === 'working' || st === 'running') return { cls:'busy', label:'working', title:'Busy — actively working' };
    if (/wait|input|prompt|\bask\b|attention|approv|permission|block/.test(st)) return { cls:'input', label:'needs input', title:'Waiting on you — reveal it' };
    if (/error|fail|crash/.test(st)) return { cls:'error', label: st, title:'Error — reveal it' };
    if (!st) return { cls:'unk', label:'unknown', title:'Status unknown' };
    return { cls:'unk', label: st, title: st };
  }

  function renderMonth(data){
    cur = { year: data.year, month: data.month };
    lastData = data;
    render(data);
  }

  function render(data){
    let weeks = data.weeks;
    let label = data.label;
    if (calView === 'week'){
      // Resolve which week to show: edge after a cross-month nav, else today's week, else clamp.
      if (pendingWeek === 'last') weekIdx = weeks.length - 1;
      else if (pendingWeek === 'first') weekIdx = 0;
      else if (weekIdx < 0) { const ti = weeks.findIndex((w) => w.some((c) => c.isToday)); weekIdx = ti >= 0 ? ti : 0; }
      pendingWeek = null;
      weekIdx = Math.max(0, Math.min(weekIdx, weeks.length - 1));
      weeks = [weeks[weekIdx]];
    }
    document.getElementById('calLabel').textContent = label;
    document.getElementById('dow').innerHTML = data.weekdays.map((w) => '<th>' + w + '</th>').join('');
    const body = document.getElementById('cal');
    body.innerHTML = weeks.map((week) =>
      '<tr>' + week.map((c) => {
        if (c.date === null) return '<td><div class="cell empty"></div></td>';
        const cls = ['cell','day']; if (c.hasNote) cls.push('has'); if (c.isToday) cls.push('today');
        return '<td><div class="' + cls.join(' ') + '" data-date="' + c.date + '"><span class="num">' + c.day + '</span></div></td>';
      }).join('') + '</tr>'
    ).join('');
    // Only days that already have a note are clickable — no accidental note creation.
    body.querySelectorAll('.cell.has').forEach((el) =>
      el.addEventListener('click', (ev) => vscode.postMessage({ type: 'openDay', date: el.getAttribute('data-date'), edit: ev.metaKey || ev.ctrlKey })));
  }

  vscode.postMessage({ type: 'ready' });
