/* GUITAR 指板记忆
 * 在参考站（cbs.lljy.de 贝斯指板记忆）的基础上改造：
 * - 指板替换为六弦标准吉他（E A D G B E，从上到下为 1~6 弦）
 * - 完整保留原站交互：乱序出题、自动切换/自动显示答案、包含升降号、
 *   快捷键、练习次数持久化
 * - 新增「练习模式」：点击指板作答、即时对错反馈、难度分级、计分与成绩汇总
 */

const NOTES = [
  { key: "C", display: "C", pitch: "C" },
  { key: "Cs", display: "C♯", pitch: "C#" },
  { key: "Db", display: "D♭", pitch: "C#" },
  { key: "D", display: "D", pitch: "D" },
  { key: "Ds", display: "D♯", pitch: "D#" },
  { key: "Eb", display: "E♭", pitch: "D#" },
  { key: "E", display: "E", pitch: "E" },
  { key: "F", display: "F", pitch: "F" },
  { key: "Fs", display: "F♯", pitch: "F#" },
  { key: "Gb", display: "G♭", pitch: "F#" },
  { key: "G", display: "G", pitch: "G" },
  { key: "Gs", display: "G♯", pitch: "G#" },
  { key: "Ab", display: "A♭", pitch: "G#" },
  { key: "A", display: "A", pitch: "A" },
  { key: "As", display: "A♯", pitch: "A#" },
  { key: "Bb", display: "B♭", pitch: "A#" },
  { key: "B", display: "B", pitch: "B" },
];
const ROUND_STORAGE_KEY = "guitar-fretboard-round-count";
const BEST_STORAGE_PREFIX = "guitar-fretboard-best-";
const FRET_RANGE_STORAGE_KEY = "guitar-fretboard-fret-range";
const STRING_STORAGE_KEY = "guitar-fretboard-strings";
const MIN_FRET = 0;
const MAX_FRET = 24;
const DEFAULT_FRET_RANGE = { min: MIN_FRET, max: 12 };
const NATURAL_NOTE_KEYS = new Set(["C", "D", "E", "F", "G", "A", "B"]);
const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_DISPLAY = {
  C: "C", "C#": "C♯", D: "D", "D#": "D♯", E: "E", F: "F",
  "F#": "F♯", G: "G", "G#": "G♯", A: "A", "A#": "A♯", B: "B",
};

/**
 * 将指定元素移动到视口正中央（水平 + 垂直居中）
 * 适用于弹窗、浮层、提示等需要脱离文档流居中的场景；
 * 日常布局居中请优先使用 CSS flex/grid，避免遮挡其他内容。
 * @param {string|Element} target - CSS 选择器或 DOM 元素
 * @param {Object} options
 * @param {('fixed'|'absolute')} options.position - 定位方式，默认 fixed
 * @param {boolean} options.keepOnResize - 窗口缩放时是否保持居中，默认 true
 * @returns {function} cleanup - 调用可移除居中样式与 resize 监听
 */
function centerInViewport(target, options = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || !(el instanceof Element)) {
    console.error('centerInViewport: 未找到目标元素');
    return () => {};
  }

  const { position = 'fixed', keepOnResize = true } = options;

  function applyCenter() {
    const rect = el.getBoundingClientRect();
    const elW = rect.width;
    const elH = rect.height;
    const left = (window.innerWidth - elW) / 2;
    const top = (window.innerHeight - elH) / 2;

    el.style.position = position;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
    el.style.transform = 'none';
    if (getComputedStyle(el).zIndex === 'auto') {
      el.style.zIndex = '9999';
    }
  }

  applyCenter();

  let resizeHandler;
  if (keepOnResize) {
    resizeHandler = () => requestAnimationFrame(applyCenter);
    window.addEventListener('resize', resizeHandler);
  }

  return function cleanup() {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
    }
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.margin = '';
    el.style.transform = '';
    if (el.style.zIndex === '9999') el.style.zIndex = '';
  };
}

