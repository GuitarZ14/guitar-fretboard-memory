/* GUITAR 音阶练习 — 交互逻辑
 * 依赖 chord-engine.js：音名表、调弦、和弦类型、指法搜索算法（extendedVoicings / fretboardPositions / noteName）。
 * 纯函数部分可在 Node 中复用（module.exports），DOM 初始化仅在浏览器执行。
 */

"use strict";

/* ===================== 音阶定义 ===================== */
const SCALE_GROUPS = [
  { key: "common", cn: "常用音阶" },
  { key: "minor", cn: "小调色彩" },
  { key: "modes", cn: "调式音阶" },
];

const SCALE_TYPES = [
  {
    id: "major", group: "common", cn: "大调音阶", en: "Major (Ionian)",
    intervals: [0, 2, 4, 5, 7, 9, 11], degrees: ["1", "2", "3", "4", "5", "6", "7"],
    formula: "全 全 半 全 全 全 半",
    desc: "自然大调音阶，明亮、稳定，是绝大多数流行与古典音乐的基石，顺阶和弦包含我们最熟悉的大小七色彩。",
  },
  {
    id: "minor", group: "common", cn: "自然小调音阶", en: "Natural Minor (Aeolian)",
    intervals: [0, 2, 3, 5, 7, 8, 10], degrees: ["1", "2", "b3", "4", "5", "b6", "7"],
    formula: "全 半 全 全 半 全 全",
    desc: "自然小调音阶，柔和、忧郁，作为大调的关系小调共享调号，常用于抒情与伤感段落。",
  },
  {
    id: "majorPenta", group: "common", cn: "大调五声音阶", en: "Major Pentatonic",
    intervals: [0, 2, 4, 7, 9], degrees: ["1", "2", "3", "5", "6"],
    formula: "全 全 小三 全 小三",
    desc: "去掉小调色彩与易冲突的 4、b7 级，只剩五个音，怎么弹都好听，是民谣与乡村solo的万能音阶。",
  },
  {
    id: "minorPenta", group: "common", cn: "小调五声音阶", en: "Minor Pentatonic",
    intervals: [0, 3, 5, 7, 10], degrees: ["1", "b3", "4", "5", "b7"],
    formula: "小三 全 全 小三 全",
    desc: "摇滚、布鲁斯与流行solo的母体音阶，五个音避免了不协和的大二度碰撞，solo上手极快。",
  },
  {
    id: "blues", group: "common", cn: "布鲁斯音阶", en: "Blues",
    intervals: [0, 3, 5, 6, 7, 10], degrees: ["1", "b3", "4", "b5", "5", "b7"],
    formula: "小三 全 半 半 小三 全",
    desc: "在小调五声基础上加入 b5（蓝调音），那一丝尖锐的张力正是布鲁斯的灵魂所在。",
  },
  {
    id: "melodicMinor", group: "minor", cn: "旋律小调音阶", en: "Melodic Minor",
    intervals: [0, 2, 3, 5, 7, 9, 11], degrees: ["1", "2", "b3", "4", "5", "6", "7"],
    formula: "全 半 全 全 全 全 半",
    desc: "上行时把自然小调的 6、7 级升高，得到更顺滑的爵士色彩，上行旋律优美、解决自然。",
  },
  {
    id: "harmonicMinor", group: "minor", cn: "和声小调音阶", en: "Harmonic Minor",
    intervals: [0, 2, 3, 5, 7, 8, 11], degrees: ["1", "2", "b3", "4", "5", "b6", "7"],
    formula: "全 半 全 全 半 增二 半",
    desc: "保留小调的 b6，同时升高 7 级制造导音，形成标志性的增二度跳跃，充满异域与古典和声张力。",
  },
  {
    id: "ionian", group: "modes", cn: "Ionian 伊奥尼亚", en: "Ionian",
    intervals: [0, 2, 4, 5, 7, 9, 11], degrees: ["1", "2", "3", "4", "5", "6", "7"],
    formula: "全 全 半 全 全 全 半",
    desc: "即大调音阶本身，最明亮、最稳定的调式，所有调式都以它为参照原点。",
  },
  {
    id: "dorian", group: "modes", cn: "Dorian 多利亚", en: "Dorian",
    intervals: [0, 2, 3, 5, 7, 9, 10], degrees: ["1", "2", "b3", "4", "5", "6", "b7"],
    formula: "全 半 全 全 全 半 全",
    desc: "小调色彩但带有明亮的大六度，比自然小调更开阔，是爵士、放克与摇滚小调solo的首选。",
  },
  {
    id: "phrygian", group: "modes", cn: "Phrygian 弗里几亚", en: "Phrygian",
    intervals: [0, 1, 3, 5, 7, 8, 10], degrees: ["1", "b2", "b3", "4", "5", "b6", "b7"],
    formula: "半 全 全 全 半 全 全",
    desc: "以小二度起始，带西班牙/弗拉门戈与金属风的阴暗紧张感，常被用在激昂或异域段落。",
  },
  {
    id: "lydian", group: "modes", cn: "Lydian 利底亚", en: "Lydian",
    intervals: [0, 2, 4, 6, 7, 9, 11], degrees: ["1", "2", "3", "#4", "5", "6", "7"],
    formula: "全 全 全 半 全 全 半",
    desc: "大调基础上升高 4 级，梦幻、悬浮、向上飞扬，是电影配乐与梦境氛围的常客。",
  },
  {
    id: "mixolydian", group: "modes", cn: "Mixolydian 混合利底亚", en: "Mixolydian",
    intervals: [0, 2, 4, 5, 7, 9, 10], degrees: ["1", "2", "3", "4", "5", "6", "b7"],
    formula: "全 全 半 全 全 半 全",
    desc: "大调色彩但降低 7 级，少了导音的推进、多了慵懒的摇滚感，是属七和弦对应的调式。",
  },
  {
    id: "aeolian", group: "modes", cn: "Aeolian 爱奥利亚", en: "Aeolian",
    intervals: [0, 2, 3, 5, 7, 8, 10], degrees: ["1", "2", "b3", "4", "5", "b6", "7"],
    formula: "全 半 全 全 半 全 全",
    desc: "即自然小调音阶，最典型的小调调式，承载了无数抒情与伤感的旋律。",
  },
  {
    id: "locrian", group: "modes", cn: "Locrian 洛克里亚", en: "Locrian",
    intervals: [0, 1, 3, 5, 6, 8, 10], degrees: ["1", "b2", "b3", "4", "b5", "b6", "b7"],
    formula: "半 全 全 半 全 全 全",
    desc: "唯一以减五度作为框架的调式，极不稳定、充满悬疑，多用于需要强烈紧张感的过渡。",
  },
];

