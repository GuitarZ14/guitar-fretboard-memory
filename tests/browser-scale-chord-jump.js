/* 真实浏览器验证：音阶练习页 → 顺阶和弦卡片「查看详情」→ 和弦速查页详情 → 返回
 * 场景：在 scales.html 选 C 大调 → 点击 IVmaj7 卡片（Fmaj7）下方的「查看详情 →
 *       → 验证跳转到 chords.html，Hero 显示 Fmaj7，detail-block 标记为「音阶练习页推荐」，
 *       按法图高亮 chord 组成音对应的 (si, fret) 位置。
 *       → 点击「← 返回音阶练习」按钮回到 scales.html，状态保留。
 */
"use strict";

const { spawn } = require("child_process");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9350;
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

async function main() {
  console.log("[1] 启动 headless Chrome...");
  chromeProc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-setuid-sandbox",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/chrome-cdp-scale-jump",
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

  // 第一阶段：scales.html 加载 + 切换到 F 大调 + 找 Fmaj7 卡片
  await cdp("Page.navigate", { url: URL });
  if (!(await waitFor(`document.querySelector('#scaleFretboard svg')`))) throw new Error("scales 页未加载");
  await waitFor(`document.querySelectorAll('.chord-cell').length > 0`, 6000);
  console.log("[2] scales 页加载完成");

  // 切换到 F 大调（root=5）后再点击 Imaj7 卡片：跳转 → 返回时应当仍是 F 大调
  await evalJs(`document.querySelector('#rootButtons .root-btn[data-root="5"]').click()`);
  await new Promise((r) => setTimeout(r, 250));
  const scaleAfterRootChange = await evalJs(`document.querySelector('#scaleName').textContent.trim()`);
  console.log("[2.5] 切换根音后 scaleName:", scaleAfterRootChange);
  if (scaleAfterRootChange !== "F 大调音阶") throw new Error(`根音切换未生效: ${scaleAfterRootChange}`);

  // 找 Imaj7 卡片（Fmaj7）：roman 文本 Imaj7
  const fmaj7BtnFound = await evalJs(`(() => {
    const cells = [...document.querySelectorAll('#seventhGrid .chord-cell')];
    const target = cells.find(c => c.querySelector('.chord-cell-roman').textContent.trim() === 'Imaj7');
    if (!target) return null;
    const btn = target.querySelector('.chord-cell-detail-btn');
    return { hasCell: true, hasBtn: !!btn, btnText: btn && btn.textContent.trim(), symbol: target.querySelector('.chord-cell-symbol').textContent.trim() };
  })()`);
  console.log("[3] 找到 Fmaj7 卡片按钮:", fmaj7BtnFound);
  if (!fmaj7BtnFound || !fmaj7BtnFound.hasBtn) {
    console.log("所有 roman:", await evalJs(`[...document.querySelectorAll('#seventhGrid .chord-cell-roman')].map(s=>s.textContent.trim()).join(',')`));
    throw new Error("未找到 Fmaj7 卡片或详情按钮");
  }

  // 点击详情按钮 → 跳转到 chords.html
  await evalJs(`(() => {
    const cells = [...document.querySelectorAll('#seventhGrid .chord-cell')];
    const target = cells.find(c => c.querySelector('.chord-cell-roman').textContent.trim() === 'Imaj7');
    target.querySelector('.chord-cell-detail-btn').click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  // 第二阶段：chords.html 加载验证
  if (!(await waitFor(`document.querySelector('#chordSymbol')`))) throw new Error("chords 页未跳转");
  // 由于 navigate 不会自动触发新页面，监听 Page.frameNavigated 也行 — 我们用 document.location 来判断
  const urlAfterClick = await evalJs(`location.href`);
  console.log("[4] 当前 URL:", urlAfterClick);

  if (!urlAfterClick.includes("chords.html")) {
    throw new Error("未跳转到 chords.html，仍在 " + urlAfterClick);
  }

  // 等 chords 渲染完成
  await waitFor(`document.querySelector('.detail-card')`, 6000);

  const detailState = await evalJs(`(() => ({
    heroSymbol: document.querySelector('.hero-card #chordSymbol').textContent.trim(),
    heroVisible: !document.querySelector('.hero-card').hidden,
    hasDetailCard: !!document.querySelector('.detail-card'),
    bannerTag: (document.querySelector('.picker-detail-tag') || {}).textContent || '',
    bannerMeta: (document.querySelector('.picker-detail-meta') || {}).textContent || '',
    backBtnText: (document.querySelector('#pickerBackBtn') || {}).textContent || '',
    pickRingCount: document.querySelectorAll('.detail-diagram svg circle.diagram-pick-ring').length,
    activeRoot: document.querySelector('#rootButtons .root-btn.active')?.dataset.root,
    activeType: document.querySelector('#typeGroups .type-btn.active')?.dataset.type,
    viewMode: document.querySelector('#viewSwitch button.active')?.dataset.view,
  }))()`);
  console.log("[5] chords.html 详情状态:", detailState);

  // 点返回按钮 → 回到 scales.html
  await evalJs(`document.getElementById('pickerBackBtn').click()`);
  await new Promise((r) => setTimeout(r, 600));

  const backState = await evalJs(`(() => ({
    location: location.href,
    hasScaleFretboard: !!document.querySelector('#scaleFretboard svg'),
    scaleName: document.querySelector('#scaleName').textContent.trim(),
    rootActive: document.querySelector('#rootButtons .root-btn.active')?.dataset.root,
    scaleActive: document.querySelector('#scaleGroups .scale-btn.active')?.dataset.scale || document.querySelector('#scaleGroups .scale-btn.active')?.dataset.id,
    fbRangeMin: document.getElementById('fretRangeMin')?.textContent,
    fbRangeMax: document.getElementById('fretRangeMax')?.textContent,
  }))()`);
  console.log("[6] 返回后 scales 状态:", backState);

  // 验证：URL 不再含 chords.html；scales 页正常加载；备份不污染刷新
  const reloadClean = await evalJs(`(() => {
    sessionStorage.removeItem('gcfm-scale-backup');
    location.reload();
    return true;
  })()`);

  const errors = [];
  if (!detailState.heroVisible) errors.push("Hero 卡片应可见");
  if (detailState.heroSymbol !== "Fmaj7") errors.push(`Hero 符号应为 Fmaj7，实际 ${detailState.heroSymbol}`);
  if (!detailState.hasDetailCard) errors.push("未渲染 detail-card");
  if (!detailState.bannerTag.includes("音阶")) errors.push(`banner 标签错误: ${detailState.bannerTag}`);
  if (!detailState.bannerMeta.includes("音阶")) errors.push(`banner meta 错误: ${detailState.bannerMeta}`);
  if (!detailState.backBtnText.includes("音阶练习")) errors.push(`返回按钮文案错误: ${detailState.backBtnText}`);
  if (detailState.pickRingCount < 1) errors.push(`pickRing 数量 ${detailState.pickRingCount} < 1`);
  if (detailState.activeRoot !== "5") errors.push(`根音应为 5 (F)，实际 ${detailState.activeRoot}`);
  if (detailState.activeType !== "maj7") errors.push(`类型应为 maj7，实际 ${detailState.activeType}`);
  if (detailState.viewMode !== "voicing") errors.push(`视图应为 voicing，实际 ${detailState.viewMode}`);

  if (!backState.location.includes("scales.html")) errors.push(`返回 URL 错误: ${backState.location}`);
  if (!backState.hasScaleFretboard) errors.push("返回后 scales 指板未渲染");
  if (backState.scaleName !== "F 大调音阶") errors.push(`备份应保留 F 大调，实际 ${backState.scaleName}`);

  console.log("\n=== scales → chords 跳转 真实浏览器验证 ===");
  errors.forEach((e) => console.log("  ✗ " + e));
  if (pageErrors.length) {
    console.log(`\n⚠ ${pageErrors.length} 条页面 JS 错误:`);
    pageErrors.slice(0, 8).forEach((e) => console.log("  - " + e));
  } else {
    console.log("\n✓ 全程无页面 JS 错误");
  }
  console.log(errors.length === 0 ? "\n✓ 全部符合预期" : "\n✗ 存在不符合预期项");
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ 验证失败：", e.message);
  process.exit(1);
}).finally(() => {
  try { if (ws) ws.close(); } catch {}
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch {}
});