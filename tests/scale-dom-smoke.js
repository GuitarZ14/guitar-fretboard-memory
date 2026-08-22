/* 轻量 DOM 桩：在 Node 中真实执行 scale-app.js 的浏览器初始化（init），
 * 并模拟关键交互（根音切换 / 音阶切换 / 和弦高亮 / 播放与停止），
 * 捕捉事件处理路径上的引用错误或异常。不验证视觉，只验证“页面能跑起来且交互不炸”。
 */
"use strict";

const assert = require("assert");

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) {
    const has = this.set.has(c);
    const on = force === undefined ? !has : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  contains(c) { return this.set.has(c); }
}

class FakeEl {
  constructor(tag = "div", root = false) {
    this.tagName = tag || "div";
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this._text = "";
    this._html = "";
    this._listeners = {};
    this.offsetWidth = 0;
    this.id = "";
    this._className = "";
    this._parent = root ? null : undefined; // 非 root 元素懒创建 parent，且不会无限递归
  }
  get parentElement() {
    if (this._parent === undefined) this._parent = new FakeEl("div", true);
    return this._parent;
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList = new FakeClassList();
    String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  matches(sel) {
    if (sel === "*") return true;
    const token = sel.trim().split(/\s+/)[0];
    if (token.startsWith("#")) return this.id === token.slice(1);
    // 属性选择器 [data-x] / button[data-x="v"]
    const attr = token.match(/^([a-zA-Z][a-zA-Z0-9-]*)?\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const [, tag, a, val] = attr;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const dv = this.dataset[a.replace(/^data-/, "")];
      if (val !== undefined) return String(dv) === val;
      return dv !== undefined;
    }
    // 支持 ".a.b" / "button.a" 等复合类选择器
    const cls = [];
    let tag = token;
    for (const m of token.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      cls.push(m[1]);
      tag = tag.replace(m[0], "");
    }
    for (const c of cls) if (!this.classList.contains(c)) return false;
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    return true;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n.matches(sel)) return n;
      n = n._parent && n._parent._parent !== undefined ? n._parent : null;
    }
    return null;
  }
  _walk(sel, out) {
    for (const c of this.children) {
      if (c.matches(sel)) out.push(c);
      c._walk(sel, out);
    }
    return out;
  }
  querySelectorAll(sel) { return this._walk(sel, []); }
  querySelector(sel) {
    const m = this.querySelectorAll(sel);
    return m.length ? m[0] : new FakeEl();
  }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { if (k === "class") this.className = v; else if (k === "id") this.id = v; this[k] = v; }
  getAttribute() { return null; }
  appendChild(c) { this.children.push(c); c._parent = this; return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }
  focus() {}
}

const bySel = {};
function getEl(sel) { if (!bySel[sel]) bySel[sel] = new FakeEl(); return bySel[sel]; }

/* 预置三个分段控件（模拟 scales.html 静态按钮），init 时事件才能绑上去 */
function mkSegBtn(attr, val) {
  const b = new FakeEl("button");
  b.dataset[attr] = val;
  return b;
}
function seedSegmented(id, attr, values) {
  const container = getEl(id);
  values.forEach((v) => container.append(mkSegBtn(attr, v)));
}
// 双滑块（模拟 scales.html 的 <input type="range"> 默认值）
bySel["#fretRangeMinInput"] = getEl("#fretRangeMinInput");
bySel["#fretRangeMaxInput"] = getEl("#fretRangeMaxInput");
bySel["#fretRangeMinInput"].value = "0";
bySel["#fretRangeMaxInput"].value = "12";
seedSegmented("#accidentalSwitch", "acc", ["sharp", "flat"]);
seedSegmented("#labelSwitch", "label", ["note", "degree"]);

const documentStub = {
  querySelector(sel) { return getEl(sel); },
  querySelectorAll(sel) {
    const out = [];
    const seen = new Set();
    Object.values(bySel).forEach((el) => {
      el._walk(sel, out);
    });
    return out.filter((el) => (seen.has(el) ? false : (seen.add(el), true)));
  },
  createElement(tag) { return new FakeEl(tag); },
  createElementNS() { return new FakeEl("svg"); },
  addEventListener() {},
};
global.__bySel = bySel;

