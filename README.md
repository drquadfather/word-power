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
