// ─── STATE ──────────────────────────────────────────────────────────────────
const state = {
  activeCat: "all",
  activeSub: "all",
  dir: "de-tr",           // "de-tr" | "tr-de" | "random"
  cardIndex: 0,
  cardFlipped: false,
  showLearnedOnly: false,
  deck: [],               // filtered + optionally shuffled
  learned: new Set(),     // ids of cards marked learned
  correct: new Set(),     // ids answered correctly in session
  quiz: {
    questions: [],
    current: 0,
    right: 0,
    wrong: 0,
    answered: false,
    results: [],
  },
};

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
function loadProgress() {
  try {
    const raw = localStorage.getItem("tuerkisch_learned");
    if (raw) state.learned = new Set(JSON.parse(raw));
  } catch (_) {}
}

function saveProgress() {
  localStorage.setItem("tuerkisch_learned", JSON.stringify([...state.learned]));
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getFiltered() {
  let list = VOCABULARY;
  if (state.activeCat !== "all") list = list.filter(v => v.cat === state.activeCat);
  if (state.activeSub !== "all") list = list.filter(v => v.sub === state.activeSub);
  if (state.showLearnedOnly) list = list.filter(v => state.learned.has(v.id));
  return list;
}

function buildDeck() {
  state.deck = getFiltered();
  state.cardIndex = 0;
  state.cardFlipped = false;
}

function currentCard() {
  return state.deck[state.cardIndex] || null;
}

function frontText(card) {
  if (!card) return "–";
  const effectiveDir = state.dir === "random"
    ? (Math.random() < 0.5 ? "de-tr" : "tr-de")
    : state.dir;
  return effectiveDir === "de-tr" ? card.de : card.tr;
}

function backText(card) {
  if (!card) return "–";
  const effectiveDir = state.dir === "random"
    ? "de-tr"   // randomness fixed per card render; good enough
    : state.dir;
  return effectiveDir === "de-tr" ? card.tr : card.de;
}

// ─── DOM REFS ────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ─── SPEECH ──────────────────────────────────────────────────────────────────
let ttsAvailable = false;
let turkishVoice  = null;

function initSpeech() {
  if (!window.speechSynthesis) return;

  function findVoice() {
    const voices = speechSynthesis.getVoices();
    turkishVoice = voices.find(v => v.lang.startsWith("tr")) || null;
    ttsAvailable = true;
    // Show all speak buttons once voices are ready
    $$(".speak-btn").forEach(btn => btn.style.removeProperty("display"));
  }

  // Voices may load asynchronously on first call
  if (speechSynthesis.getVoices().length > 0) {
    findVoice();
  } else {
    speechSynthesis.addEventListener("voiceschanged", findVoice, { once: true });
  }
}

function speak(text, lang = "tr-TR") {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = lang;
  utt.rate   = 0.82;   // slightly slower for learning
  if (turkishVoice && lang.startsWith("tr")) utt.voice = turkishVoice;
  speechSynthesis.speak(utt);
}

function speakCurrentCardTurkish() {
  const card = currentCard();
  if (card) speak(card.tr);
}

function speakSpeakerCard() {
  const tr = $("sp-tr").textContent;
  if (tr && tr !== "–") speak(tr);
}

// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-content").forEach(s => s.classList.toggle("active", s.id === `tab-${name}`));
  if (name === "list") renderList();
}

// ─── SUB-FILTER POPULATION ───────────────────────────────────────────────────
function populateSubFilter() {
  const sel = $("sub-filter");
  // clear all but first option
  while (sel.options.length > 1) sel.remove(1);
  let subs = [...new Set(VOCABULARY
    .filter(v => state.activeCat === "all" || v.cat === state.activeCat)
    .map(v => v.sub))];
  subs.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
  sel.value = state.activeSub in [...subs, "all"] ? state.activeSub : "all";
}

// ─── PROGRESS BAR ────────────────────────────────────────────────────────────
function updateProgress() {
  const total = VOCABULARY.length;
  const done  = state.learned.size;
  const pct   = Math.round((done / total) * 100);
  $("progress-bar").style.width = pct + "%";
  $("progress-label").textContent = `${done} von ${total} gelernt (${pct}%)`;
}

