#!/bin/zsh
# Word Power: pull latest words from the Obsidian vault and publish.
# Usage: ./update.sh [--settle]   (--settle waits 30s first; used by the
# launchd agent so Obsidian can finish writing a freshly captured note)
set -e
cd "$(dirname "$0")"

if [[ "$1" == "--settle" ]]; then
  sleep 30
fi

node sync.mjs
git pull --rebase -q || true
git add -A
if git diff --cached --quiet; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') no word changes"
  exit 0
fi
git commit -q -m "Sync words from vault"
git push -q
echo "$(date '+%Y-%m-%d %H:%M:%S') published $(node -e "console.log(require('./docs/words.json').count)") words"
