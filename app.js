// ─── STATE ──────────────────────────────────────────────────────────────────
const state = {
  activeCat: "all",
  activeSub: "all",
  dir: "de-tr",           // "de-tr" | "tr-de" | "random"
  cardIndex: 0,
  cardFlipped: false,
  showLearnedOnly: false,
  srsMode: false,
  deck: [],
  learned: new Set(),
  correct: new Set(),
  quiz: {
    questions: [],
    current: 0,
    right: 0,
    wrong: 0,
    answered: false,
    results: [],
  },
};

// ─── SPACED REPETITION (SM-2) ────────────────────────────────────────────────
const SRS_KEY = "tuerkisch_srs_v1";
let srsData = {};

function loadSRS() {
  try {
    const raw = localStorage.getItem(SRS_KEY);
    if (raw) srsData = JSON.parse(raw);
  } catch(_) {}
}

function saveSRS() {
  localStorage.setItem(SRS_KEY, JSON.stringify(srsData));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Returns how many days until next review
function sm2Update(id, quality) {
  const s = srsData[id] || { interval: 0, repetitions: 0, ef: 2.5 };
  let { interval, repetitions, ef } = s;

  if (quality < 3) {
    interval = 1;
    repetitions = 0;
  } else {
    if (repetitions === 0)      interval = 1;
    else if (repetitions === 1) interval = 6;
    else                        interval = Math.round(interval * ef);
    repetitions++;
    ef = Math.max(1.3, ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  }

  const due = new Date();
  due.setDate(due.getDate() + interval);
  srsData[id] = { interval, repetitions, ef, dueDate: due.toISOString().slice(0, 10), lastReview: todayISO() };
  saveSRS();
  return interval;
}

function buildSRSDeck(pool) {
  const today = todayISO();
  const due = pool
    .filter(c => { const s = srsData[c.id]; return s && s.dueDate <= today; })
    .sort((a, b) => srsData[a.id].dueDate.localeCompare(srsData[b.id].dueDate));
  const newCards = pool.filter(c => !srsData[c.id]).slice(0, 10);
  return [...due, ...newCards];
}

function countDueToday() {
  const today = todayISO();
  return VOCABULARY.filter(c => { const s = srsData[c.id]; return s && s.dueDate <= today; }).length;
}

function updateDueBadge() {
  const badge = $("due-badge");
  const n = countDueToday();
  if (state.srsMode && n > 0) {
    badge.textContent = `${n} fällig`;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

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
  const pool = getFiltered();
  state.deck = state.srsMode ? buildSRSDeck(pool) : pool;
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

// ─── SPEECH RECOGNITION ──────────────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition     = null;
let sttAvailable    = false;
let micGotResult    = false;   // did onresult fire before onend?
let micTimeout      = null;    // safety timeout handle

function initRecognition() {
  if (!SpeechRecognition) return;
  sttAvailable = true;
  recognition = new SpeechRecognition();
  recognition.lang             = "tr-TR";
  recognition.interimResults   = false;
  recognition.continuous       = false;
  recognition.maxAlternatives  = 5;

  recognition.onstart = () => {
    micGotResult = false;
    // Safety timeout: iOS sometimes never fires onend — force-stop after 7s
    clearTimeout(micTimeout);
    micTimeout = setTimeout(() => {
      try { recognition.stop(); } catch(_) {}
    }, 7000);
  };

  recognition.onresult = e => {
    micGotResult = true;
    clearTimeout(micTimeout);
    const alternatives = Array.from(e.results[0]).map(r => r.transcript.trim());
    handleRecognitionResult(alternatives);
  };

  recognition.onerror = e => {
    clearTimeout(micTimeout);
    micGotResult = true;   // prevent onend from showing duplicate message
    if (e.error === "not-allowed") {
      showMicResult("❌ Mikrofon-Zugriff verweigert\nIn Safari: Einstellungen → Websites → Mikrofon", "wrong");
    } else if (e.error === "no-speech") {
      showMicResult("⚠️ Nichts gehört", "neutral");
    } else {
      showMicResult(`⚠️ Fehler: ${e.error}`, "neutral");
    }
    resetMicBtn();
  };

  // onend always fires last — if no result arrived, mic hung silently on iOS
  recognition.onend = () => {
    clearTimeout(micTimeout);
    if (!micGotResult) {
      showMicResult("⚠️ Nichts gehört – nochmal tippen", "neutral");
    }
    resetMicBtn();
  };
}

// Normalize Turkish text for comparison: lowercase, remove punctuation
function normalizeTr(s) {
  return s.toLowerCase()
    .replace(/[.,!?;:"""''()\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple edit distance for fuzzy matching
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function handleRecognitionResult(alternatives) {
  const card = currentCard();
  if (!card) return;

  const target  = normalizeTr(card.tr);
  const heard   = alternatives[0];
  const heardN  = normalizeTr(heard);

  // Check all alternatives for any match
  const bestDist = alternatives.reduce((best, alt) => {
    return Math.min(best, editDistance(normalizeTr(alt), target));
  }, Infinity);

  const maxLen  = Math.max(target.length, heardN.length);
  const ratio   = bestDist / maxLen;   // 0 = perfect, 1 = completely different

  let icon, label, cls;
  if (ratio === 0) {
    icon = "✅"; label = "Perfekt!"; cls = "correct";
  } else if (ratio <= 0.25) {
    icon = "🟡"; label = "Fast richtig!"; cls = "close";
  } else if (ratio <= 0.5) {
    icon = "⚠️"; label = "Nochmal üben"; cls = "neutral";
  } else {
    icon = "❌"; label = "Nicht erkannt"; cls = "wrong";
  }

  showMicResult(`Gehört: „${heard}"\n${icon} ${label}`, cls);

  // Auto-flip to show correct answer after a moment
  if (!state.cardFlipped) {
    setTimeout(() => {
      state.cardFlipped = true;
      $("flashcard").classList.add("flipped");
    }, 1200);
  }
}

function showMicResult(text, cls) {
  const result  = $("mic-result");
  const heard   = $("mic-heard");
  const verdict = $("mic-verdict");
  const lines   = text.split("\n");
  heard.textContent   = lines[0] || "";
  verdict.textContent = lines[1] || "";
  verdict.className   = "mic-verdict mic-verdict--" + cls;
  result.style.display = "flex";
  $("flip-hint").style.display = "none";
}


let micActive = false;

function startRecognition() {
  if (!recognition) return;

  // If already listening, stop on second tap
  if (micActive) {
    try { recognition.stop(); } catch(_) {}
    return;
  }

  micActive = true;
  $("mic-result").style.display = "none";
  $("flip-hint").style.display  = "block";
  const btn = $("mic-btn");
  btn.textContent = "⏹ Stopp";
  btn.classList.add("mic-listening");
  btn.disabled = false;   // keep enabled so user can tap to stop
  try { recognition.start(); } catch(_) {}
}

function resetMicBtn() {
  micActive = false;
  const btn = $("mic-btn");
  if (!btn) return;
  btn.textContent = "🎤 Sprechen";
  btn.classList.remove("mic-listening");
  btn.disabled = false;
}

// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-content").forEach(s => s.classList.toggle("active", s.id === `tab-${name}`));
  if (name === "list")      renderList();
  if (name === "dialogues") renderDialogues();
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
  // SRS completion screen
  const complete = $("srs-complete");
  const flashcard = $("flashcard");
  if (state.srsMode && state.deck.length === 0) {
    complete.style.display = "flex";
    flashcard.style.display = "none";
    const due = countDueToday();
    $("srs-complete-msg").textContent = due > 0
      ? `${due} Karte${due === 1 ? "" : "n"} morgen fällig.`
      : "Morgen gibt es neue Karten.";
    updateDueBadge();
    return;
  }
  complete.style.display = "none";
  flashcard.style.display = "";

  const card = currentCard();
  const flipped = state.cardFlipped;

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

  // Mic button: show only on DE→TR cards (user should say the Turkish word)
  const micBtn = $("mic-btn");
  const showMic = sttAvailable && effectiveDir === "de-tr";
  micBtn.style.display = showMic ? "inline-flex" : "none";
  // Reset mic state on card change
  $("mic-result").style.display = "none";
  $("flip-hint").style.display  = "block";
  resetMicBtn();

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

// ─── SRS FEEDBACK ────────────────────────────────────────────────────────────
function showSRSFeedback(text, cls) {
  const el = $("srs-feedback");
  el.textContent = text;
  el.className = "srs-feedback srs-feedback--" + cls;
  el.style.display = "block";
}
function hideSRSFeedback() {
  $("srs-feedback").style.display = "none";
}

// ─── DIALOGUES ───────────────────────────────────────────────────────────────
function renderDialogues() {
  const container = $("dialogues-list");
  container.innerHTML = DIALOGUES.map(d => `
    <div class="dialogue-card">
      <button class="dialogue-header" data-id="${d.id}">
        <span class="d-emoji">${d.emoji}</span>
        <span class="d-title">${d.title}</span>
        <span class="d-sub">${d.sub}</span>
        <span class="d-chevron">▾</span>
      </button>
      <div class="dialogue-body" id="dbody-${d.id}" style="display:none">
        ${d.lines.map((l, i) => `
          <div class="d-line d-line--${l.speaker.toLowerCase()}">
            <div class="d-role">${l.role}</div>
            <div class="d-bubble">
              <div class="d-tr">${l.tr}</div>
              <div class="d-de">${l.de}</div>
              <div class="d-pron">${l.pron}</div>
            </div>
            ${ttsAvailable ? `<button class="d-speak" data-tr="${l.tr.replace(/"/g, "&quot;")}" title="Vorlesen">🔊</button>` : ""}
          </div>
        `).join("")}
        <div class="dialogue-practice-bar">
          <button class="btn btn-primary d-quiz-btn" data-id="${d.id}">Diesen Dialog üben</button>
        </div>
      </div>
    </div>
  `).join("");

  // Toggle open/close
  $$(".dialogue-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const body = $("dbody-" + btn.dataset.id);
      const open = body.style.display !== "none";
      // Close all others
      $$(".dialogue-body").forEach(b => b.style.display = "none");
      $$(".d-chevron").forEach(c => c.textContent = "▾");
      if (!open) {
        body.style.display = "block";
        btn.querySelector(".d-chevron").textContent = "▴";
      }
    });
  });

  // Speak buttons
  $$(".d-speak").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      speak(btn.dataset.tr);
    });
  });

  // Practice this dialogue: load its words into SRS deck
  $$(".d-quiz-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const d = DIALOGUES.find(x => x.id === btn.dataset.id);
      if (!d) return;
      // Switch to cards tab, filter to the lines of this dialogue as a temporary deck
      state.deck = d.lines.map((l, i) => ({
        id: 9000 + i,
        de: l.de,
        tr: l.tr,
        pron: l.pron,
        cat: "dialogue",
        sub: d.title,
      }));
      state.cardIndex = 0;
      state.cardFlipped = false;
      switchTab("cards");
      renderCard();
    });
  });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  // Register service worker for offline support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  initSpeech();
  initRecognition();
  loadSRS();
  loadProgress();
  $("total-count").textContent = VOCABULARY.length;
  populateSubFilter();
  buildDeck();
  state._randomDir = "de-tr";
  renderCard();
  updateProgress();
  renderSpeakerCard();

  updateDueBadge();

  // ── Tab buttons ──
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ── SRS toggle ──
  $("srs-btn").addEventListener("click", () => {
    state.srsMode = !state.srsMode;
    $("srs-btn").classList.toggle("active", state.srsMode);
    $("shuffle-btn").style.display = state.srsMode ? "none" : "";
    buildDeck();
    renderCard();
    updateDueBadge();
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

  // ── Mic button ──
  $("mic-btn").addEventListener("click", e => {
    e.stopPropagation();
    startRecognition();
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
    if (!card) return;
    state.learned.add(card.id);
    saveProgress();
    updateProgress();
    if (state.srsMode) {
      const days = sm2Update(card.id, 4);
      showSRSFeedback(`✓ Gewusst — Wiederholung in ${days} Tag${days === 1 ? "" : "en"}`, "correct");
      setTimeout(() => { hideSRSFeedback(); nextCard(); }, 1400);
    } else {
      nextCard();
    }
  });

  $("wrong-btn").addEventListener("click", () => {
    const card = currentCard();
    if (state.srsMode && card) {
      sm2Update(card.id, 1);
      showSRSFeedback("✗ Nochmal — morgen wieder", "wrong");
      setTimeout(() => { hideSRSFeedback(); nextCard(); }, 1400);
    } else {
      nextCard();
    }
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
