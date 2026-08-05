// Aether Vault: encrypted cross-device sync.
// Vaults sync to a private GitHub repo as AES-GCM ciphertext. The key derives
// from name + PIN in this browser (PBKDF2, 150k iterations); the filename is a
// hash of the same, so the repo holds no readable names and no readable data.
// The repo token is a trust-circle credential entered once per device and kept
// only in localStorage. A forgotten PIN means the vault cannot be decrypted.

const Sync = (() => {
  const REPO = 'theforcebe/aether-vault-data';
  const LS_ID = 'av_sync_id';       // {name, pin, token}
  const LS_META = 'av_sync_meta';   // {slug, lastPush, lastPull, sha}
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } }

  // chunked: spreading a whole vault's bytes as arguments overflows the call stack
  const b64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function keyFor(name, pin, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(name.toLowerCase().trim() + ':' + pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function slugFor(name, pin) {
    const h = await crypto.subtle.digest('SHA-256', enc.encode('av1:' + name.toLowerCase().trim() + ':' + pin));
    return [...new Uint8Array(h).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function encrypt(name, pin, obj) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(name, pin, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }

  async function decrypt(name, pin, envelope) {
    const key = await keyFor(name, pin, unb64(envelope.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.ct));
    return JSON.parse(dec.decode(pt));
  }

  // ---------- GitHub contents API ----------
  function headers(token) {
    return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  async function apiGet(token, path) {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, { headers: headers(token) });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('Token rejected. Check it has access to the vault repo.');
    if (!r.ok) throw new Error('Sync read failed (' + r.status + ')');
    return r.json();
  }

  // The contents API only inlines files up to 1MB; real vaults get bigger.
  // Returns { sha, envelope } however large the file is, or null if absent.
  async function fetchVaultFile(token, path) {
    const metaRes = await apiGet(token, path);
    if (!metaRes) return null;
    let text;
    if (metaRes.content) {
      text = atob(metaRes.content.replace(/\n/g, ''));
    } else {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
        headers: { ...headers(token), Accept: 'application/vnd.github.raw+json' },
      });
      if (!r.ok) throw new Error('Sync read failed (' + r.status + ')');
      text = await r.text();
    }
    return { sha: metaRes.sha, envelope: JSON.parse(text) };
  }

  // what a vault object actually holds, for guard prompts
  function counts(v) {
    const rows = (v && v.mycollection) || [];
    return {
      cards: rows.reduce((s, r) => s + (r.q || 1), 0),
      decks: ((v && v.userdecks) || []).length,
    };
  }
  async function apiPut(token, path, contentB64, message, sha) {
    const body = { message, content: contentB64 };
    if (sha) body.sha = sha;
    const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
      method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (r.status === 401 || r.status === 403) throw new Error('Token rejected. Check it has access to the vault repo.');
    if (!r.ok) throw new Error('Sync write failed (' + r.status + ')');
    return r.json();
  }

  // ---------- vault payload ----------
  function currentVault() {
    const s = Store.state;
    return {
      app: 'aether-vault', version: 3, updatedAt: new Date().toISOString(),
      prices: s.prices, prev: s.prev, snapshots: s.snapshots, moves: s.moves,
      sessions: s.sessions, resolved: s.resolved, userdecks: s.userdecks,
      mycollection: s.mycollection, seeded: s.seeded, baseline: s.baseline,
    };
  }

  const identity = () => load(LS_ID);
  const meta = () => load(LS_META) || {};
  function enabled() { const id = identity(); return !!(id && id.token && id.name && id.pin); }

  async function enable(name, pin, token) {
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN should be 4 to 8 digits.');
    if (!name.trim()) throw new Error('Pick a name.');
    // verify token against the repo
    const probe = await fetch('https://api.github.com/repos/' + REPO, { headers: headers(token) });
    if (!probe.ok) throw new Error('That token cannot see the vault repo.');
    const slug = await slugFor(name, pin);
    save(LS_ID, { name: name.trim(), pin, token });
    save(LS_META, { slug });
    // existing cloud vault?
    const existing = await fetchVaultFile(token, 'users/' + slug + '.json');
    if (existing) {
      let cloud;
      try { cloud = await decrypt(name, pin, existing.envelope); }
      catch (e) { throw new Error('A vault exists for that name but the PIN does not open it.'); }
      return { found: true, cloud, sha: existing.sha };
    }
    return { found: false };
  }

  function signOut() { localStorage.removeItem(LS_ID); localStorage.removeItem(LS_META); }

  async function push() {
    const id = identity();
    if (!id) throw new Error('Sync is not set up.');
    const m = meta();
    const slug = m.slug || await slugFor(id.name, id.pin);
    const envelope = await encrypt(id.name, id.pin, currentVault());
    const path = 'users/' + slug + '.json';
    const existing = await apiGet(id.token, path);
    const res = await apiPut(id.token, path, btoa(JSON.stringify(envelope)), 'vault update', existing ? existing.sha : undefined);
    if (res.conflict) {
      // someone else (another device) wrote since our read: re-read and retry once
      const again = await apiGet(id.token, path);
      const res2 = await apiPut(id.token, path, btoa(JSON.stringify(envelope)), 'vault update', again ? again.sha : undefined);
      if (res2.conflict) throw new Error('Sync conflict; try again.');
    }
    save(LS_META, { ...m, slug, lastPush: Date.now() });
    return true;
  }

  async function pull() {
    const id = identity();
    if (!id) throw new Error('Sync is not set up.');
    const m = meta();
    const slug = m.slug || await slugFor(id.name, id.pin);
    const existing = await fetchVaultFile(id.token, 'users/' + slug + '.json');
    if (!existing) return null;
    const cloud = await decrypt(id.name, id.pin, existing.envelope);
    save(LS_META, { ...m, slug, lastPull: Date.now() });
    return cloud;
  }

  function applyCloud(cloud) {
    // keep a local snapshot first so nothing is ever lost
    try { localStorage.setItem('av_prepull_snapshot', JSON.stringify(currentVault())); } catch (e) { /* space */ }
    Store.importBackup(cloud);
  }

  function hasSnapshot() { return !!localStorage.getItem('av_prepull_snapshot'); }
  function restoreSnapshot() {
    const raw = localStorage.getItem('av_prepull_snapshot');
    if (!raw) throw new Error('No snapshot on this device.');
    Store.importBackup(JSON.parse(raw));
  }

  // debounced autosync
  let timer = null;
  let lastDirty = 0;
  function autosyncTick() {
    if (!enabled()) return;
    const b = Store.backupState();
    if (b.dirty > 0 && b.dirty !== lastDirty) {
      lastDirty = b.dirty;
      clearTimeout(timer);
      timer = setTimeout(() => {
        push().then(() => { if (typeof UI !== 'undefined') UI.toast('Vault synced.'); App.refresh(); })
          .catch(() => { /* quiet; manual sync surfaces errors */ });
      }, 20000);
    }
  }

  return { REPO, enabled, identity, meta, enable, signOut, push, pull, applyCloud, autosyncTick, encrypt, decrypt, slugFor, currentVault, counts, hasSnapshot, restoreSnapshot };
})();
