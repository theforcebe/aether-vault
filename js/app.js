// Aether Vault: router and boot.

const App = (() => {
  const root = () => document.getElementById('view');

  function parseHash() {
    const h = location.hash || '#/vault';
    const [pathPart, queryPart] = h.split('?');
    const params = {};
    if (queryPart) for (const kv of queryPart.split('&')) {
      const [k, v] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
    return { path: pathPart, params };
  }

  function go(path, params) {
    const q = params
      ? '?' + Object.entries(params).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
      : '';
    const target = path + (q === '?' ? '' : q);
    if (location.hash === target) render();
    else location.hash = target;
  }

  function render() {
    const { path, params } = parseHash();
    const el = root();
    let html = '';
    if (path === '#/vault' || path === '#/' || path === '') html = UI.viewVault();
    else if (path === '#/collection') html = UI.viewCollection(params);
    else if (path.startsWith('#/deck/')) html = UI.viewDeck(path.split('/')[2]);
    else if (path === '#/moves') html = UI.viewMoves();
    else if (path === '#/import') html = UI.viewImport();
    else if (path.startsWith('#/session/')) html = UI.viewSession(path.split('/')[2]);
    else html = UI.viewVault();
    el.innerHTML = html;
    UI.wire(el, path, params);

    document.querySelectorAll('.nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === path ||
        (a.getAttribute('href') === '#/decks-menu' && path.startsWith('#/deck/')));
    });
    const mc = document.getElementById('moves-count');
    const n = Store.state.moves.length;
    mc.textContent = n ? n : '';
    mc.style.display = n ? 'inline-flex' : 'none';
  }

  function boot() {
    window.addEventListener('hashchange', render);
    UI.hoverPreview();

    document.getElementById('btn-prices').addEventListener('click', (e) => UI.refreshPrices(e.currentTarget));
    document.getElementById('btn-backup').addEventListener('click', () => Store.exportBackup());
    document.getElementById('file-restore').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { Store.importBackup(JSON.parse(rd.result)); UI.toast('Backup restored.'); render(); }
        catch (err) { UI.toast('That file is not an Aether Vault backup.'); }
      };
      rd.readAsText(f);
    });

    render();
  }

  return { boot, render, refresh: render, go };
})();

document.addEventListener('DOMContentLoaded', App.boot);
