/**
 * 和弦速查页 — 全指板点击发声测试
 * ------------------------------------------------------------
 * 运行：node tests/fretboard-audio.test.js
 * 前置：本地预览服务在 http://127.0.0.1:8624/chords.html
 *
 * 覆盖：
 *  1. 切换到全指板视图后，每个 SVG 内存在 6 根透明点击条
 *  2. 点击条携带 data-si / data-start / data-end / data-left-pad 等几何参数
 *  3. 点击后创建并恢复 AudioContext，ctx.state 为 running
 *  4. 通过 Playwright 捕获页面最后一次播放的 MIDI 音高，校验与点击坐标/弦/调音对应
 *  5. 右滑加载高把位后，新 SVG 内同样存在点击条
 */

const path = require('path');

function loadPlaywright() {
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'playwright-core'),
    '/tmp/pwtest/node_modules/playwright-core',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  throw new Error('playwright-core 未找到');
}

const { chromium } = loadPlaywright();
const EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.CHORDS_URL || 'http://127.0.0.1:8624/chords.html';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#viewSwitch');
  await page.waitForTimeout(600);

  // 切换到全指板视图
  await page.click('#viewSwitch button[data-view="fretboard"]');
  await page.waitForTimeout(400);

  console.log('\n[点击条 DOM 检查]');
  const stripsInfo = await page.evaluate(() => {
    const strips = [...document.querySelectorAll('.full-fretboard .fb-string-strip')];
    return {
      count: strips.length,
      first: strips[0] ? {
        si: strips[0].dataset.si,
        start: strips[0].dataset.start,
        end: strips[0].dataset.end,
        leftPad: strips[0].dataset.leftPad,
        colW: strips[0].dataset.colW,
        rowH: strips[0].dataset.rowH,
        padT: strips[0].dataset.padT,
      } : null,
    };
  });
  check('全指板 SVG 中存在 6 根点击条', stripsInfo.count === 6, 'count=' + stripsInfo.count);
  check('点击条携带 data-si', stripsInfo.first && stripsInfo.first.si === '5', JSON.stringify(stripsInfo.first));
  check('点击条携带 data-start=0', stripsInfo.first && stripsInfo.first.start === '0', JSON.stringify(stripsInfo.first));

  console.log('\n[点击发声与音高校验]');

  // 在页面暴露最后播放的 MIDI，便于测试断言
  await page.evaluate(() => {
    window.__lastPlayedMidi = null;
    const orig = guitarAudio.play.bind(guitarAudio);
    guitarAudio.play = function (midi, velocity) {
      window.__lastPlayedMidi = midi;
      return orig(midi, velocity);
    };
  });

  // 点击 6 弦（最上方）的某个品位（低把位段）
  // 标准调弦 6 弦 = index 0，空弦 E2 = MIDI 40；点击 open 弦区域（strip 左侧）
  const stripBox = await page.$eval('.full-fretboard .fb-string-strip[data-si="0"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // 点击 strip 左侧 1/4 处，应近似 open 弦（fret 0）
  const clickX = stripBox.x + stripBox.w * 0.12;
  const clickY = stripBox.y + stripBox.h * 0.5;
  await page.mouse.click(Math.round(clickX), Math.round(clickY));
  await page.waitForTimeout(200);

  const audioState = await page.evaluate(() => ({
    ctxState: guitarAudio.ctx ? guitarAudio.ctx.state : null,
    lastMidi: window.__lastPlayedMidi,
  }));
  check('点击后 AudioContext 已创建并恢复', audioState.ctxState === 'running', 'state=' + audioState.ctxState);
  check('点击 6 弦左侧区域播放 E2 (MIDI 40)', audioState.lastMidi === 40, 'lastMidi=' + audioState.lastMidi);

  // 点击 6 弦靠近 fret 3 的区域（标准调弦 E2+3 = G2，MIDI 43）
  // fret 3 中心 x = leftPad + 3*colW + colW/2 ≈ 34 + 132 + 22 = 188
  const stripData = await page.$eval('.full-fretboard .fb-string-strip[data-si="0"]', (el) => ({
    leftPad: Number(el.dataset.leftPad),
    colW: Number(el.dataset.colW),
  }));
  const fret3X = stripBox.x + stripData.leftPad + 3 * stripData.colW + stripData.colW / 2;
  await page.mouse.click(Math.round(fret3X), Math.round(clickY));
  await page.waitForTimeout(200);
  const midi3 = await page.evaluate(() => window.__lastPlayedMidi);
  check('点击 6 弦 3 品播放 G2 (MIDI 43)', midi3 === 43, 'lastMidi=' + midi3);

  console.log('\n[高把位动态加载后检查]');
  await page.evaluate(() => {
    const scroll = document.getElementById('fretboardScroll');
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  });
  await page.waitForTimeout(500);

  const highInfo = await page.evaluate(() => {
    const high = document.getElementById('fretboardPartHigh');
    if (!high) return { exists: false };
    const strips = [...high.querySelectorAll('.fb-string-strip')];
    return {
      exists: true,
      stripCount: strips.length,
      firstSi: strips[0] ? strips[0].dataset.si : null,
      firstStart: strips[0] ? strips[0].dataset.start : null,
      firstEnd: strips[0] ? strips[0].dataset.end : null,
    };
  });
  check('右滑到底后加载了高把位段', highInfo.exists);
  check('高把位段 SVG 中存在 6 根点击条', highInfo.stripCount === 6, 'count=' + highInfo.stripCount);
  check('高把位段 start=13 / end=24', highInfo.firstStart === '13' && highInfo.firstEnd === '24', JSON.stringify(highInfo));

  // 点击高把位段 1 弦 13 品：标准调弦 1 弦空弦 E4 = MIDI 64，+13 = F#5 = 77
  const highStrip = await page.$('#fretboardPartHigh .fb-string-strip[data-si="5"]');
  if (highStrip) {
    const highBox = await highStrip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const highData = await highStrip.evaluate((el) => ({
      leftPad: Number(el.dataset.leftPad),
      colW: Number(el.dataset.colW),
      start: Number(el.dataset.start),
    }));
    // 高把位段 leftPad=0；fret 13 中心 x = 0 + (13-13)*colW + colW/2 = colW/2
    const fret13X = highBox.x + highData.colW / 2;
    const highClickY = highBox.y + highBox.h * 0.5;
    await page.mouse.click(Math.round(fret13X), Math.round(highClickY));
    await page.waitForTimeout(200);
    const highMidi = await page.evaluate(() => window.__lastPlayedMidi);
    check('点击高把位 1 弦 13 品播放 F#5 (MIDI 77)', highMidi === 77, 'lastMidi=' + highMidi);
  }

  check('无 console 报错', consoleErrors.length === 0, consoleErrors.join('; '));
  check('无页面异常', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed ? 1 : 0);
})();
