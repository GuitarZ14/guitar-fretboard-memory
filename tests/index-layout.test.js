/**
 * 指板练习页（index.html）方案三（左右分栏布局）布局 + 功能单元测试
 * ------------------------------------------------------------
 * 本文件为「指板练习」页回归测试；和弦速查页（chords.html）的三栏布局测试见
 * layout-split.test.js。
 *
 * 运行方式（本机已具备 playwright-core + 本地 Chrome）：
 *   node tests/index-layout.test.js
 * 前置：本地预览服务已在 http://127.0.0.1:8624 运行
 *       （python3 -m http.server 8624）
 *
 * 覆盖：
 *  1. DOM 结构：顶部三栏(.top-row) —— 左(.sidebar-left 含 autoRevealCard) /
 *     右(.sidebar-right 含 difficultyCard) / 中(.current-note-col)，下方指板区铺满整列
 *  2. 桌面布局：三栏横向并列、指板区在下方且宽度铺满；无横向溢出
 *  3. 移动布局：三栏纵向堆叠、指板区在下，模式 tab 并排可见
 *  4. 功能：显示答案 / 下一个音 / 模式切换联动禁用 / 升降号按钮(aria-pressed 切换) / 难度滑块
 *  5. 视觉：黏土浅色主题无暗色残留、卡片具备双重阴影
 *  6. 健壮性：无 console 报错、无页面异常、无 404
 *  7. 移动端指板滚动回归：0–24 品全部存在、可横向滚动、第 24 品滚动后完全进入视口
 */

const path = require('path');

// 解析 playwright-core：优先项目依赖，回退到本机共享路径
function loadPlaywright() {
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'playwright-core'),
    '/tmp/pwtest/node_modules/playwright-core',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  throw new Error('playwright-core 未找到，请先安装或确认 /tmp/pwtest/node_modules 可用');
}

