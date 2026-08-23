#!/bin/zsh
# Word Power: pull latest words from the Obsidian vault and publish.
set -e
cd "$(dirname "$0")"
node sync.mjs
git add -A
if git diff --cached --quiet; then
  echo "No word changes to publish."
  exit 0
fi
git commit -m "Sync words from vault"
git push
echo "Published — the app will pick up new words within a couple of minutes."
