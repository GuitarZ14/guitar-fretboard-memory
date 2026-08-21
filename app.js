/* GUITAR 指板记忆
 * 在参考站（cbs.lljy.de 贝斯指板记忆）的基础上改造：
 * - 指板替换为六弦标准吉他（E A D G B E，从上到下为 1~6 弦）
 * - 完整保留原站交互：乱序出题、自动模式、包含升降号、
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

/**
 * 统一点击/触摸处理器：兼容桌面 click 与微信 web-view 触摸环境
 * 微信 web-view 对动态生成的 <button> 点击事件合成不稳定（尤其置于
 * overflow-x: auto 滚动容器内时），所以额外监听 touchstart/touchend，
 * 通过位移阈值区分「点击」与「滚动」，并防止 touch + click 重复触发。
 */
function addTapListener(element, handler) {
  let startX = 0;
  let startY = 0;
  let moved = false;
  let lastTouchTime = 0;
  const TAP_THRESHOLD = 10; // px，超过视为滑动/滚动

  element.addEventListener("touchstart", (e) => {
    const touch = e.touches[0] || e.changedTouches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    moved = false;
  }, { passive: true });

  element.addEventListener("touchmove", (e) => {
    const touch = e.touches[0] || e.changedTouches[0];
    if (Math.abs(touch.clientX - startX) > TAP_THRESHOLD ||
        Math.abs(touch.clientY - startY) > TAP_THRESHOLD) {
      moved = true;
    }
  }, { passive: true });

  element.addEventListener("touchend", (e) => {
    if (moved) return;
    lastTouchTime = Date.now();
    e.preventDefault();
    handler(e);
  }, { passive: false });

  element.addEventListener("click", (e) => {
    // 如果 touchend 刚触发过（500ms 内），跳过，避免重复响应
    if (Date.now() - lastTouchTime < 500) return;
    handler(e);
  });
}

/**
 * 委托式点击/触摸处理器：在容器上统一监听，兼容微信 web-view 对动态生成按钮的点击合成问题。
 * 优先使用 Pointer Events（微信 web-view 现代内核/Chromium 均支持），缺失时回退 Touch Events，
 * click 作为最终兜底并做去抖，避免 pointer 与 click 双触发。比逐元素绑定更可靠。
 */
