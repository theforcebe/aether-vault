// Aether Vault: router and boot.

const App = (() => {
  const root = () => document.getElementById('view');

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
    else if (path === '#/decks') html = UI.viewDecks();
    else if (path.startsWith('#/deck/')) html = UI.viewDeck(path.split('/')[2]);
    else if (path.startsWith('#/mydeck/')) html = UI.viewMyDeck(path.split('/')[2]);
    else if (path === '#/moves') html = UI.viewMoves();
    else if (path === '#/import') html = UI.viewImport();
    else if (path.startsWith('#/session/')) html = UI.viewSession(path.split('/')[2]);
    else if (path === '#/data') html = UI.viewData();
    else html = UI.viewDashboard(params);
    el.innerHTML = html;
    UI.wire(el, path, params);

    document.querySelectorAll('.nav a').forEach((a) => {
      const href = a.getAttribute('href');
      const active = href === path ||
        (href === '#/decks' && (path.startsWith('#/deck/') || path.startsWith('#/mydeck/') || path.startsWith('#/session/'))) ||
        (href === '#/dashboard' && (path === '#/' || path === '' || path === '#/vault'));
      a.classList.toggle('active', active);
    });
    const mc = document.getElementById('moves-count');
    const n = Store.state.moves.length;
    mc.textContent = n || '';
    mc.style.display = n ? 'inline-flex' : 'none';
    document.querySelector('details.menu')?.removeAttribute('open');
  }

  // resolve any card that still lacks art, quietly, once per load
  async function heal() {
    const names = Store.missingSidNames().slice(0, 225);
    if (!names.length || !navigator.onLine) return;
    try {
      const res = await Scry.resolveNames(names);
      if (Object.keys(res.found).length) {
        Store.cacheResolved(res.found);
        render();
      }
    } catch (e) { /* quiet */ }
  }

  function boot() {
    window.addEventListener('hashchange', render);
    UI.hoverPreview();

    document.getElementById('btn-prices').addEventListener('click', (e) => UI.refreshPrices(e.currentTarget));
    document.getElementById('m-prices').addEventListener('click', (e) => UI.refreshPrices(e.currentTarget));
    document.getElementById('m-backup').addEventListener('click', () => Store.exportBackup());

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
          UI.toast('Loaded ' + count + ' rows. You are now viewing your collection.');
          render();
        } catch (err) { UI.toast(err.message || 'Could not read that CSV.'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });

    render();
    heal();
  }

  return { boot, render, refresh: render, go };
})();

document.addEventListener('DOMContentLoaded', App.boot);