const SCALE_TYPE_MAP = Object.fromEntries(SCALE_TYPES.map((s) => [s.id, s]));

/* ===================== 工具 ===================== */
function scaleMod12(n) {
  return ((n % 12) + 12) % 12;
}

// 每根弦的八度偏移（6 弦最低 → 1 弦最高），保证所有调弦都落在合理音区
const STRING_OCTAVE_K = [3, 3, 4, 4, 4, 5];
function stringMidi(tuning, si, fret) {
  return tuning.pitches[si] + 12 * STRING_OCTAVE_K[si] + fret;
}

function intervalKey(intervals) {
  return intervals.map((i) => scaleMod12(i)).sort((a, b) => a - b).join(",");
}

// 和弦类型匹配表（按音程集合 → typeId）
const TRIAD_MAP = {};
const SEVENTH_MAP = {};
CHORD_TYPES.forEach((t) => {
  const key = intervalKey(t.intervals);
  if (t.intervals.length === 3) TRIAD_MAP[key] = t.id;
  else if (t.intervals.length === 4) SEVENTH_MAP[key] = t.id;
});

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
function romanNumeral(degree, typeId) {
  const base = ROMAN[degree];
  const lower = base.toLowerCase();
  switch (typeId) {
    case "major": return base;
    case "aug": return base + "+";
    case "minor": return lower;
    case "dim": return lower + "°";
    case "maj7": return base + "maj7";
    case "7": return base + "7";
    case "m7": return lower + "m7";
    case "m7b5": return lower + "m7♭5";
    case "dim7": return lower + "°7";
    default: return base;
  }
}

/* ===================== 顺阶和弦计算 ===================== */
function diatonicChords(root, scaleType, tuning, accidental) {
  const ivals = scaleType.intervals;
  const n = ivals.length;
  const build = (useSeventh) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const rootSemi = scaleMod12(root + ivals[i]);
      const offsets = useSeventh ? [2, 4, 6] : [2, 4];
      const relative = offsets.map((o) => scaleMod12(root + ivals[(i + o) % n]));
      const key = intervalKey([0, ...relative]);
      const map = useSeventh ? SEVENTH_MAP : TRIAD_MAP;
      const typeId = map[key] || (useSeventh ? "7" : "major");
      const type = CHORD_TYPE_MAP[typeId];
      const symbol = chordSymbol(rootSemi, type, accidental);
      const semis = chordSemitones(rootSemi, type);
      out.push({
        degree: i,
        roman: romanNumeral(i, typeId),
        symbol,
        rootSemi,
        typeId,
        semis,
      });
    }
    return out;
  };
  return { triads: build(false), sevenths: build(true) };
}