function addDelegatedTapListener(container, selector, handler) {
  let startX = 0;
  let startY = 0;
  let moved = false;
  let pressing = false;
  let lastHandleTime = 0;
  const TAP_THRESHOLD = 10; // px，超过视为滑动/滚动
  const DEBOUNCE_MS = 300;  // 同一手势触发多次事件源时的去重窗口

  function resolveTarget(e) {
    const node = e.target;
    return node && typeof node.closest === "function" ? node.closest(selector) : null;
  }

  function deliver(e) {
    const target = resolveTarget(e);
    if (!target) return;
    const now = Date.now();
    if (now - lastHandleTime < DEBOUNCE_MS) return;
    lastHandleTime = now;
    handler(target, e);
  }

  if (typeof window !== "undefined" && window.PointerEvent) {
    container.addEventListener("pointerdown", (e) => {
      // 忽略鼠标左键以外的指针，避免右键/触控笔干扰
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
      pressing = true;
    }, { passive: true });

    container.addEventListener("pointermove", (e) => {
      if (!pressing) return;
      if (Math.abs(e.clientX - startX) > TAP_THRESHOLD ||
          Math.abs(e.clientY - startY) > TAP_THRESHOLD) {
        moved = true;
      }
    }, { passive: true });

    container.addEventListener("pointerup", (e) => {
      if (!pressing) return;
      pressing = false;
      if (moved) return;
      deliver(e);
    }, { passive: false });

    container.addEventListener("pointercancel", () => {
      pressing = false;
      moved = true;
    }, { passive: true });
  } else {
    container.addEventListener("touchstart", (e) => {
      const touch = e.touches[0] || e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      moved = false;
    }, { passive: true });

    container.addEventListener("touchmove", (e) => {
      const touch = e.touches[0] || e.changedTouches[0];
      if (Math.abs(touch.clientX - startX) > TAP_THRESHOLD ||
          Math.abs(touch.clientY - startY) > TAP_THRESHOLD) {
        moved = true;
      }
    }, { passive: true });

    container.addEventListener("touchend", (e) => {
      if (moved) return;
      e.preventDefault();
      deliver(e);
    }, { passive: false });
  }

  // click 兜底：pointer/touch 已处理过的（去抖窗口内）自动跳过
  container.addEventListener("click", deliver);
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
// 进入「点按模式」默认单选一弦：低音 E 弦（6 弦，最基础、0-12 品音位清晰），
// 确保进入模式即可直接点按，无需用户手动选弦；用户可在模式内切换/多选。
const DEFAULT_STRING = 6;

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
// 进入点按模式默认「单选一弦」——初始仅点亮默认弦（DEFAULT_STRING），用户可直接点按；
// 之后可在模式内点弦按钮切换为其他弦或追加多选，选择会持久化。
function loadStrings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STRING_STORAGE_KEY));
    if (Array.isArray(saved)) {
      const valid = saved
        .map((n) => Number(n))
        .filter((n) => ALL_STRINGS.includes(n));
      if (valid.length > 0) return valid;
    }
  } catch {
    // fall back to default
  }
  return [DEFAULT_STRING];
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

  if (group.length > 1 && group[0]?.key === previousNote?.key) {
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
    targetStrings: new Set(), // 当前题需要点击的弦（仅含在品格区间内有答案的选中弦）
    foundStrings: new Set(),  // 当前题已正确点击的弦
    advanceTimer: null,
    lastAdvanceAt: 0, // drawNextNote 防重入去抖时间戳
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
  autoRevealToggle: document.querySelector("#autoRevealToggle"),
  autoRevealAtSeconds: document.querySelector("#autoRevealAtSeconds"),
  autoRevealHoldSeconds: document.querySelector("#autoRevealHoldSeconds"),
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

      elements.fretboard.append(cell);
    }
  });

  // 用委托式 tap 监听替代逐元素绑定，兼容微信 web-view 对滚动容器内动态按钮的点击合成问题
  addDelegatedTapListener(elements.fretboard, ".fret-cell", onCellClick);

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

/**
 * 确保 state.note 始终是有效音名对象；无效时从队列或题库兜底取一个，
 * 避免 undefined 冒泡导致渲染/事件回调抛异常、rAF 动画链断裂（表现为界面卡死）。
 */
function ensureValidNote() {
  if (state.note && typeof state.note.pitch === "string" && typeof state.note.display === "string") {
    return state.note;
  }
  if (Array.isArray(state.noteQueue) && state.noteQueue.length > 0) {
    state.note = state.noteQueue.shift();
  } else {
    const pool = state.mode === "practice" ? getPracticeNotes() : getActiveNotes();
    state.note = createShuffledGroup(state.note, pool.length > 0 ? pool : NOTES)[0] || NOTES[0];
  }
  return state.note;
}

function updateMatches() {
  const note = ensureValidNote();
  document.querySelectorAll(".answer-note").forEach((marker) => {
    const matches = marker.dataset.pitch === note.pitch;
    marker.classList.toggle("match", matches);
    marker.textContent = matches ? note.display : "";
  });
}

