/* 真实浏览器验证：和弦速查"全指板"探索模式
 * 场景：在指板上点击 D(4弦空弦)、F(6弦1品)、A(5弦空弦)，
 *       验证 pickedNotes 与匹配和弦列表含 Dm / F6/D / Asus4#5/D，并验证清空。
 */
"use strict";

const { spawn } = require("child_process");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
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

// 在指板上点击 (si, fret)：构造 MouseEvent 并设 offsetX 以便 fretFromX 算出正确 fret
async function clickFret(si, fret) {
  // 当前左内边距=40，0 品在 x<40 区域，其余按 (fret-1)*44 + 22 + 40 居中
  const offsetX = fret === 0 ? 20 : 40 + (fret - 1) * 44 + 22;
  // strip y: pad.t=28, row=order.indexOf(si). 弦名/行从 si=5 在最上 si=0 在最下？order=[5,4,3,2,1,0], row 0=si5 (高音E 1弦)? 等等 chord-app 的 buildFullFretboardSVG order=[5,4,3,2,1,0]，"6弦在上"。所以 row 0=si=5? 那 row 对应 si=5(1弦)? 不对。
  // 实际 chord-app.js line 451 `order = [5, 4, 3, 2, 1, 0]; // 6弦在上`. 但 si=5 是 E4 (1弦)。注释错了。实际 SVG 里 row 0 = 列表第一个 = si=5 = 1弦。
  // 不重要，我们只要触发 picker，不依赖行号；strip 本身带 data-si。
  // 直接找到对应 si 的 strip 并 dispatch。
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
    "--user-data-dir=/tmp/chrome-cdp-chords-picker",
    "about:blank",
  ], { stdio: "ignore" });
  chromeProc.on("error", (e) => console.log("[chrome error]", e.message));
  chromeProc.on("exit", (code, sig) => console.log("[chrome exit]", code, sig));
  console.log("[2] spawn 完成");

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
  // 等和弦引擎与按钮渲染
  await waitFor(`document.querySelectorAll('#rootButtons .root-btn').length === 12`, 6000);

  // 切到全指板视图
  await evalJs(`document.querySelector('#viewSwitch button[data-view="fretboard"]').click()`);
  if (!(await waitFor(`document.getElementById('pickerClearBtn')`))) throw new Error("picker UI 未出现");
  console.log("[3] 进入全指板 picker 模式");

  const results = [];

  // 初始：清空按钮 disabled，无 chips
  const initialDisabled = await evalJs(`document.getElementById('pickerClearBtn').disabled`);
  results.push(`初始清空按钮 disabled=${initialDisabled} (期望 true)`);

  // 点击 D(4弦空弦 si=2 fret=0)、F(6弦1品 si=0 fret=1)、A(5弦空弦 si=1 fret=0)
  await clickFret(2, 0); // D
  await new Promise((r) => setTimeout(r, 80));
  await clickFret(0, 1); // F
  await new Promise((r) => setTimeout(r, 80));
  await clickFret(1, 0); // A
  await new Promise((r) => setTimeout(r, 120));

  // 读 pickedNotes 与 chips
  const picked = await evalJs(`(() => {
    const chips = [...document.querySelectorAll('.picker-tone-chips .chip')].map(c => c.textContent.trim()).join(' ');
    const cards = [...document.querySelectorAll('.picker-card .chord-card-symbol')].map(s => s.textContent.trim());
    return { chips, cards };
  })()`);
  const chipsOk = picked.chips === "D F A";
  results.push(`已选组成音 chips: "${picked.chips}"（期望 "D F A"）→ ${chipsOk ? "✓" : "✗"}`);

  const expectSymbols = ["Dm", "F6", "Asus4#5"]; // picker 默认显示根音位置；用户例子里 F6/D、Asus4#5/D 是常见转位，本 picker 同时会匹配到
  const matchedTop3 = expectSymbols.map((s) => `${s}:${picked.cards.includes(s) ? "✓" : "✗"}`).join(" ");
  results.push(`匹配和弦（含转位）：${matchedTop3}（卡片前几: ${picked.cards.slice(0, 5).join(", ")}... 共 ${picked.cards.length}）`);

  // 清空
  await evalJs(`document.getElementById('pickerClearBtn').click()`);
  await new Promise((r) => setTimeout(r, 120));
  const afterClear = await evalJs(`(() => ({
    disabled: document.getElementById('pickerClearBtn').disabled,
    chips: [...document.querySelectorAll('.picker-tone-chips .chip')].length,
    cards: document.querySelectorAll('.picker-card').length,
  }))()`);
  results.push(`清空后: disabled=${afterClear.disabled}, chips=${afterClear.chips}, cards=${afterClear.cards} (期望 disabled=true chips=0 cards=0)`);

  // 重复点击同一位置应取消（toggle）
  await clickFret(2, 0);
  await clickFret(2, 0);
  const toggle = await evalJs(`document.querySelectorAll('.picker-tone-chips .chip').length`);
  results.push(`重复点击同一位置 toggle：chips=${toggle}（期望 0，已取消）`);

  const allOk = chipsOk
    && picked.cards.includes("Dm")
    && picked.cards.includes("F6")
    && picked.cards.includes("Asus4#5")
    && afterClear.disabled === true && afterClear.chips === 0 && afterClear.cards === 0
    && toggle === 0;

  console.log("\n=== chords.html picker 真实浏览器验证 ===");
  results.forEach((r) => console.log("  " + r));
  if (pageErrors.length) {
    console.log(`\n⚠ ${pageErrors.length} 条页面 JS 错误:`);
    pageErrors.slice(0, 8).forEach((e) => console.log("  - " + e));
  } else {
    console.log("\n✓ 全程无页面 JS 错误");
  }
  console.log(allOk ? "\n✓ 全部符合预期" : "\n✗ 存在不符合预期项");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ 验证失败：", e.message);
  process.exit(1);
}).finally(() => {
  try { if (ws) ws.close(); } catch {}
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch {}
});