// 六弦标准调弦，从上到下为 1 弦(高音 E) 至 6 弦(低音 E)
// 标准六弦吉他定弦（从上到下 1~6 弦：高音E、B、G、D、A、低音E）
// name 直接由 pitch 推导（CHROMATIC[pitch]），保证「空弦音标识」与「实际音高」永不脱节、无法错乱
const STRINGS = [
  { name: CHROMATIC[4], pitch: 4, size: 1.2 }, // 1弦 高音 E
  { name: CHROMATIC[11], pitch: 11, size: 1.6 }, // 2弦 B
  { name: CHROMATIC[7], pitch: 7, size: 2.0 }, // 3弦 G
  { name: CHROMATIC[2], pitch: 2, size: 2.5 }, // 4弦 D
  { name: CHROMATIC[9], pitch: 9, size: 3.0 }, // 5弦 A
  { name: CHROMATIC[4], pitch: 4, size: 3.6 }, // 6弦 低音 E
];
// 弦序号 1-6（索引 0 = 一弦高音E … 索引 5 = 六弦低音E）
const ALL_STRINGS = STRINGS.map((_, index) => index + 1);

// 练习难度现在由用户通过双滑块自由设定品格区间 [minFret, maxFret]
function loadFretRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(FRET_RANGE_STORAGE_KEY));
    if (
      saved &&
      Number.isFinite(saved.min) &&
      Number.isFinite(saved.max) &&
      saved.min >= MIN_FRET &&
      saved.max <= MAX_FRET &&
      saved.min <= saved.max
    ) {
      return { min: saved.min, max: saved.max };
    }
  } catch {
    // fall back to default
  }
  return { ...DEFAULT_FRET_RANGE };
}

function saveFretRange(range) {
  try {
    localStorage.setItem(FRET_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // ignore
  }
}

// 练习难度：用户可单独或组合勾选琴弦（1-6）。
// 默认「全灰、按需选择」——初始不点亮任何弦，由用户主动点击选取。
// 历史存储若恰好等于「六根全选」，视为旧版默认（非用户显式选择），回落到空（全灰）。
function loadStrings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STRING_STORAGE_KEY));
    if (Array.isArray(saved) && saved.length > 0 && saved.every((n) => ALL_STRINGS.includes(Number(n)))) {
      const nums = saved.map(Number).sort((a, b) => a - b);
      const allSelected = nums.length === ALL_STRINGS.length && ALL_STRINGS.every((n) => nums.includes(n));
      if (!allSelected) return nums;
    }
  } catch {
    // fall back to default
  }
  return [];
}

function saveStrings(strings) {
  try {
    localStorage.setItem(STRING_STORAGE_KEY, JSON.stringify(strings));
  } catch {
    // ignore
  }
}

function createShuffledGroup(previousNote = null, notePool = NOTES) {
  const group = [...notePool];

  for (let index = group.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [group[index], group[randomIndex]] = [group[randomIndex], group[index]];
  }

  if (group[0]?.key === previousNote?.key) {
    const swapIndex = 1 + Math.floor(Math.random() * (group.length - 1));
    [group[0], group[swapIndex]] = [group[swapIndex], group[0]];
  }

  return group;
}

function loadRoundCount() {
  try {
    const saved = Number.parseInt(localStorage.getItem(ROUND_STORAGE_KEY), 10);
    return Number.isFinite(saved) && saved >= 1 ? saved : 1;
  } catch {
    return 1;
  }
}

function saveRoundCount(count) {
  try {
    localStorage.setItem(ROUND_STORAGE_KEY, String(count));
  } catch {
    // The counter still works for the current session when storage is unavailable.
  }
}

const firstGroup = createShuffledGroup();
const initialFretRange = loadFretRange();
// 朗读相关音频模块已移除：不再使用真人录音 / Web Speech 合成。

const state = {
  note: firstGroup.shift(),
  noteQueue: firstGroup,
  round: loadRoundCount(),
  answerVisible: false,
  startedAt: performance.now(),
  animationFrame: null,
  mode: "browse", // browse | practice
  summaryOpen: false,
  practice: {
    started: false,
    accidentals: false,
    fretRange: { ...initialFretRange },
    strings: loadStrings(),
    roundTotal: 0,
    roundStartedAt: 0,
    completed: 0,
    firstTry: 0,
    wrongClicks: 0,
    wrongInQuestion: 0,
    phase: "pending", // pending | done
    firstClick: true,
    advanceTimer: null,
  },
};

