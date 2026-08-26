/* Word Power — vocabulary trainer with FSRS spaced repetition.
   All progress is stored locally on this device (localStorage). */
"use strict";

/* ================= FSRS-4.5 scheduler ================= */

const FSRS_W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 365 * 2;
// First intervals (days) for a card's early grades. All scheduling is
// day-based: sessions are short and infrequent, so sub-day steps make no sense.
const FIRST_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7 };
const DAY = 24 * 60 * 60 * 1000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function retrievability(elapsedDays, stability) {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}
function intervalFor(stability) {
  const days = (stability / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}
function initDifficulty(grade) {
  return clamp(FSRS_W[4] - Math.exp(FSRS_W[5] * (grade - 1)) + 1, 1, 10);
}
function nextDifficulty(d, grade) {
  const delta = -FSRS_W[6] * (grade - 3);
  const meanReverted = FSRS_W[7] * initDifficulty(4) + (1 - FSRS_W[7]) * (d + delta);
  return clamp(meanReverted, 1, 10);
}
function stabilityOnSuccess(d, s, r, grade) {
  const hardPenalty = grade === 2 ? FSRS_W[15] : 1;
  const easyBonus = grade === 4 ? FSRS_W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(FSRS_W[8]) *
        (11 - d) *
        Math.pow(s, -FSRS_W[9]) *
        (Math.exp(FSRS_W[10] * (1 - r)) - 1) *
        hardPenalty *
        easyBonus)
  );
}
function stabilityOnLapse(d, s, r) {
  const sf =
    FSRS_W[11] *
    Math.pow(d, -FSRS_W[12]) *
    (Math.pow(s + 1, FSRS_W[13]) - 1) *
    Math.exp(FSRS_W[14] * (1 - r));
  return clamp(sf, 0.1, s);
}

/* Card state shape:
   { state: 'new'|'learning'|'review',
     s: stability (days), d: difficulty,
     due: epoch ms, last: epoch ms, reps: n, lapses: n }
   ('learning' = missed while new; graduates to FSRS on any passing grade.
    Legacy 'relearning' cards from the old scheduler are treated as learning.) */

function newCardState() {
  return { state: "new", s: 0, d: 0, due: 0, last: 0, reps: 0, lapses: 0 };
}

// Apply a grade (1=Again 2=Hard 3=Good 4=Easy) and return the updated state.
function applyGrade(card, grade, now) {
  const c = { ...card };
  c.reps += 1;

  if (c.state !== "review") {
    // First exposures use the fixed day ladder; stability is seeded to the
    // chosen interval so FSRS growth continues smoothly from there.
    const days = FIRST_INTERVALS[grade];
    c.s = days;
    c.d = initDifficulty(grade);
    c.state = grade === 1 ? "learning" : "review";
    c.due = now + days * DAY;
  } else {
    const elapsed = Math.max((now - c.last) / DAY, 0.25);
    const r = retrievability(elapsed, c.s);
    if (grade === 1) {
      // Lapse: stability takes the FSRS hit, and the word comes back tomorrow.
      c.lapses += 1;
      c.d = nextDifficulty(c.d, 1);
      c.s = stabilityOnLapse(c.d, c.s, r);
      c.due = now + DAY;
    } else {
      c.d = nextDifficulty(c.d, grade);
      c.s = stabilityOnSuccess(c.d, c.s, r, grade);
      let iv = intervalFor(c.s);
      if (grade === 2) iv = clamp(Math.round(elapsed * 1.2) || 1, 1, iv);
      c.due = now + iv * DAY;
    }
  }

  c.last = now;
  return c;
}

