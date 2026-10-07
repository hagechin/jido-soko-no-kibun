/** ドット絵アイコンを canvas で描いて data URL にする（外部画像なし） */
import { ICONS, ICON_SIZE, PALETTE } from '../data/icons';
import { itemDef } from '../data/items';

const cache = new Map<string, string>();

export function iconDataUrl(itemId: string, scale = 4): string {
  const key = `${itemId}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = ICONS[itemId];
  const c = document.createElement('canvas');
  c.width = ICON_SIZE * scale;
  c.height = ICON_SIZE * scale;
  const ctx = c.getContext('2d')!;
  if (!rows) {
    ctx.fillStyle = itemDef(itemId).color;
    ctx.fillRect(scale, scale, c.width - 2 * scale, c.height - 2 * scale);
  } else {
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        ctx.fillStyle = PALETTE[ch] ?? '#f0f';
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function iconImg(itemId: string, size = 32): HTMLImageElement {
  const img = document.createElement('img');
  img.src = iconDataUrl(itemId);
  img.width = size;
  img.height = size;
  img.alt = itemDef(itemId).name;
  img.title = itemDef(itemId).name;
  img.className = 'item-icon';
  img.draggable = false;
  return img;
}