const { chromium } = loadPlaywright();
const EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:8624/index.html';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function box(page, sel) {
  return page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => failedRequests.push(r.url() + ' (' + (r.failure() && r.failure().errorText) + ')'));

  // ============ 桌面端测试 ============
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-split');
  await page.waitForTimeout(900); // 等待入场动画结束

  console.log('\n[桌面布局 1280×900]');
  const topRow = await box(page, '.top-row');
  const leftSidebar = await box(page, '.sidebar-left');
  const rightSidebar = await box(page, '.sidebar-right');
  const noteCol = await box(page, '.current-note-col');
  const fret = await box(page, '.fretboard-section');

  check('存在 .top-row 顶部三栏', !!topRow);
  check('存在左侧栏(.sidebar-left)', !!leftSidebar);
  check('存在右侧栏(.sidebar-right)', !!rightSidebar);
  check('存在当前音名列(.current-note-col)', !!noteCol);
  // 三栏横向并列（左-中-右）：全指板找音模式(左) < 当前音名(中) < 自由找音模式(右)
  check('三栏横向并列（左 < 当前音名 < 右）',
    leftSidebar.x < noteCol.x - 20 && noteCol.x < rightSidebar.x - 20,
    `L.x=${leftSidebar.x.toFixed(0)} N.x=${noteCol.x.toFixed(0)} R.x=${rightSidebar.x.toFixed(0)}`);
  check('三栏顶部基本对齐', Math.abs(leftSidebar.y - rightSidebar.y) < 8 && Math.abs(rightSidebar.y - noteCol.y) < 8,
    `L.y=${leftSidebar.y.toFixed(0)} R.y=${rightSidebar.y.toFixed(0)} N.y=${noteCol.y.toFixed(0)}`);

  // 指板区在下方且铺满整列（宽度接近视口宽度）
  check('指板区在顶部三栏下方', fret.y > topRow.bottom - 4, `fret.y=${fret.y.toFixed(0)} topRow.bottom=${topRow.bottom.toFixed(0)}`);
  check('指板区横向铺满（宽度接近视口）', fret.w >= topRow.w - 4, `fret.w=${fret.w.toFixed(0)} topRow.w=${topRow.w.toFixed(0)}`);

  // 无横向溢出
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('无横向溢出', overflow.scrollW <= overflow.clientW + 2, `scrollW=${overflow.scrollW} clientW=${overflow.clientW}`);

  // 顶栏 Tab 切换器（指板练习 / 和弦速查 / 音阶练习）
  const topTabs = await page.$$eval('.tool-nav.tabs .tool-tab', (els) => els.map((e) => ({
    text: e.textContent.trim(),
    active: e.classList.contains('active'),
    href: e.getAttribute('href'),
  })));
  check('顶栏存在三个工具 Tab', topTabs.length === 3 && topTabs[0].text === '指板练习' && topTabs[1].text === '和弦速查' && topTabs[2].text === '音阶练习');
  check('当前页「指板练习」Tab 高亮', topTabs[0].active && !topTabs[1].active && !topTabs[2].active && topTabs[0].href === 'index.html' && topTabs[1].href === 'chords.html' && topTabs[2].href === 'scales.html');

  // 双 Tab 在顶栏中保持居中（与和弦速查页统一）
  const topbarBox = await box(page, '.topbar');
  const tabsBox = await box(page, '.tool-nav.tabs');
  const tabCenter = tabsBox.x + tabsBox.w / 2;
  const topbarCenter = topbarBox.x + topbarBox.w / 2;
  check('双 Tab 在顶栏中大致居中', Math.abs(tabCenter - topbarCenter) < 24, `tabCenter=${tabCenter.toFixed(1)} topbarCenter=${topbarCenter.toFixed(1)}`);

  // 左栏：全指板找音模式卡片；右栏：自由找音模式卡片
  const leftCard = await page.$eval('.sidebar-left .control-card', (el) => el.id);
  const rightCard = await page.$eval('.sidebar-right .control-card', (el) => el.id);
  check('左栏含 autoRevealCard（全指板找音模式）', leftCard === 'autoRevealCard', leftCard);
  check('右栏含 difficultyCard（自由找音模式）', rightCard === 'difficultyCard', rightCard);

  // 升降号按钮紧邻显示答案按钮（同处 .note-actions 内）
  const accInActions = await page.$$eval('.note-actions #accidentalsToggle', (els) => els.length);
  check('含升降号按钮位于当前音名操作区', accInActions === 1, 'count=' + accInActions);

  // 截图
  await page.screenshot({ path: path.resolve(__dirname, '..', 'tests', 'shot-desktop.png') });

  // ============ 移动端测试 ============
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-split');
  await page.waitForTimeout(700);

  console.log('\n[移动布局 390×844]');
  const mTopRow = await box(page, '.top-row');
  const leftBox = await box(page, '.sidebar-left');
  const rightBox = await box(page, '.sidebar-right');
  const noteBox = await box(page, '.current-note-col');
  const mFret = await box(page, '.fretboard-section');

  // 三栏纵向堆叠：左栏(全指板) → 当前音名 → 右栏(自由找音) → 指板
  check('移动端三栏纵向堆叠（左栏在上、当前音名其次、右栏再次）',
    leftBox.y < noteBox.y - 4 && noteBox.y < rightBox.y - 4,
    `L.y=${leftBox.y.toFixed(0)} N.y=${noteBox.y.toFixed(0)} R.y=${rightBox.y.toFixed(0)}`);
  check('移动端指板区在最下方', mFret.y > noteBox.y + 4, `fret.y=${mFret.y.toFixed(0)} N.y=${noteBox.y.toFixed(0)}`);

  // 侧栏各含 1 张卡片、宽度铺满
  const leftCardW = await page.$eval('.sidebar-left .control-card', (el) => el.getBoundingClientRect().width);
  const rightCardW = await page.$eval('.sidebar-right .control-card', (el) => el.getBoundingClientRect().width);
  check('左栏卡片铺满宽度', leftCardW > 200, 'w=' + leftCardW.toFixed(0));
  check('右栏卡片铺满宽度', rightCardW > 200, 'w=' + rightCardW.toFixed(0));

  // 无横向溢出
  const mobOverflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('移动端无横向溢出', mobOverflow.scrollW <= mobOverflow.clientW + 2, `scrollW=${mobOverflow.scrollW} clientW=${mobOverflow.clientW}`);

  // 模式切换 tab：两个都可见且并排（查看 + 点按）
  const tabs = await page.evaluate(() => {
    const bt = document.querySelector('#browseModeTab');
    const pt = document.querySelector('#practiceModeTab');
    const rb = bt.getBoundingClientRect();
    const rp = pt.getBoundingClientRect();
    return {
      bothVisible: rb.width > 0 && rp.width > 0,
      sideBySide: Math.abs(rb.y - rp.y) < 2,
      bothFit: rp.right <= window.innerWidth + 1 && rb.left >= -1,
    };
  });
  check('移动端两个模式 tab 并排且都可见', tabs.bothVisible && tabs.sideBySide && tabs.bothFit, JSON.stringify(tabs));

  await page.screenshot({ path: path.resolve(__dirname, '..', 'tests', 'shot-mobile.png') });

  // ============ 移动端指板滚动回归（修复 15 品之后品格被截断） ============
  // 根因：旧版 .fretboard 被容器压到 ~358px，overflow:hidden 裁掉 15 品之后的格子；
  // 修复后 .fret-numbers / .fretboard 加 min-width: max-content，由 .fretboard-scroll 横向滚动。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#fretboard');
  await page.waitForTimeout(500);

  console.log('\n[移动端指板滚动回归 390×844]');

  // 进入点按模式 + 选择任一弦，确保指板可交互且全品格渲染
  await page.click('#practiceModeTab');
  await page.waitForTimeout(400);
  await page.click('.string-btn[data-string="1"]');
  await page.waitForTimeout(200);
  // 难度上限拉满到 24，确保第 24 品在范围内（置灰只改 opacity/pointer-events，不影响几何）
  await page.$eval('#fretRangeMaxInput', (el) => { el.value = 24; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);

  // 1) DOM 中应存在 0–24 全部 25 个品格
  const fretInfo = await page.evaluate(() => {
    const cells = document.querySelectorAll('.fretboard .fret-cell');
    const maxFret = cells.length ? Math.max.apply(null, Array.from(cells).map((c) => Number(c.dataset.fret))) : -1;
    const last = document.querySelector('.fretboard .fret-cell[data-fret="24"]');
    return { total: cells.length, hasFret24: !!last, maxFret, lastWidth: last ? last.getBoundingClientRect().width : 0 };
  });
  check('指板 DOM 含全部 0–24 品（maxFret=24）', fretInfo.maxFret === 24, 'maxFret=' + fretInfo.maxFret + ' total=' + fretInfo.total);
  check('存在 data-fret="24" 的品格且已渲染（width>0）', fretInfo.hasFret24 && fretInfo.lastWidth > 0, 'w=' + fretInfo.lastWidth.toFixed(1));

  // 2) 指板在移动端应可横向滚动（内容宽度 > 视口宽度；旧版被裁切故不可滚动）
  const scrollInfo = await page.evaluate(() => {
    const sc = document.querySelector('#fretboardScroll');
    return { scrollW: sc.scrollWidth, clientW: sc.clientWidth };
  });
  check('移动端指板可横向滚动（scrollWidth>clientWidth）', scrollInfo.scrollW > scrollInfo.clientW + 1, `scrollW=${scrollInfo.scrollW} clientW=${scrollInfo.clientW}`);

  // 3) 滚动到最右后，第 24 品应完全进入滚动视口，可被点按
  const reachable = await page.evaluate(() => {
    const sc = document.querySelector('#fretboardScroll');
    const cell = document.querySelector('.fretboard .fret-cell[data-fret="24"]');
    sc.scrollLeft = sc.scrollWidth; // 滚到最右
    const cRect = cell.getBoundingClientRect();
    const sRect = sc.getBoundingClientRect();
    return { left: cRect.left, right: cRect.right, sLeft: sRect.left, sRight: sRect.right,
      inView: cRect.left >= sRect.left - 2 && cRect.right <= sRect.right + 2 };
  });
  check('滚动到最右后第 24 品完全可见（进入滚动视口）', reachable.inView, JSON.stringify(reachable));

  // 恢复默认（查看模式）以便后续功能测试，不影响断言结果
  await page.click('#browseModeTab');
  await page.waitForTimeout(200);

  // 矮视口（≤760 宽且 ≤780 高）：侧栏仍为 2×2 网格，不回退单列
  await page.setViewportSize({ width: 390, height: 740 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-split');
  await page.waitForTimeout(500);

  console.log('\n[矮视口布局 390×740]');
  const shortRow = await box(page, '.top-row');
  const slBox = await box(page, '.sidebar-left');
  const srBox = await box(page, '.sidebar-right');
  const snBox = await box(page, '.current-note-col');
  check('矮视口三栏纵向堆叠（左 < 当前音名 < 右）', slBox.y < snBox.y - 4 && snBox.y < srBox.y - 4, `L.y=${slBox.y.toFixed(0)} N.y=${snBox.y.toFixed(0)} R.y=${srBox.y.toFixed(0)}`);
  check('矮视口三栏均铺满宽度', slBox.w > 200 && srBox.w > 200 && snBox.w > 200, `L.w=${slBox.w.toFixed(0)} R.w=${srBox.w.toFixed(0)} N.w=${snBox.w.toFixed(0)}`);


  // ============ 功能测试（桌面视口） ============
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#revealButton');
  await page.waitForTimeout(600);

  console.log('\n[功能测试]');
  // 显示答案
  await page.click('#revealButton');
  await page.waitForTimeout(300);
  const ansVisible = await page.$eval('#answerStatus', (el) => el.classList.contains('visible'));
  check('点击显示答案 → 答案状态可见', ansVisible);
  const matchCount = await page.$$eval('.fretboard.show-answer .answer-note.match', (els) => els.length);
  check('指板显示答案圆点（匹配点 > 0）', matchCount > 0, 'match=' + matchCount);

  // 空弦位置本身已有 string-label 显示音名，不应再重复渲染 answer-note
  const openAnswerNotes = await page.$$eval('.fret-cell.open .answer-note', (els) => els.length);
  check('空弦位置不重复显示 answer-note', openAnswerNotes === 0, 'count=' + openAnswerNotes);

  // 下一个音（轮次递增）
  const roundBefore = await page.$eval('#roundCount', (el) => el.textContent.trim());
  await page.click('#nextButton');
  await page.waitForTimeout(200);
  const roundAfter = await page.$eval('#roundCount', (el) => el.textContent.trim());
  check('点击下一个音 → 练习次数递增', roundBefore !== roundAfter, `${roundBefore} → ${roundAfter}`);

  // 升降号开关（按钮化：aria-pressed + .active 高亮）
  const accBefore = await page.$eval('#accidentalsToggle', (el) => el.getAttribute('aria-pressed') === 'true' && el.classList.contains('active'));
  await page.click('#accidentalsToggle', { force: true });
  await page.waitForTimeout(150);
  const accAfter = await page.$eval('#accidentalsToggle', (el) => el.getAttribute('aria-pressed') === 'true' && el.classList.contains('active'));
  check('升降号开关可切换（含高亮态）', accBefore !== accAfter, `${accBefore} → ${accAfter}`);

  // 查看模式：难度卡片禁用；点按模式：启用 + 高亮
  const browseDisabled = await page.$eval('#difficultyCard', (el) => el.classList.contains('disabled'));
  check('默认（查看）模式 → 难度卡片禁用', browseDisabled);
  await page.click('#practiceModeTab');
  await page.waitForTimeout(900); // 等待禁用态 opacity 过渡与高亮
  const practiceState = await page.evaluate(() => {
    const el = document.querySelector('#difficultyCard');
    return { disabled: el.classList.contains('disabled'), highlight: el.classList.contains('highlight') };
  });
  check('切换到点按模式 → 难度卡片启用', practiceState.disabled === false);
  check('切换到点按模式 → 难度卡片高亮', practiceState.highlight === true);

  // 难度滑块在点按模式可拖动并置灰指板
  await page.$eval('#fretRangeMaxInput', (el) => { el.value = 5; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(300);
  const dimmed = await page.$$eval('.fretboard .fret-cell.dimmed', (els) => els.length);
  check('拖动难度上限滑块 → 指板置灰（dimmed > 0）', dimmed > 0, 'dimmed=' + dimmed);

  // 新规则回归：题目池 = 选定范围内出现过的全部音名（出现即出题，不再要求≥2个位置）。
  // 1) 单弦(1弦) 0~5 品：范围内 E/F/F#/G/G#/A 均可出题，无 alert，且每题只需点 1 处即可过关
  await page.evaluate(() => {
    document.querySelectorAll('.string-btn').forEach((b) => {
      const s = Number(b.dataset.string);
      if ((b.getAttribute('aria-pressed') === 'true') !== (s === 1)) b.click();
    });
    const mn = document.querySelector('#fretRangeMinInput');
    const mx = document.querySelector('#fretRangeMaxInput');
    mn.value = 0; mn.dispatchEvent(new Event('input', { bubbles: true }));
    mx.value = 5; mx.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  let dialogMsg = null;
  page.once('dialog', async (d) => { dialogMsg = d.message(); await d.dismiss(); });
  await page.evaluate(() => { const nb = document.querySelector('#nextButton'); if (nb) nb.click(); });
  await page.waitForTimeout(300);
  const singleNote = await page.$eval('#currentNote', (el) => el.textContent.trim());
  check('单弦 0~5 品可正常出题（无 alert）', dialogMsg === null && singleNote !== '—', 'note=' + singleNote + ' dialog=' + JSON.stringify(dialogMsg));

  // 单弦点击正确音即过关（每题只需点 1 处）
  const singleCleared = await page.evaluate(() => {
    const noteText = document.querySelector('#currentNote').textContent.trim();
    const pitchMap = {'C':'C','C♯':'C#','D♭':'C#','D':'D','D♯':'D#','E♭':'D#','E':'E','F':'F','F♯':'F#','G♭':'F#','G':'G','G♯':'G#','A♭':'G#','A':'A','A♯':'A#','B♭':'A#','B':'B'};
    const tp = pitchMap[noteText];
    const c = Array.from(document.querySelectorAll('.fret-cell')).find((x) => x.dataset.pitch === tp && Number(x.dataset.fret) <= 5 && !x.classList.contains('dimmed'));
    if (!c) return 'no-cell';
    c.click();
    return document.querySelectorAll('#answerStatus span')[1]?.textContent ?? '';
  });
  check('单弦点击正确音即过关（全部找齐）', /全部找齐/.test(singleCleared), 'status=' + singleCleared);

  // 2) 多弦(1弦+2弦) 4~7 品：范围内有 F#/G/G#/A/A#/B，新规则下有解、无 alert
  await page.evaluate(() => {
    document.querySelectorAll('.string-btn').forEach((b) => {
      const s = Number(b.dataset.string);
      const want = s === 1 || s === 2;
      if ((b.getAttribute('aria-pressed') === 'true') !== want) b.click();
    });
    const mn = document.querySelector('#fretRangeMinInput');
    const mx = document.querySelector('#fretRangeMaxInput');
    mn.value = 4; mn.dispatchEvent(new Event('input', { bubbles: true }));
    mx.value = 7; mx.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  let dialogMsg2 = null;
  page.once('dialog', async (d) => { dialogMsg2 = d.message(); await d.dismiss(); });
  await page.evaluate(() => { const nb = document.querySelector('#nextButton'); if (nb) nb.click(); });
  await page.waitForTimeout(300);
  const multiNote = await page.$eval('#currentNote', (el) => el.textContent.trim());
  check('多弦 4~7 品新规则下有解（无 alert）', dialogMsg2 === null && multiNote !== '—', 'note=' + multiNote + ' dialog=' + JSON.stringify(dialogMsg2));


  // ============ 视觉检查（黏土浅色主题） ============
  console.log('\n[视觉检查]');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  check('页面背景为浅色渐变（含 #fef3f2）', bg.includes('#fef3f2'), bg);

  const cardShadow = await page.$eval('#autoRevealCard', (el) => getComputedStyle(el).boxShadow);
  check('控制卡片具备双重阴影（box-shadow 含逗号分隔多层）', (cardShadow.match(/rgb/g) || []).length >= 2, cardShadow.slice(0, 60) + '…');

  // ============ 健壮性 ============
  console.log('\n[健壮性]');
  check('无 console 报错', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('无页面异常', pageErrors.length === 0, pageErrors.join(' | '));
  check('无失败的资源请求', failedRequests.length === 0, failedRequests.join(' | '));

  await browser.close();

  console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
  if (failed > 0) {
    console.log('失败项：\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('测试运行异常：', e);
  process.exit(2);
});