/* ===================== SVG 颜色 ===================== */
const SCALE_DIAGRAM_COLORS = {
  line: "rgba(120,120,140,0.4)",
  nut: "#8a8aa0",
  root: "#4f8fb0",
  tone: "#f5a69c",
  highlight: "#2fa45a",
};

function scaleStringWidth(si, thin, thick) {
  return +(thin + (si / 5) * (thick - thin)).toFixed(2);
}

// 与 buildFullFretboardSVG 一致的布局参数
function scaleFbLayout(frets) {
  const leftPad = 34;
  const colW = 44;
  const rowH = 38;
  const pad = { t: 28, r: frets >= 22 ? 16 : 0, b: 18, l: leftPad };
  const rightEdge = leftPad + (frets - 0) * colW;
  const w = rightEdge + pad.r;
  const h = pad.t + 6 * rowH + pad.b;
  const order = [5, 4, 3, 2, 1, 0]; // 6 弦在上
  return { leftPad, colW, rowH, pad, rightEdge, w, h, order };
}

/* ===================== 指板 SVG（音阶） ===================== */
function buildScaleFretboardSVG(root, scaleType, tuning, opts = {}) {
  const frets = opts.frets ?? 12;
  const labelMode = opts.labelMode ?? "note"; // note | degree
  const accidental = opts.accidental ?? "sharp";
  const highlight = opts.highlight || null; // Set<number> 或数组（pitch class）
  const L = scaleFbLayout(frets);
  const { leftPad, colW, rowH, pad, rightEdge, w, h, order } = L;

  // 半音 → 音级映射（用于标注）
  const semiToDegree = {};
  scaleType.intervals.forEach((iv, k) => {
    const semi = scaleMod12(root + iv);
    if (semiToDegree[semi] === undefined) semiToDegree[semi] = scaleType.degrees[k];
  });

  const positions = fretboardPositions(root, { intervals: scaleType.intervals }, tuning.pitches, { frets })
    .filter((p) => p.fret >= 0 && p.fret <= frets);

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${scaleType.cn} 指板位置（0–${frets} 品）" class="full-fretboard scale-fretboard">`
  );

  for (let f = 1; f <= frets; f += 1) {
    const x = leftPad + (f - 0) * colW + colW / 2;
    parts.push(`<text class="diagram-fretnum" x="${x}" y="${pad.t - 9}" text-anchor="middle">${f}</text>`);
  }

  for (let f = 0; f <= frets; f += 1) {
    const x = leftPad + (f - 0) * colW;
    const isNut = f === 0;
    parts.push(
      `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + 6 * rowH}" stroke="${isNut ? SCALE_DIAGRAM_COLORS.nut : SCALE_DIAGRAM_COLORS.line}" stroke-width="${isNut ? 8 : 7}"/>`
    );
  }

  order.forEach((si, row) => {
    const y = pad.t + row * rowH + rowH / 2;
    const sw = scaleStringWidth(si, 2, 6);
    parts.push(`<line x1="${leftPad}" y1="${y}" x2="${rightEdge}" y2="${y}" stroke="${SCALE_DIAGRAM_COLORS.line}" stroke-width="${sw}"/>`);
    parts.push(`<text class="diagram-stringname" x="${leftPad - 9}" y="${y + 3}" text-anchor="end">${noteName(tuning.pitches[si], accidental)}</text>`);
  });

  // 品记
  [3, 5, 7, 9, 15, 17, 19, 21].forEach((f) => {
    if (f > frets) return;
    const x = leftPad + f * colW + colW / 2;
    parts.push(`<circle cx="${x}" cy="${pad.t + 3 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
  });
  [12, 24].forEach((f) => {
    if (f > frets) return;
    const x = leftPad + f * colW + colW / 2;
    parts.push(`<circle cx="${x}" cy="${pad.t + 2.5 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
    parts.push(`<circle cx="${x}" cy="${pad.t + 4.5 * rowH}" r="6" fill="rgba(120,120,140,0.35)"/>`);
  });

  positions.forEach((p) => {
    const x = leftPad + p.fret * colW + colW / 2;
    const row = order.indexOf(p.si);
    const y = pad.t + row * rowH + rowH / 2;
    const semi = scaleMod12(tuning.pitches[p.si] + p.fret);
    const note = noteName(semi, accidental);
    const degree = semiToDegree[semi] ?? "";
    const isHi = highlight && (Array.isArray(highlight) ? highlight.includes(semi) : highlight.has(semi));
    const r = p.isRoot ? 13 : 10;
    const fill = p.isRoot ? SCALE_DIAGRAM_COLORS.root : SCALE_DIAGRAM_COLORS.tone;

    // 高亮环（组成音）
    if (isHi) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${r + 6}" fill="none" stroke="${SCALE_DIAGRAM_COLORS.highlight}" stroke-width="3.5"/>`);
    }

    parts.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>`
    );

    const centerLabel = labelMode === "note" ? note : degree;
    const supraLabel = labelMode === "note" ? degree : note;
    // 圆心主标注
    parts.push(
      `<text class="${p.isRoot ? "diagram-root" : "diagram-fb-label"}" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">${centerLabel}</text>`
    );
    // 上标（另一个信息）
    if (supraLabel) {
      parts.push(
        `<text class="diagram-degree" x="${x}" y="${y - r - 4}" text-anchor="middle">${supraLabel}</text>`
      );
    }
  });

  // 透明点击条（按弦发声）
  order.forEach((si, row) => {
    const y = pad.t + row * rowH;
    parts.push(
      `<rect class="fb-string-strip" x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent" data-si="${si}" data-start="0" data-end="${frets}" data-left-pad="${leftPad}" data-col-w="${colW}" data-row-h="${rowH}" data-pad-t="${pad.t}" aria-label="弦 ${6 - si} 点击区"/>`
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/* ===================== 竖向指法图 SVG（顺阶和弦） ===================== */
function scaleStringWidthV(si, thin, thick) {
  return +(thin + (si / 5) * (thick - thin)).toFixed(2);
}

function buildScaleVoicingSVG(v, type, tuning, opts = {}) {
  const handed = opts.handed ?? "right";
  const accidental = opts.accidental ?? "sharp";
  const frets = v.frets;
  const base = v.baseFret;
  const start = base <= 1 ? 0 : base - 1;
  const rows = Math.max(4, Math.min(6, v.span + 2));
  const pad = { t: 22, r: 10, b: 14, l: 16 };
  const colW = 15;
  const rowH = 15;
  const order = handed === "left" ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const w = pad.l + colW * 6 + pad.r;
  const h = pad.t + rows * rowH + pad.b;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="和弦指法图">`);

  for (let r = 0; r <= rows; r += 1) {
    const y = pad.t + r * rowH;
    const isTop = r === 0;
    parts.push(
      `<line x1="${pad.l}" y1="${y}" x2="${pad.l + colW * 6}" y2="${y}" stroke="${isTop ? SCALE_DIAGRAM_COLORS.nut : SCALE_DIAGRAM_COLORS.line}" stroke-width="${isTop ? 4 : 1.4}"/>`
    );
  }

  for (let b = 1; b <= rows; b += 1) {
    const label = start + b;
    const cy = pad.t + (b - 0.5) * rowH;
    parts.push(`<text class="diagram-fretnum" x="${pad.l - 7}" y="${cy + 3}" text-anchor="end">${label}</text>`);
  }

  order.forEach((si, col) => {
    const x = pad.l + col * colW + colW / 2;
    parts.push(`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + rows * rowH}" stroke="${SCALE_DIAGRAM_COLORS.line}" stroke-width="1.4"/>`);
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
    const cols = sis.map((si) => order.indexOf(si)).sort((a, b) => a - b);
    const x1 = pad.l + cols[0] * colW + colW / 2;
    const x2 = pad.l + cols[cols.length - 1] * colW + colW / 2;
    const y = pad.t + (f - start) * rowH + rowH / 2;
    parts.push(`<path d="M ${x1} ${y - 2} Q ${(x1 + x2) / 2} ${y - 6}, ${x2} ${y - 2}" fill="none" stroke="${SCALE_DIAGRAM_COLORS.line}" stroke-width="1.6"/>`);
  });

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
    const fill = isRoot ? SCALE_DIAGRAM_COLORS.root : SCALE_DIAGRAM_COLORS.tone;
    parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>`);
    if (isRoot) {
      parts.push(`<text class="diagram-root" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">R</text>`);
    } else {
      const finger = v.fingers[si];
      if (finger > 0) {
        parts.push(`<text class="diagram-finger" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">${finger}</text>`);
      }
    }
  });

  order.forEach((si, col) => {
    const x = pad.l + col * colW + colW / 2;
    const f = frets[si];
    let label;
    if (f === -1) label = "×";
    else if (f === 0) label = noteName(tuning.pitches[si], accidental);
    else label = noteName(tuning.pitches[si] + f, accidental);
    parts.push(`<text class="diagram-stringname" x="${x}" y="${pad.t + rows * rowH + 11}" text-anchor="middle">${label}</text>`);
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/* ===================== 升序播放序列（指板运行） ===================== */
function buildScaleRun(root, scaleType, tuning, octaves) {
  const ivals = scaleType.intervals;
  const n = ivals.length;
  const positions = fretboardPositions(root, { intervals: ivals }, tuning.pitches, { frets: 24 })
    .map((p) => ({
      si: p.si,
      fret: p.fret,
      midi: stringMidi(tuning, p.si, p.fret),
      semi: scaleMod12(tuning.pitches[p.si] + p.fret),
    }));

  const pool = positions.filter((p) => p.semi === scaleMod12(root) && p.midi >= 48)
    .sort((a, b) => a.midi - b.midi);
  const startPool = pool.length ? pool : positions.filter((p) => p.semi === scaleMod12(root)).sort((a, b) => a.midi - b.midi);
  if (!startPool.length) return [];

  const run = [startPool[0]];
  let prev = startPool[0];
  const steps = n * (octaves || 1);
  for (let k = 1; k <= steps; k += 1) {
    const targetSemi = scaleMod12(root + (k < steps ? ivals[k % n] : 0));
    const cands = positions
      .filter((p) => p.semi === targetSemi && p.midi > prev.midi)
      .sort((a, b) => a.midi - b.midi);
    const next = cands.length
      ? cands[0]
      : positions.filter((p) => p.semi === targetSemi).sort((a, b) => a.midi - b.midi)[0];
    if (!next) break;
    run.push(next);
    prev = next;
  }
  return run;
}

/* ===================== 音频（Karplus-Strong 合成） ===================== */
const scaleAudioEngine = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  },
  playSynth(midi, velocity = 1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const sr = ctx.sampleRate;
    const duration = 2.6;
    const N = Math.max(2048, Math.floor(sr * duration));
    const delayLen = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(delayLen);
    for (let i = 0; i < delayLen; i += 1) ring[i] = Math.random() * 2 - 1;
    let prev = 0;
    for (let i = 0; i < delayLen; i += 1) {
      const c = ring[i];
      ring[i] = (c + prev) * 0.5;
      prev = c;
    }
    const out = new Float32Array(N);
    let idx = 0;
    const decay = 0.996;
    for (let nn = 0; nn < N; nn += 1) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % delayLen];
      const filt = (cur + nxt) * 0.5;
      out[nn] = cur;
      ring[idx] = filt * decay;
      idx = (idx + 1) % delayLen;
    }
    const attack = Math.floor(sr * 0.003);
    for (let nn = 0; nn < attack; nn += 1) out[nn] *= nn / attack;
    const fade = Math.floor(sr * 0.05);
    for (let nn = 0; nn < fade; nn += 1) out[N - 1 - nn] *= nn / fade;
    let peak = 0;
    for (let nn = 0; nn < N; nn += 1) peak = Math.max(peak, Math.abs(out[nn]));
    if (peak > 0) {
      const g = 0.9 / peak;
      for (let nn = 0; nn < N; nn += 1) out[nn] *= g;
    }
    const ab = ctx.createBuffer(1, N, sr);
    ab.getChannelData(0).set(out);
    const src = ctx.createBufferSource();
    src.buffer = ab;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 8000;
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
  play(tuning, si, fret, velocity = 1) {
    if (!this.ensure()) return;
    this.playSynth(stringMidi(tuning, si, fret), velocity);
  },
};

