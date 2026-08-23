#!/usr/bin/env node
// Word Power sync: parses the Obsidian vault folder and writes docs/words.json
// Zero dependencies — the vault notes use a consistent, simple frontmatter format.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT = "/Users/peterjones/Documents/Obsidian/pjjOS/PJJ PKM/Word Power";
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "docs", "words.json");

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [{}, text];
  const fm = {};
  let currentKey = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    const listItem = rawLine.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(unquote(listItem[1]));
      continue;
    }
    const kv = rawLine.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const value = kv[2].trim();
      fm[currentKey] = value === "" ? null : unquote(value);
    }
  }
  return [fm, text.slice(m[0].length)];
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseSections(body) {
  // Split the note body on "## Heading" lines.
  const sections = {};
  const parts = body.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const heading = part.slice(0, nl).trim().toLowerCase();
    sections[heading] = part.slice(nl + 1).trim();
  }
  return sections;
}

function listItems(sectionText) {
  if (!sectionText) return [];
  return sectionText
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*[-*]\s+(.*)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
}

function stripBlockquote(text) {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

function firstParagraph(text) {
  if (!text) return "";
  return text.split(/\r?\n\r?\n/)[0].trim();
}

const files = readdirSync(VAULT).filter((f) => f.endsWith(".md"));
const words = [];
const problems = [];

for (const file of files.sort((a, b) => a.localeCompare(b))) {
  const text = readFileSync(join(VAULT, file), "utf8");
  const [fm, body] = parseFrontmatter(text);
  const sections = parseSections(body);

  const word = (fm.word || basename(file, ".md")).toLowerCase().trim();
  const definition =
    fm.definition || firstParagraph(sections["definition"]) || null;
  if (!definition) {
    problems.push(`${file}: no definition found — skipped`);
    continue;
  }

  words.push({
    id: word.replace(/[^a-z0-9]+/g, "-"),
    word,
    title: fm.title || word,
    partOfSpeech: fm.part_of_speech || null,
    pronunciation: fm.pronunciation || firstParagraph(sections["pronunciation"]) || null,
    definition,
    etymology: firstParagraph(sections["etymology"]) || fm.etymology || null,
    example: stripBlockquote(sections["example"]) || null,
    synonyms: listItems(sections["synonyms"]),
    antonyms: listItems(sections["antonyms"]),
    memoryHook: firstParagraph(sections["memory hook"]) || null,
    related: listItems(sections["related words"]).map((s) =>
      s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    ),
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t) => t !== "vocabulary") : [],
    added: fm.date || null,
  });
}

// Stable order: by date added (oldest first), then alphabetical. New-card
// introduction order in the app follows this array.
words.sort((a, b) =>
  (a.added || "").localeCompare(b.added || "") || a.word.localeCompare(b.word)
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ generated: new Date().toISOString(), count: words.length, words }, null, 2)
);

console.log(`Wrote ${words.length} words to ${OUT}`);
for (const p of problems) console.warn(`⚠ ${p}`);