const elements = {
  currentNote: document.querySelector("#currentNote"),
  noteCard: document.querySelector(".note-card"),
  roundCount: document.querySelector("#roundCount"),
  fretboard: document.querySelector("#fretboard"),
  fretNumbers: document.querySelector("#fretNumbers"),
  answerStatus: document.querySelector("#answerStatus"),
  revealButton: document.querySelector("#revealButton"),
  nextButton: document.querySelector("#nextButton"),
  instruction: document.querySelector("#instruction"),
  sectionKicker: document.querySelector("#sectionKicker"),
  autoNextToggle: document.querySelector("#autoNextToggle"),
  autoNextSeconds: document.querySelector("#autoNextSeconds"),
  autoNextBpm: document.querySelector("#autoNextBpm"),
  autoNextSetting: document.querySelector("#autoNextSetting"),
  autoRevealToggle: document.querySelector("#autoRevealToggle"),
  autoRevealSeconds: document.querySelector("#autoRevealSeconds"),
  autoRevealSetting: document.querySelector("#autoRevealSetting"),
  autoRevealCard: document.querySelector("#autoRevealCard"),
  accidentalsToggle: document.querySelector("#accidentalsToggle"),
  accidentalsCard: document.querySelector("#accidentalsCard"),
  difficultyCard: document.querySelector("#difficultyCard"),
  fretRangeMin: document.querySelector("#fretRangeMin"),
  fretRangeMax: document.querySelector("#fretRangeMax"),
  fretRangeMinInput: document.querySelector("#fretRangeMinInput"),
  fretRangeMaxInput: document.querySelector("#fretRangeMaxInput"),
  fretRangeFill: document.querySelector("#fretRangeFill"),
  stringButtons: document.querySelectorAll("#stringButtons .string-btn"),
  browseModeTab: document.querySelector("#browseModeTab"),
  practiceModeTab: document.querySelector("#practiceModeTab"),
  practiceStats: document.querySelector("#practiceStats"),
  statProgress: document.querySelector("#statProgress"),
  statCorrect: document.querySelector("#statCorrect"),
  statWrong: document.querySelector("#statWrong"),
  statAccuracy: document.querySelector("#statAccuracy"),
  statBest: document.querySelector("#statBest"),
  summaryOverlay: document.querySelector("#summaryOverlay"),
  summarySub: document.querySelector("#summarySub"),
  summaryTotal: document.querySelector("#summaryTotal"),
  summaryCorrect: document.querySelector("#summaryCorrect"),
  summaryAccuracy: document.querySelector("#summaryAccuracy"),
  summaryTime: document.querySelector("#summaryTime"),
  summaryAvg: document.querySelector("#summaryAvg"),
  summaryBest: document.querySelector("#summaryBest"),
  summaryAgain: document.querySelector("#summaryAgain"),
  nextProgress: document.querySelector("#nextProgress"),
  revealProgress: document.querySelector("#revealProgress"),
};

function getActiveNotes() {
  return elements.accidentalsToggle.checked
    ? NOTES
    : NOTES.filter((note) => NATURAL_NOTE_KEYS.has(note.key));
}

