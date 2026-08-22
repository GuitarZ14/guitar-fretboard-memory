/* GUITAR 和弦速查 — 交互逻辑
 * 依赖 chord-engine.js：音名表、调弦、和弦类型、指法搜索算法。
 * 渲染方式：SVG 字符串（竖向指法图 + 横向全指板图），无第三方依赖。
 */

"use strict";

const STORAGE_KEY = "guitar-chord-finder-settings";

const DEFAULT_STATE = {
  root: 0,          // C
  typeId: "maj7",
  tuningId: "standard",
  handed: "right",
  accidental: "sharp",
  view: "voicing",  // voicing | fretboard
  fbLabelMode: "degree", // degree | note
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        root: Number.isFinite(saved.root) ? Number(saved.root) % 12 : DEFAULT_STATE.root,
        typeId: CHORD_TYPE_MAP[saved.typeId] ? saved.typeId : DEFAULT_STATE.typeId,
        tuningId: TUNINGS[saved.tuningId] ? saved.tuningId : DEFAULT_STATE.tuningId,
        handed: saved.handed === "left" ? "left" : "right",
        accidental: saved.accidental === "flat" ? "flat" : "sharp",
        view: saved.view === "fretboard" ? "fretboard" : "voicing",
        fbLabelMode: saved.fbLabelMode === "note" ? "note" : "degree",
      };
    }
  } catch {
    // 忽略，使用默认
  }
  return { ...DEFAULT_STATE };
}

const state = loadState();

// 探索模式（fretboard 视图）状态：用户点击指板选音，匹配包含这些音的所有和弦
// 不持久化（session-only），避免下次加载残留。
let pickedNotes = new Set();          // pitch class 集合（0-11）
let pickedPositions = [];              // {si, fret, pc}

/* ---------------- 音频：Karplus-Strong 合成引擎 ---------------- */
const TUNING_BASE_MIDI = {
  standard: [40, 45, 50, 55, 59, 64], // 6弦..1弦 (EADGBE)
  dropD:    [38, 45, 50, 55, 59, 64],
  dadgad:   [38, 45, 50, 55, 57, 64],
  openG:    [38, 43, 50, 55, 59, 62],
  openD:    [38, 45, 50, 54, 57, 62],
  eb:       [39, 44, 49, 54, 58, 63],
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const audioEngine = {
  ctx: null,

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  },

  /* Karplus-Strong 合成（JS 侧逐样本生成，稳定收敛，规避 WebAudio 反馈回路发散）
     延迟线 + 一阶平均低通（自然阻尼）+ 衰减增益(<1)，音色温暖、延音自然。 */
  playSynth(midi, velocity = 1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freq = midiToFreq(midi);
    const sr = ctx.sampleRate;
    const duration = 2.6;
    const N = Math.max(2048, Math.floor(sr * duration));

    // 延迟线长度 = 一个周期；整数延迟保证音高准确
    const delayLen = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(delayLen);
    for (let i = 0; i < delayLen; i += 1) ring[i] = Math.random() * 2 - 1;
    // 平滑激励：对初始噪声做一次一阶低通，去掉过亮高频，更接近拨片拨弦
    let prev = 0;
    for (let i = 0; i < delayLen; i += 1) {
      const c = ring[i];
      ring[i] = (c + prev) * 0.5;
      prev = c;
    }

    const out = new Float32Array(N);
    let idx = 0;
    const decay = 0.996; // <1：决定延音长度；一阶平均阻尼让高频更快衰减
    for (let n = 0; n < N; n += 1) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % delayLen];
      const filt = (cur + nxt) * 0.5; // 反馈低通（平均），音色随延音逐渐变暗
      out[n] = cur;
      ring[idx] = filt * decay;
      idx = (idx + 1) % delayLen;
    }
    // 短促起音与末端淡出，避免咔哒声
    const attack = Math.floor(sr * 0.003);
    for (let n = 0; n < attack; n += 1) out[n] *= n / attack;
    const fade = Math.floor(sr * 0.05);
    for (let n = 0; n < fade; n += 1) out[N - 1 - n] *= n / fade;
    // 归一化到峰值 0.9
    let peak = 0;
    for (let n = 0; n < N; n += 1) peak = Math.max(peak, Math.abs(out[n]));
    if (peak > 0) {
      const g = 0.9 / peak;
      for (let n = 0; n < N; n += 1) out[n] *= g;
    }

    const ab = ctx.createBuffer(1, N, sr);
    ab.getChannelData(0).set(out);
    const src = ctx.createBufferSource();
    src.buffer = ab;

    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 8000; // 去掉不可闻超高频毛刺

    const output = ctx.createGain();
    output.gain.setValueAtTime(0.0001, t);
    output.gain.linearRampToValueAtTime(0.85 * velocity, t + 0.004);
    output.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(tone);
    tone.connect(output);
    output.connect(ctx.destination);

    src.start(t);

    setTimeout(() => {
      try { src.disconnect(); tone.disconnect(); output.disconnect(); } catch {}
    }, (duration + 0.2) * 1000);
  },

  play(si, fret, velocity = 1) {
    this.ensure();
    this.playSynth(TUNING_BASE_MIDI[state.tuningId][si] + fret, velocity);
  },
};

