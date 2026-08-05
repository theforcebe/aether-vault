// Aether Vault: Scryfall API client.
// Respects documented limits: /cards/collection is 2 requests per second, 75 identifiers max.
// Browser User-Agent stays intact per Scryfall docs. Prices are daily estimates.

const Scry = (() => {
  const API = 'https://api.scryfall.com';
  let lastPost = 0;
  let lastGet = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function throttled(kind) {
    const now = Date.now();
    if (kind === 'post') {
      const wait = Math.max(0, lastPost + 560 - now);
      lastPost = now + wait;
      if (wait) await sleep(wait);
    } else {
      const wait = Math.max(0, lastGet + 130 - now);
      lastGet = now + wait;
      if (wait) await sleep(wait);
    }
  }

  async function post(path, body, tries = 0) {
    await throttled('post');
    try {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (tries < 4) { await sleep(1200 * (tries + 1)); return post(path, body, tries + 1); }
      throw e;
    }
  }

  async function get(path, tries = 0) {
    await throttled('get');
    try {
      const r = await fetch(API + path, { headers: { Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (tries < 4) { await sleep(1000 * (tries + 1)); return get(path, tries + 1); }
      return null;
    }
  }

  function img(sid, size) {
    if (!sid) return '';
    return 'https://cards.scryfall.io/' + (size || 'normal') + '/front/' + sid[0] + '/' + sid[1] + '/' + sid + '.jpg';
  }

  function compactPrices(c) {
    return {
      usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null,
      usd_foil: c.prices && c.prices.usd_foil ? parseFloat(c.prices.usd_foil) : null,
      usd_etched: c.prices && c.prices.usd_etched ? parseFloat(c.prices.usd_etched) : null,
    };
  }

  // Fetch fresh prices for an array of scryfall ids. onProgress(done, total).
  async function pricesByIds(ids, onProgress) {
    const out = {};
    for (let i = 0; i < ids.length; i += 75) {
      const batch = ids.slice(i, i + 75).map((id) => ({ id }));
      const res = await post('/cards/collection', { identifiers: batch });
      for (const c of res.data || []) out[c.id] = compactPrices(c);
      if (onProgress) onProgress(Math.min(i + 75, ids.length), ids.length);
    }
    return out;
  }

  // Resolve card names to {sid, name, prices, type_line, mana_cost, ci}. Batches of 75.
  async function resolveNames(names, onProgress) {
    const out = { found: {}, missing: [] };
    for (let i = 0; i < names.length; i += 75) {
      const batch = names.slice(i, i + 75).map((name) => ({ name }));
      const res = await post('/cards/collection', { identifiers: batch });
      for (const c of res.data || []) {
        out.found[c.name.toLowerCase()] = {
          sid: c.id, name: c.name, t: c.type_line, mc: c.mana_cost || '', ci: (c.color_identity || []).join(''),
          mv: c.cmc, ...compactPrices(c),
        };
        const front = c.name.split(' // ')[0].toLowerCase();
        if (!out.found[front]) out.found[front] = out.found[c.name.toLowerCase()];
      }
      for (const nf of res.not_found || []) out.missing.push(nf.name);
      if (onProgress) onProgress(Math.min(i + 75, names.length), names.length);
    }
    return out;
  }

  async function cardById(sid) { return get('/cards/' + sid); }
  async function cardByName(name) { return get('/cards/named?fuzzy=' + encodeURIComponent(name)); }

  return { img, pricesByIds, resolveNames, cardById, cardByName };
})();