// ─── FLASHCARD RENDER ────────────────────────────────────────────────────────
function renderCard() {
  const card = currentCard();
  const flipped = state.cardFlipped;
  const flashcard = $("flashcard");

  flashcard.classList.toggle("flipped", flipped);

  const effectiveDir = state.dir === "random"
    ? (state._randomDir || "de-tr")
    : state.dir;

  const frontWord = card ? (effectiveDir === "de-tr" ? card.de : card.tr) : "–";
  const backWord  = card ? (effectiveDir === "de-tr" ? card.tr : card.de) : "–";

  $("front-label").textContent = effectiveDir === "de-tr" ? "Deutsch" : "Türkisch";
  $("front-word").textContent  = frontWord;
  $("front-sub").textContent   = card ? card.sub : "";

  $("back-label").textContent  = effectiveDir === "de-tr" ? "Türkisch" : "Deutsch";
  $("back-word").textContent   = backWord;
  $("back-pron").textContent   = card ? card.pron : "";
  $("back-sub").textContent    = card ? card.sub : "";

  $("card-counter").textContent = `${state.cardIndex + 1} / ${state.deck.length}`;

  const markBtn = $("mark-btn");
  if (card) {
    const isLearned = state.learned.has(card.id);
    markBtn.textContent = isLearned ? "★ Als gelernt markiert" : "☆ Als gelernt markieren";
    markBtn.classList.toggle("marked", isLearned);
  }
}

function flipCard() {
  state.cardFlipped = !state.cardFlipped;
  $("flashcard").classList.toggle("flipped", state.cardFlipped);
}

function nextCard() {
  if (state.deck.length === 0) return;
  state.cardIndex = (state.cardIndex + 1) % state.deck.length;
  state.cardFlipped = false;
  if (state.dir === "random") state._randomDir = Math.random() < 0.5 ? "de-tr" : "tr-de";
  renderCard();
}

function prevCard() {
  if (state.deck.length === 0) return;
  state.cardIndex = (state.cardIndex - 1 + state.deck.length) % state.deck.length;
  state.cardFlipped = false;
  if (state.dir === "random") state._randomDir = Math.random() < 0.5 ? "de-tr" : "tr-de";
  renderCard();
}

// ─── QUIZ ────────────────────────────────────────────────────────────────────
function buildQuizQuestions(count) {
  let pool = getFiltered();
  if (pool.length < 4) { alert("Zu wenige Wörter für das Quiz. Bitte Kategorie erweitern."); return; }
  pool = shuffle(pool);
  const n = Math.min(count, pool.length);
  state.quiz.questions = pool.slice(0, n).map(card => {
    const distractors = shuffle(pool.filter(c => c.id !== card.id)).slice(0, 3);
    const answers = shuffle([card, ...distractors]);
    return { card, answers };
  });
  state.quiz.current = 0;
  state.quiz.right   = 0;
  state.quiz.wrong   = 0;
  state.quiz.results = [];
  state.quiz.answered = false;
}

function renderQuizQuestion() {
  const q = state.quiz.questions[state.quiz.current];
  if (!q) return;
  const effectiveDir = state.dir === "random"
    ? (Math.random() < 0.5 ? "de-tr" : "tr-de")
    : state.dir;

  $("quiz-progress").textContent = `Frage ${state.quiz.current + 1} / ${state.quiz.questions.length}`;
  $("quiz-score").textContent    = `✓ ${state.quiz.right}  ✗ ${state.quiz.wrong}`;

  const fromLang = effectiveDir === "de-tr" ? "Türkisch" : "Deutsch";
  $("quiz-q-label").textContent = `Was heißt auf ${fromLang}:`;
  const quizWord = effectiveDir === "de-tr" ? q.card.de : q.card.tr;
  $("quiz-q-word").textContent  = quizWord;
  $("quiz-q-sub").textContent   = q.card.sub;

  // Show speak button only when the question word is Turkish (TR→DE mode)
  const quizSpeakBtn = $("quiz-speak-btn");
  if (effectiveDir === "tr-de" && ttsAvailable) {
    quizSpeakBtn.style.display = "inline-flex";
    quizSpeakBtn.onclick = e => { e.stopPropagation(); speak(q.card.tr); };
  } else {
    quizSpeakBtn.style.display = "none";
  }

  const container = $("quiz-options");
  container.innerHTML = "";
  state.quiz.answered = false;

  q.answers.forEach(ans => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = effectiveDir === "de-tr" ? ans.tr : ans.de;
    btn.addEventListener("click", () => handleQuizAnswer(btn, ans, q, effectiveDir));
    container.appendChild(btn);
  });
}

