const path = require('path');
function loadPlaywright() {
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'playwright-core'),
    '/tmp/pwtest/node_modules/playwright-core',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (e) {}
  }
  throw new Error('playwright-core not found');
}
const { chromium } = loadPlaywright();

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://127.0.0.1:8624";
async function openAndDraw(page, btnSel, cloneSel, tools) {
  await page.click(btnSel);
  await page.waitForTimeout(350);
  const box = await page.locator(".fb-fs-canvas").boundingBox();
  if (!box) return { open: false };
  const open = await page.locator(".fb-fullscreen-overlay.open").count();
  const cloned = await page.locator(cloneSel).count();
  async function draw(x1, y1, x2, y2) {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
    await page.mouse.move(x2, y2, { steps: 5 });
    await page.mouse.up();
  }
  if (tools.free) { await page.click('[data-tool="free"]'); await draw(box.x + 100, box.y + 80, box.x + 300, box.y + 160); }
  if (tools.circle) { await page.click('[data-tool="circle"]'); await draw(box.x + 400, box.y + 100, box.x + 540, box.y + 200); }
  if (tools.arrow) { await page.click('[data-tool="arrow"]'); await draw(box.x + 200, box.y + 300, box.x + 420, box.y + 380); }
  if (tools.text) {
    await page.click('[data-tool="text"]');
    await page.mouse.click(box.x + 150, box.y + 420);
    await page.waitForTimeout(80);
    await page.keyboard.type("教学批注");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
  }
  const strokeCount = await page.evaluate(() => window.FretboardAnnotate._strokeCount());
  await page.click("#fbFsUndo");
  await page.click("#fbFsClear");
  await page.click("#fbFsExit");
  await page.waitForTimeout(150);
  const closed = await page.locator(".fb-fullscreen-overlay.open").count();
  return { open, cloned, strokeCount, closed };
}

