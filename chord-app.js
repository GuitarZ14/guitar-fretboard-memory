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
      };
    }
  } catch {
    // 忽略，使用默认
  }
  return { ...DEFAULT_STATE };
}

const state = loadState();

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

  // 品位数字（每根横线左侧）
  for (let r = 0; r <= rows; r += 1) {
    const label = start + r;
    const y = pad.t + r * rowH;
    if (label === 0) continue; // nut 不标
    parts.push(`<text class="diagram-fretnum" x="${pad.l - 7}" y="${y + 4}" text-anchor="end">${label}</text>`);
  }

  // 横线（品丝）
  for (let r = 0; r <= rows; r += 1) {
    const y = pad.t + r * rowH;
    const isNut = start === 0 && r === 0;
    parts.push(
      `<line x1="${pad.l}" y1="${y}" x2="${pad.l + colW * 6}" y2="${y}" stroke="${isNut ? DIAGRAM_COLORS.nut : DIAGRAM_COLORS.line}" stroke-width="${isNut ? 4 : 1.4}"/>`
    );
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

/* ---------------- 全指板横向图 SVG ---------------- */
function buildFullFretboardSVG(type, tuning) {
  const maxFret = 24;
  const pad = { t: 26, r: 16, b: 20, l: 34 };
  const colW = 34;
  const rowH = 30;
  const order = state.handed === "left" ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const w = pad.l + (maxFret + 1) * colW + pad.r;
  const h = pad.t + 6 * rowH + pad.b;

  const positions = fretboardPositions(state.root, type, tuning.pitches, {
    frets: maxFret,
  });

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="全指板和弦音位置" class="full-fretboard">`);

  // 品位数字
  for (let f = 1; f <= maxFret; f += 1) {
    const x = pad.l + f * colW + colW / 2;
    parts.push(`<text class="diagram-fretnum" x="${x}" y="${pad.t - 8}" text-anchor="middle">${f}</text>`);
  }

  // 品丝竖线
  for (let f = 0; f <= maxFret; f += 1) {
    const x = pad.l + f * colW;
    const isNut = f === 0;
    parts.push(
      `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + 6 * rowH}" stroke="${isNut ? DIAGRAM_COLORS.nut : DIAGRAM_COLORS.line}" stroke-width="${isNut ? 4 : 1.4}"/>`
    );
  }

  // 琴弦横线 + 弦名
  order.forEach((si, row) => {
    const y = pad.t + row * rowH + rowH / 2;
    parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + (maxFret + 1) * colW}" y2="${y}" stroke="${DIAGRAM_COLORS.line}" stroke-width="1.4"/>`);
    parts.push(`<text class="diagram-stringname" x="${pad.l - 9}" y="${y + 3}" text-anchor="end">${noteName(tuning.pitches[si], state.accidental)}</text>`);
  });

  // 品记
  const singleInlays = [3, 5, 7, 9, 15, 17, 19, 21];
  singleInlays.forEach((f) => {
    const x = pad.l + f * colW + colW / 2;
    parts.push(`<circle cx="${x}" cy="${pad.t + 3 * rowH}" r="5" fill="rgba(120,120,140,0.35)"/>`);
  });
  [12, 24].forEach((f) => {
    const x = pad.l + f * colW + colW / 2;
    parts.push(`<circle cx="${x}" cy="${pad.t + 2.5 * rowH}" r="5" fill="rgba(120,120,140,0.35)"/>`);
    parts.push(`<circle cx="${x}" cy="${pad.t + 4.5 * rowH}" r="5" fill="rgba(120,120,140,0.35)"/>`);
  });

  // 和弦音位置
  positions.forEach((p) => {
    const x = pad.l + p.fret * colW + colW / 2;
    const row = order.indexOf(p.si);
    const y = pad.t + row * rowH + rowH / 2;
    const fill = p.isRoot ? DIAGRAM_COLORS.root : DIAGRAM_COLORS.tone;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${p.isRoot ? 10 : 8}" fill="${fill}" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>`
    );
    if (p.isRoot) {
      parts.push(`<text class="diagram-root" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">R</text>`);
    }
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/* ---------------- 渲染 ---------------- */
function chip(className, text) {
  return `<span class="chip">${text}</span>`;
}

function renderHero() {
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

  elements.diagramTitle.textContent = `${symbol} 的按法`;
  elements.resultKicker.textContent = state.view === "voicing" ? "推荐指法" : "全指板";

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
    elements.voicingArea.hidden = true;
    elements.fretboardArea.hidden = false;
    const legend = document.querySelector(".legend");
    if (legend) legend.hidden = true;

    elements.fretboardArea.innerHTML = `
      <div class="fretboard-wrap-diagram">
        ${buildFullFretboardSVG(type, tuning)}
      </div>`;
    elements.voicingHint.classList.add("visible");
    elements.voicingHintText.textContent = "0–24 品";
    elements.diagramHint.innerHTML =
      `<span class="hint-line"></span> 深蓝为根音，桃色为和弦构成音，可横向滚动查看。`;
  }
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

/* ---------------- 初始化 ---------------- */
buildRootButtons();
buildTypeButtons();
refreshButtonStates();
renderAll();
