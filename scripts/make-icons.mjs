// ボクセル倉庫のアイコンを PNG で生成する（依存なし: zlib だけ）。
// 使い方: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ART = [
  '................',
  '................',
  '......KKKK......',
  '....KKRRRRKK....',
  '..KKRRRRRRRRKK..',
  'KKRRRRRRRRRRRRKK',
  'KLLLLLLLLLLLLLLK',
  'KLWWLLBBLLYYLLLK',
  'KLWWLLBBLLYYLLLK',
  'KLLLLLLLLLLLLLLK',
  'KLGGLLLLLLLKKLLK',
  'KLGGLLLLLLLKKLLK',
  'KLLLLLLLLLLLLLLK',
  'KKKKKKKKKKKKKKKK',
  '................',
  '................',
];
const PAL = { K: [30, 34, 44], R: [224, 75, 75], L: [217, 221, 226], W: [255, 255, 255], B: [59, 111, 214], Y: [242, 201, 76], G: [60, 161, 60] };
const BG = [29, 39, 51];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, transparentBg = false) {
  const scale = size / 16;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const ch = ART[Math.floor(y / scale)][Math.floor(x / scale)];
      const col = PAL[ch] ?? (transparentBg ? null : BG);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (!col) { raw[o + 3] = 0; continue; }
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192));
writeFileSync('public/icons/icon-512.png', png(512));
writeFileSync('public/icons/maskable-512.png', png(512));
writeFileSync('public/icons/apple-touch-icon.png', png(180 - (180 % 16) + 16 > 180 ? 176 : 176));
// favicon は SVG（ピクセルをそのまま rect に）
let rects = '';
ART.forEach((row, y) => [...row].forEach((ch, x) => { if (PAL[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${PAL[ch].join(',')})"/>`; }));
writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>\n`);
console.log('icons written');