/* ===================== Node 导出（供审计/测试） ===================== */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCALE_GROUPS,
    SCALE_TYPES,
    SCALE_TYPE_MAP,
    diatonicChords,
    buildScaleFretboardSVG,
    buildScaleVoicingSVG,
    buildScaleRun,
    scaleMod12,
    stringMidi,
    intervalKey,
    TRIAD_MAP,
    SEVENTH_MAP,
  };
}

/* ===================== 浏览器初始化 ===================== */
if (typeof document !== "undefined") {
  const STORAGE_KEY = "guitar-scale-practice-settings";
  const DEFAULT_STATE = {
    root: 0,
    scaleId: "major",
    tuningId: "standard",
    accidental: "sharp",
    frets: 12,
    octaves: 1,
    tempo: 380,
    labelMode: "note",
    handed: "right",
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        return {
          root: Number.isFinite(saved.root) ? saved.root % 12 : DEFAULT_STATE.root,
          scaleId: SCALE_TYPE_MAP[saved.scaleId] ? saved.scaleId : DEFAULT_STATE.scaleId,
          tuningId: TUNINGS[saved.tuningId] ? saved.tuningId : DEFAULT_STATE.tuningId,
          accidental: saved.accidental === "flat" ? "flat" : "sharp",
          frets: saved.frets === 22 ? 22 : 12,
          octaves: saved.octaves === 2 ? 2 : 1,
          tempo: [240, 380, 620].includes(saved.tempo) ? saved.tempo : DEFAULT_STATE.tempo,
          labelMode: saved.labelMode === "degree" ? "degree" : "note",
          handed: saved.handed === "left" ? "left" : "right",
        };
      }
    } catch {}
    return { ...DEFAULT_STATE };
  }

  const state = loadState();
  let currentDiatonic = null;
  let highlightSet = null; // 当前高亮的和弦 pitch class 数组
  let isPlaying = false;
  let playTimers = [];

  const els = {
    tuningSelect: document.querySelector("#tuningSelect"),
    tuningDesc: document.querySelector("#tuningDesc"),
    accidentalSwitch: document.querySelector("#accidentalSwitch"),
    rangeSwitch: document.querySelector("#rangeSwitch"),
    octaveSwitch: document.querySelector("#octaveSwitch"),
    tempoSwitch: document.querySelector("#tempoSwitch"),
    scaleName: document.querySelector("#scaleName"),
    scaleEn: document.querySelector("#scaleEn"),
    noteChips: document.querySelector("#noteChips"),
    degreeChips: document.querySelector("#degreeChips"),
    theoryDesc: document.querySelector("#theoryDesc"),
    fretboard: document.querySelector("#scaleFretboard"),
    fretNumbers: document.querySelector("#fretNumbers"),
    fretboardScroll: document.querySelector("#fretboardScroll"),
    playButton: document.querySelector("#playButton"),
    labelSwitch: document.querySelector("#labelSwitch"),
    rootButtons: document.querySelector("#rootButtons"),
    scaleGroups: document.querySelector("#scaleGroups"),
    triadGrid: document.querySelector("#triadGrid"),
    seventhGrid: document.querySelector("#seventhGrid"),
    diatonicHintText: document.querySelector("#diatonicHintText"),
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }
  function currentScale() { return SCALE_TYPE_MAP[state.scaleId]; }
  function currentTuning() { return TUNINGS[state.tuningId]; }

  /* ---------- 构建静态控件 ---------- */
  function buildRootButtons() {
    els.rootButtons.textContent = "";
    for (let i = 0; i < 12; i += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "root-btn";
      btn.dataset.root = String(i);
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = noteName(i, state.accidental);
      els.rootButtons.append(btn);
    }
  }

  function buildScaleButtons() {
    els.scaleGroups.textContent = "";
    SCALE_GROUPS.forEach((group) => {
      const block = document.createElement("div");
      block.className = "type-group";
      const head = document.createElement("div");
      head.className = "type-group-head";
      head.innerHTML = `<span>${group.cn}</span>`;
      block.append(head);
      const btns = document.createElement("div");
      btns.className = "type-group-btns";
      SCALE_TYPES.filter((s) => s.group === group.key).forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "type-btn";
        btn.dataset.scale = s.id;
        btn.textContent = s.cn;
        btn.title = `${s.en}（${s.formula}）`;
        btns.append(btn);
      });
      block.append(btns);
      els.scaleGroups.append(block);
    });
  }

  /* ---------- 状态类更新 ---------- */
  function refreshButtonStates() {
    els.rootButtons.querySelectorAll(".root-btn").forEach((btn) => {
      const active = Number(btn.dataset.root) === state.root;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.textContent = noteName(Number(btn.dataset.root), state.accidental);
    });
    els.scaleGroups.querySelectorAll(".type-btn").forEach((btn) => {
      const active = btn.dataset.scale === state.scaleId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function refreshSegmented(container, attr, value) {
    container.querySelectorAll("button").forEach((btn) => {
      const active = btn.dataset[attr] === String(value);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  /* ---------- 渲染 Hero ---------- */
  function renderHero() {
    const sc = currentScale();
    const rootName = noteName(state.root, state.accidental);
    els.scaleName.textContent = `${rootName} ${sc.cn}`;
    els.scaleEn.textContent = sc.en;

    const semis = sc.intervals.map((iv) => scaleMod12(state.root + iv));
    els.noteChips.innerHTML = semis
      .map((s) => `<span class="chip tone-chip">${noteName(s, state.accidental)}</span>`)
      .join("");
    els.degreeChips.innerHTML = sc.degrees
      .map((d) => `<span class="chip interval-chip">${d}</span>`)
      .join("");

    els.theoryDesc.textContent = `${sc.formula}　·　${sc.desc}`;

    els.scaleName.parentElement.classList.remove("pop");
    void els.scaleName.parentElement.offsetWidth;
    els.scaleName.parentElement.classList.add("pop");
  }

  /* ---------- 渲染指板 ---------- */
  function renderFretboard() {
    const sc = currentScale();
    const svg = buildScaleFretboardSVG(state.root, sc, currentTuning(), {
      frets: state.frets,
      labelMode: state.labelMode,
      accidental: state.accidental,
      highlight: highlightSet,
    });
    els.fretboard.innerHTML = svg;
  }

  /* ---------- 渲染顺阶和弦 ---------- */
  function renderDiatonic() {
    const sc = currentScale();
    currentDiatonic = diatonicChords(state.root, sc, currentTuning(), state.accidental);
    renderChordGrid(els.triadGrid, currentDiatonic.triads, false);
    renderChordGrid(els.seventhGrid, currentDiatonic.sevenths, true);
  }

  function pickVoicing(rootSemi, typeId) {
    const res = extendedVoicings(typeId, rootSemi, currentTuning().pitches, {});
    const list = res.open.length ? res.open : res.must;
    return list.length ? list[0] : null;
  }

  function renderChordGrid(container, chords, isSeventh) {
    container.textContent = "";
    chords.forEach((c) => {
      const type = CHORD_TYPE_MAP[c.typeId];
      const v = pickVoicing(c.rootSemi, c.typeId);
      const cell = document.createElement("div");
      cell.className = "chord-cell";
      cell.dataset.semis = c.semis.join(",");
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-label", `和弦 ${c.symbol}，点击在指板高亮`);

      const roman = document.createElement("div");
      roman.className = "chord-cell-roman";
      roman.textContent = c.roman;

      const symbol = document.createElement("div");
      symbol.className = "chord-cell-symbol";
      symbol.textContent = c.symbol;

      const diagram = document.createElement("div");
      diagram.className = "chord-diagram";
      if (v) {
        diagram.innerHTML = buildScaleVoicingSVG(v, type, currentTuning(), {
          handed: state.handed,
          accidental: state.accidental,
        });
      } else {
        diagram.innerHTML = '<span class="voicing-meta">无指法</span>';
      }

      cell.append(roman, symbol, diagram);
      cell.addEventListener("click", () => toggleChordHighlight(c, cell));
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleChordHighlight(c, cell);
        }
      });
      container.append(cell);
    });
  }

  /* ---------- 和弦高亮 + 琶音 ---------- */
  function clearChordHighlight() {
    highlightSet = null;
    document.querySelectorAll(".chord-cell.active").forEach((el) => el.classList.remove("active"));
    els.diatonicHintText.textContent = "点击和弦可高亮组成音";
    renderFretboard();
  }

  function toggleChordHighlight(c, cell) {
    const isActive = cell.classList.contains("active");
    document.querySelectorAll(".chord-cell.active").forEach((el) => el.classList.remove("active"));
    if (isActive) {
      clearChordHighlight();
      return;
    }
    cell.classList.add("active");
    highlightSet = c.semis.slice();
    els.diatonicHintText.textContent = `已高亮 ${c.symbol} 的组成音`;
    renderFretboard();
    playChordArpeggio(c);
  }

  function playChordArpeggio(c) {
    const v = pickVoicing(c.rootSemi, c.typeId);
    if (!v) return;
    const tuning = currentTuning();
    const notes = [];
    v.frets.forEach((f, si) => {
      if (f >= 0) notes.push({ si, fret: f, midi: stringMidi(tuning, si, f) });
    });
    notes.sort((a, b) => a.midi - b.midi);
    notes.forEach((nt, idx) => {
      const id = setTimeout(() => {
        scaleAudioEngine.play(tuning, nt.si, nt.fret);
        flashNote(nt.si, nt.fret);
      }, idx * 260);
      playTimers.push(id);
    });
  }

  /* ---------- 指板点击发声 ---------- */
  function fretFromX(x, start, leftPad, colW, end) {
    const f = Math.round((x - leftPad - colW / 2) / colW) + start;
    return Math.max(start, Math.min(end, f));
  }

  function flashNote(si, fret) {
    const svg = els.fretboard.querySelector("svg");
    if (!svg) return;
    const L = scaleFbLayout(state.frets);
    const order = L.order;
    const row = order.indexOf(si);
    if (row < 0) return;
    const x = L.leftPad + fret * L.colW + L.colW / 2;
    const y = L.pad.t + row * L.rowH + L.rowH / 2;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", 8);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "rgba(47,164,90,0.9)");
    circle.setAttribute("stroke-width", 3);
    circle.setAttribute("class", "fb-hit-ring");
    svg.appendChild(circle);
    setTimeout(() => circle.remove(), 340);
  }

  function handleFretboardClick(e) {
    const strip = e.target.closest(".fb-string-strip");
    if (!strip) return;
    const si = Number(strip.dataset.si);
    const start = Number(strip.dataset.start);
    const end = Number(strip.dataset.end);
    const leftPad = Number(strip.dataset.leftPad);
    const colW = Number(strip.dataset.colW);
    const rowH = Number(strip.dataset.rowH);
    const padT = Number(strip.dataset.padT);
    const rect = strip.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fret = fretFromX(x, start, leftPad, colW, end);
    scaleAudioEngine.play(currentTuning(), si, fret);
    flashNote(si, fret);
  }

  /* ---------- 播放音阶 ---------- */
  function stopScale() {
    playTimers.forEach((id) => clearTimeout(id));
    playTimers = [];
    isPlaying = false;
    updatePlayButton();
  }

  function finishScale() {
    isPlaying = false;
    updatePlayButton();
  }

  function updatePlayButton() {
    const label = els.playButton.querySelector(".play-label");
    const icon = els.playButton.querySelector(".play-icon");
    if (isPlaying) {
      label.textContent = "停止";
      icon.textContent = "■";
      els.playButton.classList.add("playing");
    } else {
      label.textContent = "播放音阶";
      icon.textContent = "▶";
      els.playButton.classList.remove("playing");
    }
  }

  function playScale() {
    if (isPlaying) { stopScale(); return; }
    const sc = currentScale();
    const run = buildScaleRun(state.root, sc, currentTuning(), state.octaves);
    if (!run.length) return;
    isPlaying = true;
    updatePlayButton();
    run.forEach((p, idx) => {
      const id = setTimeout(() => {
        scaleAudioEngine.play(currentTuning(), p.si, p.fret);
        flashNote(p.si, p.fret);
        if (idx === run.length - 1) finishScale();
      }, idx * state.tempo);
      playTimers.push(id);
    });
  }

  /* ---------- 整体渲染 ---------- */
  function renderAll() {
    renderHero();
    renderFretboard();
    renderDiatonic();
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    els.tuningSelect.addEventListener("change", () => {
      state.tuningId = els.tuningSelect.value;
      els.tuningDesc.textContent = currentTuning().desc;
      highlightSet = null;
      saveState();
      renderAll();
    });

    els.accidentalSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-acc]");
      if (!btn) return;
      state.accidental = btn.dataset.acc;
      refreshSegmented(els.accidentalSwitch, "acc", state.accidental);
      saveState();
      renderAll();
    });

    els.rangeSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      state.frets = Number(btn.dataset.range);
      refreshSegmented(els.rangeSwitch, "range", state.frets);
      saveState();
      renderFretboard();
    });

    els.octaveSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-oct]");
      if (!btn) return;
      state.octaves = Number(btn.dataset.oct);
      refreshSegmented(els.octaveSwitch, "oct", state.octaves);
      saveState();
    });

    els.tempoSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tempo]");
      if (!btn) return;
      state.tempo = Number(btn.dataset.tempo);
      refreshSegmented(els.tempoSwitch, "tempo", state.tempo);
      saveState();
    });

    els.labelSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-label]");
      if (!btn) return;
      state.labelMode = btn.dataset.label;
      refreshSegmented(els.labelSwitch, "label", state.labelMode);
      saveState();
      renderFretboard();
    });

    els.rootButtons.addEventListener("click", (e) => {
      const btn = e.target.closest(".root-btn");
      if (!btn) return;
      state.root = Number(btn.dataset.root);
      refreshButtonStates();
      highlightSet = null;
      saveState();
      renderAll();
    });

    els.scaleGroups.addEventListener("click", (e) => {
      const btn = e.target.closest(".type-btn");
      if (!btn) return;
      state.scaleId = btn.dataset.scale;
      refreshButtonStates();
      highlightSet = null;
      saveState();
      renderAll();
    });

    els.playButton.addEventListener("click", playScale);
    els.fretboardScroll.addEventListener("click", handleFretboardClick);

    // 初次加载：应用已保存的分段状态
    refreshSegmented(els.accidentalSwitch, "acc", state.accidental);
    refreshSegmented(els.rangeSwitch, "range", state.frets);
    refreshSegmented(els.octaveSwitch, "oct", state.octaves);
    refreshSegmented(els.tempoSwitch, "tempo", state.tempo);
    refreshSegmented(els.labelSwitch, "label", state.labelMode);
  }

  /* ---------- 启动 ---------- */
  function init() {
    els.tuningDesc.textContent = currentTuning().desc;
    buildRootButtons();
    buildScaleButtons();
    refreshButtonStates();
    bindEvents();
    renderAll();
  }

  init();
}
