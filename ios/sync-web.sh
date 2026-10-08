#!/usr/bin/env bash
# Web 版をビルドして iOS アプリに同梱するコピー（ios/Web）を作る。リポジトリのどこから呼んでもよい
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。Node.js 22 を入れてください（.nvmrc 参照。例: brew install node@22 または nvm use）" >&2
  exit 1
fi
# Astro 5 は Node 22.12 以上が必要
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  echo "Node.js $(node -v) は古すぎます。22.12 以上を使ってください（.nvmrc。例: nvm use 22）" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "node_modules が無いので依存を入れます（npm ci）..."
  npm ci
fi

# 古い同梱 Web を残さない（ビルドに失敗したら ios/Web は無くなり、xcodegen が止まる）
rm -rf ios/Web
npm run build
mkdir -p ios/Web
cp -R dist/. ios/Web/
rm -f ios/Web/sw.js   # アプリ内では Service Worker を使わない（独自スキームでは登録できない）
printf 'commit=%s\ndate=%s\nnode=%s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(node -v)" > ios/Web/BUILD_INFO
echo "synced dist -> ios/Web ($(du -sh ios/Web | cut -f1))"
echo "次: cd ios && xcodegen generate && open HakoniwaDS.xcodeproj"