// Human-readable preview of what each grade would do (for the buttons).
function previewIntervals(card, now) {
  const out = {};
  for (const g of [1, 2, 3, 4]) {
    const next = applyGrade(card, g, now);
    const days = Math.max(1, Math.round((next.due - now) / DAY));
    out[g] = days < 30
      ? `${days}d`
      : days < 365
        ? `${(days / 30.44).toFixed(1).replace(/\.0$/, "")}mo`
        : `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
  }
  return out;
}

/* ================= Persistence ================= */

const STORE_KEY = "wordpower-v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupted → start fresh */ }
  return { cards: {}, settings: { newPerDay: 5 }, dayLog: {} };
}
function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let store = loadStore();
let WORDS = [];
let wordById = {};

/* ================= Queue building ================= */

function todayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getCard(id) {
  return store.cards[id] || newCardState();
}

function buildQueue(now) {
  const due = [];
  const news = [];
  const introducedToday = store.dayLog[todayKey(now)] || 0;
  let newBudget = Math.max(0, store.settings.newPerDay - introducedToday);

  for (const w of WORDS) {
    const c = getCard(w.id);
    if (c.state === "new") {
      if (newBudget > 0) { news.push(w.id); newBudget--; }
    } else if (c.due <= now) {
      due.push(w.id);
    }
  }
  // Order: due reviews first (oldest due first), then new words.
  due.sort((a, b) => getCard(a).due - getCard(b).due);
  return { due, news };
}

/* ================= Session ================= */

let session = null; // { queue: [ids], idx-less: shift from front; revealed: bool }

function startSession() {
  const q = buildQueue(Date.now());
  session = { queue: [...q.due, ...q.news], revealed: false };
  if (session.queue.length === 0) { session = null; render(home()); return; }
  render(reviewScreen());
}

function currentCardId() {
  return session && session.queue.length ? session.queue[0] : null;
}

function grade(g) {
  const id = currentCardId();
  if (!id) return;
  const now = Date.now();
  const before = getCard(id);
  if (before.state === "new") {
    const k = todayKey(now);
    store.dayLog[k] = (store.dayLog[k] || 0) + 1;
  }
  const after = applyGrade(before, g, now);
  store.cards[id] = after;
  saveStore();

  session.queue.shift();
  session.revealed = false;
  advance();
}

function advance() {
  if (!session) { render(home()); return; }
  if (session.queue.length === 0) {
    session = null;
    render(doneScreen());
    return;
  }
  render(reviewScreen());
}

/* ================= Rendering ================= */

const app = document.getElementById("app");

function render(html) {
  app.innerHTML = html;
  app.firstElementChild?.classList.add("fade-in");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Minimal markdown: **bold**, *italic*, strip [[wikilinks]]
function md(s) {
  return esc(s)
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

function topbar(active) {
  const tab = (id, label) =>
    `<button class="${active === id ? "active" : ""}" onclick="go('${id}')">${label}</button>`;
  return `<div class="topbar">
    <h1>Word<span>Power</span></h1>
    <div class="nav">${tab("home", "Review")}${tab("browse", "Words")}${tab("settings", "⚙")}</div>
  </div>`;
}

function home() {
  const now = Date.now();
  const q = buildQueue(now);
  const total = q.due.length + q.news.length;
  const learned = WORDS.filter((w) => {
    const c = getCard(w.id);
    return c.state === "review" && c.s >= 21;
  }).length;
  const seen = WORDS.filter((w) => getCard(w.id).state !== "new").length;

  return `${topbar("home")}
  <div class="hero">
    ${total > 0
      ? `<div class="due-count">${total}</div>
         <div class="due-label">word${total === 1 ? "" : "s"} to review</div>
         <div class="breakdown">
           <span><b>${q.due.length}</b> due</span>
           <span><b>${q.news.length}</b> new</span>
         </div>
         <button class="btn-primary" onclick="startSession()">Start review</button>`
      : `<div class="due-count">✓</div>
         <div class="all-done">All caught up. Nothing due right now — your next reviews will appear here.</div>`}
  </div>
  <div class="stats-row">
    <div class="stat"><b>${WORDS.length}</b><span>in vault</span></div>
    <div class="stat"><b>${seen}</b><span>learning</span></div>
    <div class="stat"><b>${learned}</b><span>known*</span></div>
  </div>
  <div class="home-foot">*stability ≥ 3 weeks · progress is stored on this device</div>`;
}

function cardFront(w, c) {
  return `
    ${c.state === "new" ? '<span class="new-badge">New word</span>' : ""}
    <div class="word">${esc(w.title || w.word)}</div>
    ${w.partOfSpeech ? `<div class="pos">${esc(w.partOfSpeech)}</div>` : ""}
    ${w.pronunciation ? `<div class="pron">${esc(w.pronunciation)}</div>` : ""}`;
}

function cardBack(w) {
  const field = (title, body, cls = "") =>
    body ? `<div class="field ${cls}"><h3>${title}</h3>${body}</div>` : "";
  const chips = (arr, cls = "") =>
    arr && arr.length
      ? `<div class="chips ${cls}">${arr.map((s) => `<span>${md(s)}</span>`).join("")}</div>`
      : "";
  return `
    <div class="definition">${md(w.definition)}</div>
    ${field("Example", w.example ? `<p>${md(w.example)}</p>` : "", "example")}
    ${field("Memory hook", w.memoryHook ? `<p>${md(w.memoryHook)}</p>` : "")}
    ${field("Etymology", w.etymology ? `<p>${md(w.etymology)}</p>` : "")}
    ${field("Synonyms", chips(w.synonyms))}
    ${field("Antonyms", chips(w.antonyms, "anto"))}`;
}

function reviewScreen() {
  const id = currentCardId();
  const w = wordById[id];
  const c = getCard(id);
  const now = Date.now();
  const remaining = session.queue.length;

  let actions;
  if (!session.revealed) {
    actions = `<button class="btn-reveal" onclick="reveal()">Show answer</button>`;
  } else {
    const p = previewIntervals(c, now);
    actions = `<div class="grades">
      <button class="grade again" onclick="grade(1)">Again<small>${p[1]}</small></button>
      <button class="grade hard" onclick="grade(2)">Hard<small>${p[2]}</small></button>
      <button class="grade good" onclick="grade(3)">Good<small>${p[3]}</small></button>
      <button class="grade easy" onclick="grade(4)">Easy<small>${p[4]}</small></button>
    </div>`;
  }

  return `
  <div class="review-head">
    <button onclick="endSession()">✕ End</button>
    <div class="counts"><span>${remaining} left</span></div>
  </div>
  <div class="card ${session.revealed ? "revealed" : ""}" ${session.revealed ? "" : `onclick="reveal()"`}>
    <div class="front">${cardFront(w, c)}</div>
    ${session.revealed ? `<div class="back">${cardBack(w)}</div>` : ""}
  </div>
  <div class="actions">${actions}</div>`;
}

function doneScreen() {
  return `${topbar("home")}
  <div class="card"><div class="done-wrap">
    <div class="big">🎉</div>
    <h2>Session complete</h2>
    <p>Every card graded. Come back when more are due.</p>
    <button class="btn-primary" onclick="go('home')">Back to home</button>
  </div></div>`;
}

/* ---------- Browse ---------- */

let browseFilter = "";

function browse() {
  const f = browseFilter.trim().toLowerCase();
  const items = WORDS.filter(
    (w) => !f || w.word.includes(f) || (w.definition || "").toLowerCase().includes(f)
  );
  return `${topbar("browse")}
  <input class="search" type="search" placeholder="Search ${WORDS.length} words…" value="${esc(browseFilter)}"
    oninput="browseFilter=this.value; refreshBrowseList()" autocomplete="off">
  <ul class="word-list" id="word-list">${browseList(items)}</ul>`;
}

function browseList(items) {
  return items
    .map(
      (w) => `<li><button onclick="go('detail:${w.id}')">
        <span class="w">${esc(w.word)}</span>
        <span class="d">${esc(w.definition)}</span>
      </button></li>`
    )
    .join("");
}

function refreshBrowseList() {
  const f = browseFilter.trim().toLowerCase();
  const items = WORDS.filter(
    (w) => !f || w.word.includes(f) || (w.definition || "").toLowerCase().includes(f)
  );
  document.getElementById("word-list").innerHTML = browseList(items);
}

function detail(id) {
  const w = wordById[id];
  if (!w) return browse();
  const c = getCard(id);
  let sched = "Not started yet — will appear as a new card.";
  if (c.state === "review") {
    const days = Math.max(0, Math.round((c.due - Date.now()) / DAY));
    sched = `Reviewed ${c.reps}×${c.lapses ? `, ${c.lapses} lapse${c.lapses === 1 ? "" : "s"}` : ""} · next in ${days === 0 ? "less than a day" : days + " day" + (days === 1 ? "" : "s")}.`;
  } else if (c.state !== "new") {
    sched = "Still learning — due again tomorrow.";
  }
  return `${topbar("browse")}
  <button class="detail-back" onclick="go('browse')">← All words</button>
  <div class="card revealed" style="flex:0 1 auto">
    <div class="front">${cardFront(w, { state: "x" })}</div>
    <div class="back">${cardBack(w)}
      <div class="sched-note">${sched}</div>
    </div>
  </div>`;
}

/* ---------- Settings ---------- */

function settings() {
  return `${topbar("settings")}
  <div class="settings-card">
    <h3>New words per day</h3>
    <p>How many unseen vault words enter the rotation each day.</p>
    <div class="stepper">
      <button onclick="bumpNew(-1)">−</button>
      <b>${store.settings.newPerDay}</b>
      <button onclick="bumpNew(1)">+</button>
    </div>
  </div>
  <div class="settings-card">
    <h3>Progress</h3>
    <p>All review history lives only on this device.</p>
    <button class="danger" onclick="resetProgress()">Reset all progress…</button>
  </div>
  <div class="home-foot">Word Power · ${WORDS.length} words · synced from your Obsidian vault</div>`;
}

function bumpNew(delta) {
  store.settings.newPerDay = clamp(store.settings.newPerDay + delta, 0, 50);
  saveStore();
  render(settings());
}

function resetProgress() {
  if (confirm("Erase all review progress on this device? The word list itself is unaffected.")) {
    store = { cards: {}, settings: store.settings, dayLog: {} };
    saveStore();
    render(settings());
  }
}

/* ---------- Navigation ---------- */

function go(where) {
  if (where.startsWith("detail:")) { render(detail(where.slice(7))); return; }
  if (where === "browse") { render(browse()); return; }
  if (where === "settings") { render(settings()); return; }
  session = null;
  render(home());
}
function reveal() {
  if (session && !session.revealed) { session.revealed = true; render(reviewScreen()); }
}
function endSession() { session = null; render(home()); }

// expose handlers used in inline attributes
Object.assign(window, { go, reveal, grade, startSession, endSession, bumpNew, resetProgress, refreshBrowseList });
Object.defineProperty(window, "browseFilter", {
  get: () => browseFilter,
  set: (v) => { browseFilter = v; },
});

/* ---------- Boot ---------- */

async function boot() {
  try {
    const res = await fetch("words.json", { cache: "no-cache" });
    const data = await res.json();
    WORDS = data.words;
    localStorage.setItem("wordpower-words-cache", JSON.stringify(data));
  } catch (e) {
    const cached = localStorage.getItem("wordpower-words-cache");
    if (cached) WORDS = JSON.parse(cached).words;
  }
  wordById = Object.fromEntries(WORDS.map((w) => [w.id, w]));
  if (!WORDS.length) {
    render(`<div class="card"><div class="done-wrap"><h2>No words loaded</h2><p>Check your connection and reload once.</p></div></div>`);
    return;
  }
  render(home());
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
