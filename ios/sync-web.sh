#!/usr/bin/env bash
# Web 版をビルドして iOS アプリに同梱するコピー（ios/Web）を作る
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
rm -rf ios/Web
mkdir -p ios/Web
cp -R dist/. ios/Web/
rm -f ios/Web/sw.js   # アプリ内では Service Worker を使わない（独自スキームでは登録できない）
echo "synced dist -> ios/Web ($(du -sh ios/Web | cut -f1))"