function buildFretboard() {
  for (let fret = 0; fret <= MAX_FRET; fret += 1) {
    const number = document.createElement("span");
    number.textContent = fret === 0 ? "空弦" : String(fret);
    elements.fretNumbers.append(number);
  }

  STRINGS.forEach((string, stringIndex) => {
    const row = stringIndex + 1;
    for (let fret = 0; fret <= MAX_FRET; fret += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `fret-cell${fret === 0 ? " open" : ""}`;
      cell.style.setProperty("--string-size", `${string.size}px`);
      cell.style.gridColumn = String(fret + 1);
      cell.style.gridRow = String(row);
      cell.dataset.string = string.name;
      cell.dataset.stringIndex = String(stringIndex + 1);
      cell.dataset.fret = String(fret);

      if (fret === 0) {
        const label = document.createElement("span");
        label.className = "string-label";
        label.textContent = string.name;
        cell.append(label);
      }

      const pitchName = CHROMATIC[(string.pitch + fret) % 12];
      cell.dataset.pitch = pitchName;
      const answer = document.createElement("span");
      answer.className = "answer-note";
      answer.dataset.pitch = pitchName;
      cell.append(answer);

      cell.addEventListener("click", () => onCellClick(cell));
      elements.fretboard.append(cell);
    }
  });

  // 品记：按真实吉他位置绘制在指板格子内（单点 3/5/7/9/15/17/19/21，双点 12/24）
  const singleInlays = [3, 5, 7, 9, 15, 17, 19, 21];
  const doubleInlays = [12, 24];
  singleInlays.forEach((fret) => {
    const marker = document.createElement("span");
    marker.className = "fret-inlay fret-inlay-single";
    marker.style.gridColumn = String(fret + 1); // +1 因为第 1 列是弦标签
    marker.style.gridRow = "3 / 5"; // 位于第 3、4 弦之间（中央）
    elements.fretboard.append(marker);
  });
  doubleInlays.forEach((fret) => {
    const upper = document.createElement("span");
    upper.className = "fret-inlay fret-inlay-double";
    upper.style.gridColumn = String(fret + 1);
    upper.style.gridRow = "2 / 4"; // 第 2、3 弦之间
    elements.fretboard.append(upper);

    const lower = document.createElement("span");
    lower.className = "fret-inlay fret-inlay-double";
    lower.style.gridColumn = String(fret + 1);
    lower.style.gridRow = "4 / 6"; // 第 4、5 弦之间
    elements.fretboard.append(lower);
  });
}

function clampNumber(input) {
  const parsed = Number.parseFloat(input.value);
  const value = Number.isFinite(parsed) ? parsed : Number(input.min);
  const clamped = Math.min(Number(input.max), Math.max(Number(input.min), value));
  const decimals = input.step.includes(".") ? 2 : 0;
  input.value = String(Number(clamped.toFixed(decimals)));
  return Number(input.value);
}

function setNumber(input, value) {
  const decimals = input.step.includes(".") ? 2 : 0;
  input.value = String(Number(value.toFixed(decimals)));
  clampNumber(input);
}

function syncSpeed(changed) {
  clampNumber(changed);
  if (changed === elements.autoNextSeconds) {
    setNumber(elements.autoNextBpm, 60 / Number(elements.autoNextSeconds.value));
  } else {
    setNumber(elements.autoNextSeconds, 60 / Number(elements.autoNextBpm.value));
  }
  state.startedAt = performance.now();
}

function updateMatches() {
  document.querySelectorAll(".answer-note").forEach((marker) => {
    const matches = marker.dataset.pitch === state.note.pitch;
    marker.classList.toggle("match", matches);
    marker.textContent = matches ? state.note.display : "";
  });
}

function renderCurrentNote() {
  const display = state.note.display;
  if (display.length > 1) {
    const base = display[0];
    const accidental = display.slice(1);
    // 主音字母保持居中，升降号作为右上角小标，避免撑开整体导致视觉偏左
    elements.currentNote.innerHTML = `${base}<span class="note-accidental">${accidental}</span>`;
  } else {
    elements.currentNote.textContent = display;
  }
  elements.noteCard.classList.toggle("accidental", display.length > 1);
}

function setAnswerStatus(text, visible = false) {
  elements.answerStatus.classList.toggle("visible", visible);
  elements.answerStatus.lastElementChild.textContent = text;
}

function setAnswerVisible(visible, statusText) {
  state.answerVisible = visible;
  elements.fretboard.classList.toggle("show-answer", visible);
  setAnswerStatus(
    statusText ?? (visible ? `已显示 ${state.note.display} 的位置` : "答案已隐藏"),
    visible,
  );
  elements.revealButton.lastElementChild.textContent = visible ? "隐藏答案" : "显示答案";
  elements.revealButton.setAttribute("aria-pressed", String(visible));
}


/* ---------- 练习模式：点击作答 / 计分 ---------- */

function getPracticeNotes() {
  const base = state.practice.accidentals
    ? NOTES
    : NOTES.filter((note) => NATURAL_NOTE_KEYS.has(note.key));
  const { min, max } = state.practice.fretRange;
  const strings = state.practice.strings;

  // 只保留在「选中弦组 + 当前品格区间」内至少有一个位置的音名
  return base.filter((note) =>
    strings.some((stringIndex) => {
      const pitch = STRINGS[stringIndex - 1].pitch;
      for (let fret = min; fret <= max; fret += 1) {
        if (CHROMATIC[(pitch + fret) % 12] === note.pitch) return true;
      }
      return false;
    }),
  );
}

