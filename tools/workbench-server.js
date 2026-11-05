// Local companion. Reads private inventory; never serves knowledge/ or writes allocations.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeApi, quote, importCollection } = require('./mtg');
const { effectivePlan, allocationAudit, validateAllocations } = require('./mtg-allocations');
const Spellbook = require('./spellbook');
const Additions = require('../js/collection-additions');
const { commit: commitAdditions } = require('./collection-additions');
const ROOT = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
function createServer({ vaultRoot = ROOT, cacheRoot = path.join(ROOT, 'knowledge/cache/workbench'), port = 8787, api = makeApi(), comboFind = Spellbook.find } = {}) {
  const jobs = new Map(); let queue = Promise.resolve();
  const serial = task => { const p = queue.then(task); queue = p.catch(() => {}); return p; };
  // Spellbook has its own host and throttle; a printing quote must not block combo discovery.
  const spellbookRequest = Spellbook.makeClient(); let comboQueue = Promise.resolve();
  const findCombos = deck => { const task=comboQueue.then(()=>comboFind(deck,spellbookRequest));comboQueue=task.catch(()=>{});return task; };
  let facts = {}; const cacheFile = path.join(cacheRoot, 'facts.json');
  try { facts = read(cacheFile); } catch (_) { /* optional cache */ }
  function saveFacts() { fs.mkdirSync(cacheRoot, { recursive: true }); const tmp = cacheFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(facts)); fs.renameSync(tmp, cacheFile); }
  const baseline = () => ({ snapshot: read(path.join(vaultRoot, 'knowledge/collection/latest.json')), ledger: read(path.join(vaultRoot, 'knowledge/collection/allocations.json')) });
  function context(body) {
    if (!body.snapshot) { const v=baseline();if(body.expectedHash && body.expectedHash!==Additions.revision(v.snapshot))throw Error('The saved collection changed. Refresh the active collection, then quote again.');return v; }
    const s = body.snapshot;
    if (s.schemaVersion !== 1 || !Array.isArray(s.records) || s.records.length > 50000 || s.records.some(r => typeof r.name !== 'string' || !r.name.trim() || !Number.isSafeInteger(r.quantity) || r.quantity < 1 || typeof r.proxy !== 'boolean' || typeof r.binder !== 'string' || typeof r.binderType !== 'string')) throw Error('Invalid collection snapshot');
    validateAllocations(body.ledger); return { snapshot: s, ledger: body.ledger };
  }
  async function body(req) {
    let size = 0, chunks = [];
    for await (const part of req) { size += part.length; if (size > 12 * 1024 * 1024) throw Error('Request too large'); chunks.push(part); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  function reply(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (![ '127.0.0.1:' + port, 'localhost:' + port ].includes(host)) return reply(res, 403, { error: 'Loopback host required' });
      if ((req.headers.origin && req.headers.origin !== 'http://' + host) || req.headers['sec-fetch-site'] === 'cross-site') return reply(res, 403, { error: 'Same-origin requests only' });
      const url = new URL(req.url, 'http://' + host), p = url.pathname;
      if (p === '/api/workbench/status' && req.method === 'GET') return reply(res, 200, { app: 'aether-vault-workbench', local: true, version: 1 });
      if (p === '/api/workbench/vault' && req.method === 'GET') { const v = baseline(); return reply(res, 200, { ...v, audit: allocationAudit(v.ledger, v.snapshot) }); }
      if (p === '/api/workbench/collection-add' && req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res,415,{error:'JSON content type required'});
        const b=await body(req), initial=baseline();
        validateAllocations(initial.ledger);
        allocationAudit(initial.ledger,initial.snapshot);
        const checked=Additions.receipt(initial.snapshot,b.requestId,b.entries);
        if(checked.old)return reply(res,200,{...initial,added:checked.old.quantity,replayed:true,audit:allocationAudit(initial.ledger,initial.snapshot)});
        if(b.expectedRevision!==Additions.revision(initial.snapshot))return reply(res,409,{error:'The collection changed. Refresh the collection and review your queue before saving again.'});
        const ids=[...new Set(checked.normalized.map(e=>e.id))], cards=[];
        // Validate every printing before committing anything. Never accept client prices or names.
        for(let i=0;i<ids.length;i+=75){
          const r=await serial(()=>api('/cards/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifiers:ids.slice(i,i+75).map(id=>({id}))})}));
          if(!Array.isArray(r.data)||r.not_found?.length)throw Error('A printing could not be verified. Search for that edition again.');
          cards.push(...r.data.map(c=>({...c,_fetchedAt:new Date().toISOString()})));
        }
        const result=commitAdditions(vaultRoot,b.entries,cards,{requestId:b.requestId,expectedRevision:b.expectedRevision});
        const ledger=initial.ledger;
        for(const c of cards){
          const day=c._fetchedAt.slice(0,10),previous=facts[c.id]?._priceHistory||[];
          c._priceHistory=[...previous.filter(p=>p.date!==day),{date:day,prices:c.prices}].slice(-90);
          facts[c.id]=c;facts[c.name.toLowerCase()]=c;for(const face of c.card_faces||[])facts[face.name.toLowerCase()]=c;
        }
        try{saveFacts();}catch(_){/* Ownership is committed; return verified facts even if the optional cache is full. */}
        return reply(res,200,{...result,ledger,audit:allocationAudit(ledger,result.snapshot),cards});
      }
      if (p === '/api/workbench/facts' && req.method === 'POST') {
        const b = await body(req);
        if (!Array.isArray(b.identifiers) || b.identifiers.length > 75 || b.identifiers.some(x => !(typeof x.name === 'string' && x.name.length <= 256) && !(typeof x.id === 'string' && /^[a-f0-9-]{36}$/i.test(x.id)))) throw Error('Use at most 75 card identifiers');
        const result = await serial(async () => {
          const found = [], need = [];
          for (const id of b.identifiers) {
            const c = facts[id.id || String(id.name).toLowerCase()];
            if (c && !b.refresh && Date.now() - Date.parse(c._fetchedAt) < 864e5) found.push(c); else need.push(id);
          }
          let missing = [];
          if (need.length) {
            const r = await api('/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: need }) });
            if (!Array.isArray(r.data)) throw Error('Invalid Scryfall response');
            for (const c of r.data) {
              c._fetchedAt = new Date().toISOString();
              const day = c._fetchedAt.slice(0,10), previous = facts[c.id]?._priceHistory || [];
              c._priceHistory = [...previous.filter(p=>p.date!==day), { date:day, prices:c.prices }].slice(-90);
              facts[c.id] = c; facts[c.name.toLowerCase()] = c; for (const f of c.card_faces || []) facts[f.name.toLowerCase()] = c; found.push(c);
            }
            missing = r.not_found || []; saveFacts();
          }
          return { data: found, missing };
        });
        return reply(res, 200, result);
      }
      if (p === '/api/workbench/import-collection' && req.method === 'POST') {
        const b = await body(req); if (typeof b.csv !== 'string') throw Error('CSV text required');
        fs.mkdirSync(cacheRoot, { recursive: true }); const tmp = path.join(cacheRoot, 'import-' + crypto.randomUUID() + '.csv');
        let s; try { fs.writeFileSync(tmp, b.csv); s = importCollection(tmp); } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
        s.source = String(b.name || 'ManaBox upload').slice(0, 200);
        let ledger; try { ledger = baseline().ledger; } catch (_) { ledger = { schemaVersion: 1, availableBinders: ['Extras'], decks: [] }; }
        return reply(res, 200, { snapshot: s, ledger, audit: allocationAudit(ledger, s) });
      }
      if (p === '/api/workbench/quote' && req.method === 'POST') {
        if ([...jobs.values()].some(j => j.status === 'running')) return reply(res, 409, { error: 'A quote is already running. Wait for it to finish.' });
        const b = await body(req), { snapshot, ledger } = context(b), plan = effectivePlan(b.plan, ledger, snapshot);
        if (!Array.isArray(plan.cards) || plan.cards.length > 600) throw Error('Use at most 600 cards');
        const id = crypto.randomUUID(), job = { id, status: 'running', completed: 0, total: plan.cards.length, created: Date.now() }; jobs.set(id, job);
        for (const [k, j] of jobs) if (j.status !== 'running' && Date.now() - j.created > 3600e3) jobs.delete(k);
        serial(async () => {
          const result = await quote(plan, snapshot, async (url, options) => {
            const value = await api(url, options);
            if (String(url).includes('/named?') || /\/cards\/[a-f0-9-]{36}$/.test(String(url))) job.completed++;
            return value;
          }); job.result = result; job.status = 'done';
        }).catch(e => { job.status = 'error'; job.error = e.message; });
        return reply(res, 202, { id });
      }
      if (p.startsWith('/api/workbench/jobs/') && req.method === 'GET') { const j = jobs.get(p.split('/').pop()); return reply(res, j ? 200 : 404, j || { error: 'Quote expired; refresh it.' }); }
      if (p === '/api/workbench/combos' && req.method === 'POST') { const b = await body(req); return reply(res, 200, await findCombos(b)); }
      if (p === '/api/workbench/variant' && req.method === 'POST') {
        const b = await body(req); if (typeof b.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(b.id)) throw Error('Invalid variant ID');
        return reply(res, 200, await serial(() => Spellbook.makeClient()('https://backend.commanderspellbook.com/variants/' + b.id + '/')));
      }
      if (p.startsWith('/api/')) return reply(res, 404, { error: 'Unknown local API endpoint' });
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { error: 'Method not allowed' });
      const name = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
      if (!/^(?:index\.html|manifest\.webmanifest|sw\.js|(?:js|css|data|icons)\/[a-zA-Z0-9_-]+\.(?:js|css|png|svg|webp))$/.test(name)) return reply(res, 404, { error: 'Not found' });
      const file = path.join(ROOT, name); if (!fs.existsSync(file)) return reply(res, 404, { error: 'Not found' });
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch (e) { reply(res, 400, { error: e.code === 'ENOENT' ? 'No local baseline found. Import a ManaBox CSV in Workbench.' : e.message }); }
  });
  return server;
}
module.exports = { createServer };
if (require.main === module) {
  const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const port = Number(arg('--port', '8787'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Port must be 1024..65535');
  const server = createServer({ port, vaultRoot: path.resolve(arg('--vault', ROOT)), cacheRoot: path.resolve(arg('--cache', path.join(ROOT, 'knowledge/cache/workbench'))) });
  server.listen(port, '127.0.0.1', () => console.log('Aether Vault Workbench: http://127.0.0.1:' + port + '/#/workbench'));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is in use. Choose --port 8788 or reopen the running Workbench.' : e.message); process.exitCode = 1; });
}