/* 全指板横向图布局：0 品空弦音画在弦枕左侧专用位置，不占品位格子 */
function chordFbLayout(start, end, leftPad, colW) {
  const openPad = 40; // 弦枕 x 位置，左侧留给空弦音与弦名
  const actualLeftPad = start === 0 ? (leftPad ?? openPad) : (leftPad ?? 0);
  const openX = actualLeftPad - 16; // 空弦音（0 品）圆点中心
  return { start, end, leftPad: actualLeftPad, colW, openX };
}

function chordFretX(L, fret) {
  if (fret <= 0) return L.openX;
  return L.leftPad + (fret - L.start - 1) * L.colW + L.colW / 2;
}

// 点击 x 坐标 → 品位：空弦区（弦枕左侧）返回 0，其余按所在品格格子计算
function chordFretFromX(x, start, leftPad, colW, end) {
  if (start === 0 && x < leftPad) return 0;
  const base = start === 0 ? 1 : start + 1;
  const minFret = start === 0 ? 0 : start + 1;
  const f = base + Math.floor((x - leftPad) / colW);
  return Math.max(minFret, Math.min(end, f));
}

function showFretHit(svg, si, fret, start, leftPad, colW, rowH, padT) {
  const order = [5, 4, 3, 2, 1, 0];
  const row = order.indexOf(si);
  const L = chordFbLayout(start, 24, leftPad, colW);
  const x = chordFretX(L, fret);
  const y = padT + row * rowH + rowH / 2;
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", x);
  circle.setAttribute("cy", y);
  circle.setAttribute("r", 8);
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "rgba(245,166,156,0.85)");
  circle.setAttribute("stroke-width", 3);
  circle.setAttribute("class", "fb-hit-ring");
  svg.appendChild(circle);
  setTimeout(() => circle.remove(), 340);
}

const elements = {
  chordSymbol: document.querySelector("#chordSymbol"),
  chordCn: document.querySelector("#chordCn"),
  toneChips: document.querySelector("#toneChips"),
  intervalChips: document.querySelector("#intervalChips"),
  rootButtons: document.querySelector("#rootButtons"),
  typeGroups: document.querySelector("#typeGroups"),
  tuningSelect: document.querySelector("#tuningSelect"),
  tuningDesc: document.querySelector("#tuningDesc"),
  resultKicker: document.querySelector("#resultKicker"),
  diagramTitle: document.querySelector("#diagram-title"),
  voicingArea: document.querySelector("#voicingArea"),
  fretboardArea: document.querySelector("#fretboardArea"),
  voicingHint: document.querySelector("#voicingHint"),
  voicingHintText: document.querySelector("#voicingHintText"),
  diagramHint: document.querySelector("#diagramHint"),
  theoryDesc: document.querySelector("#theoryDesc"),
  handSwitch: document.querySelector("#handSwitch"),
  accidentalSwitch: document.querySelector("#accidentalSwitch"),
  viewSwitch: document.querySelector("#viewSwitch"),
  chordNameCard: document.querySelector(".chord-name-card"),
  heroCard: document.querySelector(".hero-card"),
};

/* ---------------- 工具 ---------------- */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 忽略
  }
}

function currentType() {
  return CHORD_TYPE_MAP[state.typeId];
}

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

/* 根据和弦类型与位置，返回级数标签（如 R / 3 / b7 / 9） */
function degreeLabelForPosition(type, tuning, p) {
  const semi = mod12(tuning.pitches[p.si] + p.fret);
  const intervalSemi = mod12(semi - state.root);
  const idx = type.intervals.findIndex((iv) => mod12(iv) === intervalSemi);
  if (idx < 0) return "";
  const raw = type.labels[idx];
  return raw === "1" ? "R" : raw;
}

/* 旧的 getVoicings 已替换为 extendedVoicings */
const voicingCache = new Map();
function getVoicings() {
  return extendedVoicings(state.typeId, state.root, TUNINGS[state.tuningId].pitches).must;
}

/* ---------------- 构建静态控件 ---------------- */
function buildRootButtons() {
  elements.rootButtons.textContent = "";
  for (let i = 0; i < 12; i += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "root-btn";
    btn.dataset.root = String(i);
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = noteName(i, state.accidental);
    elements.rootButtons.append(btn);
  }
}

function buildTypeButtons() {
  elements.typeGroups.textContent = "";
  TYPE_GROUPS.forEach((group) => {
    const block = document.createElement("div");
    block.className = "type-group";
    const head = document.createElement("div");
    head.className = "type-group-head";
    head.innerHTML = `<span>${group.cn}</span>`;
    block.append(head);
    const btns = document.createElement("div");
    btns.className = "type-group-btns";
    CHORD_TYPES.filter((t) => t.group === group.key).forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-btn";
      btn.dataset.type = t.id;
      btn.textContent = t.suffix === "" ? "M" : t.suffix;
      btn.title = `${t.cn}（${t.desc.slice(0, 24)}…）`;
      btns.append(btn);
    });
    block.append(btns);
    elements.typeGroups.append(block);
  });
}