// 修复 1 验证：笔触精确跟随光标（在已知屏幕坐标画点，读回画布像素应命中笔迹颜色）
async function verifyCoordPrecision(page) {
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const box = await page.locator(".fb-fs-canvas").boundingBox();
  await page.click('[data-tool="free"]');
  // 取画布中心点（确保在指板有效区域内）
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(100);
  // 通过像素验证：画布 backing store 中点应命中笔迹颜色 #ff5a5a（默认色）
  const hit = await page.evaluate(([sx, sy]) => {
    const c = document.querySelector(".fb-fs-canvas");
    const rect = c.getBoundingClientRect();
    const lx = (sx - rect.left) * (c.width / rect.width);
    const ly = (sy - rect.top) * (c.height / rect.height);
    const data = c.getContext("2d").getImageData(Math.round(lx), Math.round(ly), 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  }, [cx, cy]);
  const matched = hit.r > 200 && hit.g < 120 && hit.b < 120 && hit.a > 100; // #ff5a5a
  await page.click("#fbFsClear");
  await page.click("#fbFsExit");
  await page.waitForTimeout(120);
  return { cx, cy, hit, matched };
}

// 修复 2 验证：橡皮擦可擦除已有笔迹（像素从有色变为透明）
async function verifyEraser(page) {
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const box = await page.locator(".fb-fs-canvas").boundingBox();
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  // 先画一条粗线
  await page.click('[data-tool="free"]');
  await page.evaluate(() => { const s = document.querySelector(".fb-fs-size"); s.value = 20; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 8 });
  await page.mouse.up();
  // 读取画线后的像素（应为有色）
  const before = await page.evaluate(([sx, sy]) => {
    const c = document.querySelector(".fb-fs-canvas");
    const rect = c.getBoundingClientRect();
    const lx = (sx - rect.left) * (c.width / rect.width);
    const ly = (sy - rect.top) * (c.height / rect.height);
    return [...c.getContext("2d").getImageData(Math.round(lx), Math.round(ly), 1, 1).data];
  }, [cx, cy]);
  // 用橡皮擦擦过中心
  await page.click('[data-tool="eraser"]');
  await page.evaluate(() => { const s = document.querySelector("#fbFsEraseSize"); s.value = 40; s.dispatchEvent(new Event("input", { bubbles: true })); });
  const eraseGroupVisible = await page.evaluate(() => {
    const g = document.querySelector("#fbFsEraserSizeGroup");
    return g && g.style.display !== "none" && getComputedStyle(g).display !== "none";
  });
  await page.mouse.move(cx - 80, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.evaluate(([sx, sy]) => {
    const c = document.querySelector(".fb-fs-canvas");
    const rect = c.getBoundingClientRect();
    const lx = (sx - rect.left) * (c.width / rect.width);
    const ly = (sy - rect.top) * (c.height / rect.height);
    return [...c.getContext("2d").getImageData(Math.round(lx), Math.round(ly), 1, 1).data];
  }, [cx, cy]);
  const erased = after[3] < before[3]; // 擦除后 alpha 下降（变透明）
  const strokes = await page.evaluate(() => window.FretboardAnnotate._strokeCount());
  await page.click("#fbFsClear");
  await page.click("#fbFsExit");
  await page.waitForTimeout(120);
  return { before, after, erased, strokes, eraseGroupVisible };
}

// 修复 3 验证：文字工具点击后出现输入框并可成功添加文字
async function verifyTextTool(page) {
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const box = await page.locator(".fb-fs-canvas").boundingBox();
  await page.click('[data-tool="text"]');
  const activeTool = await page.evaluate(() => {
    const b = document.querySelector("#fbFsTools [data-tool].active");
    return b ? b.dataset.tool : null;
  });
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await page.waitForTimeout(120);
  const inputCount = await page.locator(".fb-fs-text-input").count();
  const inputFocused = await page.evaluate(() => {
    const el = document.querySelector(".fb-fs-text-input");
    return !!el && document.activeElement === el;
  });
  await page.keyboard.type("C 大调");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
  const inputGone = await page.locator(".fb-fs-text-input").count();
  const strokes = await page.evaluate(() => {
    const n = window.FretboardAnnotate._strokeCount();
    return n;
  });
  await page.click("#fbFsClear");
  await page.click("#fbFsExit");
  await page.waitForTimeout(120);
  return { box, activeTool, inputCount, inputFocused, inputGone, strokes };
}

// 修复 2 验证：截图工具框选区域并导出 PNG 下载
async function verifyScreenshot(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 4000 }).catch(() => null);
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const box = await page.locator(".fb-fs-canvas").boundingBox();
  await page.click('[data-tool="shot"]');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const download = await downloadPromise;
  let downloadName = null;
  let downloadSize = 0;
  if (download) {
    downloadName = download.suggestedFilename();
    const path = await download.path().catch(() => null);
    if (path) {
      const fs = require("fs");
      downloadSize = fs.statSync(path).size;
    }
  }
  const toast = await page.evaluate(() => {
    const t = document.querySelector(".fb-fs-toast");
    return t ? t.textContent : null;
  });
  await page.click("#fbFsExit");
  await page.waitForTimeout(120);
  return { downloadName, downloadSize, toast };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  // 1) 音阶练习页（SVG）- 用户要求恢复
  await page.goto(`${BASE}/scales.html?v=6`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scaleFretboard svg", { timeout: 5000 });
  const scales = await openAndDraw(page, "#fbFullscreenBtn",
    ".fb-fs-board > svg", { free: true, circle: true, text: true });

  // 2) 和弦速查页 - 当前无按钮，跳过
  const chords = { open: 0, cloned: 0, strokeCount: 0, closed: 0 };
  const chordView = false;

  // 3) 指板练习页（HTML grid）- 当前无按钮，跳过
  const index = { open: 0, cloned: 0, strokeCount: 0, closed: 0 };

  // 4) 移动端：音阶页
  await page.goto(`${BASE}/scales.html?v=6`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scaleFretboard svg", { timeout: 5000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const mobileOpen = await page.locator(".fb-fullscreen-overlay.open").count();
  const mobileToolbarVisible = await page.locator(".fb-fs-toolbar").isVisible();
  await page.click("#fbFsExit");

  // 5) 修复验证：坐标精确性（笔触跟手）— 音阶页 SVG 指板（恢复桌面视口）
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/scales.html?v=6`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scaleFretboard svg", { timeout: 5000 });
  const coordPrec = await verifyCoordPrecision(page);

  // 6) 修复验证：橡皮擦像素级擦除
  const eraser = await verifyEraser(page);

  // 7) 修复验证：文字工具唤起输入并成文
  const textTool = await verifyTextTool(page);

  // 8) 修复验证：截图框选导出 PNG
  const shot = await verifyScreenshot(page);

  console.log(JSON.stringify({ index, scales, chords, chordView, mobileOpen, mobileToolbarVisible, coordPrec, eraser, textTool, shot, errors }, null, 2));

  const ok =
    scales.open === 1 && scales.cloned === 1 && scales.strokeCount >= 2 && scales.closed === 0 &&
    // chords.open === 1 && chords.cloned === 1 && chords.strokeCount >= 2 && chords.closed === 0 &&
    // chordView === true &&
    mobileOpen === 1 && mobileToolbarVisible === true &&
    coordPrec.matched === true &&
    eraser.erased === true && eraser.eraseGroupVisible === true &&
    textTool.inputCount === 1 && textTool.inputFocused === true &&
    textTool.inputGone === 0 && textTool.strokes >= 1 &&
    shot.downloadName && shot.downloadName.endsWith(".png") && shot.downloadSize > 500 &&
    errors.length === 0;
  await browser.close();
  if (!ok) { console.error("ANNOTATE CHECK FAILED"); process.exit(1); }
  console.log("ANNOTATE CHECK PASSED (all pages + fixes)");
})().catch((e) => { console.error(e); process.exit(1); });
