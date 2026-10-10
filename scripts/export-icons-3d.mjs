/**
 * ビンの上に商品のドット絵をボクセルで押し出した状態（ゲーム内と同じ見た目）を、
 * 斜め上から見た透過 PNG に書き出す。headless Chromium + three.js（ゲームと同じ版）で描く。
 *   node scripts/export-icons-3d.mjs [outDir] [size] [res]   res: 8 = ゲーム内と同じ 8×8 ボクセル、16 = ドット絵そのまま
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ICONS, PALETTE, ICON_SIZE } from '../src/game/data/icons.ts';
import { ITEMS } from '../src/game/data/items.ts';
import { RENDER } from '../src/game/data/balance.ts';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const out = process.argv[2] ?? 'assets/item-icons/render-3d';
const SIZE = Number(process.argv[3] ?? 1024);
const ICON_RES = Number(process.argv[4] ?? 8);
mkdirSync(out, { recursive: true });

// scene.ts の iconVoxels と同じ: 16×16 を 8×8 に落とし、2×2 の多数色（2 個以上）を採る（res=16 なら 1:1）
function voxels(rows) {
  const step = ICON_SIZE / ICON_RES;
  const res = [];
  for (let z = 0; z < ICON_RES; z++) for (let x = 0; x < ICON_RES; x++) {
    const counts = new Map();
    for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
      const ch = rows[z * step + dz][x * step + dx];
      if (ch !== '.') counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    let best = null, bn = 0;
    for (const [ch, n] of counts) if (n > bn) { bn = n; best = ch; }
    if (best && bn >= Math.min(2, step * step)) res.push([x, z, PALETTE[best] ?? '#ff00ff']);
  }
  return res;
}
const items = ITEMS.filter((it) => ICONS[it.id]).map((it) => ({ id: it.id, name: it.name, color: it.color, vox: voxels(ICONS[it.id]) }));

const app = `
const ITEMS = ${JSON.stringify(items)};
const R = ${JSON.stringify({ binHeight: RENDER.binHeight, binSize: RENDER.binSize })};
const SIZE = ${SIZE};
const canvas = document.getElementById('c');
canvas.width = SIZE; canvas.height = SIZE;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.add(new HemisphereLight('#ffffff', '#8899aa', 0.9));
scene.add(new AmbientLight('#ffffff', 0.25));
const sun = new DirectionalLight('#fff4e0', 1.4);
sun.position.set(-2.5, 6, -1); // 影が手前（カメラ側）に落ちるように
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -2; sun.shadow.camera.right = 2; sun.shadow.camera.top = 2; sun.shadow.camera.bottom = -2;
sun.shadow.radius = 4;
scene.add(sun);
// 透明背景に落ちる影だけの床
const ground = new Mesh(new PlaneGeometry(10, 10), new ShadowMaterial({ opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new PerspectiveCamera(28, 1, 0.1, 50);
const elev = 38 * Math.PI / 180, azim = 42 * Math.PI / 180, dist = 3.4;
const target = new Vector3(0, R.binHeight * 0.55, 0);
camera.position.set(target.x + dist * Math.cos(elev) * Math.sin(azim), target.y + dist * Math.sin(elev), target.z + dist * Math.cos(elev) * Math.cos(azim));
camera.lookAt(target);

const group = new Group();
scene.add(group);
const boxGeo = new BoxGeometry(1, 1, 1);
function build(item) {
  group.clear();
  const bs = R.binSize, bh = R.binHeight;
  const h = bh * 0.92;
  const bin = new Mesh(boxGeo, new MeshLambertMaterial({ color: item.color }));
  bin.scale.set(bs, h, bs);
  bin.position.set(0, h / 2, 0);
  bin.castShadow = true; bin.receiveShadow = true;
  group.add(bin);
  const cell = (bs * 0.7) / ${ICON_RES};
  const vh = 0.06;
  const topY = h;
  for (const [x, z, color] of item.vox) {
    const m = new Mesh(boxGeo, new MeshLambertMaterial({ color }));
    m.scale.set(cell, vh, cell);
    m.position.set((x - ${ICON_RES} / 2 + 0.5) * cell, topY + vh / 2, (z - ${ICON_RES} / 2 + 0.5) * cell);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
}
window.renderItem = (i) => { build(ITEMS[i]); renderer.render(scene, camera); return canvas.toDataURL('image/png'); };
window.itemCount = ITEMS.length;
window.makeSheet = (urls, cols, cell) => new Promise((ok) => {
  const rows = Math.ceil(urls.length / cols);
  const c2 = document.createElement('canvas'); c2.width = cols * cell; c2.height = rows * cell;
  const ctx = c2.getContext('2d');
  let left = urls.length;
  urls.forEach((u, i) => { const im = new Image(); im.onload = () => { ctx.drawImage(im, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell); if (--left === 0) ok(c2.toDataURL('image/png')); }; im.src = u; });
});
window.ready = true;
`;
const html = `<!doctype html><html><body style="margin:0;background:#0000"><canvas id="c"></canvas><script type="module">import { WebGLRenderer, PCFSoftShadowMap, Scene, HemisphereLight, AmbientLight, DirectionalLight, Mesh, PlaneGeometry, ShadowMaterial, PerspectiveCamera, Vector3, Group, BoxGeometry, MeshLambertMaterial } from './three.module.js';\n${app}</script></body></html>`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 300)));
// three.module.js は ./three.core.js を import するので、擬似 http オリジンで配信する（file:// は CORS で止まる）
await page.route('http://render.local/**', (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (name === '' || name === 'index.html') return route.fulfill({ contentType: 'text/html', body: html });
  if (/^three\.(module|core)\.js$/.test(name)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(resolve('node_modules/three/build/' + name), 'utf8') });
  return route.fulfill({ status: 404, body: '' });
});
await page.goto('http://render.local/index.html');
await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
const n = await page.evaluate(() => window.itemCount);
const urls = [];
for (let i = 0; i < n; i++) {
  const url = await page.evaluate((k) => window.renderItem(k), i);
  urls.push(url);
  writeFileSync(join(out, `${items[i].id}.png`), Buffer.from(url.split(',')[1], 'base64'));
}
const sheet = await page.evaluate(([u, cols, cell]) => window.makeSheet(u, cols, cell), [urls, 6, 256]);
writeFileSync(join(out, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
await browser.close();
console.log(`${n} renders → ${out}`);