function getBestKey() {
  const { min, max } = state.practice.fretRange;
  const acc = state.practice.accidentals ? 1 : 0;
  const str = state.practice.strings.slice().sort().join("");
  return `${min}-${max}-${str}-${acc}`;
}

function getBestForDifficulty() {
  try {
    return Number(localStorage.getItem(BEST_STORAGE_PREFIX + getBestKey())) || 0;
  } catch {
    return 0;
  }
}

function updateStats() {
  const { completed, roundTotal, firstTry } = state.practice;
  elements.statProgress.textContent = `${Math.min(completed, roundTotal)} / ${roundTotal}`;
  elements.statCorrect.textContent = String(firstTry);
  elements.statWrong.textContent = String(completed - firstTry);
  elements.statAccuracy.textContent = completed > 0 ? `${Math.round((firstTry / completed) * 100)}%` : "—";
  elements.statBest.textContent = `${getBestForDifficulty()}%`;
}

function updateDimmedCells() {
  const practice = state.mode === "practice";
  const { min, max } = practice ? state.practice.fretRange : { min: MIN_FRET, max: MAX_FRET };
  const activeStrings = practice ? state.practice.strings : ALL_STRINGS;
  document.querySelectorAll(".fret-cell").forEach((cell) => {
    const fret = Number(cell.dataset.fret);
    const stringIndex = Number(cell.dataset.stringIndex);
    const inRange = fret >= min && fret <= max;
    const inStrings = activeStrings.includes(stringIndex);
    cell.classList.toggle("dimmed", !(inRange && inStrings));
  });
}

function clearCellFeedback() {
  document.querySelectorAll(".fret-cell.miss, .fret-cell.hit").forEach((cell) => {
    cell.classList.remove("miss", "hit");
  });
}

function startQuestion() {
  if (state.mode !== "practice") return;
  state.practice.phase = "pending";
  state.practice.firstClick = true;
  state.practice.wrongInQuestion = 0;
  clearCellFeedback();
  setAnswerVisible(false);
  setAnswerStatus(`在指板上找出 ${state.note.display} 的位置`);
  updateStats();
}

function countSkip() {
  if (state.mode !== "practice" || state.practice.phase !== "pending") return;
  state.practice.phase = "done";
  state.practice.firstClick = false;
  state.practice.completed += 1;
  state.practice.wrongClicks += 1;
  updateStats();
}

function onCellClick(cell) {
  if (state.mode !== "practice" || state.practice.phase !== "pending" || state.summaryOpen) return;

  if (cell.dataset.pitch === state.note.pitch) {
    cell.blur();
    state.practice.completed += 1;
    state.practice.phase = "done";
    if (state.practice.firstClick) state.practice.firstTry += 1;
    const suffix = state.practice.wrongInQuestion > 0
      ? `（本题先错过 ${state.practice.wrongInQuestion} 次）`
      : "";
    setAnswerVisible(true, `答对了！已显示 ${state.note.display} 的位置${suffix}`);
    cell.classList.add("hit");
    updateStats();
    clearTimeout(state.practice.advanceTimer);
    state.practice.advanceTimer = setTimeout(() => newRound(), 1500);
  } else {
    cell.blur();
    state.practice.firstClick = false;
    state.practice.wrongInQuestion += 1;
    state.practice.wrongClicks += 1;
    cell.classList.remove("miss");
    void cell.offsetWidth;
    cell.classList.add("miss");
    setAnswerStatus(`不对，这个位置是 ${PITCH_DISPLAY[cell.dataset.pitch] ?? cell.dataset.pitch}，再试试`);
    setTimeout(() => cell.classList.remove("miss"), 640);
  }
}

function handleReveal() {
  if (state.mode === "practice") {
    if (state.practice.phase === "pending" && !state.summaryOpen) {
      countSkip();
      setAnswerVisible(true, `已显示 ${state.note.display} 的位置（本题跳过）`);
      clearTimeout(state.practice.advanceTimer);
      state.practice.advanceTimer = setTimeout(() => newRound(), 1600);
    }
    return;
  }
  setAnswerVisible(!state.answerVisible);
}

