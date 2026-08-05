// Aether Vault: router and boot. v3.

const App = (() => {
  const root = () => document.getElementById('view');
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
    dot.style.display = b.hasData && (b.dirty > 0 || !b.last) ? 'inline-block' : 'none';

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

    render();
    heal();
  }

  return { boot, render, refresh: render, go };
})();

document.addEventListener('DOMContentLoaded', App.boot);
