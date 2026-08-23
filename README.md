# Word Power

Personal vocabulary trainer. Words come from an Obsidian vault
(`PJJ PKM/Word Power`); the app is a PWA with FSRS spaced repetition,
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

New words enter the review rotation a few per day (configurable in the
app's settings).

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
