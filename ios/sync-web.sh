#!/usr/bin/env bash
# Web 版をビルドして iOS アプリに同梱するコピー（ios/Web）を作る。リポジトリのどこから呼んでもよい
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。Node.js 22 を入れてください（.nvmrc 参照。例: brew install node@22 または nvm use）" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) は古すぎます。22 を使ってください（.nvmrc）" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "node_modules が無いので依存を入れます（npm ci）..."
  npm ci
fi

npm run build
rm -rf ios/Web
mkdir -p ios/Web
cp -R dist/. ios/Web/
rm -f ios/Web/sw.js   # アプリ内では Service Worker を使わない（独自スキームでは登録できない）
echo "synced dist -> ios/Web ($(du -sh ios/Web | cut -f1))"
echo "次: cd ios && xcodegen generate && open HakoniwaDS.xcodeproj"
