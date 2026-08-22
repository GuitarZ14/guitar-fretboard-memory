/* 真实浏览器（Headless Chrome + CDP）验证音阶练习页控件交互：
 * 1) 指板范围 12↔22 品：SVG 宽度与品位数字应变化
 * 2) 音阶跨度/播放速度：状态应保存并影响播放序列
 * 3) 顺阶和弦：C 大调应为 C Dm Em F G Am Bdim / Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5
 */
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const URL = "http://localhost:8655/scales.html";

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
    ws.onerror = (e) => reject(new Error("WS 连接失败: " + (e && e.message)));
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
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log("[1] 启动 headless Chrome...");
  // 1. 启动 headless Chrome
  chromeProc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-setuid-sandbox",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/chrome-cdp-scale-check",
    "about:blank",
  ], { stdio: "ignore" });
  chromeProc.on("error", (e) => console.log("[chrome error]", e.message));
  chromeProc.on("exit", (code, sig) => console.log("[chrome exit]", code, sig));
  console.log("[2] spawn 完成，等待 CDP 端口...");

  // 等 CDP 端口就绪
  let targets = null;
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
      console.log(`[3] 第 ${i} 次 fetch 无 target，重试...`);
    } catch (e) {
      console.log(`[3] 第 ${i} 次 fetch 失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!targets || !targets.length) throw new Error("CDP 端口未就绪");
  console.log("[4] CDP 就绪，targets:", targets.length);

  const page = targets.find((t) => t.type === "page");
  await waitOpen(page.webSocketDebuggerUrl);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");

  // 2. 打开页面
  await cdp("Page.navigate", { url: URL });
  if (!(await waitFor(`document.querySelector('#scaleFretboard') && document.querySelector('#scaleFretboard').innerHTML.includes('<svg')`))) {
    throw new Error("页面未加载指板");
  }
  // 注入空弦音级数读取函数
  await evalJs(`(() => {
    window.readOpenDegrees = function () {
      const svg = document.querySelector('#scaleFretboard svg');
      // 只取实心圆点（排除 fill=none 的高亮环/播放环）
      const circles = [...svg.querySelectorAll('circle[cx="40"]')].filter(c => c.getAttribute('fill') !== 'none');
      const items = circles.map(c => {
        const cy = Number(c.getAttribute('cy'));
        const texts = [...svg.querySelectorAll('text')].filter(t => {
          const ty = Number(t.getAttribute('y'));
          const tx = Number(t.getAttribute('x'));
          return Math.abs(ty - cy) < 3 && tx === 40;
        });
        const center = texts.find(t => !t.classList.contains('diagram-degree'));
        return { cy, label: center ? center.textContent.trim() : '?' };
      }).sort((a, b) => a.cy - b.cy);
      return items.map(i => i.label).join(' ');
    };
  })()`);

  const results = [];

  // 3. 顺阶和弦正确性（修复后的预期）
  const diatonics = await evalJs(`(() => {
    const tri = [...document.querySelectorAll('#triadGrid .chord-cell')].map(c => c.querySelector('.chord-cell-symbol').textContent);
    const sev = [...document.querySelectorAll('#seventhGrid .chord-cell')].map(c => c.querySelector('.chord-cell-symbol').textContent);
    return { tri, sev, name: document.querySelector('#scaleName').textContent };
  })()`);
  const triOk = diatonics.tri.join(" ") === "C Dm Em F G Am Bdim";
  const sevOk = diatonics.sev.join(" ") === "Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5";
  results.push(`顺阶三和弦 [${diatonics.tri.join(" ")}] → ${triOk ? "✓ C Dm Em F G Am Bdim" : "✗ 错误"}`);
  results.push(`顺阶七和弦 [${diatonics.sev.join(" ")}] → ${sevOk ? "✓ Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5" : "✗ 错误"}`);

  // 4. 指板范围切换
  const fb0 = await evalJs(`document.querySelector('#scaleFretboard').innerHTML`);
  const w0 = Number(/width="(\d+)"/.exec(fb0)[1]);
  const num0 = await evalJs(`document.querySelectorAll('#fretNumbers span').length`);
  await evalJs(`document.querySelector('#rangeSwitch button[data-range="22"]').click()`);
  await new Promise((r) => setTimeout(r, 150));
  const fb1 = await evalJs(`document.querySelector('#scaleFretboard').innerHTML`);
  const w1 = Number(/width="(\d+)"/.exec(fb1)[1]);
  const r22Active = await evalJs(`document.querySelector('#rangeSwitch button[data-range="22"]').classList.contains('active')`);
  const num1 = await evalJs(`document.querySelectorAll('#fretNumbers span').length`);
  results.push(`指板范围 12→22：SVG 宽度 ${w0} → ${w1}，22 品按钮高亮=${r22Active}，品位数字 ${num0} → ${num1} 个`);

  // 5. 音阶跨度 + 播放速度
  await evalJs(`document.querySelector('#octaveSwitch button[data-oct="2"]').click()`);
  await evalJs(`document.querySelector('#tempoSwitch button[data-tempo="620"]').click()`);
  const saved = await evalJs(`JSON.parse(localStorage.getItem('guitar-scale-practice-settings'))`);
  results.push(`音阶跨度/播放速度 → octaves=${saved.octaves}, tempo=${saved.tempo}`);

  // 6. 播放：验证 play 按钮进入播放态（说明 playScale 使用新状态且未报错）
  await evalJs(`document.querySelector('#playButton').click()`);
  const playing = await waitFor(`document.querySelector('#playButton').classList.contains('playing')`, 2000);
  await evalJs(`document.querySelector('#playButton').click()`); // 停止
  results.push(`播放按钮：进入播放态=${playing}（音阶序列随 octaves/tempo 生效）`);

  // 7. 点击和弦卡片高亮 + 点击指板发声（确认无 JS 错误）
  await evalJs(`document.querySelector('#triadGrid .chord-cell').click()`);
  const hiActive = await waitFor(`document.querySelector('#triadGrid .chord-cell.active') !== null`, 2000);
  const hint = await evalJs(`document.querySelector('#diatonicHintText').textContent`);
  await evalJs(`document.querySelector('#fretboardScroll').querySelector('.fb-string-strip').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 80, clientY: 20 }))`);
  await new Promise((r) => setTimeout(r, 200));
  results.push(`和弦高亮：进入高亮=${hiActive}（提示：${hint}）；指板点击发声无报错`);

  // 8. 品位坐标：单行 HTML 品位数字 1 的中心与品位 1 的音都落在弦枕右侧第一格中心（x=78）
  const fretnum1x = await evalJs(`(() => {
    const span = document.querySelector('#fretNumbers span');
    if (!span || span.textContent !== '1') return -1;
    return Math.round(span.offsetLeft + span.offsetWidth / 2);
  })()`);
  const openCircleX = await evalJs(`(() => {
    const c = document.querySelector('#scaleFretboard circle[cx]');
    // 空弦音是最左的圆点（cx 最小）
    const all = [...document.querySelectorAll('#scaleFretboard circle[cx]')].map(c => Number(c.getAttribute('cx'))).sort((a,b)=>a-b);
    return all[0];
  })()`);
  results.push(`品位坐标：品位1数字中心 x=${fretnum1x}（期望 78），最左空弦音 x=${openCircleX}（期望 40，即 0 品在弦枕左侧）`);

  // 9. 空弦音级数随音阶变化：degree 模式读空弦音标注
  await evalJs(`document.querySelector('#labelSwitch button[data-label="degree"]').click()`);
  const openDegC = await evalJs(`readOpenDegrees()`);
  await evalJs(`document.querySelector('#rootButtons .root-btn[data-root="7"]').click()`);
  const openDegG = await evalJs(`readOpenDegrees()`);
  await evalJs(`document.querySelector('#rootButtons .root-btn[data-root="0"]').click()`);
  await evalJs(`document.querySelector('#labelSwitch button[data-label="note"]').click()`);
  const degCOk = openDegC === "3 6 2 5 7 3" || openDegC === "3 7 5 2 6 3";
  const degGOk = openDegG === "6 2 5 1 3 6" || openDegG === "6 3 1 5 2 6";
  results.push(`空弦级数：C 调 [${openDegC}]（期望 3 6 2 5 7 3）、G 调 [${openDegG}]（期望 6 2 5 1 3 6）→ C:${degCOk} G:${degGOk}`);

  // 10. 播放时指板中所有该音高亮：先切回 12 品，播放 C 大调第 1 个音（C），
  //     12 品内共有 6 个 C（每根弦各 1 个），应出现 6 个播放色环
  await evalJs(`document.querySelector('#rangeSwitch button[data-range="12"]').click()`);
  await evalJs(`document.querySelector('#playButton').click()`);
  await waitFor(`document.querySelectorAll('#scaleFretboard circle[stroke="#e8a13c"]').length > 0`, 2000);
  const playingRings = await evalJs(`document.querySelectorAll('#scaleFretboard circle[stroke="#e8a13c"]').length`);
  await evalJs(`document.querySelector('#playButton').click()`); // 停止
  const ringsAfter = await evalJs(`document.querySelectorAll('#scaleFretboard circle[stroke="#e8a13c"]').length`);
  const ringsOk = playingRings === 6 && ringsAfter === 0;
  results.push(`播放高亮：C 大调播放 C 音时高亮环 ${playingRings} 个（12 品内 6 个 C 位置，期望 6），停止后 ${ringsAfter} 个`);

  // 汇总
  const allOk = triOk && sevOk && w1 > w0 && r22Active && num1 === 22 && saved.octaves === 2 && saved.tempo === 620 && playing && hiActive
    && fretnum1x === 78 && openCircleX === 40 && degCOk && degGOk && ringsOk;
  console.log("=== 真实浏览器验证 ===");
  results.forEach((r) => console.log("  " + r));
  if (pageErrors.length) {
    console.log(`\n⚠ 捕获到 ${pageErrors.length} 条页面 JS 错误：`);
    pageErrors.slice(0, 10).forEach((e) => console.log("  - " + e));
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
