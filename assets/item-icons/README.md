# 商品アイコン（書き出し）

`src/game/data/icons.ts` の 16×16 ドット絵を `node scripts/export-icons.mjs` で書き出したもの。背景は透過。

- `png-16/` 原寸、`png-128/` 8 倍、`png-512/` 32 倍（最近傍拡大なので輪郭はシャープ）
- `svg/` ベクター（任意のサイズで使える）
- `sheet-128.png` 24 種を 6×4 に並べたもの

| id | 名前 |
|---|---|
| apple | りんご |
| book | 本 |
| tshirt | Tシャツ |
| mug | マグカップ |
| shoes | 靴 |
| console | ゲーム機 |
| plush | ぬいぐるみ |
| ball | ボール |
| plant | 植物 |
| clock | 時計 |
| headphones | ヘッドホン |
| umbrella | 傘 |
| cake | ケーキ |
| hat | 帽子 |
| camera | カメラ |
| lamp | ランプ |
| guitar | ギター |
| robot | ロボット玩具 |
| banana | バナナ |
| milk | 牛乳 |
| pencil | 鉛筆 |
| scissors | ハサミ |
| battery | 電池 |
| fish | 魚 |

## 3D レンダリング（ビン + ボクセル）

`node scripts/export-icons-3d.mjs <outDir> <size> <res>` で、ゲーム内と同じ three.js でビンの上にアイコンを押し出した状態を斜め上から描いたもの（1024×1024、透過、床の影つき）。

- `render-3d/` ゲーム内と同じ 8×8 ボクセル（16×16 を 2×2 で多数決）
- `render-3d-hd/` 16×16 をそのまま押し出した高精細版（LP 向け）
- 各フォルダの `sheet.png` は 24 種の一覧（256px 格子）
