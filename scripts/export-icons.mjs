/**
 * 商品アイコン（data/icons.ts の 16×16 ドット絵）を PNG / SVG に書き出す。
 *   node scripts/export-icons.mjs [outDir]
 * 出力: <outDir>/png-16, png-128, png-512（最近傍拡大・透過）、svg、sheet-128.png（6×4 のスプライト）
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS, PALETTE, ICON_SIZE } from '../src/game/data/icons.ts';
import { ITEMS } from '../src/game/data/items.ts';

const out = process.argv[2] ?? 'assets/item-icons';

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** rgba: Uint8Array (w*h*4) → PNG Buffer */
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

function paint(rgba, stride, ox, oy, rows, scale) {
  for (let y = 0; y < ICON_SIZE; y++) for (let x = 0; x < ICON_SIZE; x++) {
    const ch = rows[y][x];
    if (ch === '.') continue;
    const [r, g, b] = hex(PALETTE[ch] ?? '#ff00ff');
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((oy + y * scale + dy) * stride + (ox + x * scale + dx)) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
}
function iconPng(rows, scale) {
  const s = ICON_SIZE * scale;
  const rgba = Buffer.alloc(s * s * 4);
  paint(rgba, s, 0, 0, rows, scale);
  return encodePng(s, s, rgba);
}
function iconSvg(rows) {
  const rects = [];
  for (let y = 0; y < ICON_SIZE; y++) {
    let x = 0;
    while (x < ICON_SIZE) { // 横に同色をまとめる
      const ch = rows[y][x];
      if (ch === '.') { x++; continue; }
      let w = 1;
      while (x + w < ICON_SIZE && rows[y][x + w] === ch) w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[ch] ?? '#ff00ff'}"/>`);
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

const scales = [1, 8, 32];
for (const sc of scales) mkdirSync(join(out, `png-${ICON_SIZE * sc}`), { recursive: true });
mkdirSync(join(out, 'svg'), { recursive: true });
const ids = ITEMS.map((it) => it.id).filter((id) => ICONS[id]);
for (const id of ids) {
  for (const sc of scales) writeFileSync(join(out, `png-${ICON_SIZE * sc}`, `${id}.png`), iconPng(ICONS[id], sc));
  writeFileSync(join(out, 'svg', `${id}.svg`), iconSvg(ICONS[id]));
}
// スプライト 6×4（128px、間隔 16px）
const cols = 6, cell = 128, gap = 16, rowsN = Math.ceil(ids.length / cols);
const W = cols * cell + (cols - 1) * gap, H = rowsN * cell + (rowsN - 1) * gap;
const sheet = Buffer.alloc(W * H * 4);
ids.forEach((id, i) => paint(sheet, W, (i % cols) * (cell + gap), Math.floor(i / cols) * (cell + gap), ICONS[id], cell / ICON_SIZE));
writeFileSync(join(out, 'sheet-128.png'), encodePng(W, H, sheet));
writeFileSync(join(out, 'README.md'), `# 商品アイコン（書き出し）\n\n\`src/game/data/icons.ts\` の 16×16 ドット絵を \`node scripts/export-icons.mjs\` で書き出したもの。背景は透過。\n\n- \`png-16/\` 原寸、\`png-128/\` 8 倍、\`png-512/\` 32 倍（最近傍拡大なので輪郭はシャープ）\n- \`svg/\` ベクター（任意のサイズで使える）\n- \`sheet-128.png\` 24 種を 6×4 に並べたもの\n\n| id | 名前 |\n|---|---|\n${ITEMS.map((it) => `| ${it.id} | ${it.name} |`).join('\n')}\n`);
console.log(`${ids.length} icons → ${out}`);