function handleQuizAnswer(btn, ans, q, effectiveDir) {
  if (state.quiz.answered) return;
  state.quiz.answered = true;

  const correct = ans.id === q.card.id;
  btn.classList.add(correct ? "correct" : "wrong");

  // Reveal correct answer
  $$(".quiz-option").forEach(b => {
    const bText = b.textContent;
    const correctText = effectiveDir === "de-tr" ? q.card.tr : q.card.de;
    if (bText === correctText) b.classList.add("correct");
  });

  if (correct) {
    state.quiz.right++;
    state.correct.add(q.card.id);
  } else {
    state.quiz.wrong++;
    state.quiz.results.push({ card: q.card, wrong: ans });
  }

  // Auto-advance after short delay
  setTimeout(() => {
    state.quiz.current++;
    if (state.quiz.current >= state.quiz.questions.length) {
      showQuizResult();
    } else {
      renderQuizQuestion();
    }
  }, 900);
}

function showQuizResult() {
  $("quiz-run").style.display    = "none";
  $("quiz-result").style.display = "block";

  const total = state.quiz.questions.length;
  const pct   = Math.round((state.quiz.right / total) * 100);

  $("result-score").textContent  = `${state.quiz.right} / ${total} richtig (${pct}%)`;

  let grade, emoji;
  if (pct >= 90)      { grade = "Ausgezeichnet!";   emoji = "🏆"; }
  else if (pct >= 70) { grade = "Sehr gut!";         emoji = "🎉"; }
  else if (pct >= 50) { grade = "Gut gemacht!";      emoji = "👍"; }
  else                { grade = "Weiter üben!";      emoji = "💪"; }
  $("result-grade").textContent = `${emoji} ${grade}`;

  const details = $("result-details");
  if (state.quiz.results.length > 0) {
    details.innerHTML = "<h4>Fehler zum Nachlernen:</h4>" +
      state.quiz.results.map(r =>
        `<div class="result-row"><span class="r-de">${r.card.de}</span> → <span class="r-tr">${r.card.tr}</span> <span class="r-pron">(${r.card.pron})</span></div>`
      ).join("");
  } else {
    details.innerHTML = "<p>Keine Fehler – perfekt! 🌟</p>";
  }
}

// ─── VOCAB LIST ──────────────────────────────────────────────────────────────
function renderList(filter = "") {
  const showPron = $("show-pron-toggle").checked;
  const container = $("vocab-list");
  let data = getFiltered();
  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(v => v.de.toLowerCase().includes(q) || v.tr.toLowerCase().includes(q));
  }

  // Group by sub
  const groups = {};
  data.forEach(v => {
    if (!groups[v.sub]) groups[v.sub] = [];
    groups[v.sub].push(v);
  });

  container.innerHTML = Object.entries(groups).map(([sub, words]) => `
    <div class="list-group">
      <h3 class="list-group-title">${sub}</h3>
      <table class="vocab-table">
        <thead><tr>
          <th>Deutsch</th><th>Türkisch</th>
          ${showPron ? "<th>Aussprache</th>" : ""}
          <th>Gelernt</th>
        </tr></thead>
        <tbody>
          ${words.map(v => `
            <tr class="${state.learned.has(v.id) ? "row-learned" : ""}">
              <td>${v.de}</td>
              <td class="tr-word-cell">
                <span class="tr-word">${v.tr}</span>
                ${ttsAvailable ? `<button class="speak-row-btn" data-tr="${v.tr.replace(/"/g,"&quot;")}" title="Vorlesen">🔊</button>` : ""}
              </td>
              ${showPron ? `<td class="pron-cell">${v.pron}</td>` : ""}
              <td><button class="mark-row-btn ${state.learned.has(v.id) ? "marked" : ""}" data-id="${v.id}">${state.learned.has(v.id) ? "★" : "☆"}</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("") || "<p class='no-results'>Keine Wörter gefunden.</p>";

  // Attach list mark buttons
  $$(".mark-row-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      toggleLearned(id);
      renderList($("list-search").value);
    });
  });

  // Attach list speak buttons
  $$(".speak-row-btn").forEach(btn => {
    btn.addEventListener("click", () => speak(btn.dataset.tr));
  });
}

// ─── SPEAKER CARD ────────────────────────────────────────────────────────────
let spDeck = [];
let spIdx  = 0;

function renderSpeakerCard() {
  if (spDeck.length === 0) spDeck = shuffle(VOCABULARY);
  const card = spDeck[spIdx % spDeck.length];
  $("sp-de").textContent   = card.de;
  $("sp-tr").textContent   = card.tr;
  $("sp-pron").textContent = card.pron;
  $("speaker-card").classList.remove("flipped");
}

