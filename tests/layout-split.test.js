/**
 * 方案三（左右分栏布局）布局 + 功能单元测试
 * ------------------------------------------------------------
 * 运行方式（本机已具备 playwright-core + 本地 Chrome）：
 *   node tests/layout-split.test.js
 * 前置：本地预览服务已在 http://127.0.0.1:8624 运行
 *       （python3 -m http.server 8624）
 *
 * 覆盖：
 *  1. DOM 结构：侧栏(.sidebar-controls) 与 主区(.main-column) 均存在且含预期子元素
 *  2. 桌面布局：侧栏在左、主区在右且顶部对齐；无横向溢出
 *  3. 移动布局：主区在上、控制在下，侧栏卡片呈 2×2 网格（等高/等宽），模式 tab 并排可见
 *  4. 功能：显示答案 / 下一个音 / 模式切换联动禁用 / 升降号开关 / 难度滑块
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
  const sidebar = await box(page, '.sidebar-controls');
  const main = await box(page, '.main-column');

  check('存在 .sidebar-controls 侧栏', !!sidebar);
  check('存在 .main-column 主区', !!main);
  check('侧栏在左（x < 主区 x）', sidebar.x < main.x - 50, `sidebar.x=${sidebar.x.toFixed(0)} main.x=${main.x.toFixed(0)}`);
  check('侧栏与主区顶部基本对齐', Math.abs(sidebar.y - main.y) < 8, `sidebar.y=${sidebar.y.toFixed(0)} main.y=${main.y.toFixed(0)}`);
  check('主区宽度明显大于侧栏（横向填满）', main.w > sidebar.w * 1.5, `main.w=${main.w.toFixed(0)} sidebar.w=${sidebar.w.toFixed(0)}`);

  // 无横向溢出
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('无横向溢出', overflow.scrollW <= overflow.clientW + 2, `scrollW=${overflow.scrollW} clientW=${overflow.clientW}`);

  // 四张控制卡片都在侧栏内
  const cardsInSidebar = await page.$$eval('.sidebar-controls .control-card', (els) => els.map((e) => e.id));
  check('侧栏含 4 张控制卡片', cardsInSidebar.length === 4, cardsInSidebar.join(','));
  check('含 autoNextCard', cardsInSidebar.includes('autoNextCard'));
  check('含 accidentalsCard', cardsInSidebar.includes('accidentalsCard'));
  check('含 autoRevealCard', cardsInSidebar.includes('autoRevealCard'));
  check('含 difficultyCard', cardsInSidebar.includes('difficultyCard'));
  check('卡片顺序：自动切换 → 包含升降号 → 自动显示答案 → 练习难度',
    JSON.stringify(cardsInSidebar) === JSON.stringify(['autoNextCard', 'accidentalsCard', 'autoRevealCard', 'difficultyCard']),
    cardsInSidebar.join(' > '));

  // 指板在主区右侧
  const fret = await box(page, '.fretboard-section');
  check('指板区位于主区内（右侧）', fret.x >= main.x - 2 && fret.right <= main.right + 2, `fret.x=${fret.x.toFixed(0)} main.x=${main.x.toFixed(0)}`);

  // 截图
  await page.screenshot({ path: path.resolve(__dirname, '..', 'tests', 'shot-desktop.png') });

  // ============ 移动端测试 ============
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-split');
  await page.waitForTimeout(700);

  console.log('\n[移动布局 390×844]');
  const sBox = await box(page, '.sidebar-controls');
  const mBox = await box(page, '.main-column');
  check('移动端 2×2：主区在上、侧栏在下', mBox.y < sBox.y - 20, `main.y=${mBox.y.toFixed(0)} sidebar.y=${sBox.y.toFixed(0)}`);

  // 侧栏卡片 2×2 网格：前两张同行、后两张同行、两行依次排列，且四张等高/等宽
  const cardBoxes = await page.$$eval('.sidebar-controls .control-card', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    })
  );
  const [c0, c1, c2, c3] = cardBoxes;
  check('侧栏含 4 张卡片（DOM 顺序不变）', cardBoxes.length === 4, 'count=' + cardBoxes.length);
  check('前两张卡片同行（同一行，y 相同）', Math.abs(c0.y - c1.y) < 2, `y0=${c0.y.toFixed(0)} y1=${c1.y.toFixed(0)}`);
  check('后两张卡片同行（同一行，y 相同）', Math.abs(c2.y - c3.y) < 2, `y2=${c2.y.toFixed(0)} y3=${c3.y.toFixed(0)}`);
  check('两行依次排列（第二行在第一行下方）', c2.y > c0.y + 4 && c3.y > c1.y + 4, `row1.y=${c0.y.toFixed(0)} row2.y=${c2.y.toFixed(0)}`);
  check('同行为两列（左右排布、不重叠）', c1.x > c0.x + c0.w - 2 && Math.abs(c1.y - c0.y) < 2, `x0=${c0.x.toFixed(0)} x1=${c1.x.toFixed(0)}`);
  const ws = [c0.w, c1.w, c2.w, c3.w].map((n) => n.toFixed(0));
  check('四张卡片等宽（列宽一致）', Math.abs(c0.w - c1.w) < 1 && Math.abs(c0.w - c2.w) < 1 && Math.abs(c0.w - c3.w) < 1, 'w=' + ws.join(','));
  const hs = [c0.h, c1.h, c2.h, c3.h].map((n) => n.toFixed(0));
  check('四张卡片等高（行高一致）', Math.abs(c0.h - c1.h) < 1 && Math.abs(c2.h - c3.h) < 1 && Math.abs(c0.h - c2.h) < 1, 'h=' + hs.join(','));

  // 无横向溢出
  const mobOverflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('移动端无横向溢出', mobOverflow.scrollW <= mobOverflow.clientW + 2, `scrollW=${mobOverflow.scrollW} clientW=${mobOverflow.clientW}`);

  // 模式切换 tab：两个都可见且并排（核对 + 点按）
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

  // 恢复默认（核对模式）以便后续功能测试，不影响断言结果
  await page.click('#browseModeTab');
  await page.waitForTimeout(200);

  // 矮视口（≤760 宽且 ≤780 高）：侧栏仍为 2×2 网格，不回退单列
  await page.setViewportSize({ width: 390, height: 740 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-split');
  await page.waitForTimeout(500);

  console.log('\n[矮视口布局 390×740]');
  const shortBoxes = await page.$$eval('.sidebar-controls .control-card', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    })
  );
  const [s0, s1, s2, s3] = shortBoxes;
  check('矮视口仍为 2×2 网格（共 4 张）', shortBoxes.length === 4, 'count=' + shortBoxes.length);
  check('矮视口前两张同行', Math.abs(s0.y - s1.y) < 2, `y0=${s0.y.toFixed(0)} y1=${s1.y.toFixed(0)}`);
  check('矮视口后两张同行', Math.abs(s2.y - s3.y) < 2, `y2=${s2.y.toFixed(0)} y3=${s3.y.toFixed(0)}`);
  check('矮视口两行依次排列', s2.y > s0.y + 4 && s3.y > s1.y + 4, `row1.y=${s0.y.toFixed(0)} row2.y=${s2.y.toFixed(0)}`);
  check('矮视口同行为两列', s1.x > s0.x + s0.w - 2 && Math.abs(s1.y - s0.y) < 2, `x0=${s0.x.toFixed(0)} x1=${s1.x.toFixed(0)}`);
  const sw = [s0.w, s1.w, s2.w, s3.w].map((n) => n.toFixed(0));
  const sh = [s0.h, s1.h, s2.h, s3.h].map((n) => n.toFixed(0));
  check('矮视口四张卡片等宽', Math.abs(s0.w - s1.w) < 1 && Math.abs(s0.w - s2.w) < 1 && Math.abs(s0.w - s3.w) < 1, 'w=' + sw.join(','));
  check('矮视口四张卡片等高', Math.abs(s0.h - s1.h) < 1 && Math.abs(s2.h - s3.h) < 1 && Math.abs(s0.h - s2.h) < 1, 'h=' + sh.join(','));


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

  // 下一个音（轮次递增）
  const roundBefore = await page.$eval('#roundCount', (el) => el.textContent.trim());
  await page.click('#nextButton');
  await page.waitForTimeout(200);
  const roundAfter = await page.$eval('#roundCount', (el) => el.textContent.trim());
  check('点击下一个音 → 练习次数递增', roundBefore !== roundAfter, `${roundBefore} → ${roundAfter}`);

  // 升降号开关
  const accBefore = await page.$eval('#accidentalsToggle', (el) => el.checked);
  await page.click('#accidentalsToggle', { force: true });
  await page.waitForTimeout(150);
  const accAfter = await page.$eval('#accidentalsToggle', (el) => el.checked);
  check('升降号开关可切换', accBefore !== accAfter, `${accBefore} → ${accAfter}`);

  // 核对模式：难度卡片禁用；点按模式：启用 + 高亮
  const browseDisabled = await page.$eval('#difficultyCard', (el) => el.classList.contains('disabled'));
  check('默认（核对）模式 → 难度卡片禁用', browseDisabled);
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

  // ============ 视觉检查（黏土浅色主题） ============
  console.log('\n[视觉检查]');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  check('页面背景为浅色渐变（含 #fef3f2）', bg.includes('#fef3f2'), bg);

  const cardShadow = await page.$eval('#autoNextCard', (el) => getComputedStyle(el).boxShadow);
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
