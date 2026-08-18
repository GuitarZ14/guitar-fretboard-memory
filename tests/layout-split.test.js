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
 *  3. 移动布局：恢复单列，主区在上、控制在下，卡片单列堆叠，模式 tab 并排可见
 *  4. 功能：显示答案 / 下一个音 / 模式切换联动禁用 / 升降号开关 / 难度滑块
 *  5. 视觉：黏土浅色主题无暗色残留、卡片具备双重阴影
 *  6. 健壮性：无 console 报错、无页面异常、无 404
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
  check('移动端单列：主区在上、侧栏在下', mBox.y < sBox.y - 20, `main.y=${mBox.y.toFixed(0)} sidebar.y=${sBox.y.toFixed(0)}`);

  // 侧栏卡片单列堆叠：四张卡片纵向依次排列（非 2×2 并排）
  const cardTops = await page.$$eval('.sidebar-controls .control-card', (els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().y))
  );
  check('侧栏卡片呈单列堆叠（首两张不同行）', cardTops.length >= 2 && cardTops[0] < cardTops[1] - 2, 'tops=' + cardTops.join(','));
  const stackedInOrder = cardTops.length === 4 && cardTops.every((t, i) => i === 0 || t >= cardTops[i - 1] - 1);
  check('四张控制卡片纵向依次堆叠', stackedInOrder, 'tops=' + cardTops.join(','));

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
