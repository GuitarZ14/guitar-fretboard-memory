const { chromium } = require("playwright-core");

const CHROME = "/Users/guitarzry/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  // 1) 指板练习页（HTML grid）
  await page.goto(`${BASE}/index.html?v=20`, { waitUntil: "networkidle" });
  await page.waitForSelector("#fretboard .fret-cell", { timeout: 5000 });
  const index = await openAndDraw(page, "#fbFullscreenBtn",
    ".fb-fs-stage-inner > .fretboard", { free: true, circle: true, arrow: true, text: true });

  // 2) 音阶练习页（SVG）
  await page.goto(`${BASE}/scales.html?v=5`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scaleFretboard svg", { timeout: 5000 });
  const scales = await openAndDraw(page, "#fbFullscreenBtn",
    ".fb-fs-stage-inner > svg", { free: true, circle: true, text: true });

  // 3) 和弦速查页（默认推荐指法视图 → 应自动切到全指板）
  await page.goto(`${BASE}/chords.html?v=22`, { waitUntil: "networkidle" });
  await page.waitForSelector("#voicingArea svg", { timeout: 5000 });
  const chords = await openAndDraw(page, "#fbFullscreenBtn",
    ".fb-fs-stage-inner > svg", { free: true, circle: true, arrow: true });
  const chordView = await page.evaluate(() => {
    const area = document.getElementById("fretboardArea");
    return !!(area && !area.hidden);
  });

  // 4) 移动端：音阶页
  await page.goto(`${BASE}/scales.html?v=5`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scaleFretboard svg", { timeout: 5000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#fbFullscreenBtn");
  await page.waitForTimeout(350);
  const mobileOpen = await page.locator(".fb-fullscreen-overlay.open").count();
  const mobileToolbarVisible = await page.locator(".fb-fs-toolbar").isVisible();
  await page.click("#fbFsExit");

  console.log(JSON.stringify({ index, scales, chords, chordView, mobileOpen, mobileToolbarVisible, errors }, null, 2));

  const ok =
    index.open === 1 && index.cloned === 1 && index.strokeCount >= 2 && index.closed === 0 &&
    scales.open === 1 && scales.cloned === 1 && scales.strokeCount >= 2 && scales.closed === 0 &&
    chords.open === 1 && chords.cloned === 1 && chords.strokeCount >= 2 && chords.closed === 0 &&
    chordView === true &&
    mobileOpen === 1 && mobileToolbarVisible === true &&
    errors.length === 0;
  await browser.close();
  if (!ok) { console.error("ANNOTATE CHECK FAILED"); process.exit(1); }
  console.log("ANNOTATE CHECK PASSED (all pages)");
})().catch((e) => { console.error(e); process.exit(1); });
