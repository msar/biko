// Genera pwa-192.png y pwa-512.png (íconos sólidos con "B") sin dependencias,
// escribiendo el PNG a mano con zlib. Suficiente hasta tener un ícono de diseño.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../public');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// "B" dibujada en una grilla 16x16 que se escala al tamaño final.
const GLYPH = [
  '................',
  '................',
  '...#######......',
  '...########.....',
  '...##....###....',
  '...##.....##....',
  '...##....###....',
  '...########.....',
  '...########.....',
  '...##....###....',
  '...##.....##....',
  '...##.....##....',
  '...##....###....',
  '...#########....',
  '...########.....',
  '................',
];

function makePng(size) {
  const bg = [0x10, 0x68, 0x3f];
  const fg = [0xf6, 0xf4, 0xef];
  const cell = size / 16;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filtro None
    const gy = Math.min(15, Math.floor(y / cell));
    for (let x = 0; x < size; x++) {
      const gx = Math.min(15, Math.floor(x / cell));
      const on = GLYPH[gy][gx] === '#';
      const [r, g, b] = on ? fg : bg;
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(path.join(dir, `pwa-${size}.png`), makePng(size));
  console.log(`pwa-${size}.png generado`);
}
