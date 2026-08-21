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
    const orig = audioEngine.play.bind(audioEngine);
    audioEngine.play = function (si, fret, velocity) {
      window.__lastPlayedMidi = (TUNING_BASE_MIDI[state.tuningId][si] + fret);
      return orig(si, fret, velocity);
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
    ctxState: audioEngine.ctx ? audioEngine.ctx.state : null,
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

  console.log('\n[采样模式切换与真实采样路由]');
  // 切换到采样模式
  await page.click('#toneSwitch button[data-tone="sample"]');
  await page.waitForTimeout(300);
  const tonePressed = await page.$eval('#toneSwitch button[data-tone="sample"]', (el) => el.getAttribute('aria-pressed'));
  const toneActive = await page.$eval('#toneSwitch button[data-tone="sample"]', (el) => el.classList.contains('active'));
  check('点击「采样」→ 该按钮 aria-pressed=true', tonePressed === 'true', 'pressed=' + tonePressed);
  check('点击「采样」→ 该按钮高亮', toneActive);

  // 采样模式下再次点击，应仍按音高播放（override 拦截 midi）
  await page.mouse.click(Math.round(clickX), Math.round(clickY));
  await page.waitForTimeout(300);
  const sampleMidi = await page.evaluate(() => window.__lastPlayedMidi);
  check('采样模式点击 6 弦左侧仍播放 E2 (MIDI 40)', sampleMidi === 40, 'lastMidi=' + sampleMidi);

  // pickSample 音高映射：6 弦空弦(MIDI40/E2) → wavebase 的 string-6 fret-02（录音为 Drop-D，空弦=D2，故 E2 在 2 品）
  const pick = await page.evaluate(() => {
    const p = audioEngine.pickSample(0, 0, 'standard');
    return p ? { N: p.N, fret: p.fret, token: p.token, take: p.take, targetMidi: p.targetMidi } : null;
  });
  check('pickSample(6弦,0品) 命中真实采样', pick !== null, JSON.stringify(pick));
  check('6 弦空弦 E2 命中 wavebase string-6（同物理低音弦）', pick && pick.N === 6, JSON.stringify(pick));
  // 该录音在 wavebase 中以异名同音记法 "Dx2"（D 重升 = E2）存储，按音高校验更准确
  check('真实采样音高 = E2 (MIDI 40)', pick && pick.targetMidi === 40, JSON.stringify(pick));
  check('每次点击选定一个具体 take 编号', pick && pick.take >= 1, JSON.stringify(pick));

  // 构造真实采样 URL 并校验格式（指向 wavebase CDN，绝不含 playbackRate 思路）
  const url = await page.evaluate(() => {
    const p = audioEngine.pickSample(0, 0, 'standard');
    return audioEngine.sampleUrl(p.N, p.fret, p.token, 1);
  });
  check('采样 URL 指向真实录音 CDN（media.githubusercontent / parker-fly / string-6）',
    /media\.githubusercontent\.com\/media\/cluesurf\/wavebase.*parker-fly\/string-6\/string-6-note-.+-fret-\d+-1\.wav$/.test(url),
    url);

  // 用 fetch 桩拦截 CDN 请求（避免依赖外网），返回一段合法 WAV，验证解码与路由
  // 先清空缓存并指定固定 take，确保本次请求被桩捕获（不命中前序真实点击的缓存）
  const decoded = await page.evaluate(async () => {
    audioEngine.buffers = Object.create(null);
    audioEngine.loading = Object.create(null);
    function makeWav(freq, dur) {
      const sr = 44100, n = Math.floor(sr * dur);
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      ws(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * freq * 2 * Math.PI) * 30000, true);
      return buf;
    }
    let requested = null;
    const origFetch = window.fetch.bind(window);
    window.fetch = (u) => {
      requested = typeof u === 'string' ? u : u.url;
      return Promise.resolve(new Response(makeWav(330, 0.2), { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
    };
    // 指定 (N=6, fret=1, token=Dx2, take=3)：与 6 弦空弦 E2 对应的真实录音
    const buf = await audioEngine.loadSampleBuffer(6, 1, 'Dx2', 3);
    window.fetch = origFetch;
    return buf ? { ok: true, duration: buf.duration, sr: buf.sampleRate, requested } : { ok: false, requested };
  });
  check('真实采样被解码为 AudioBuffer（decodeAudioData 成功）', decoded.ok && decoded.duration > 0.05, JSON.stringify(decoded));
  check('采样加载确实请求了真实录音 URL',
    decoded.requested && /parker-fly\/string-6\/string-6-note-Dx2-fret-01-3\.wav$/.test(decoded.requested),
    JSON.stringify(decoded));

  // 切回合成模式，避免影响后续用例
  await page.click('#toneSwitch button[data-tone="synth"]');
  await page.waitForTimeout(100);

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

  // 点击高把位段 1 弦 13 品：标准调弦 1 弦空弦 E4 = MIDI 64，+13 = F5 = 77
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