function formatTime(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function finishPracticeRound() {
  state.summaryOpen = true;
  clearTimeout(state.practice.advanceTimer);
  state.practice.advanceTimer = null;

  const { completed, firstTry, roundTotal, fretRange } = state.practice;
  const accuracy = completed > 0 ? Math.round((firstTry / completed) * 100) : 0;
  const elapsed = (performance.now() - state.practice.roundStartedAt) / 1000;

  let best = getBestForDifficulty();
  if (accuracy > best) {
    best = accuracy;
    try {
      localStorage.setItem(BEST_STORAGE_PREFIX + getBestKey(), String(best));
    } catch {
      // 最佳成绩仍可在本轮内展示
    }
  }

  const rangeLabel = `${fretRange.min}–${fretRange.max} 品`;
  elements.summaryTotal.textContent = String(roundTotal);
  elements.summaryCorrect.textContent = String(firstTry);
  elements.summaryAccuracy.textContent = `${accuracy}%`;
  elements.summaryTime.textContent = formatTime(elapsed);
  elements.summaryAvg.textContent = `${(elapsed / Math.max(1, completed)).toFixed(1)}s`;
  elements.summaryBest.textContent = `${best}%`;
  elements.summarySub.textContent = `${rangeLabel} · 共 ${roundTotal} 题已完成`;

  elements.summaryOverlay.hidden = false;
}

function closeSummary() {
  state.summaryOpen = false;
  elements.summaryOverlay.hidden = true;
}

function startPracticeRound() {
  state.practice.started = true;
  state.practice.accidentals = elements.accidentalsToggle.checked;
  const notes = getPracticeNotes();
  // 弦组为空（默认全灰、用户尚未勾选）：提示先选择弦组，不进入出题，避免空集直接结算
  if (notes.length === 0) {
    setAnswerStatus("请在「选择弦组」中至少勾选一根弦，再开始练习。");
    state.practice.roundTotal = 0;
    state.noteQueue = [];
    updateDimmedCells(); // 同步将指板全部灰化，呈现「默认全灰」状态
    updateStats();
    return;
  }
  state.practice.roundTotal = notes.length;
  state.practice.phase = "pending";
  state.practice.completed = 0;
  state.practice.firstTry = 0;
  state.practice.wrongClicks = 0;
  state.practice.wrongInQuestion = 0;
  state.practice.roundStartedAt = performance.now();
  state.noteQueue = createShuffledGroup(state.note, getPracticeNotes());
  updateDimmedCells();
  drawNextNote({ skipPending: false });
}

function ensurePracticeRound() {
  if (!state.practice.started || state.noteQueue.length === 0) {
    startPracticeRound();
    return;
  }
  // 切换模式不计跳过，当前题重置为未作答
  state.practice.phase = "pending";
  state.practice.firstClick = true;
  state.practice.wrongInQuestion = 0;
  clearCellFeedback();
  setAnswerVisible(false);
  setAnswerStatus(`在指板上找出 ${state.note.display} 的位置`);
  updateStats();
}

function renderFretRangeInputs() {
  const { min, max } = state.practice.fretRange;
  elements.fretRangeMinInput.value = String(min);
  elements.fretRangeMaxInput.value = String(max);
  elements.fretRangeMin.textContent = String(min);
  elements.fretRangeMax.textContent = String(max);

  const minPercent = (min / MAX_FRET) * 100;
  const maxPercent = (max / MAX_FRET) * 100;
  elements.fretRangeFill.style.left = `${minPercent}%`;
  elements.fretRangeFill.style.width = `${maxPercent - minPercent}%`;
}

function setFretRange(min, max) {
  min = Math.max(MIN_FRET, Math.min(MAX_FRET, Math.round(min)));
  max = Math.max(MIN_FRET, Math.min(MAX_FRET, Math.round(max)));
  if (min > max) [min, max] = [max, min];

  const prev = state.practice.fretRange;
  if (prev.min === min && prev.max === max) return;

  state.practice.fretRange = { min, max };
  saveFretRange(state.practice.fretRange);
  renderFretRangeInputs();

  if (state.mode === "practice") {
    clearTimeout(state.practice.advanceTimer);
    startPracticeRound();
  }
}

function onFretRangeInput(event) {
  // 练习难度仅在练习模式下生效；浏览模式下拖动滑块不更新设置、也不影响指板
  if (state.mode !== "practice") return;

  let min = Number(elements.fretRangeMinInput.value);
  let max = Number(elements.fretRangeMaxInput.value);

  // 保证两端不会交叉：如果拖动导致交叉，强制对齐到另一端
  if (event.target === elements.fretRangeMinInput && min > max) {
    max = min;
  } else if (event.target === elements.fretRangeMaxInput && max < min) {
    min = max;
  }

  setFretRange(min, max);
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;

  elements.browseModeTab.classList.toggle("active", mode === "browse");
  elements.practiceModeTab.classList.toggle("active", mode === "practice");
  elements.browseModeTab.setAttribute("aria-selected", String(mode === "browse"));
  elements.practiceModeTab.setAttribute("aria-selected", String(mode === "practice"));
  elements.fretboard.classList.toggle("practice", mode === "practice");
  elements.practiceStats.hidden = mode !== "practice";
  elements.instruction.textContent =
    mode === "practice"
      ? "点击指板上对应位置作答，答完自动进入下一题。"
      : "在吉他上弹出这个音的任意位置，然后查看答案。";
  elements.sectionKicker.textContent = mode === "practice" ? "练习区域" : "答案区域";

  if (state.summaryOpen) closeSummary();

  if (mode === "practice") {
    ensurePracticeRound();
  } else {
    clearTimeout(state.practice.advanceTimer);
    clearCellFeedback();
    updateDimmedCells();
    setAnswerVisible(false);
  }
  syncControlState();
}

/* ---------- 出题 / 渲染 ---------- */

function drawNextNote({ skipPending = true } = {}) {
  clearTimeout(state.practice.advanceTimer);
  state.practice.advanceTimer = null;

  if (state.summaryOpen) return;

  if (skipPending && state.mode === "practice") countSkip();

  if (state.noteQueue.length === 0) {
    if (state.mode === "practice") {
      finishPracticeRound();
      return;
    }
    state.noteQueue = createShuffledGroup(state.note, getActiveNotes());
  }

  state.note = state.noteQueue.shift();
  state.round += 1;
  saveRoundCount(state.round);
  state.startedAt = performance.now();
  renderCurrentNote();
  elements.roundCount.textContent = String(state.round).padStart(2, "0");
  elements.noteCard.classList.remove("pop");
  void elements.noteCard.offsetWidth;
  elements.noteCard.classList.add("pop");
  updateMatches();
  setAnswerVisible(false);
  startQuestion();
}

function newRound() {
  drawNextNote();
}

function syncControlState() {
  const practice = state.mode === "practice";
  elements.autoNextSetting.classList.toggle("enabled", elements.autoNextToggle.checked);
  elements.autoRevealSetting.classList.toggle("enabled", elements.autoRevealToggle.checked && !practice);
  elements.autoRevealCard.classList.toggle("disabled", practice);
  // 练习难度卡片：仅练习模式可交互并高亮，浏览模式禁用并灰化
  elements.difficultyCard.classList.toggle("disabled", !practice);
  elements.difficultyCard.classList.toggle("highlight", practice);
  state.startedAt = performance.now();
  if (!elements.autoNextToggle.checked) elements.nextProgress.style.width = "0";
  if (!elements.autoRevealToggle.checked) elements.revealProgress.style.width = "0";
}

/* ---------- 弦组多选 ---------- */

function renderStringButtons() {
  elements.stringButtons.forEach((btn) => {
    const num = Number(btn.dataset.string);
    const active = state.practice.strings.includes(num);
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function toggleString(num) {
  // 弦组属于练习难度，仅练习模式生效；浏览模式下卡片已禁用，此处再兜底拦截
  if (state.mode !== "practice") return;

  const idx = state.practice.strings.indexOf(num);
  if (idx >= 0) {
    state.practice.strings.splice(idx, 1);
  } else {
    state.practice.strings.push(num);
  }
  state.practice.strings.sort((a, b) => a - b);
  saveStrings(state.practice.strings);
  renderStringButtons();
  updateDimmedCells();

  clearTimeout(state.practice.advanceTimer);
  startPracticeRound();
}

function timerLoop(now) {
  const elapsed = now - state.startedAt;
  const practice = state.mode === "practice";

  // 自动显示答案：练习模式作答时禁用，避免提前泄露
  if (!practice && elements.autoRevealToggle.checked && !state.answerVisible) {
    const revealDuration = clampNumber(elements.autoRevealSeconds) * 1000;
    const revealRatio = Math.min(1, elapsed / revealDuration);
    elements.revealProgress.style.width = `${revealRatio * 100}%`;
    if (revealRatio >= 1) setAnswerVisible(true);
  } else {
    elements.revealProgress.style.width = "0";
  }

  if (elements.autoNextToggle.checked && !state.summaryOpen) {
    const nextDuration = clampNumber(elements.autoNextSeconds) * 1000;
    const nextRatio = Math.min(1, elapsed / nextDuration);
    elements.nextProgress.style.width = `${nextRatio * 100}%`;
    if (nextRatio >= 1) newRound();
  } else {
    elements.nextProgress.style.width = "0";
  }

  state.animationFrame = requestAnimationFrame(timerLoop);
}

/* ---------- 事件绑定 ---------- */

elements.nextButton.addEventListener("click", newRound);
elements.revealButton.addEventListener("click", handleReveal);
elements.autoNextToggle.addEventListener("change", syncControlState);
elements.autoRevealToggle.addEventListener("change", syncControlState);
elements.accidentalsToggle.addEventListener("change", () => {
  if (state.mode === "practice") {
    clearTimeout(state.practice.advanceTimer);
    startPracticeRound();
    return;
  }
  const activeNotes = getActiveNotes();
  state.noteQueue = createShuffledGroup(state.note, activeNotes);

  if (!activeNotes.some((note) => note.key === state.note.key)) {
    state.note = state.noteQueue.shift();
    state.startedAt = performance.now();
    renderCurrentNote();
    updateMatches();
    setAnswerVisible(false);
  }
});

elements.browseModeTab.addEventListener("click", () => setMode("browse"));
elements.practiceModeTab.addEventListener("click", () => setMode("practice"));
elements.fretRangeMinInput.addEventListener("input", onFretRangeInput);
elements.fretRangeMaxInput.addEventListener("input", onFretRangeInput);

// 触摸设备上拖动结束后也能触发一次最终对齐
[elements.fretRangeMinInput, elements.fretRangeMaxInput].forEach((input) => {
  input.addEventListener("change", onFretRangeInput);
});
elements.summaryAgain.addEventListener("click", () => {
  closeSummary();
  startPracticeRound();
});

[elements.autoNextSeconds, elements.autoNextBpm, elements.autoRevealSeconds].forEach((input) => {
  input.addEventListener("input", () => {
    if (input === elements.autoNextSeconds || input === elements.autoNextBpm) syncSpeed(input);
  });
  input.addEventListener("change", () => {
    if (input === elements.autoNextSeconds || input === elements.autoNextBpm) syncSpeed(input);
    else {
      clampNumber(input);
      state.startedAt = performance.now();
    }
  });
});

elements.stringButtons.forEach((btn) => {
  btn.addEventListener("click", () => toggleString(Number(btn.dataset.string)));
});

document.querySelectorAll("[data-step-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.stepTarget}`);
    input.value = String(Number(input.value) + Number(button.dataset.step));
    if (input === elements.autoNextSeconds || input === elements.autoNextBpm) syncSpeed(input);
    else {
      clampNumber(input);
      state.startedAt = performance.now();
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, button")) return;
  if (state.summaryOpen) return;
  if (event.code === "Space") {
    event.preventDefault();
    newRound();
  }
  if (event.key.toLowerCase() === "a") handleReveal();
});

/* ---------- 初始化 ---------- */

buildFretboard();
renderCurrentNote();
elements.roundCount.textContent = String(state.round).padStart(2, "0");
updateMatches();
renderFretRangeInputs();
renderStringButtons();
updateDimmedCells();
syncControlState();
state.animationFrame = requestAnimationFrame(timerLoop);
