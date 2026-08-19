/**
 * 和弦速查页（chords.html）三栏布局 + 功能单元测试
 * ------------------------------------------------------------
 * 运行方式（本机已具备 playwright-core + 本地 Chrome）：
 *   node tests/layout-split.test.js
 * 前置：本地预览服务已在对应地址运行，默认 http://127.0.0.1:8624/chords.html
 *       （可用 CHORDS_URL 环境变量覆盖，例如 CHORDS_URL=http://127.0.0.1:8088/chords.html）
 *
 * 覆盖：
 *  1. DOM 结构：三栏（.layout-left / .layout-main / .layout-right）与理论区（.layout-theory）均存在
 *  2. 桌面布局：左控制 → 中主区 → 右和弦列表 三列并排、顶部对齐；理论区位于主栏正下方；无横向溢出
 *  3. 移动布局：重排为 主区 → 和弦列表 → 控制 → 理论 的单栏顺序、无横向溢出
 *  4. 功能：根音切换 / 类型切换 / 视图切换（推荐指法 ↔ 全指板）/ 升降号 / 变调夹 / 左右手 联动
 *  5. 视觉：黏土浅色主题、卡片具备双重阴影
 *  6. 健壮性：无 console 报错、无页面异常、无失败的资源请求
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
const URL = process.env.CHORDS_URL || 'http://127.0.0.1:8624/chords.html';

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
  await page.waitForSelector('.chords-layout');
  await page.waitForTimeout(900); // 等待入场动画结束

  console.log('\n[桌面布局 1280×900]');
  const left = await box(page, '.layout-left');
  const main = await box(page, '.layout-main');
  const right = await box(page, '.layout-right');
  const theory = await box(page, '.layout-theory');

  check('存在 .layout-left 左控制栏', !!left);
  check('存在 .layout-main 中主区', !!main);
  check('存在 .layout-right 右和弦列表栏', !!right);
  check('存在 .layout-theory 理论区', !!theory);

  // 三列并排且顺序为 左 < 中 < 右
  check('三列顺序：左 < 中 < 右（x 递增）',
    left.x < main.x - 50 && main.x < right.x - 50,
    `left.x=${left.x.toFixed(0)} main.x=${main.x.toFixed(0)} right.x=${right.x.toFixed(0)}`);
  check('三列顶部基本对齐',
    Math.abs(left.y - main.y) < 8 && Math.abs(right.y - main.y) < 8,
    `left.y=${left.y.toFixed(0)} main.y=${main.y.toFixed(0)} right.y=${right.y.toFixed(0)}`);
  check('中主区宽度明显大于左右两栏（横向填满）',
    main.w > left.w * 1.4 && main.w > right.w * 1.4,
    `main.w=${main.w.toFixed(0)} left.w=${left.w.toFixed(0)} right.w=${right.w.toFixed(0)}`);

  // 理论区位于主栏正下方（同一列，且在主区之下）
  check('理论区位于主栏正下方（x 对齐 + y 在主区之下）',
    Math.abs(theory.x - main.x) < 8 && theory.y > main.y + 4,
    `theory.x=${theory.x.toFixed(0)} main.x=${main.x.toFixed(0)} theory.y=${theory.y.toFixed(0)} main.y=${main.y.toFixed(0)}`);

  // 无横向溢出
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('无横向溢出', overflow.scrollW <= overflow.clientW + 2, `scrollW=${overflow.scrollW} clientW=${overflow.clientW}`);

  // 顶栏双 Tab（指板练习 ↔ 和弦速查）
  const topTabs = await page.$$eval('.tool-nav.tabs .tool-tab', (els) => els.map((e) => ({
    text: e.textContent.trim(),
    active: e.classList.contains('active'),
    href: e.getAttribute('href'),
  })));
  check('顶栏存在「指板练习 / 和弦速查」双 Tab',
    topTabs.length === 2 && topTabs[0].text === '指板练习' && topTabs[1].text === '和弦速查');
  check('当前页「和弦速查」Tab 高亮',
    !topTabs[0].active && topTabs[1].active && topTabs[0].href === 'index.html' && topTabs[1].href === 'chords.html');

  // 左栏：两张控制卡片（调音与把位 / 显示选项）
  const leftCards = await page.$$eval('.layout-left .control-card', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 12)));
  check('左栏含 2 张控制卡片', leftCards.length === 2, leftCards.join(' | '));
  const hasTuning = await page.$('.layout-left #tuningSelect');
  const hasView = await page.$('.layout-left #viewSwitch');
  check('左栏含「调音标准」控件', !!hasTuning);
  check('左栏含「视图切换」控件', !!hasView);

  // 右栏：根音 12 个 + 和弦类型若干
  const rootCount = await page.$$eval('.layout-right #rootButtons .root-btn', (els) => els.length);
  check('右栏根音按钮为 12 个', rootCount === 12, 'count=' + rootCount);
  const typeCount = await page.$$eval('.layout-right #typeGroups .type-btn', (els) => els.length);
  check('右栏和弦类型按钮 > 0', typeCount > 0, 'count=' + typeCount);
  const groupHeads = await page.$$eval('.layout-right #typeGroups .type-group-head span', (els) => els.map((e) => e.textContent.trim()));
  check('右栏类型按分组显示（分组标题 > 0）', groupHeads.length > 0, groupHeads.join(' / '));

  // 主栏：当前和弦名称卡 + 指法区
  const chordSymbol = await page.$eval('#chordSymbol', (e) => e.textContent.trim());
  check('主栏当前和弦名称非空', chordSymbol.length > 0, chordSymbol);
  const hasVoicing = await page.$('#voicingArea');
  const hasFretboard = await page.$('#fretboardArea');
  check('主栏含推荐指法区', !!hasVoicing);
  check('主栏含全指板区', !!hasFretboard);

  await page.screenshot({ path: path.resolve(__dirname, '..', 'tests', 'shot-chords-desktop.png') });

  // ============ 移动端测试 ============
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.chords-layout');
  await page.waitForTimeout(700);

  console.log('\n[移动布局 390×844]');
  const mL = await box(page, '.layout-left');
  const mM = await box(page, '.layout-main');
  const mR = await box(page, '.layout-right');
  const mT = await box(page, '.layout-theory');

  // 单栏顺序：主区 → 和弦列表 → 控制 → 理论
  check('移动端单栏顺序：主区(y) < 和弦列表(y) < 控制(y) < 理论(y)',
    mM.y < mR.y - 10 && mR.y < mL.y - 10 && mL.y < mT.y - 10,
    `main.y=${mM.y.toFixed(0)} right.y=${mR.y.toFixed(0)} left.y=${mL.y.toFixed(0)} theory.y=${mT.y.toFixed(0)}`);

  // 右栏（和弦列表）在移动端应可横向滚动（类型按钮 nowrap + overflow-x）
  const scrollable = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.layout-right .type-group-btns')];
    if (groups.length === 0) return { ok: false, reason: 'no type-group-btns' };
    const any = groups.some((g) => g.scrollWidth > g.clientWidth + 1);
    return { ok: any, detail: groups.map((g) => `${g.scrollWidth}/${g.clientWidth}`) };
  });
  check('移动端右栏和弦类型可横向滚动', scrollable.ok, JSON.stringify(scrollable));

  // 无横向溢出
  const mobOverflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check('移动端无横向溢出', mobOverflow.scrollW <= mobOverflow.clientW + 2, `scrollW=${mobOverflow.scrollW} clientW=${mobOverflow.clientW}`);

  // 移动端控制卡片（左栏）仍存在 2 张
  const mobLeftCards = await page.$$eval('.layout-left .control-card', (els) => els.length);
  check('移动端左栏仍含 2 张控制卡片', mobLeftCards === 2, 'count=' + mobLeftCards);

  await page.screenshot({ path: path.resolve(__dirname, '..', 'tests', 'shot-chords-mobile.png') });

  // ============ 功能测试（桌面视口） ============
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#chordSymbol');
  await page.waitForTimeout(600);

  console.log('\n[功能测试]');
  const symBefore = await page.$eval('#chordSymbol', (e) => e.textContent.trim());

  // 根音切换
  await page.click('.layout-right #rootButtons .root-btn[data-root="2"]');
  await page.waitForTimeout(250);
  const symAfterRoot = await page.$eval('#chordSymbol', (e) => e.textContent.trim());
  const rootActive = await page.$eval('.layout-right #rootButtons .root-btn[data-root="2"]', (e) => e.classList.contains('active'));
  check('点击根音 → 当前和弦名称更新', symAfterRoot !== symBefore, `${symBefore} → ${symAfterRoot}`);
  check('点击根音 → 对应根音按钮高亮', rootActive);

  // 类型切换（点第一个类型按钮）
  const firstType = await page.$('.layout-right #typeGroups .type-btn');
  const typeId = await page.$eval('.layout-right #typeGroups .type-btn', (e) => e.dataset.type);
  await firstType.click();
  await page.waitForTimeout(250);
  const symAfterType = await page.$eval('#chordSymbol', (e) => e.textContent.trim());
  const typeActive = await page.$eval(`.layout-right #typeGroups .type-btn[data-type="${typeId}"]`, (e) => e.classList.contains('active'));
  check('点击和弦类型 → 当前和弦名称更新', symAfterType !== symAfterRoot, `${symAfterRoot} → ${symAfterType}`);
  check('点击和弦类型 → 对应类型按钮高亮', typeActive);

  // 视图切换：推荐指法 → 全指板
  await page.click('.layout-left #viewSwitch button[data-view="fretboard"]');
  await page.waitForTimeout(300);
  const fretVisible = await page.$eval('#fretboardArea', (e) => !e.hidden);
  const voicingHidden = await page.$eval('#voicingArea', (e) => e.hidden);
  check('切换到全指板 → 全指板区可见', fretVisible);
  check('切换到全指板 → 推荐指法区隐藏', voicingHidden);
  // 切回推荐指法
  await page.click('.layout-left #viewSwitch button[data-view="voicing"]');
  await page.waitForTimeout(200);
  const voicingVisible = await page.$eval('#voicingArea', (e) => !e.hidden);
  check('切回推荐指法 → 推荐指法区可见', voicingVisible);

  // 升降号切换（升 → 降）：先选含升降号的根音 C#/Db（data-root=1）
  await page.click('.layout-right #rootButtons .root-btn[data-root="1"]');
  await page.waitForTimeout(200);
  const nameSharp = await page.$eval('.layout-right #rootButtons .root-btn[data-root="1"]', (e) => e.textContent.trim());
  await page.click('.layout-left #accidentalSwitch button[data-acc="flat"]');
  await page.waitForTimeout(200);
  const nameFlat = await page.$eval('.layout-right #rootButtons .root-btn[data-root="1"]', (e) => e.textContent.trim());
  check('切换降号 → 根音名变为降号记法（如 Db 含 b）',
    nameFlat !== nameSharp && nameFlat.includes('b'),
    `${nameSharp} → ${nameFlat}`);
  await page.click('.layout-left #accidentalSwitch button[data-acc="sharp"]');
  await page.waitForTimeout(150);

  // 变调夹 +1
  const capoBefore = await page.$eval('#capoInput', (e) => e.value);
  await page.click('.layout-left [data-step-target="capoInput"][data-step="1"]');
  await page.waitForTimeout(150);
  const capoAfter = await page.$eval('#capoInput', (e) => e.value);
  check('点击变调夹 +1 → 值递增', Number(capoAfter) === Number(capoBefore) + 1, `${capoBefore} → ${capoAfter}`);

  // 左右手切换
  await page.click('.layout-left #handSwitch button[data-hand="left"]');
  await page.waitForTimeout(200);
  const leftHandPressed = await page.$eval('.layout-left #handSwitch button[data-hand="left"]', (e) => e.getAttribute('aria-pressed') === 'true');
  check('切换左手 → 左手按钮 aria-pressed=true', leftHandPressed);

  // ============ 视觉检查（黏土浅色主题） ============
  console.log('\n[视觉检查]');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  check('页面背景为浅色渐变（含 #fef3f2）', bg.includes('#fef3f2'), bg);

  const cardShadow = await page.$eval('.hero-card', (el) => getComputedStyle(el).boxShadow);
  check('主区卡片具备双重阴影（box-shadow 含多层）', (cardShadow.match(/rgb/g) || []).length >= 2, cardShadow.slice(0, 60) + '…');

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