function renderCurrentNote() {
  const display = ensureValidNote().display;
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

/* 当前题需要在「选中弦组 + 品格区间」内逐一找出的弦集合（1-based string index）。
   只包含有目标音高的弦；没有该音的选中弦不强制点击。 */
function getTargetStrings(note = ensureValidNote()) {
  const { min, max } = state.practice.fretRange;
  const indices = state.practice.strings.filter((stringIndex) => {
    const pitch = STRINGS[stringIndex - 1].pitch;
    for (let fret = min; fret <= max; fret += 1) {
      if (CHROMATIC[(pitch + fret) % 12] === note.pitch) return true;
    }
    return false;
  });
  return new Set(indices);
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
    const selected = inRange && inStrings;
    cell.classList.toggle("dimmed", !selected);
    // 选中的难度区间：标记 in-range，供高亮样式突出显示
    cell.classList.toggle("in-range", practice && selected);
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
  state.practice.foundStrings = new Set();
  state.practice.targetStrings = getTargetStrings();
  clearCellFeedback();
  setAnswerVisible(false);
  const note = ensureValidNote();
  const targetCount = state.practice.targetStrings.size;
  const status = targetCount > 1
    ? `在指板上找出 ${note.display} 的位置（需找 ${targetCount} 根弦）`
    : `在指板上找出 ${note.display} 的位置`;
  setAnswerStatus(status);
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
  if (!cell || !cell.dataset) return;
  if (state.mode !== "practice" || state.practice.phase !== "pending" || state.summaryOpen) {
    // 如果当前不在可答题状态，给用户一点反馈，便于排查
    if (state.mode === "practice" && state.practice.phase === "done" && !state.summaryOpen) {
      setAnswerStatus("本题已作答，请点击「下一题」继续");
    }
    return;
  }

  const note = ensureValidNote();
  const stringIndex = Number(cell.dataset.stringIndex);

  if (cell.dataset.pitch === note.pitch) {
    cell.blur();

    // 正确音高但不在当前题目要求的弦上（理论上已被 dimmed 屏蔽点击，兜底处理）
    if (!state.practice.targetStrings.has(stringIndex)) {
      state.practice.firstClick = false;
      state.practice.wrongInQuestion += 1;
      state.practice.wrongClicks += 1;
      cell.classList.remove("miss");
      void cell.offsetWidth;
      cell.classList.add("miss");
      setAnswerStatus("不对，这条弦不在当前练习范围内");
      setTimeout(() => cell.classList.remove("miss"), 640);
      return;
    }

    // 同一弦重复点击不重复计数
    if (state.practice.foundStrings.has(stringIndex)) {
      setAnswerStatus("这根弦已经找过了，继续找其他弦");
      return;
    }

    state.practice.foundStrings.add(stringIndex);
    cell.classList.add("hit");
    const found = state.practice.foundStrings.size;
    const total = state.practice.targetStrings.size;

    if (found === total) {
      state.practice.completed += 1;
      state.practice.phase = "done";
      if (state.practice.firstClick) state.practice.firstTry += 1;
      const suffix = state.practice.wrongInQuestion > 0
        ? `（本题先错过 ${state.practice.wrongInQuestion} 次）`
        : "";
      setAnswerVisible(true, `全部找齐！${note.display} 的位置${suffix}`);
      updateStats();
      clearTimeout(state.practice.advanceTimer);
      state.practice.advanceTimer = setTimeout(() => newRound(), 1500);
    } else {
      setAnswerStatus(`已找到 ${found}/${total} 根弦，继续找 ${note.display}`);
      updateStats();
    }
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
      setAnswerVisible(true, `已显示 ${ensureValidNote().display} 的位置（本题跳过）`);
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
  // 没有有效题目时不应弹 summary，而是重新初始化
  if (state.practice.roundTotal === 0) {
    closeSummary();
    startPracticeRound();
    return;
  }

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
  elements.summarySub.textContent = `${rangeLabel} · 已完成 ${completed} / ${roundTotal} 题`;

  elements.summaryOverlay.hidden = false;
}

function closeSummary() {
  state.summaryOpen = false;
  elements.summaryOverlay.hidden = true;
}

function startPracticeRound() {
  state.practice.accidentals = elements.accidentalsToggle.checked;
  const notes = getPracticeNotes();
  // 弦组为空（默认全灰、用户尚未勾选）：提示先选择弦组，不进入出题，避免空集直接结算
  if (notes.length === 0) {
    setAnswerStatus("请在「选择弦组」中至少勾选一根弦，再开始练习。");
    state.practice.started = false;
    state.practice.roundTotal = 0;
    state.noteQueue = [];
    updateDimmedCells(); // 同步将指板全部灰化，呈现「默认全灰」状态
    updateStats();
    return;
  }
  state.practice.started = true;
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
      ? "点按模式下需逐一点按每根选中弦上的目标音，全部找齐后自动进入下一题。"
      : "在吉他上弹出这个音的任意位置，然后查看答案。";
  elements.sectionKicker.textContent = mode === "practice" ? "点按区域" : "查看区域";

  if (state.summaryOpen) closeSummary();

  if (mode === "practice") {
    // 进入点按模式：若当前无有效弦选择（用户曾在模式内清空），回退到默认单选一弦，确保进入即可点按
    if (!Array.isArray(state.practice.strings) || state.practice.strings.length === 0) {
      state.practice.strings = [DEFAULT_STRING];
    }
    renderStringButtons();
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

  // 防重入去抖：跳过/推进动作在 150ms 内被重复触发（如答题自动跳题定时器与
  // 用户点击「下一题」同时排队）时丢弃多余一次，避免连续跳题与状态冲突
  if (skipPending && state.mode === "practice") {
    const now = Date.now();
    if (now - state.practice.lastAdvanceAt < 150) return;
    state.practice.lastAdvanceAt = now;
  }

  // 练习模式下，如果本轮未初始化或题目池为空，先尝试重新初始化
  if (state.mode === "practice" && (!state.practice.started || state.practice.roundTotal === 0)) {
    startPracticeRound();
    return;
  }

  // 跳过当前未答题（计错）
  if (skipPending && state.mode === "practice" && state.practice.phase === "pending") {
    countSkip();
  }

  // 题目队列耗尽：本轮自然结束；若 roundTotal 异常为 0，则重新初始化而不是直接结算
  if (state.mode === "practice" && state.noteQueue.length === 0) {
    if (state.practice.roundTotal > 0) {
      finishPracticeRound();
    } else {
      startPracticeRound();
    }
    return;
  }

  state.note = state.noteQueue.shift();
  ensureValidNote();
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
  elements.autoRevealSetting.classList.toggle("enabled", elements.autoRevealToggle.checked && !practice);
  elements.autoRevealCard.classList.toggle("disabled", practice);
  // 练习难度卡片：仅练习模式可交互并高亮，浏览模式禁用并灰化
  elements.difficultyCard.classList.toggle("disabled", !practice);
  elements.difficultyCard.classList.toggle("highlight", practice);
  state.startedAt = performance.now();
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
  // 单帧异常不应打断 rAF 动画链（否则表现为界面卡死），所以整帧逻辑用 try 包裹
  try {
    const elapsed = now - state.startedAt;
    const practice = state.mode === "practice";

    // 限时模式：浏览模式下，延时到「限时反应」时亮出答案，保持「维持秒」后自动进入下一题
    if (!practice && elements.autoRevealToggle.checked && !state.summaryOpen) {
      const atMs = clampNumber(elements.autoRevealAtSeconds) * 1000;
      const holdMs = clampNumber(elements.autoRevealHoldSeconds) * 1000;
      const totalMs = atMs + holdMs;
      const cycleRatio = Math.min(1, elapsed / totalMs);
      elements.revealProgress.style.width = `${cycleRatio * 100}%`;
      if (elapsed >= atMs && elapsed < totalMs) {
        if (!state.answerVisible) setAnswerVisible(true);
      } else if (elapsed >= totalMs) {
        if (state.answerVisible) setAnswerVisible(false);
        newRound();
      } else if (state.answerVisible) {
        setAnswerVisible(false);
      }
    } else {
      elements.revealProgress.style.width = "0";
    }
  } catch (err) {
    // 静默吞掉单帧异常，动画循环继续
  }

  state.animationFrame = requestAnimationFrame(timerLoop);
}

/* ---------- 事件绑定 ---------- */

elements.nextButton.addEventListener("click", newRound);
elements.revealButton.addEventListener("click", handleReveal);
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

[elements.autoRevealAtSeconds, elements.autoRevealHoldSeconds].forEach((input) => {
  input.addEventListener("input", () => clampNumber(input));
  input.addEventListener("change", () => {
    clampNumber(input);
    state.startedAt = performance.now();
  });
});

elements.stringButtons.forEach((btn) => {
  btn.addEventListener("click", () => toggleString(Number(btn.dataset.string)));
});

document.querySelectorAll("[data-step-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.stepTarget}`);
    input.value = String(Number(input.value) + Number(button.dataset.step));
    clampNumber(input);
    state.startedAt = performance.now();
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
