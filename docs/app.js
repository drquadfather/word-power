/* Word Power — vocabulary trainer with frequency-weighted review.
   All progress is stored locally on this device (localStorage). */
"use strict";

/* ================= Weighted scheduler =================
   There are no due dates. Each session draws words at random, weighted by the
   last rating: harder words come up more often. A word's weight also grows the
   longer it goes unseen, so even Easy words keep coming back instead of
   disappearing for months. */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Relative odds by last rating (1=Again 2=Hard 3=Good 4=Easy).
const RATING_WEIGHT = { 1: 8, 2: 4, 3: 2, 4: 1 };
// Every RAMP_DAYS unseen adds the base weight again (a week → 2×, a month → ~5×).
const RAMP_DAYS = 7;
// Words seen within the last hour are heavily discounted, so a second session
// in the same sitting brings up different words.
const COOLDOWN_FACTOR = 0.1;

const RATING_LABEL = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

const SESSION_STEP = 5;
const SESSION_MIN = 5;
const SESSION_MAX = 50;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* Card state shape:
   { state: 'new'|'seen', rating: 1-4, last: epoch ms, reps: n, lapses: n,
     boost?: true }
   (boost = missed in a quiz; guaranteed a slot in the next review session.) */

function newCardState() {
  return { state: "new", rating: 0, last: 0, reps: 0, lapses: 0 };
}

function applyGrade(card, grade, now) {
  const c = { ...card, state: "seen", rating: grade, last: now, reps: card.reps + 1 };
  if (grade === 1 && card.state !== "new") c.lapses += 1;
  delete c.boost;
  return c;
}

function reviewWeight(c, now) {
  const since = Math.max(now - c.last, 0);
  const w = RATING_WEIGHT[c.rating] * (1 + since / DAY / RAMP_DAYS);
  return since < HOUR ? w * COOLDOWN_FACTOR : w;
}

// Weighted sample without replacement.
function weightedPick(ids, n, weight) {
  const rest = ids.map((id) => ({ id, w: weight(id) }));
  const out = [];
  while (out.length < n && rest.length) {
    let t = Math.random() * rest.reduce((sum, x) => sum + x.w, 0);
    let i = 0;
    while (i < rest.length - 1 && (t -= rest[i].w) > 0) i++;
    out.push(rest.splice(i, 1)[0].id);
  }
  return out;
}

// Estimate a last rating for cards saved by the old FSRS scheduler. Its last
// interval (due − last) reflects how the word was graded: a lapse or a quiz
// miss meant ~1 day or less, a first Hard 2 days, Good 4, Easy 7, growing
// from there with each success.
function migrateCard(c) {
  if (c.rating || c.state === "new") return c;
  const days = (c.due - c.last) / DAY;
  const rating = c.state !== "review" || days <= 1.5 ? 1 : days <= 3 ? 2 : days <= 21 ? 3 : 4;
  return { state: "seen", rating, last: c.last, reps: c.reps || 0, lapses: c.lapses || 0 };
}

/* ================= Persistence ================= */

const STORE_KEY = "wordpower-v1";
const DEFAULT_SETTINGS = { sessionSize: 10, newPerSession: 2 };

function loadStore() {
  let st = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) st = JSON.parse(raw);
  } catch (e) { /* corrupted → start fresh */ }
  if (!st) st = { cards: {} };
  st.cards = st.cards || {};
  for (const id in st.cards) st.cards[id] = migrateCard(st.cards[id]);
  const { newPerDay, ...settings } = st.settings || {};
  st.settings = { ...DEFAULT_SETTINGS, ...settings };
  delete st.dayLog;
  return st;
}
function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let store = loadStore();
let WORDS = [];
let wordById = {};

/* ================= Queue building ================= */

function getCard(id) {
  return store.cards[id] || newCardState();
}

function unseenIds() {
  return WORDS.filter((w) => getCard(w.id).state === "new").map((w) => w.id);
}
function seenIds() {
  return WORDS.filter((w) => getCard(w.id).state !== "new").map((w) => w.id);
}

// A session holds `size` words: quiz misses first, then the configured number
// of new words (in vault order), then a weighted draw from everything seen.
// If either pool runs short, the other fills the gap.
function buildQueue(now, size) {
  const seen = seenIds();
  const unseen = unseenIds();
  const boosted = shuffle(seen.filter((id) => getCard(id).boost)).slice(0, size);
  const rest = seen.filter((id) => !boosted.includes(id));
  const room = size - boosted.length;

  const nNew = Math.min(unseen.length, Math.max(room - rest.length, Math.min(store.settings.newPerSession, room)));
  const news = unseen.slice(0, nNew);
  const reviews = weightedPick(rest, room - nNew, (id) => reviewWeight(getCard(id), now));
  // New words are spread through the session rather than bunched at the end.
  return { reviews: [...boosted, ...reviews], news, queue: shuffle([...boosted, ...reviews, ...news]) };
}

