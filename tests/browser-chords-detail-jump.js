/* 真实浏览器验证：和弦速查"探索模式 → 匹配卡片点击 → 详情视图"流程
 * 场景：在指板上选 C/E/G（组成 Cmaj）→ 点击匹配的 Cmaj7 卡片 →
 *       验证切到推荐指法视图、顶部出现「从探索模式跳入」卡、Hero 显示 Cmaj7、
 *       按返回按钮能恢复已选音。
 */
"use strict";

const { spawn } = require("child_process");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9335;
const URL = "http://localhost:8655/chords.html";

let ws;
let msgId = 0;
const pending = new Map();
const pageErrors = [];
let chromeProc;

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitOpen(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error("WS 失败: " + (e && e.message)));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        const desc = d.exception && d.exception.description ? d.exception.description : d.text;
        pageErrors.push(desc.split("\n")[0]);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        pageErrors.push("[console.error] " + (msg.params.entry.text || ""));
      }
    };
  });
}
async function evalJs(expression) {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页面 JS 异常: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function waitFor(expr, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJs(expr)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// 指板上点击 (si, fret)：dispatch click 事件到对应 strip
// 当前左内边距=40，0 品在 x<40 区域，其余按 (fret-1)*44 + 22 + 40 居中
async function clickFret(si, fret) {
  const offsetX = fret === 0 ? 20 : 40 + (fret - 1) * 44 + 22;
  await evalJs(`(() => {
    const strip = document.querySelector('.fb-string-strip[data-si="${si}"]');
    if (!strip) throw new Error('找不到 strip si=${si}');
    const rect = strip.getBoundingClientRect();
    const ev = new MouseEvent('click', { bubbles: true, clientX: rect.left + ${offsetX}, clientY: rect.top + rect.height / 2 });
    Object.defineProperty(ev, 'offsetX', { value: ${offsetX} });
    strip.dispatchEvent(ev);
    return true;
  })()`);
}

async function main() {
  console.log("[1] 启动 headless Chrome...");
  chromeProc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-setuid-sandbox",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/chrome-cdp-chords-detail",
    "about:blank",
  ], { stdio: "ignore" });
  chromeProc.on("error", (e) => console.log("[chrome error]", e.message));

  let targets = null;
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!targets || !targets.length) throw new Error("CDP 端口未就绪");
  const page = targets.find((t) => t.type === "page");
  await waitOpen(page.webSocketDebuggerUrl);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");

  await cdp("Page.navigate", { url: URL });
  if (!(await waitFor(`document.querySelector('#chordSymbol')`))) throw new Error("和弦页未加载");
  await waitFor(`document.querySelectorAll('#rootButtons .root-btn').length === 12`, 6000);

  // 切到全指板视图
  await evalJs(`document.querySelector('#viewSwitch button[data-view="fretboard"]').click()`);
  if (!(await waitFor(`document.getElementById('pickerClearBtn')`))) throw new Error("picker UI 未出现");
  console.log("[2] 进入全指板 picker 模式");

  // 选 C / E / G：
  // 标准调弦 [40(E2), 45(A2), 50(D3), 55(G3), 59(B3), 64(E4)]，si=0..5 = 6..1 弦
  // C: 2 弦 si=4 fret=1（pitch 60 = C4）
  // E: 1 弦 si=5 fret=0（pitch 64 = E4）
  // G: 3 弦 si=3 fret=0（pitch 55 = G3）
  await clickFret(4, 1); // C
  await new Promise((r) => setTimeout(r, 80));
  await clickFret(5, 0); // E
  await new Promise((r) => setTimeout(r, 80));
  await clickFret(3, 0); // G
  await new Promise((r) => setTimeout(r, 150));

  const picked = await evalJs(`(() => {
    const chips = [...document.querySelectorAll('.picker-tone-chips .chip')].map(c => c.textContent.trim()).join(' ');
    return chips;
  })()`);
  console.log("[3] 已选音:", picked);

  // 找到 Cmaj7 卡片
  const cmaj7Found = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.picker-jump-card')];
    const target = cards.find(c => c.querySelector('.chord-card-symbol') && c.querySelector('.chord-card-symbol').textContent.trim().startsWith('Cmaj7'));
    return target ? { found: true, root: target.dataset.root, typeId: target.dataset.typeId } : { found: false };
  })()`);
  console.log("[4] 找到 Cmaj7 卡片:", cmaj7Found);

  if (!cmaj7Found.found) {
    console.log("可用卡片:",
      await evalJs(`[...document.querySelectorAll('.picker-jump-card .chord-card-symbol')].map(s => s.textContent.trim()).slice(0, 12).join(',')`)
    );
    throw new Error("未找到 Cmaj7 卡片");
  }

  // 点击卡片
  await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.picker-jump-card')];
    const target = cards.find(c => c.querySelector('.chord-card-symbol') && c.querySelector('.chord-card-symbol').textContent.trim().startsWith('Cmaj7'));
    target.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 250));

  // 验证：1) 视图切到 voicing；2) 出现 detail-card；3) Hero 可见且文本=Cmaj7；4) 返回按钮存在
  const detailState = await evalJs(`(() => {
    const fc = document.querySelector('.fretboardArea, [id="fretboardArea"]');
    const ringSet = document.querySelectorAll('.detail-diagram svg circle.diagram-pick-ring');
    return {
      heroVisible: !document.querySelector('.hero-card').hidden,
      heroSymbol: document.querySelector('.hero-card #chordSymbol').textContent.trim(),
      hasDetailCard: !!document.querySelector('.detail-card'),
      hasBackBtn: !!document.getElementById('pickerBackBtn'),
      hasPickRing: ringSet.length,
      pickRingCxs: [...ringSet].map(c => c.getAttribute('cx')).join(','),
      detailBananaText: (document.querySelector('.picker-detail-meta') || {}).textContent || '',
      viewModeNow: document.querySelector('#viewSwitch button.active')?.dataset.view || '',
      detailSvg: document.querySelector('.detail-diagram svg')?.outerHTML.slice(0, 3000) || '',
    };
  })()`);
  console.log("[5] 详情状态:", detailState);

  // 点返回按钮
  const hasBackAfter = detailState.hasBackBtn;
  await evalJs(`document.getElementById('pickerBackBtn').click()`);
  await new Promise((r) => setTimeout(r, 250));

  const afterBack = await evalJs(`(() => ({
    viewMode: document.querySelector('#viewSwitch button.active')?.dataset.view || '',
    chipCount: document.querySelectorAll('.picker-tone-chips .chip').length,
    chipText: [...document.querySelectorAll('.picker-tone-chips .chip')].map(c => c.textContent.trim()).join(' '),
    pickerClearDisabled: document.getElementById('pickerClearBtn').disabled,
    heroVisible: !document.querySelector('.hero-card').hidden,
  }))()`);
  console.log("[6] 返回后状态:", afterBack);

  // 异常情况：清空后点击 picker-clear，再次进 picker 不会触发 detailVoicing
  await evalJs(`document.getElementById('pickerClearBtn').click()`);
  await new Promise((r) => setTimeout(r, 100));
  // 同时验证 root/type 切换会清掉 detailVoicing
  await evalJs(`document.querySelector('#rootButtons .root-btn[data-root="2"]').click()`); // D
  await new Promise((r) => setTimeout(r, 200));
  const noDetailAfterRootSwitch = await evalJs(`!document.querySelector('.detail-card')`);
  console.log("[7] 切换根音后 detail-card 应消失:", noDetailAfterRootSwitch);

  const allOk =
    picked.includes("C") && picked.includes("E") && picked.includes("G")
    && cmaj7Found.found
    && detailState.heroVisible
    && detailState.heroSymbol === "Cmaj7"
    && detailState.hasDetailCard
    && detailState.hasBackBtn
    && detailState.hasPickRing >= 1 // 高亮至少一个已选位置
    && detailState.detailBananaText.includes("已选")
    && detailState.viewModeNow === "voicing"
    && afterBack.viewMode === "fretboard"
    && afterBack.chipCount === 3
    && afterBack.chipText.includes("C") && afterBack.chipText.includes("E") && afterBack.chipText.includes("G")
    && afterBack.pickerClearDisabled === false
    && noDetailAfterRootSwitch;

  console.log("\n=== chords.html 探索→详情跳转 真实浏览器验证 ===");
  const errors = [];
  if (!picked.includes("C") || !picked.includes("E") || !picked.includes("G")) errors.push(`chips 未含 C/E/G: "${picked}"`);
  if (!cmaj7Found.found) errors.push("未找到 Cmaj7 卡片");
  if (!detailState.heroVisible) errors.push("Hero 卡片应可见");
  if (detailState.heroSymbol !== "Cmaj7") errors.push(`Hero 符号应为 Cmaj7，实际 ${detailState.heroSymbol}`);
  if (!detailState.hasDetailCard) errors.push("未渲染 detail-card");
  if (!detailState.hasBackBtn) errors.push("未渲染返回按钮");
  if (detailState.hasPickRing < 1) errors.push(`pickRing 数量 ${detailState.hasPickRing} < 1`);
  if (!detailState.detailBananaText.includes("已选")) errors.push(`banner meta 文案错误: ${detailState.detailBananaText}`);
  if (detailState.viewModeNow !== "voicing") errors.push(`视图未切到 voicing: ${detailState.viewModeNow}`);
  if (afterBack.viewMode !== "fretboard") errors.push(`返回后视图不是 fretboard: ${afterBack.viewMode}`);
  if (afterBack.chipCount !== 3) errors.push(`返回后 chips 数量 ${afterBack.chipCount} ≠ 3`);
  if (afterBack.pickerClearDisabled !== false) errors.push("返回后清空按钮应可用");
  if (!noDetailAfterRootSwitch) errors.push("切换根音后 detail-card 未消失");

  errors.forEach((e) => console.log("  ✗ " + e));
  if (pageErrors.length) {
    console.log(`\n⚠ ${pageErrors.length} 条页面 JS 错误:`);
    pageErrors.slice(0, 8).forEach((e) => console.log("  - " + e));
  } else {
    console.log("\n✓ 全程无页面 JS 错误");
  }
  console.log(allOk && errors.length === 0 ? "\n✓ 全部符合预期" : "\n✗ 存在不符合预期项");
  process.exit(allOk && errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ 验证失败：", e.message);
  process.exit(1);
}).finally(() => {
  try { if (ws) ws.close(); } catch {}
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch {}
});
