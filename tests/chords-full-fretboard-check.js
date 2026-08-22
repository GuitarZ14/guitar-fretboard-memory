const { chromium } = require("playwright-core");
const EXE = "/Users/guitarzry/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:8624";

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("pageerror", e => errs.push("PE: " + e.message));
  p.on("console", m => { if (m.type() === "error") errs.push("CE: " + m.text()); });

  await p.goto(`${BASE}/chords.html?v=12`, { waitUntil: "networkidle" });
  // 切到「全指板」视图（探索模式）
  await p.waitForSelector('#viewSwitch [data-view="fretboard"]', { timeout: 5000 });
  await p.click('#viewSwitch [data-view="fretboard"]');
  await p.waitForTimeout(400);

  const svg = await p.locator("#fretboardArea #fretboardPartLow svg").first();
  const hasSvg = await svg.count();
  const box = hasSvg ? await svg.boundingBox() : null;
  // 读取 viewBox 宽度，确认覆盖 24 品
  const vbW = await p.evaluate(() => {
    const s = document.querySelector("#fretboardArea #fretboardPartLow svg");
    return s ? s.getAttribute("viewBox").split(" ")[2] : null;
  });
  // 品位数字文本：应出现 24
  const lastFretNum = await p.evaluate(() => {
    const texts = [...document.querySelectorAll("#fretboardArea .diagram-fretnum")].map(t => Number(t.textContent));
    return texts.length ? Math.max(...texts) : -1;
  });
  // 滚动容器可横向滚动，且全板宽度 > 视口
  const scrollInfo = await p.evaluate(() => {
    const sc = document.getElementById("fretboardScroll");
    return sc ? { scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth } : null;
  });

  // 测试横向滚动：scroll 到最右
  let scrolledRight = false;
  if (scrollInfo && scrollInfo.scrollWidth > scrollInfo.clientWidth) {
    await p.evaluate(() => { const sc = document.getElementById("fretboardScroll"); sc.scrollLeft = sc.scrollWidth; });
    await p.waitForTimeout(300);
    scrolledRight = await p.evaluate(() => { const sc = document.getElementById("fretboardScroll"); return sc.scrollLeft > 0 && sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 10; });
  }

  // 点击指板选音，确认仍可用（探索模式）
  let pickWorks = false;
  if (hasSvg) {
    await p.evaluate(() => { const sc = document.getElementById("fretboardScroll"); sc.scrollLeft = 0; });
    await p.waitForTimeout(150);
    const bb = await svg.boundingBox();
    await p.mouse.click(bb.x + bb.width * 0.2, bb.y + bb.height * 0.3);
    await p.waitForTimeout(200);
    pickWorks = await p.evaluate(() => document.querySelectorAll("#fretboardArea .full-fretboard circle[data-pc]").length > 0);
  }

  console.log(JSON.stringify({
    hasSvg, vbW, lastFretNum, scrollInfo, scrolledRight, pickWorks, errs,
  }, null, 2));

  // 截图
  await p.screenshot({ path: "/tmp/chords-full.png", fullPage: false });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