/* ================= Session ================= */

let session = null; // { queue: [ids], shifted from the front; revealed: bool }

function sessionSize() {
  return Math.min(store.settings.sessionSize, WORDS.length);
}

function bumpSession(delta) {
  store.settings.sessionSize = clamp(store.settings.sessionSize + delta * SESSION_STEP, SESSION_MIN, SESSION_MAX);
  saveStore();
  render(home());
}

function startSession() {
  const q = buildQueue(Date.now(), sessionSize());
  session = { queue: q.queue, revealed: false };
  if (session.queue.length === 0) { session = null; render(home()); return; }
  window.scrollTo(0, 0);
  render(reviewScreen());
}

function currentCardId() {
  return session && session.queue.length ? session.queue[0] : null;
}

function grade(g) {
  const id = currentCardId();
  if (!id) return;
  const now = Date.now();
  store.cards[id] = applyGrade(getCard(id), g, now);
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
    <div class="nav">${tab("home", "Review")}${tab("browse", "Words")}${tab("quiz", "Quiz")}${tab("settings", "⚙")}</div>
  </div>`;
}

function home() {
  const q = buildQueue(Date.now(), sessionSize());
  const seen = seenIds().length;
  const known = WORDS.filter((w) => getCard(w.id).rating >= 3).length;

  return `${topbar("home")}
  <div class="hero">
    <div class="stepper session-stepper">
      <button onclick="bumpSession(-1)" aria-label="Fewer words"${store.settings.sessionSize <= SESSION_MIN ? " disabled" : ""}>−</button>
      <div class="due-count">${q.queue.length}</div>
      <button onclick="bumpSession(1)" aria-label="More words"${store.settings.sessionSize >= SESSION_MAX ? " disabled" : ""}>+</button>
    </div>
    <div class="due-label">words this session</div>
    <div class="breakdown">
      <span><b>${q.reviews.length}</b> review</span>
      <span><b>${q.news.length}</b> new</span>
    </div>
    <button class="btn-primary" onclick="startSession()">Start review</button>
  </div>
  <div class="stats-row">
    <div class="stat"><b>${WORDS.length}</b><span>in vault</span></div>
    <div class="stat"><b>${seen}</b><span>learning</span></div>
    <div class="stat"><b>${known}</b><span>known*</span></div>
  </div>
  <div class="home-foot">*last rated Good or Easy · progress is stored on this device</div>`;
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
  const remaining = session.queue.length;

  let actions;
  if (!session.revealed) {
    actions = `<button class="btn-reveal" onclick="reveal()">Show answer</button>`;
  } else {
    actions = `<div class="grades">
      <button class="grade again" onclick="grade(1)">Again</button>
      <button class="grade hard" onclick="grade(2)">Hard</button>
      <button class="grade good" onclick="grade(3)">Good</button>
      <button class="grade easy" onclick="grade(4)">Easy</button>
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
    <p>Harder words will come up more often next time.</p>
    <button class="btn-primary" onclick="startSession()">Review ${sessionSize()} more</button>
    <button class="btn-link" onclick="go('home')">Back to home</button>
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
  if (c.state !== "new") {
    const days = Math.floor((Date.now() - c.last) / DAY);
    const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    sched = `Last rated ${RATING_LABEL[c.rating]} · reviewed ${c.reps}×${c.lapses ? `, ${c.lapses} lapse${c.lapses === 1 ? "" : "s"}` : ""} · last seen ${ago}.`;
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
    <h3>New words per session</h3>
    <p>How many unseen vault words are mixed into each review session, until all have been introduced.</p>
    <div class="stepper">
      <button onclick="bumpNew(-1)">−</button>
      <b>${store.settings.newPerSession}</b>
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
  store.settings.newPerSession = clamp(store.settings.newPerSession + delta, 0, SESSION_MAX);
  saveStore();
  render(settings());
}

function resetProgress() {
  if (confirm("Erase all review progress on this device? The word list itself is unaffected.")) {
    store = { cards: {}, settings: store.settings };
    saveStore();
    render(settings());
  }
}

/* ================= Quiz ================= */

/* A round shows five words and seven definitions — the five real ones plus two
   decoys belonging to words that aren't on screen, so the last pair can't be had
   by elimination. Tap a word, then tap a definition to pair them; tap either
   half again to break the pair. */

const QUIZ_PAIRS = 5;
const QUIZ_ROUNDS = 3;
const QUIZ_DECOYS = 2;

let quiz = null;
/* { rounds: [{ words: [id], defs: [id] }], r: roundIndex,
     picks: { defId: wordId }, sel: wordId|null, checked: bool,
     score: [{ id, ok }] } */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Only words already in rotation are quizzable — an unseen word has no answer
// to recall, just a guess.
function quizPool() {
  return WORDS.filter((w) => w.definition && getCard(w.id).state !== "new").map((w) => w.id);
}

// Same weighting as review sessions: harder and longer-unseen words come up
// most often, with enough randomness that the same handful doesn't repeat.
function pickQuizWords(pool, n, now) {
  return weightedPick(pool, n, (id) => reviewWeight(getCard(id), now));
}

// Decoys come from words used nowhere else in this quiz, preferring the round's
// dominant part of speech so "it's the only adjective" gives nothing away.
function pickDecoys(words, used) {
  const tally = {};
  for (const id of words) {
    const p = wordById[id].partOfSpeech || "";
    tally[p] = (tally[p] || 0) + 1;
  }
  const dominant = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  const avail = WORDS.filter((w) => w.definition && !used.has(w.id));
  const same = shuffle(avail.filter((w) => w.partOfSpeech === dominant));
  const other = shuffle(avail.filter((w) => w.partOfSpeech !== dominant));
  return [...same, ...other].slice(0, QUIZ_DECOYS).map((w) => w.id);
}

function quizRoundCount() {
  return clamp(Math.floor(quizPool().length / QUIZ_PAIRS), 0, QUIZ_ROUNDS);
}

function buildQuiz(now) {
  const nRounds = quizRoundCount();
  if (nRounds === 0) return null;

  const picked = pickQuizWords(quizPool(), nRounds * QUIZ_PAIRS, now);
  // Cluster by part of speech before chunking, so each round is internally
  // consistent rather than a mix that answers itself.
  picked.sort((a, b) =>
    (wordById[a].partOfSpeech || "").localeCompare(wordById[b].partOfSpeech || "")
  );

  const used = new Set(picked);
  const rounds = [];
  for (let i = 0; i < nRounds; i++) {
    const words = picked.slice(i * QUIZ_PAIRS, (i + 1) * QUIZ_PAIRS);
    const decoys = pickDecoys(words, used);
    decoys.forEach((id) => used.add(id));
    rounds.push({ words: shuffle(words), defs: shuffle([...words, ...decoys]) });
  }
  return { rounds, r: 0, picks: {}, sel: null, checked: false, score: [] };
}

/* ---------- Quiz interaction ---------- */

function startQuiz() {
  quiz = buildQuiz(Date.now());
  if (!quiz) { render(quizHome()); return; }
  window.scrollTo(0, 0);
  renderQuiz();
}

function quizPick(id) {
  if (!quiz || quiz.checked) return;
  const pairedWith = Object.keys(quiz.picks).find((d) => quiz.picks[d] === id);
  if (pairedWith) { delete quiz.picks[pairedWith]; quiz.sel = null; }
  else quiz.sel = quiz.sel === id ? null : id;
  renderQuiz();
}

function quizPlace(defId) {
  if (!quiz || quiz.checked) return;
  if (quiz.picks[defId]) { delete quiz.picks[defId]; quiz.sel = null; renderQuiz(); return; }
  if (!quiz.sel) return;
  quiz.picks[defId] = quiz.sel;
  quiz.sel = null;
  renderQuiz();
}

// Asymmetric scoring. A miss is strong evidence the word has slipped, so it is
// guaranteed a slot in the next review — but its rating is left alone. A hit is
// weak evidence: recognition among five is far easier than recall, so it
// changes nothing.
function quizMiss(id) {
  const c = store.cards[id];
  if (!c || c.state === "new") return;
  store.cards[id] = { ...c, boost: true };
}

function quizCheck() {
  if (!quiz || quiz.checked) return;
  for (const id of quiz.rounds[quiz.r].words) {
    const ok = quiz.picks[id] === id;
    quiz.score.push({ id, ok });
    if (!ok) quizMiss(id);
  }
  saveStore();
  quiz.checked = true;
  quiz.sel = null;
  window.scrollTo(0, 0);
  renderQuiz();
}

function quizNext() {
  if (!quiz) return;
  if (quiz.r + 1 >= quiz.rounds.length) { render(quizResults()); return; }
  quiz.r += 1;
  quiz.picks = {};
  quiz.sel = null;
  quiz.checked = false;
  window.scrollTo(0, 0);
  renderQuiz();
}

function endQuiz() { quiz = null; render(quizHome()); }

/* ---------- Quiz rendering ---------- */

// Re-render in place: no fade (it would replay on every tap) and the scroll
// position is held so the definition list doesn't jump under your thumb.
function renderQuiz() {
  const y = window.scrollY;
  app.innerHTML = quizScreen();
  window.scrollTo(0, y);
}

function quizHome() {
  const n = quizRoundCount();
  return `${topbar("quiz")}
  <div class="hero">
    ${n > 0
      ? `<div class="due-count">${n * QUIZ_PAIRS}</div>
         <div class="due-label">words · ${n} round${n === 1 ? "" : "s"} of ${QUIZ_PAIRS}</div>
         <div class="quiz-blurb">Match each word to its definition. Two definitions in every round belong to neither — elimination won't save you.</div>
         <button class="btn-primary" onclick="startQuiz()">Start quiz</button>`
      : `<div class="due-count">—</div>
         <div class="all-done">The quiz needs at least ${QUIZ_PAIRS} words you've already started. Run a review or two first.</div>`}
  </div>
  <div class="home-foot">A missed word comes forward into your next review. A correct one leaves its schedule untouched.</div>`;
}

function quizScreen() {
  const round = quiz.rounds[quiz.r];
  const placed = Object.keys(quiz.picks).length;

  const chip = (id) => {
    const paired = Object.keys(quiz.picks).some((d) => quiz.picks[d] === id);
    const cls = ["qword",
      quiz.sel === id ? "picked" : "",
      paired && !quiz.checked ? "done" : "",
      quiz.checked ? (quiz.picks[id] === id ? "ok" : "bad") : "",
    ].filter(Boolean).join(" ");
    return `<button class="${cls}" onclick="quizPick('${id}')">${esc(wordById[id].word)}</button>`;
  };

  const row = (defId) => {
    const w = wordById[defId];
    const assigned = quiz.picks[defId];
    const isReal = round.words.includes(defId);
    const said = assigned ? ` · <em>you said</em> ${esc(wordById[assigned].word)}` : "";
    let cls = "qdef";
    let tag = "";
    if (quiz.checked) {
      if (isReal && assigned === defId) {
        cls += " ok";
        tag = `<span class="qtag ok">✓ ${esc(w.word)}</span>`;
      } else if (isReal) {
        cls += " bad";
        tag = `<span class="qtag bad">✗ ${esc(w.word)}${said}</span>`;
      } else if (assigned) {
        cls += " bad";
        tag = `<span class="qtag bad">✗ <em>not in this round</em>${said}</span>`;
      } else {
        cls += " idle";
        tag = `<span class="qtag idle"><em>not in this round</em></span>`;
      }
    } else if (assigned) {
      cls += " taken";
      tag = `<span class="qtag">${esc(wordById[assigned].word)}</span>`;
    }
    return `<button class="${cls}" onclick="quizPlace('${defId}')">${tag}<span class="qtext">${md(w.definition)}</span></button>`;
  };

  const actions = quiz.checked
    ? `<button class="btn-reveal" onclick="quizNext()">${quiz.r + 1 >= quiz.rounds.length ? "See results" : "Next round"}</button>`
    : `<button class="btn-reveal" onclick="quizCheck()"${placed < round.words.length ? " disabled" : ""}>Check ${placed}/${round.words.length}</button>`;

  return `
  <div class="review-head">
    <button onclick="endQuiz()">✕ End</button>
    <div class="counts"><span>Round ${quiz.r + 1} of ${quiz.rounds.length}</span></div>
  </div>
  <div class="quiz-words">${round.words.map(chip).join("")}</div>
  <div class="quiz-defs">${round.defs.map(row).join("")}</div>
  <div class="actions">${actions}</div>`;
}

function quizResults() {
  const right = quiz.score.filter((s) => s.ok).length;
  const total = quiz.score.length;
  const missed = quiz.score.filter((s) => !s.ok).map((s) => s.id);
  quiz = null;
  return `${topbar("quiz")}
  <div class="hero">
    <div class="due-count">${right}/${total}</div>
    <div class="due-label">matched</div>
    <div class="quiz-blurb">${missed.length
      ? `${missed.length} word${missed.length === 1 ? " is" : "s are"} now waiting in your next review.`
      : "Clean sweep — nothing pulled forward."}</div>
    <button class="btn-primary" onclick="go('quiz')">Done</button>
  </div>
  ${missed.length ? `<ul class="word-list quiz-missed">${browseList(missed.map((id) => wordById[id]))}</ul>` : ""}`;
}

/* ---------- Navigation ---------- */

function go(where) {
  if (where.startsWith("detail:")) { render(detail(where.slice(7))); return; }
  quiz = null;
  if (where === "browse") { render(browse()); return; }
  if (where === "settings") { render(settings()); return; }
  if (where === "quiz") { session = null; render(quizHome()); return; }
  session = null;
  render(home());
}
function reveal() {
  if (session && !session.revealed) { session.revealed = true; render(reviewScreen()); }
}
function endSession() { session = null; render(home()); }

// expose handlers used in inline attributes
Object.assign(window, { go, reveal, grade, startSession, endSession, bumpSession, bumpNew, resetProgress, refreshBrowseList });
Object.assign(window, { startQuiz, quizPick, quizPlace, quizCheck, quizNext, endQuiz });
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
