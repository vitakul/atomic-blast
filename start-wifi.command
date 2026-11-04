#!/bin/bash
# Spustí herní server Atomic Blast pro hru po Wi-Fi (macOS: stačí dvojklik).
cd "$(dirname "$0")/server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Chybí Node.js. Nainstaluj ho z https://nodejs.org (verze 18 nebo novější) a spusť znovu."
  read -r -p "Stiskni Enter pro zavření…"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "První spuštění – instaluji závislosti…"
  npm install --omit=dev
fi
node index.js
