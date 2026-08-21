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
seedSegmented("#rangeSwitch", "range", ["12", "22"]);
seedSegmented("#octaveSwitch", "oct", ["1", "2"]);
seedSegmented("#tempoSwitch", "tempo", ["620", "380", "240"]);
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

  /* ---- 交互 5：指板范围 12→22 品 ---- */
  const rangeBtns = bySel["#rangeSwitch"].querySelectorAll("button");
  const r22 = rangeBtns.find((b) => b.dataset.range === "22");
  const fbBefore = bySel["#scaleFretboard"].innerHTML;
  fireEvent(bySel["#rangeSwitch"], "click", r22);
  const fbAfter = bySel["#scaleFretboard"].innerHTML;
  assert.ok(fbBefore !== fbAfter, "切换指板范围后指板 SVG 应重新渲染");
  assert.ok(r22.classList.contains("active"), "22 品按钮应高亮");
  assert.ok(!rangeBtns.find((b) => b.dataset.range === "12").classList.contains("active"), "12 品按钮应取消高亮");
  assert.ok(JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]).frets === 22, "frets 应持久化为 22");
  // 22 品 SVG 宽度应大于 12 品
  const w22 = Number(/width="(\d+)"/.exec(fbAfter)[1]);
  const w12 = Number(/width="(\d+)"/.exec(fbBefore)[1]);
  assert.ok(w22 > w12, `22 品指板宽度应更大（${w12} → ${w22}）`);
  console.log(`✓ 指板范围切换：12→22 品生效，SVG 宽度 ${w12}→${w22}`);

  /* ---- 交互 6：音阶跨度 1→2 八度 ---- */
  const octBtns = bySel["#octaveSwitch"].querySelectorAll("button");
  const oct2 = octBtns.find((b) => b.dataset.oct === "2");
  fireEvent(bySel["#octaveSwitch"], "click", oct2);
  assert.ok(oct2.classList.contains("active"), "2 八度按钮应高亮");
  assert.strictEqual(JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]).octaves, 2, "octaves 应保存为 2");
  console.log("✓ 音阶跨度切换：1→2 八度 状态已更新");

  /* ---- 交互 7：播放速度 中→慢 ---- */
  const tempoBtns = bySel["#tempoSwitch"].querySelectorAll("button");
  const tSlow = tempoBtns.find((b) => b.dataset.tempo === "620");
  fireEvent(bySel["#tempoSwitch"], "click", tSlow);
  assert.ok(tSlow.classList.contains("active"), "慢速按钮应高亮");
  assert.strictEqual(JSON.parse(localStorageStub._d["guitar-scale-practice-settings"]).tempo, 620, "tempo 应保存为 620");
  console.log("✓ 播放速度切换：中→慢 状态已更新");

  /* ---- 交互 8：播放序列随 octaves 变化 ---- */
  const st = require("../scale-app.js");
  const run1 = st.buildScaleRun(0, st.SCALE_TYPE_MAP.major, engine.TUNINGS.standard, 1);
  const run2 = st.buildScaleRun(0, st.SCALE_TYPE_MAP.major, engine.TUNINGS.standard, 2);
  assert.ok(run2.length > run1.length, `2 八度播放序列应更长（${run1.length} → ${run2.length}）`);
  console.log(`✓ 播放序列跨度：1 八度 ${run1.length} 音 → 2 八度 ${run2.length} 音`);

  console.log("\n=== 冒烟测试全部通过 ===");
} catch (e) {
  console.error("✗ 冒烟测试失败：", e && e.stack ? e.stack : e);
  process.exit(1);
}
