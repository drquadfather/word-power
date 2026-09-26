# Word Power

Personal vocabulary trainer. Words come from an Obsidian vault
(`PJJ PKM/Word Power`); the app is a PWA with frequency-weighted review,
hosted on GitHub Pages. Review progress is stored locally per device.

## Layout

- `sync.mjs` — parses the vault notes (frontmatter + sections) into `docs/words.json`
- `docs/` — the static app (GitHub Pages serves this folder)
- `update.sh` — sync + commit + push in one step

## Adding words

Just add notes to the vault as usual, then run:

```sh
./update.sh
```

Each review session mixes in a few new words (configurable in the app's
settings) until every word has been introduced.

## How words are chosen

Pick a session size on the home screen (steps of 5, default 10). Words are
drawn at random, weighted by your last rating — Again 8, Hard 4, Good 2,
Easy 1 — and each word's weight grows the longer it goes unseen, so nothing
disappears for months. Words seen in the last hour are discounted, so a
second session in one sitting brings up different words. A word missed in
the quiz is guaranteed a slot in the next session.

## Automatic sync

A launchd agent runs `update.sh --settle` whenever the vault folder
changes, plus hourly (to catch edits inside existing notes). Logs go to
`~/Library/Logs/wordpower-sync.log`.

`com.peterjones.wordpower-sync.plist` in this repo is a backup copy; the
live one is installed at `~/Library/LaunchAgents/`. To reinstall on a
new Mac:

```sh
cp com.peterjones.wordpower-sync.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peterjones.wordpower-sync.plist
```
