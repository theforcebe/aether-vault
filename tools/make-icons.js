// Generates PWA icons (white field, near-black diamond) as real PNGs with no
// dependencies: raw RGBA scanlines -> zlib deflate -> PNG chunks. Run once per
// design change: node tools/make-icons.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// design: white field, diamond in --ink (#17171c), soft 1.5px edge
const INK = [0x17, 0x17, 0x1c];
function iconPixel(size, diamondRatio) {
  const c = size / 2;
  const r = size * diamondRatio;
  return (x, y) => {
    const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c) - r;
    const t = Math.max(0, Math.min(1, d / 1.5 + 0.5)); // 0 inside, 1 outside
    const mix = (ink, bg) => Math.round(ink + (bg - ink) * t);
    return [mix(INK[0], 255), mix(INK[1], 255), mix(INK[2], 255), 255];
  };
}

const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), png(192, iconPixel(192, 0.34)));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png(512, iconPixel(512, 0.34)));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), png(512, iconPixel(512, 0.27)));
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