const localStorageStub = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

class AudioContextStub {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  resume() {}
  createBuffer() {
    return { getChannelData: () => new Float32Array(1 << 20) };
  }
  createBufferSource() { return { connect() {}, start() {}, disconnect() {}, buffer: null }; }
  createBiquadFilter() { return { connect() {}, disconnect() {}, type: "", frequency: { value: 0 } }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}

global.document = documentStub;
global.window = { AudioContext: AudioContextStub, matchMedia: () => ({ matches: false }), addEventListener() {} };
global.localStorage = localStorageStub;

/* 触发事件：el 上的监听器，target 可选（默认 el 自身） */
function fireEvent(el, type, target) {
  const ev = {
    target: target || el,
    currentTarget: el,
    preventDefault() {},
    stopPropagation() {},
    key: "Enter",
    clientX: 40,
    clientY: 20,
  };
  (el._listeners[type] || []).forEach((fn) => fn(ev));
}

try {
  const engine = require("../chord-engine.js");
  Object.assign(global, engine);
  require("../scale-app.js"); // 会因 typeof document !== 'undefined' 执行 init()

  console.log("✓ scale-app.js 在 DOM 桩下成功初始化（init 未抛错）");

  /* ---- 初始渲染断言 ---- */
  assert.strictEqual(bySel["#scaleName"].textContent, "C 大调音阶", "默认根音/音阶应渲染为 C 大调音阶");
  const rootBtns = bySel["#rootButtons"].querySelectorAll(".root-btn");
  assert.strictEqual(rootBtns.length, 12, "根音按钮应为 12 个");
  const typeBtns = bySel["#scaleGroups"].querySelectorAll(".type-btn");
  assert.ok(typeBtns.length >= 12, "音阶类型按钮应不少于 12 个，实际 " + typeBtns.length);
  assert.ok(bySel["#scaleFretboard"].innerHTML.includes("<svg"), "指板应渲染出 SVG");
  const triadCells = bySel["#triadGrid"].querySelectorAll(".chord-cell");
  const seventhCells = bySel["#seventhGrid"].querySelectorAll(".chord-cell");
  assert.ok(triadCells.length >= 5 && seventhCells.length >= 5, `顺阶和弦应渲染：三和弦 ${triadCells.length} 个、七和弦 ${seventhCells.length} 个`);
  const triadSvgCount = bySel["#triadGrid"].innerHTML.split("<svg").length - 1;
  assert.ok(triadCells.length >= 5, "三和弦网格应有卡片");
  console.log(`✓ 初始渲染正确：根音×12、音阶类型×${typeBtns.length}、指板 SVG、三和弦 ${triadCells.length} / 七和弦 ${seventhCells.length}`);

  /* ---- 交互 1：切换根音到 F ---- */
  fireEvent(bySel["#rootButtons"], "click", rootBtns[5]);
  assert.strictEqual(bySel["#scaleName"].textContent, "F 大调音阶", "切到 F 后音阶名应更新");
  assert.strictEqual(localStorageStub._d["guitar-scale-practice-settings"] ? true : false, true, "设置应被保存");
  console.log("✓ 根音切换：F 大调音阶 渲染成功，设置已持久化");

  /* ---- 交互 2：切换到 自然小调 ---- */
  const minorBtn = typeBtns.find((b) => b.dataset.scale === "minor");
  fireEvent(bySel["#scaleGroups"], "click", minorBtn);
  assert.strictEqual(bySel["#scaleName"].textContent, "F 自然小调音阶", "切到小调后音阶名应更新");
  console.log("✓ 音阶类型切换：F 自然小调音阶 渲染成功");

  /* ---- 交互 3：点击和弦卡片高亮组成音 ---- */
  const cells = bySel["#triadGrid"].querySelectorAll(".chord-cell");
  fireEvent(cells[0], "click", cells[0]);
  assert.ok(cells[0].classList.contains("active"), "首个和弦卡片应进入 active");
  assert.ok(bySel["#diatonicHintText"].textContent.includes("已高亮"), "提示文案应更新");
  fireEvent(cells[1], "click", cells[1]);
  assert.ok(!cells[0].classList.contains("active"), "点击第二个和弦后首个应取消 active");
  assert.ok(cells[1].classList.contains("active"), "第二个和弦应进入 active");
  console.log("✓ 和弦高亮：点击/切换/取消路径均正常");

  /* ---- 交互 4：播放与停止 ---- */
  fireEvent(bySel["#playButton"], "click"); // 开始播放（会调度定时器）
  fireEvent(bySel["#playButton"], "click"); // 立即停止（清空定时器）
  console.log("✓ 播放/停止：无异常，定时器已清理");

  /* ---- 交互 5：拖动“结束品”滑块 12→22 品 ---- */
  const maxInput = bySel["#fretRangeMaxInput"];
  const minInput = bySel["#fretRangeMinInput"];
  const fbBefore = bySel["#scaleFretboard"].innerHTML;
  maxInput.value = "22";
  fireEvent(maxInput, "input", maxInput);
  const fbAfter = bySel["#scaleFretboard"].innerHTML;
  assert.ok(fbBefore !== fbAfter, "拖动结束品滑块后指板 SVG 应重新渲染");
  const saved5 = JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]);
  assert.strictEqual(saved5.endFret, 22, "endFret 应持久化为 22");
  assert.strictEqual(saved5.startFret, 0, "startFret 应保持为 0");
  const w22 = Number(/width="(\d+)"/.exec(fbAfter)[1]);
  const w12 = Number(/width="(\d+)"/.exec(fbBefore)[1]);
  assert.ok(w22 > w12, `22 品指板宽度应更大（${w12} → ${w22}）`);
  console.log(`✓ 指板范围滑块：结束品 12→22 生效，SVG 宽度 ${w12}→${w22}`);

  /* ---- 交互 6：拖动“起始品”滑块 0→5 品，并验证高亮带 ---- */
  minInput.value = "5";
  fireEvent(minInput, "input", minInput);
  const saved6 = JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]);
  assert.strictEqual(saved6.startFret, 5, "startFret 应持久化为 5");
  assert.strictEqual(saved6.endFret, 22, "endFret 应保持为 22");
  const fbBand = bySel["#scaleFretboard"].innerHTML;
  assert.ok(fbBand.includes("fb-range-band"), "起始品>0 时指板应绘制选中区间高亮带");
  // 两端交叉防护：min 拖到超过 max 时应对齐到 max
  const savedBand = saved6;
  minInput.value = "99";
  fireEvent(minInput, "input", minInput);
  const savedCross = JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]);
  assert.strictEqual(savedCross.startFret, savedCross.endFret, "起始品超过结束品时应自动对齐（防交叉）");
  console.log(`✓ 起始品滑块：0→5 生效并绘制高亮带；防交叉校验通过（start=${savedCross.startFret}）`);

  /* ---- 交互 7：播放序列为固定一个八度 ---- */
  const st = require("../scale-app.js");
  const run = st.buildScaleRun(0, st.SCALE_TYPE_MAP.major, engine.TUNINGS.standard);
  assert.strictEqual(run.length, st.SCALE_TYPE_MAP.major.intervals.length + 1, "播放序列应为一个八度（根音+音阶音级，含首尾同音级）");
  assert.strictEqual(run[0].semi, run[run.length - 1].semi, "序列首末音应为同音级（八度回归）");
  console.log(`✓ 播放序列：固定 1 八度，共 ${run.length} 音，首末同音级`);

  console.log("\n=== 冒烟测试全部通过 ===");
} catch (e) {
  console.error("✗ 冒烟测试失败：", e && e.stack ? e.stack : e);
  process.exit(1);
}