// ─── LEARNED TOGGLE ──────────────────────────────────────────────────────────
function toggleLearned(id) {
  if (state.learned.has(id)) {
    state.learned.delete(id);
  } else {
    state.learned.add(id);
  }
  saveProgress();
  updateProgress();
  renderCard();
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  initSpeech();
  loadProgress();
  $("total-count").textContent = VOCABULARY.length;
  populateSubFilter();
  buildDeck();
  state._randomDir = "de-tr";
  renderCard();
  updateProgress();
  renderSpeakerCard();

  // ── Tab buttons ──
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ── Category filter ──
  $$(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeCat = btn.dataset.cat;
      state.activeSub = "all";
      populateSubFilter();
      buildDeck();
      renderCard();
    });
  });

  // ── Sub-category filter ──
  $("sub-filter").addEventListener("change", e => {
    state.activeSub = e.target.value;
    buildDeck();
    renderCard();
  });

  // ── Direction buttons ──
  $$(".dir-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".dir-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.dir = btn.dataset.dir;
      if (state.dir === "random") state._randomDir = Math.random() < 0.5 ? "de-tr" : "tr-de";
      buildDeck();
      renderCard();
    });
  });

  // ── Card speak button (must not propagate to flip) ──
  $("card-speak-btn").addEventListener("click", e => {
    e.stopPropagation();
    speakCurrentCardTurkish();
  });

  // ── Speaker card speak button ──
  $("sp-speak-btn").addEventListener("click", e => {
    e.stopPropagation();
    speakSpeakerCard();
  });

  // ── Flashcard flip ──
  $("flashcard").addEventListener("click", flipCard);
  $("flashcard").addEventListener("keydown", e => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipCard(); }
    if (e.key === "ArrowRight") nextCard();
    if (e.key === "ArrowLeft")  prevCard();
  });

  // ── Navigation ──
  $("next-btn").addEventListener("click", nextCard);
  $("prev-btn").addEventListener("click", prevCard);

  $("right-btn").addEventListener("click", () => {
    const card = currentCard();
    if (card) { state.learned.add(card.id); saveProgress(); updateProgress(); }
    nextCard();
  });

  $("wrong-btn").addEventListener("click", () => {
    nextCard();
  });

  $("shuffle-btn").addEventListener("click", () => {
    state.deck = shuffle(state.deck);
    state.cardIndex = 0;
    state.cardFlipped = false;
    renderCard();
  });

  $("learned-only-btn").addEventListener("click", () => {
    state.showLearnedOnly = !state.showLearnedOnly;
    $("learned-only-btn").classList.toggle("active", state.showLearnedOnly);
    $("learned-only-btn").textContent = state.showLearnedOnly ? "⭐ Alle anzeigen" : "⭐ Gelernte anzeigen";
    buildDeck();
    renderCard();
  });

  $("mark-btn").addEventListener("click", () => {
    const card = currentCard();
    if (card) toggleLearned(card.id);
  });

  // ── Quiz ──
  $("start-quiz-btn").addEventListener("click", () => {
    const count = parseInt($("quiz-count").value);
    buildQuizQuestions(count);
    if (state.quiz.questions.length < 4) return;
    $("quiz-start").style.display  = "none";
    $("quiz-run").style.display    = "block";
    $("quiz-result").style.display = "none";
    renderQuizQuestion();
  });

  $("restart-quiz-btn").addEventListener("click", () => {
    $("quiz-start").style.display  = "block";
    $("quiz-run").style.display    = "none";
    $("quiz-result").style.display = "none";
  });

  // ── List search ──
  $("list-search").addEventListener("input", e => renderList(e.target.value));
  $("show-pron-toggle").addEventListener("change", () => renderList($("list-search").value));

  // ── Speaker card ──
  $("speaker-card").addEventListener("click", () => $("speaker-card").classList.toggle("flipped"));
  $("sp-next-btn").addEventListener("click", () => {
    spIdx++;
    $("speaker-card").classList.remove("flipped");
    setTimeout(renderSpeakerCard, 150);
  });

  // ── Reset progress ──
  $("reset-btn").addEventListener("click", () => {
    if (confirm("Gesamten Fortschritt zurücksetzen?")) {
      state.learned.clear();
      saveProgress();
      updateProgress();
      renderCard();
    }
  });

  // ── Keyboard shortcuts ──
  document.addEventListener("keydown", e => {
    if (document.activeElement === $("list-search")) return;
    if (e.key === "ArrowRight") nextCard();
    if (e.key === "ArrowLeft")  prevCard();
    if (e.key === " ")          { e.preventDefault(); flipCard(); }
  });
}

document.addEventListener("DOMContentLoaded", init);