/* ---------------- 状态类更新 ---------------- */
function refreshButtonStates() {
  elements.rootButtons.querySelectorAll(".root-btn").forEach((btn) => {
    const active = Number(btn.dataset.root) === state.root;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.textContent = noteName(Number(btn.dataset.root), state.accidental);
  });
  elements.typeGroups.querySelectorAll(".type-btn").forEach((btn) => {
    const active = btn.dataset.type === state.typeId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function refreshSegmented(container, key, value) {
  container.querySelectorAll("button").forEach((btn) => {
    const active = btn.dataset[key] === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

/* ---------------- 竖向指法图 SVG ---------------- */
/* SVG 颜色常量（与 chord-styles.css 变量保持一致，SVG 内直接用值） */
const DIAGRAM_COLORS = {
  line: "rgba(120,120,140,0.4)",
  nut: "#8a8aa0",
  root: "#4f8fb0",
  tone: "#f5a69c",
};

// 琴弦线宽：si=0（1弦/高音E，最细）→ si=5（6弦/低音E，最粗），相邻自然递减
function stringWidth(si, thin, thick) {
  return +(thin + (si / 5) * (thick - thin)).toFixed(2);
}

function buildVoicingSVG(v, type, tuning) {
  const frets = v.frets;
  const base = v.baseFret;
  const start = base <= 1 ? 0 : base - 1;
  // 格数随跨度增长：start 比最低按品位低 1 格，跨度 4 时最多需要 6 格
  const rows = Math.max(4, Math.min(6, v.span + 2));
  const pad = { t: 22, r: 10, b: 14, l: 16 };
  const colW = 15;
  const rowH = 15;
  const order = state.handed === "left" ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const w = pad.l + colW * 6 + pad.r;
  const h = pad.t + rows * rowH + pad.b;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="和弦指法图">`);

  // 横线（品丝）：最顶部横条始终为粗线（上弦枕），所有和弦图统一风格
  for (let r = 0; r <= rows; r += 1) {
    const y = pad.t + r * rowH;
    const isTop = r === 0;
    parts.push(
      `<line x1="${pad.l}" y1="${y}" x2="${pad.l + colW * 6}" y2="${y}" stroke="${isTop ? DIAGRAM_COLORS.nut : DIAGRAM_COLORS.line}" stroke-width="${isTop ? 4 : 1.4}"/>`
    );
  }

  // 品格数字（格框左侧）：与对应品格竖直居中对齐，排列整齐规范
  for (let b = 1; b <= rows; b += 1) {
    const label = start + b;
    const cy = pad.t + (b - 0.5) * rowH;
    parts.push(`<text class="diagram-fretnum" x="${pad.l - 7}" y="${cy + 3}" text-anchor="end">${label}</text>`);
  }

  // 竖线（琴弦）
  order.forEach((si, col) => {
    const x = pad.l + col * colW + colW / 2;
    parts.push(
      `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + rows * rowH}" stroke="${DIAGRAM_COLORS.line}" stroke-width="1.4"/>`
    );
  });

  // 横按弧线
  const barreGroups = new Map();
  v.frets.forEach((f, si) => {
    if (f > 0) {
      if (!barreGroups.has(f)) barreGroups.set(f, []);
      barreGroups.get(f).push(si);
    }
  });
  barreGroups.forEach((sis, f) => {
    if (sis.length < 2) return;
    const cols = sis
      .map((si) => order.indexOf(si))
      .sort((a, b) => a - b);
    const x1 = pad.l + cols[0] * colW + colW / 2;
    const x2 = pad.l + cols[cols.length - 1] * colW + colW / 2;
    const y = pad.t + (f - start) * rowH + rowH / 2;
    parts.push(
      `<path d="M ${x1} ${y - 2} Q ${(x1 + x2) / 2} ${y - 6}, ${x2} ${y - 2}" fill="none" stroke="${DIAGRAM_COLORS.line}" stroke-width="1.6"/>`
    );
  });

  // 按弦点 / 空弦 / 闷弦
  order.forEach((si, col) => {
    const x = pad.l + col * colW + colW / 2;
    const f = frets[si];
    if (f === -1) {
      parts.push(`<text class="diagram-mute" x="${x}" y="${pad.t - 7}" text-anchor="middle">×</text>`);
      return;
    }
    if (f === 0) {
      parts.push(`<text class="diagram-open" x="${x}" y="${pad.t - 7}" text-anchor="middle">○</text>`);
      return;
    }
    const y = pad.t + (f - start) * rowH + rowH / 2;
    const isRoot = v.rootStrings.includes(si);
    const fill = isRoot ? DIAGRAM_COLORS.root : DIAGRAM_COLORS.tone;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>`
    );
    if (isRoot) {
      parts.push(`<text class="diagram-root" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">R</text>`);
    } else {
      const finger = v.fingers[si];
      if (finger > 0) {
        parts.push(`<text class="diagram-finger" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">${finger}</text>`);
      }
    }
  });

  // 弦名（底部）：按实际发声音高显示（闷弦 ×、空弦音名、按品音名）
  order.forEach((si, col) => {
    const x = pad.l + col * colW + colW / 2;
    const f = frets[si];
    let label;
    if (f === -1) {
      label = "×";
    } else if (f === 0) {
      label = noteName(tuning.pitches[si], state.accidental);
    } else {
      label = noteName(tuning.pitches[si] + f, state.accidental);
    }
    parts.push(
      `<text class="diagram-stringname" x="${x}" y="${pad.t + rows * rowH + 11}" text-anchor="middle">${label}</text>`
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/* ---------------- 全指板横向图 SVG（可分段渲染） ----------------
   opts: { start=0, end=24, leftPad=40, showNames=true, minFret }
   - 仅渲染 [start, end] 品，便于「首屏 0–12、右滑动态加载 13–24」
   - 高把位段可传 start=12、minFret=13、leftPad=0，使 12 品丝与低把位段对齐
   - 各段共用同一 colW/rowH，拼接处无间隙
*/
function buildFullFretboardSVG(type, tuning, opts = {}) {
  const start = opts.start ?? 0;
  const end = opts.end ?? 24;
  const minFret = opts.minFret ?? start;
  const colW = 44;          // 放大：原 34
  const L = chordFbLayout(start, end, opts.leftPad, colW);
  const showNames = opts.showNames ?? true;
  const pickerMode = !!opts.pickedPositions; // 探索模式：用户点击选音，不画和弦位置
  const pad = { t: 28, r: end === 24 ? 16 : 0, b: 18, l: L.leftPad };
  const rowH = 38;          // 放大：原 30
  const rightEdge = L.leftPad + (end - start) * colW; // 最后一品品丝 x（琴弦止于此处）
  const w = rightEdge + pad.r;
  const h = pad.t + 6 * rowH + pad.b;

  // 弦序：标准吉他谱图示，6弦（低音 E）在上、1弦（高音 e）在下
  const order = [5, 4, 3, 2, 1, 0];
  // 探索模式：用用户已选位置；推荐指法模式：用和弦位置
  const positions = pickerMode
    ? (opts.pickedPositions || []).filter((p) => p.fret >= minFret && p.fret <= end).map((p) => ({ si: p.si, fret: p.fret, isRoot: !!p.isRoot, pickedPc: p.pc }))
    : fretboardPositions(state.root, type, tuning.pitches, { frets: end })
        .filter((p) => p.fret >= minFret && p.fret <= end);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${pickerMode ? '全指板选音（点击切换）' : `全指板和弦音位置（${start}–${end} 品）`}" class="full-fretboard${pickerMode ? ' picker-fretboard' : ''}">`);

  // 品位数字（上弦枕 0 品不标）
  for (let f = start; f <= end; f += 1) {
    if (f === 0) continue;
    const x = chordFretX(L, f);
    parts.push(`<text class="diagram-fretnum" x="${x}" y="${pad.t - 9}" text-anchor="middle">${f}</text>`);
  }

  // 品丝竖线：比琴弦粗，以突出指板分隔
  for (let f = start; f <= end; f += 1) {
    const x = L.leftPad + (f - start) * colW;
    const isNut = f === 0;
    parts.push(
      `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + 6 * rowH}" stroke="${isNut ? DIAGRAM_COLORS.nut : DIAGRAM_COLORS.line}" stroke-width="${isNut ? 8 : 7}"/>`
    );
  }

  // 琴弦横线 + 弦名：粗细随物理弦号梯度（1弦最细 → 6弦最粗），右端止于最后一品（不溢出）
  order.forEach((si, row) => {
    const y = pad.t + row * rowH + rowH / 2;
    const sw = stringWidth(si, 2, 6);
    parts.push(`<line x1="${L.leftPad}" y1="${y}" x2="${rightEdge}" y2="${y}" stroke="${DIAGRAM_COLORS.line}" stroke-width="${sw}"/>`);
    if (showNames) {
      parts.push(`<text class="diagram-stringname" x="${L.leftPad - 34}" y="${y + 3}" text-anchor="end">${noteName(tuning.pitches[si], state.accidental)}</text>`);
    }
  });

  // 品记
  const singleInlays = [3, 5, 7, 9, 15, 17, 19, 21];
  singleInlays.forEach((f) => {
    if (f < start || f > end) return;
    const x = chordFretX(L, f);
    parts.push(`<circle cx="${x}" cy="${pad.t + 3 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
  });
  [12, 24].forEach((f) => {
    if (f < start || f > end) return;
    const x = chordFretX(L, f);
    parts.push(`<circle cx="${x}" cy="${pad.t + 2.5 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
    parts.push(`<circle cx="${x}" cy="${pad.t + 4.5 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
  });

  // 和弦音位置（推荐指法模式）或 用户点击位置（探索模式）
  positions.forEach((p) => {
    const x = chordFretX(L, p.fret);
    const row = order.indexOf(p.si);
    const y = pad.t + row * rowH + rowH / 2;
    const pc = mod12(tuning.pitches[p.si] + p.fret);
    const fill = pickerMode ? DIAGRAM_COLORS.root : (p.isRoot ? DIAGRAM_COLORS.root : DIAGRAM_COLORS.tone);
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${pickerMode ? 11 : (p.isRoot ? 13 : 10)}" fill="${fill}" stroke="rgba(255,255,255,0.9)" stroke-width="2" data-pc="${pc}" data-si="${p.si}" data-fret="${p.fret}"/>`
    );

    if (pickerMode) {
      // 探索模式：圆心标音名（用户已选音）
      const noteLabel = noteName(pc, state.accidental);
      parts.push(
        `<text class="diagram-root" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">${noteLabel}</text>`
      );
    } else {
      const degLabel = degreeLabelForPosition(type, tuning, p);
      const noteLabel = noteName(mod12(tuning.pitches[p.si] + p.fret), state.accidental);
      const activeLabel = state.fbLabelMode === "note" ? noteLabel : degLabel;
      if (activeLabel) {
        const cls = p.isRoot ? "diagram-root" : "diagram-fb-label";
        parts.push(`<text class="${cls}" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" data-fb-deg="${degLabel}" data-fb-note="${noteLabel}">${activeLabel}</text>`);
      }
    }
  });

  // 透明点击条：覆盖每根弦的完整横向区域，点击后按 x 坐标计算品位并播放音高
  // 探索模式下 click 切换 pickedPositions；推荐指法模式下仅发声
  order.forEach((si, row) => {
    const y = pad.t + row * rowH;
    parts.push(`<rect class="fb-string-strip" x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent" data-si="${si}" data-start="${start}" data-end="${end}" data-left-pad="${L.leftPad}" data-col-w="${colW}" data-row-h="${rowH}" data-pad-t="${pad.t}" aria-label="弦 ${6 - si} 点击区"/>`);
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/* 右滑到底时动态加载 13–24 品（方案 B：双 SVG 分页） */
function loadHighFretboard(type, tuning) {
  const scroll = document.getElementById("fretboardScroll");
  if (!scroll || document.getElementById("fretboardPartHigh")) return;
  const more = document.getElementById("fretboardMore");
  const part = document.createElement("div");
  part.className = "fretboard-part";
  part.id = "fretboardPartHigh";
  part.innerHTML = buildFullFretboardSVG(type, tuning, { start: 12, end: 24, minFret: 13, leftPad: 0, showNames: false });
  if (more) scroll.insertBefore(part, more);
  else scroll.appendChild(part);
  if (more) more.remove();
  scroll.style.maxWidth = "none";
}

/* ---------------- 渲染 ---------------- */
function chip(className, text) {
  return `<span class="chip">${text}</span>`;
}

function renderHero() {
  if (state.view === "fretboard") {
    elements.chordSymbol.textContent = "探索模式";
    elements.chordCn.textContent = "选音识别";
    const pickedPcs = [...pickedNotes].sort((a, b) => a - b);
    elements.toneChips.innerHTML = pickedPcs.length
      ? pickedPcs.map((s) => `<span class="chip tone-chip">${noteName(s, state.accidental)}</span>`).join("")
      : "";
    elements.intervalChips.innerHTML = "";
    elements.theoryDesc.textContent = "点击下方指板任意位置可加/取消选音。已选音将自动匹配包含它们的所有和弦（含转位）。";
    elements.chordNameCard.classList.remove("pop");
    void elements.chordNameCard.offsetWidth;
    elements.chordNameCard.classList.add("pop");
    return;
  }
  const type = currentType();
  const symbol = chordSymbol(state.root, type, state.accidental);
  const semis = chordSemitones(state.root, type);

  elements.chordSymbol.textContent = symbol;
  elements.chordCn.textContent = type.cn;

  elements.toneChips.innerHTML = semis
    .map((s) => chip("tone-chip", noteName(s, state.accidental)))
    .join("");
  elements.intervalChips.innerHTML = type.labels.map((l) => chip("interval-chip", l)).join("");

  elements.chordNameCard.classList.remove("pop");
  void elements.chordNameCard.offsetWidth;
  elements.chordNameCard.classList.add("pop");

  elements.theoryDesc.textContent = type.desc;
}

function voicingTag(v, index, group) {
  return `变体 ${index + 1}`;
}

function renderVoicings() {
  const type = currentType();
  const tuning = TUNINGS[state.tuningId];
  const symbol = chordSymbol(state.root, type, state.accidental);

  // 探索模式下隐藏上方 Hero 卡片（内容与 picker-summary 重复），让指板上移
  if (elements.heroCard) {
    elements.heroCard.hidden = state.view === "fretboard";
  }

  if (state.view === "fretboard") {
    elements.diagramTitle.textContent = "探索模式";
    elements.resultKicker.textContent = "选音识别";
  } else {
    elements.diagramTitle.textContent = `${symbol} 的按法`;
    elements.resultKicker.textContent = "推荐指法";
  }

  if (state.view === "voicing") {
    elements.fretboardArea.hidden = true;
    elements.voicingArea.hidden = false;
    const legend = document.querySelector(".legend");
    if (legend) legend.hidden = false;

    const groups = extendedVoicings(state.typeId, state.root, tuning.pitches);
    const total = groups.must.length + groups.open.length + groups.moveable.length;

    if (total === 0) {
      elements.voicingArea.innerHTML = `
        <div class="theory-desc" style="padding: 18px 4px; text-align: center;">
          当前调音下未找到合适的完整指法，
          可切换到「全指板」视图查看所有可用位置。
        </div>`;
      elements.voicingHint.classList.remove("visible");
      elements.voicingHintText.textContent = "未找到";
      elements.diagramHint.textContent = "";
      return;
    }

    const sectionHTML = (label, items, group) =>
      items.length === 0 ? "" : `
        <div class="voicing-section">
          <h3 class="voicing-section-title">${label}<span class="voicing-section-count">${items.length}</span></h3>
          <div class="voicing-grid">
            ${items
              .map(
                (v, i) => `
              <figure class="voicing-card">
                <span class="voicing-tag">${voicingTag(v, i, group)}</span>
                <div class="chord-diagram">${buildVoicingSVG(v, type, tuning)}</div>
                <figcaption class="voicing-meta">${voicingMeta(v, tuning)}</figcaption>
              </figure>`
              )
              .join("")}
          </div>
        </div>`;

    elements.voicingArea.innerHTML =
      sectionHTML("MUST KNOW 必学", groups.must, "must") +
      sectionHTML("OPEN CHORDS 开放和弦", groups.open, "open") +
      sectionHTML("MOVEABLE 可移位", groups.moveable, "moveable");

    elements.voicingHint.classList.add("visible");
    elements.voicingHintText.textContent = `${total} 个指法`;
    elements.diagramHint.innerHTML =
      `<span class="hint-line"></span> 弦序：${orderString(tuning)} · 数字为品位；切换调音 / 左右手，会同步刷新指法与全指板。`;
  } else {
    // 探索模式：指板清空 + 用户点击选音 → 上方显示组成音与匹配和弦（含转位）
    elements.voicingArea.hidden = true;
    elements.fretboardArea.hidden = false;
    const legend = document.querySelector(".legend");
    if (legend) legend.hidden = true;

    const tuning = TUNINGS[state.tuningId];
    const pickedPcs = [...pickedNotes].sort((a, b) => a - b);
    const noteChips = pickedPcs.length
      ? pickedPcs.map((pc) => `<span class="chip tone-chip">${noteName(pc, state.accidental)}</span>`).join("")
      : "";

    const matches = findMatchingChords(pickedNotes);
    const matchCards = matches.length === 0
      ? `<div class="theory-desc picker-empty">点击下方指板选音，将自动列出包含这些音的所有和弦（含转位）。</div>`
      : matches.map((m) => {
          const v = pickMatchingVoicing(m.root, m.typeId, pickedNotes, tuning);
          if (!v) return "";
          const bass = voicingBassPc(v, tuning);
          const bassName = bass !== null && bass !== m.root ? "/" + noteName(bass, state.accidental) : "";
          const symbol = chordSymbol(m.root, m.type, state.accidental) + bassName;
          const noteLabels = m.type.intervals.map((iv, idx) => ({
            name: noteName(mod12(m.root + iv), state.accidental),
            degree: m.type.labels[idx] || String(iv),
          }));
          return `
            <figure class="voicing-card picker-card">
              <span class="chord-card-symbol">${symbol}</span>
              <div class="chord-diagram">${buildVoicingSVG(v, m.type, tuning)}</div>
              <div class="chord-card-notes">${noteLabels.map((n) => `<span class="chip tone-chip chord-note-chip"><span class="chord-note-name">${n.name}</span><sub class="chord-note-deg">${n.degree}</sub></span>`).join("")}</div>
              <figcaption class="voicing-meta">${voicingMeta(v, tuning)}</figcaption>
            </figure>`;
        }).join("");

    elements.fretboardArea.innerHTML = `
      <div class="picker-summary">
        <div class="picker-summary-row">
          <span class="picker-summary-label">已选组成音</span>
          <div class="tone-chips picker-tone-chips" aria-label="已选组成音">${noteChips || '<span class="picker-empty-text">未选</span>'}</div>
          <button type="button" class="picker-clear-btn" id="pickerClearBtn" ${pickedPcs.length === 0 ? "disabled" : ""}>清空</button>
        </div>
        <p class="picker-hint">点击下方指板任意位置可加/取消选音，再次点击同一位置取消。</p>
      </div>
      <div class="fretboard-scroll" id="fretboardScroll">
        <div class="fretboard-part" id="fretboardPartLow">${buildFullFretboardSVG(type, tuning, { start: 0, end: 24, leftPad: 40, showNames: true, pickedPositions })}</div>
      </div>
      <p class="fretboard-scroll-hint">← 横向滑动浏览全部 24 品 →</p>
      <div class="picker-matches">
        <h3 class="picker-matches-title">匹配和弦 <span class="picker-matches-count">${matches.length}</span></h3>
        <div class="voicing-grid picker-grid">${matchCards}</div>
      </div>`;

    document.getElementById("pickerClearBtn").addEventListener("click", clearPicked);


    elements.voicingHint.classList.add("visible");
    elements.voicingHintText.textContent = `已选 ${pickedPcs.length} 音 · 匹配 ${matches.length} 个和弦`;
    elements.diagramHint.innerHTML =
      `<span class="hint-line"></span> 探索模式：点击指板切换选音；匹配和弦含转位（低音标在 <code>/X</code> 后，组成音后为音级）。`;
  }
}

/* picker 版高把位动态加载 */
function loadHighFretboardPicker() {
  const scroll = document.getElementById("fretboardScroll");
  if (!scroll || document.getElementById("fretboardPartHigh")) return;
  const tuning = TUNINGS[state.tuningId];
  const part = document.createElement("div");
  part.className = "fretboard-part";
  part.id = "fretboardPartHigh";
  part.innerHTML = buildFullFretboardSVG(currentType(), tuning, { start: 12, end: 24, minFret: 13, leftPad: 0, showNames: false, pickedPositions });
  const more = document.getElementById("fretboardMore");
  scroll.insertBefore(part, more || null);
  if (more) more.remove();
  scroll.style.maxWidth = "none";
}

function orderString(tuning) {
  const names = tuning.pitches.map((p) => noteName(p, state.accidental));
  if (state.handed === "left") names.reverse();
  return names.join("–");
}

function voicingMeta(v, tuning) {
  const rootStr = v.rootStrings.slice().sort((a, b) => a - b)[0];
  const stringName = noteName(tuning.pitches[rootStr], state.accidental);
  const fret = v.frets[rootStr];
  const rootFretTxt = fret === 0 ? "空弦" : `${fret} 品`;
  const played = v.frets.filter((f) => f >= 0).length;
  const open = v.frets.filter((f) => f === 0).length;
  return `根音 ${stringName}弦${rootFretTxt}${open ? ` · ${open} 空弦` : ""}`;
}

/* ---------------- 探索模式：匹配和弦（含转位） ---------------- */
// 给定 voicing 与调弦，计算最低音（midi 最小）的 pitch class（bass）
function voicingBassPc(v, tuning) {
  let bestSi = -1, bestMidi = Infinity;
  for (let si = 0; si < v.frets.length; si += 1) {
    const f = v.frets[si];
    if (f < 0) continue;
    const midi = tuning.pitches[si] + f;
    if (midi < bestMidi) { bestMidi = midi; bestSi = si; }
  }
  return bestSi < 0 ? null : mod12(tuning.pitches[bestSi] + v.frets[bestSi]);
}

// 枚举所有 type × root(root ∈ pickedSet) 且和弦包含用户所有已选音（可含额外音）的匹配
function findMatchingChords(pickedSet) {
  const matches = [];
  if (pickedSet.size === 0) return matches;
  for (const type of CHORD_TYPES) {
    const ivals = type.intervals.map((i) => mod12(i)); // 相对根音的音程
    for (const root of pickedSet) {
      const chordSet = ivals.map((iv) => mod12(root + iv));
      // 和弦必须包含用户所有已选音（可含额外音）
      if (![...pickedSet].every((s) => chordSet.includes(s))) continue;
      const extra = chordSet.filter((s) => !pickedSet.has(s)); // 多余音
      matches.push({ root, typeId: type.id, type, semis: chordSet, extraCount: extra.length });
    }
  }
  // 排序：多余音最少（与用户选音最贴合）→ 同多余数时 3 音先于 4 音 → 按 type.id
  matches.sort((a, b) => a.extraCount - b.extraCount || a.type.intervals.length - b.type.intervals.length || a.typeId.localeCompare(b.typeId));
  return matches;
}

// 取匹配 (root, typeId) 的最佳 voicing：root position 优先（无斜杠标签）；
// 无 rootPos 时用 pickedSet 中非根低音的转位（显示 "符号/低音"）；最后 fallback
function pickMatchingVoicing(root, typeId, pickedSet, tuning) {
  const groups = extendedVoicings(typeId, root, tuning.pitches);
  const all = [...groups.must, ...groups.open, ...groups.moveable];
  if (!all.length) return null;
  const rootPos = all.find((v) => voicingBassPc(v, tuning) === root);
  if (rootPos) return rootPos;
  const transposed = all.filter((v) => {
    const b = voicingBassPc(v, tuning);
    return b !== null && pickedSet.has(b);
  });
  return transposed[0] || all[0];
}

// 切换（添加/移除）指板上的一个选音；同步 pickedNotes
// 同一根弦上只保留最新选择的音，避免重叠。
function togglePickedPosition(si, fret) {
  const tuning = TUNINGS[state.tuningId];
  const pc = mod12(tuning.pitches[si] + fret);
  const sameString = pickedPositions.filter((p) => p.si === si);
  const sameFretIdx = pickedPositions.findIndex((p) => p.si === si && p.fret === fret);

  // 先清除该弦上所有旧选择，并同步清理它们贡献的 pitch class
  for (const p of sameString) {
    const i = pickedPositions.indexOf(p);
    if (i >= 0) pickedPositions.splice(i, 1);
    if (!pickedPositions.some((q) => q.pc === p.pc)) pickedNotes.delete(p.pc);
  }

  // 如果点击的是当前已选中的音，则视为取消选择；否则加入最新音
  if (sameFretIdx < 0) {
    pickedPositions.push({ si, fret, pc });
    pickedNotes.add(pc);
  }
  renderVoicings();
}

function clearPicked() {
  pickedNotes.clear();
  pickedPositions = [];
  renderVoicings();
}

function renderSettings() {
  elements.tuningSelect.value = state.tuningId;
  elements.tuningDesc.textContent = TUNINGS[state.tuningId].desc;
  refreshSegmented(elements.handSwitch, "hand", state.handed);
  refreshSegmented(elements.accidentalSwitch, "acc", state.accidental);
  refreshSegmented(elements.viewSwitch, "view", state.view);
}

function renderAll() {
  refreshButtonStates();
  renderHero();
  renderVoicings();
  renderSettings();
  saveState();
}

/* ---------------- 事件绑定 ---------------- */
elements.rootButtons.addEventListener("click", (e) => {
  const btn = e.target.closest(".root-btn");
  if (!btn) return;
  state.root = Number(btn.dataset.root);
  renderAll();
});

elements.typeGroups.addEventListener("click", (e) => {
  const btn = e.target.closest(".type-btn");
  if (!btn) return;
  state.typeId = btn.dataset.type;
  renderAll();
});

elements.tuningSelect.addEventListener("change", () => {
  state.tuningId = elements.tuningSelect.value;
  renderAll();
});

elements.handSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-hand]");
  if (!btn) return;
  state.handed = btn.dataset.hand;
  renderAll();
});

elements.accidentalSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-acc]");
  if (!btn) return;
  state.accidental = btn.dataset.acc;
  renderAll();
});

elements.viewSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  renderAll();
});

/* 切换指板标记显示模式（级数 / 音名），仅更新 SVG 文字，不重绘指板，保留滚动位置与已加载高把位 */
function updateFretboardLabelMode(mode) {
  if (mode !== "degree" && mode !== "note") return;
  state.fbLabelMode = mode;

  const switchEl = document.getElementById("fbLabelSwitch");
  if (switchEl) {
    switchEl.querySelectorAll("button[data-fb-label]").forEach((btn) => {
      const active = btn.dataset.fbLabel === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  document.querySelectorAll(".full-fretboard text[data-fb-deg]").forEach((el) => {
    el.textContent = mode === "note" ? el.dataset.fbNote : el.dataset.fbDeg;
  });

  saveState();
}

// 指板标记切换（级数 / 音名）—— 事件委托
elements.fretboardArea.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-fb-label]");
  if (!btn) return;
  updateFretboardLabelMode(btn.dataset.fbLabel);
});

// 指板点击发声 / 选音切换——事件委托，兼容动态加载的高把位 SVG
elements.fretboardArea.addEventListener("click", (e) => {
  const strip = e.target.closest(".fb-string-strip");
  if (!strip) return;
  const svg = strip.closest("svg");
  if (!svg) return;

  const si = Number(strip.dataset.si);
  const start = Number(strip.dataset.start);
  const end = Number(strip.dataset.end);
  const leftPad = Number(strip.dataset.leftPad);
  const colW = Number(strip.dataset.colW);
  const rowH = Number(strip.dataset.rowH);
  const padT = Number(strip.dataset.padT);

  const fret = chordFretFromX(e.offsetX, start, leftPad, colW, end);
  // 探索模式（picker）：点击切换已选音并发声
  if (svg.classList.contains("picker-fretboard")) {
    togglePickedPosition(si, fret);
    audioEngine.play(si, fret, 1);
    showFretHit(svg, si, fret, start, leftPad, colW, rowH, padT);
    return;
  }
  audioEngine.play(si, fret, 1);
  showFretHit(svg, si, fret, start, leftPad, colW, rowH, padT);
});

/* ---------------- 初始化 ---------------- */
buildRootButtons();
buildTypeButtons();
refreshButtonStates();
renderAll();
