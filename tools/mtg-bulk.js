'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function saveCompressedBody(body, file) {
  const iterator = Readable.fromWeb(body)[Symbol.asyncIterator]();
  let first = await iterator.next();
  if (first.done) throw new Error('Empty bulk response');
  let prefix = first.value;
  while (prefix.length < 2) { first = await iterator.next(); if (first.done) break; prefix = Buffer.concat([prefix, first.value]); }
  async function* replay() { yield prefix; for (;;) { const part = await iterator.next(); if (part.done) break; yield part.value; } }
  const input = Readable.from(replay()), output = fs.createWriteStream(file);
  if (prefix[0] === 0x1f && prefix[1] === 0x8b) await pipeline(input, output);
  else await pipeline(input, zlib.createGzip(), output);
}
async function ensureGzip(file) {
  const header = Buffer.alloc(2), fd = fs.openSync(file, 'r'); fs.readSync(fd, header, 0, 2, 0); fs.closeSync(fd);
  if (header[0] === 0x1f && header[1] === 0x8b) return;
  const temp = file + '.compressed.tmp';
  await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(temp));
  fs.renameSync(temp, file);
}
// Parse a top-level JSON object, emitting individual array members. A complete bulk
// document exceeds V8's maximum string size, so only one variant is held at a time.
async function parseTopLevel(stream, onItem, onValue) {
  stream.setEncoding('utf8');
  let phase = 'start', property, token = '', escaped = false, inString = false, depth = 0, kind, after;
  const check = (c, m) => { if (!c) throw new Error(m); };
  const finish = () => {
    const value = JSON.parse(token);
    if (after === 'afterArrayItem') onItem(property, value); else onValue(property, value);
    token = ''; phase = after;
  };
  for await (const chunk of stream) for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (phase === 'capture') {
      if (kind === 'primitive' && /[\s,\]}]/.test(c)) { finish(); i--; continue; }
      token += c;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') { inString = false; if (kind === 'string') finish(); }
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) finish(); }
      check(token.length < 16 * 1024 * 1024, 'Unexpected bulk item over 16MB');
      continue;
    }
    if (phase === 'keyToken') {
      token += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') { property = JSON.parse(token); token = ''; phase = 'colon'; }
      continue;
    }
    if (/\s/.test(c)) continue;
    if (phase === 'start') { check(c === '{', 'Bulk must be a JSON object'); phase = 'key'; }
    else if (phase === 'key') {
      if (c === '}') phase = 'done';
      else { check(c === '"', 'Invalid bulk key'); token = '"'; escaped = false; phase = 'keyToken'; }
    } else if (phase === 'colon') { check(c === ':', 'Invalid bulk separator'); phase = 'value'; }
    else if (phase === 'value' || phase === 'arrayNext') {
      if (phase === 'value' && c === '[') { phase = 'arrayNext'; continue; }
      if (phase === 'arrayNext' && c === ']') { phase = 'afterValue'; continue; }
      after = phase === 'arrayNext' ? 'afterArrayItem' : 'afterValue';
      token = c; kind = c === '"' ? 'string' : (c === '{' || c === '[') ? 'composite' : 'primitive';
      depth = kind === 'composite' ? 1 : 0; inString = kind === 'string'; escaped = false; phase = 'capture';
    } else if (phase === 'afterArrayItem') {
      check(c === ',' || c === ']', 'Invalid bulk array separator'); phase = c === ',' ? 'arrayNext' : 'afterValue';
    } else if (phase === 'afterValue') {
      check(c === ',' || c === '}', 'Invalid bulk field separator'); phase = c === ',' ? 'key' : 'done';
    } else check(false, 'Unexpected content after bulk document');
  }
  check(phase === 'done', 'Truncated bulk document');
}
function withoutImages(_key, value) {
  return /^imageUri|^layoutRotation/.test(_key) ? undefined : value;
}
async function indexBulk(rawPath, indexPath, aliasPath) {
  const variantTmp = indexPath + '.tmp', aliasTmp = aliasPath + '.tmp';
  const vf = fs.openSync(variantTmp, 'w'), af = fs.openSync(aliasTmp, 'w');
  let variantCount = 0, aliasCount = 0;
  const metadata = {};
  const signature = Buffer.alloc(2), raw = fs.openSync(rawPath, 'r'); fs.readSync(raw, signature, 0, 2, 0); fs.closeSync(raw);
  const input = fs.createReadStream(rawPath);
  const decompressed = signature[0] === 0x1f && signature[1] === 0x8b ? input.pipe(zlib.createGunzip()) : input;
  try {
    await parseTopLevel(decompressed, (property, item) => {
      if (property === 'variants') { fs.writeSync(vf, JSON.stringify(item, withoutImages) + '\n'); variantCount++; }
      else if (property === 'aliases') { fs.writeSync(af, JSON.stringify(item) + '\n'); aliasCount++; }
    }, (property, value) => { metadata[property] = value; });
    if (!variantCount) throw new Error('Bulk dataset has no variants');
  } finally { fs.closeSync(vf); fs.closeSync(af); }
  fs.renameSync(variantTmp, indexPath); fs.renameSync(aliasTmp, aliasPath);
  return { ...metadata, variantCount, aliasCount, indexPath, aliasPath, rawPath };
}
function* readIndex(file) {
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(256 * 1024);
  const { StringDecoder } = require('node:string_decoder'); const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      pending += decoder.write(buffer.subarray(0, count));
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line) yield JSON.parse(line);
      }
    }
    pending += decoder.end(); if (pending.trim()) yield JSON.parse(pending);
  } finally { fs.closeSync(fd); }
}
module.exports = { parseTopLevel, indexBulk, readIndex, saveCompressedBody, ensureGzip };
