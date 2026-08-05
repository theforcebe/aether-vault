// Aether Vault: router and boot. v3.

const App = (() => {
  const root = () => document.getElementById('view');

  // Heavy intelligence bundles load after first paint, or on demand.
  let dataPromise = null;
  function ensureData() {
    if (!dataPromise) {
      dataPromise = Promise.all(['templates', 'brain', 'commanders', 'vectors', 'combos', 'commanders-cards', 'sets', 'setcards'].map((f) => new Promise((res) => {
        const s = document.createElement('script');
        s.src = 'data/' + f + '.js?v=' + (window.AV_BUILD || '0');
        s.onload = res;
        s.onerror = res; // optional bundles may not exist yet; the app runs without them
        document.head.appendChild(s);
      })));
    }
    return dataPromise;
  }
  let remindedThisSession = false;

  function parseHash() {
    const h = location.hash || '#/dashboard';
    const [pathPart, queryPart] = h.split('?');
    const params = {};
    if (queryPart) for (const kv of queryPart.split('&')) {
      const [k, v] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
    return { path: pathPart, params };
  }

  function go(path, params) {
    const clean = Object.entries(params || {}).filter(([, v]) => v !== '' && v != null);
    const q = clean.length ? '?' + clean.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
    const target = path + q;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function render() {
    const { path, params } = parseHash();
    const el = root();
    let html = '';
    if (path === '#/dashboard' || path === '#/' || path === '' || path === '#/vault') html = UI.viewDashboard(params);
    else if (path === '#/collection') html = UI.viewCollection(params);
    else if (path === '#/decks' || path.startsWith('#/deck/')) html = UI.viewDecks();
    else if (path.startsWith('#/mydeck/')) html = UI.viewMyDeck(path.split('/')[2]);
    else if (path === '#/moves') html = UI.viewMoves();
    else if (path === '#/import') html = UI.viewImport();
    else if (path.startsWith('#/session/')) html = UI.viewSession(path.split('/')[2]);
    else if (path === '#/guide') html = UI.viewGuide();
    else if (path === '#/coach') html = UI.viewCoach();
    else if (path === '#/collector') html = UI.viewCollector(params);
    else if (path.startsWith('#/pilot/')) html = UI.viewPilot();
    else if (path === '#/build') html = UI.viewBuild(params);
    else if (path === '#/data') html = UI.viewData();
    else html = UI.viewDashboard(params);
    el.innerHTML = html;
    UI.wire(el, path, params);

    document.querySelectorAll('.nav a').forEach((a) => {
      const href = a.getAttribute('href');
      const active = href === path ||
        (href === '#/decks' && (path.startsWith('#/mydeck/') || path.startsWith('#/session/') || path.startsWith('#/deck/'))) ||
        (href === '#/dashboard' && (path === '#/' || path === '' || path === '#/vault'));
      a.classList.toggle('active', active);
    });
    const mc = document.getElementById('moves-count');
    const n = Store.state.moves.length;
    mc.textContent = n || '';
    mc.style.display = n ? 'inline-flex' : 'none';

    const b = Store.backupState();
    const dot = document.getElementById('backup-dot');
    const dotOn = b.hasData && (b.dirty > 0 || !b.last);
    dot.style.display = dotOn ? 'inline-block' : 'none';

    // mobile tab bar
    document.querySelectorAll('.tabbar a').forEach((a) => {
      const href = a.getAttribute('data-tab');
      const active = href === path ||
        (href === '#/decks' && (path.startsWith('#/mydeck/') || path.startsWith('#/session/') || path.startsWith('#/deck/') || path.startsWith('#/pilot/'))) ||
        (href === '#/dashboard' && (path === '#/' || path === '' || path === '#/vault'));
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const moreBtn = document.getElementById('tab-more');
    const morePop = document.getElementById('tab-more-pop');
    if (moreBtn) moreBtn.classList.toggle('active', ['#/collector', '#/import', '#/guide', '#/moves', '#/data', '#/coach'].includes(path));
    if (morePop) { morePop.hidden = true; if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false'); }
    const tmc = document.getElementById('tab-moves-count');
    if (tmc) tmc.textContent = n ? String(n) : '';
    const tdd = document.getElementById('tab-data-dot');
    if (tdd) tdd.style.display = dotOn ? 'inline-block' : 'none';
    const tmd = document.getElementById('tab-more-dot');
    if (tmd) tmd.style.display = dotOn || n ? 'inline-block' : 'none';

    // gentle backup reminder once per session after real changes accumulate
    if (!remindedThisSession && b.dirty >= 6) {
      remindedThisSession = true;
      UI.toast('Reminder: your work lives only in this browser. Download a backup from the Data page.');
    }
    document.querySelector('details.menu')?.removeAttribute('open');
  }

  async function heal() {
    const names = Store.missingSidNames().slice(0, 225);
    if (!names.length || !navigator.onLine) return;
    try {
      const res = await Scry.resolveNames(names);
      if (Object.keys(res.found).length) { Store.cacheResolved(res.found); render(); }
    } catch (e) { /* quiet */ }
  }

  function boot() {
    window.addEventListener('hashchange', render);
    UI.hoverPreview();

    // error ring buffer for the diagnostics panel
    const logErr = (msg) => {
      try {
        const errs = JSON.parse(localStorage.getItem('av_errors') || '[]');
        errs.push(new Date().toISOString().slice(11, 19) + ' ' + String(msg).slice(0, 300));
        localStorage.setItem('av_errors', JSON.stringify(errs.slice(-20)));
      } catch (e) { /* full */ }
    };
    window.addEventListener('error', (e) => logErr((e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => logErr('promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

    document.getElementById('btn-prices').addEventListener('click', (e) => UI.refreshPrices(e.currentTarget));
    document.getElementById('m-prices').addEventListener('click', (e) => UI.refreshPrices(e.currentTarget));
    document.getElementById('m-backup').addEventListener('click', () => { Store.exportBackup(); UI.toast('Backup downloaded.'); render(); });

    document.getElementById('file-restore').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { Store.importBackup(JSON.parse(rd.result)); UI.toast('Backup restored.'); render(); }
        catch (err) { UI.toast('That file is not an Aether Vault backup.'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });

    document.getElementById('file-csv').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const count = Store.uploadCollection(rd.result, f.name.replace(/\.csv$/i, ''));
          UI.toast('Loaded ' + count + ' rows from your export.');
          go('#/collection', {});
          render();
        } catch (err) { UI.toast(err.message || 'Could not read that CSV.'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });

    // end-of-session nudge: if there are unbacked changes when the tab hides, remind on return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const b = Store.backupState();
        if (b.hasData && b.dirty >= 3 && !b.remindedBack) {
          UI.toast('Welcome back. You have changes that are not in a backup yet.');
          b.remindedBack = true;
        }
      }
    });

    // mobile More pop
    const moreBtn = document.getElementById('tab-more');
    const morePop = document.getElementById('tab-more-pop');
    if (moreBtn && morePop) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        morePop.hidden = !morePop.hidden;
        moreBtn.setAttribute('aria-expanded', String(!morePop.hidden));
      });
      document.addEventListener('click', (e) => {
        if (!morePop.hidden && !morePop.contains(e.target)) { morePop.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
      });
    }

    // offline support
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* fine without */ });
    }

    render();
    heal();
    (window.requestIdleCallback || setTimeout)(() => ensureData().then(() => { const p = parseHash().path; if (p === '#/build' || p === '#/guide') render(); }), 1200);
    setInterval(() => { try { Sync.autosyncTick(); } catch (e) { /* quiet */ } }, 5000);
  }

  return { boot, render, refresh: render, go, ensureData };
})();

document.addEventListener('DOMContentLoaded', App.boot);
