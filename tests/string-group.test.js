const { chromium } = require("playwright-core");

const URL = "http://127.0.0.1:8624/index.html";
const EXEC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
}

async function dimmedCount(page) {
  return page.evaluate(() => document.querySelectorAll(".fret-cell.dimmed").length);
}
async function stringCellsDimmed(page, idx) {
  return page.evaluate((i) => {
    const cells = [...document.querySelectorAll(`.fret-cell[data-string-index="${i}"]`)];
    return cells.every((c) => c.classList.contains("dimmed"));
  }, idx);
}
async function stringCellsNotDimmed(page, idx) {
  return page.evaluate((i) => {
    const cells = [...document.querySelectorAll(`.fret-cell[data-string-index="${i}"]`)];
    return cells.every((c) => !c.classList.contains("dimmed"));
  }, idx);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");

  // 1. 默认六弦全选中
  const allActive = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")].every((b) => b.classList.contains("active")));
  assert(allActive, "默认六弦按钮全部 active");

  // 2. 浏览模式不应用难度筛选：全部 150 格均不 dimmed
  let dim = await dimmedCount(page);
  assert(dim === 0, `浏览模式默认 dimmed=0（实际 ${dim}）`);

  // 3. 浏览模式：难度卡片 disabled，弦按钮不可点击
  const browseDisabled = await page.evaluate(() =>
    document.querySelector("#difficultyCard").classList.contains("disabled"));
  assert(browseDisabled, "浏览模式下难度卡片为 disabled");
  const pointerNone = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector("#stringButtons .string-btn"));
    return cs.pointerEvents === "none";
  });
  assert(pointerNone, "浏览模式下弦按钮 pointer-events:none（禁止点击）");

  // 4. 切到练习模式
  await page.click("#practiceModeTab");
  await page.waitForTimeout(400);
  const practiceEnabled = await page.evaluate(() =>
    !document.querySelector("#difficultyCard").classList.contains("disabled"));
  assert(practiceEnabled, "练习模式下难度卡片启用");

  // 4b. 练习模式全选 0-12 品：dimmed = 150 - 6*13 = 72
  dim = await dimmedCount(page);
  assert(dim === 72, `练习模式全选 0-12 时 dimmed=72（实际 ${dim}）`);

  // 5. 取消「三弦」
  await page.click('#stringButtons .string-btn[data-string="3"]');
  await page.waitForTimeout(300);
  const threeInactive = await page.evaluate(() =>
    !document.querySelector('#stringButtons .string-btn[data-string="3"]').classList.contains("active"));
  assert(threeInactive, "点击后三弦按钮变为 inactive");

  // 6. 三弦全部 dimmed；一弦在 0-12 品范围内未 dimmed（超出范围的格子仍灰化）
  assert(await stringCellsDimmed(page, 3), "三弦（stringIndex=3）全部 dimmed");
  const oneInRange = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.fret-cell[data-string-index="1"]')]
      .filter((c) => Number(c.dataset.fret) <= 12);
    return cells.length > 0 && cells.every((c) => !c.classList.contains("dimmed"));
  });
  assert(oneInRange, "一弦 0-12 品范围未 dimmed");
  // dimmed 数 = 150 - 5*13 = 85
  dim = await dimmedCount(page);
  assert(dim === 85, `取消三弦后 dimmed=85（实际 ${dim}）`);

  // 7. 组合取消「四弦」，一二弦保持，三四弦 dimmed
  await page.click('#stringButtons .string-btn[data-string="4"]');
  await page.waitForTimeout(300);
  assert(await stringCellsDimmed(page, 4), "四弦（stringIndex=4）全部 dimmed");
  dim = await dimmedCount(page);
  assert(dim === 98, `取消三四弦后 dimmed=98（实际 ${dim}）`);

  // 8. 至少保留一根弦：从当前状态逐步取消，直到只剩 1 根，最后一根点击无效
  while (true) {
    const active = await page.evaluate(() =>
      [...document.querySelectorAll("#stringButtons .string-btn")].filter((b) => b.classList.contains("active")).map((b) => b.dataset.string));
    if (active.length <= 1) break;
    await page.click(`#stringButtons .string-btn[data-string="${active[0]}"]`);
    await page.waitForTimeout(100);
  }
  const remaining = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")].filter((b) => b.classList.contains("active")).length);
  assert(remaining === 1, `逐步取消后仅剩1根 active（实际 ${remaining}）`);
  const last = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")].filter((b) => b.classList.contains("active"))[0].dataset.string);
  await page.click(`#stringButtons .string-btn[data-string="${last}"]`);
  await page.waitForTimeout(200);
  const stillOne = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")].filter((b) => b.classList.contains("active")).length);
  assert(stillOne === 1, "尝试取消最后一根弦被阻止，仍保留1根");

  // 9. 持久化：reload 后保留此时选择（仅剩 last 弦）
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");
  const persisted = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")].filter((b) => b.classList.contains("active")).length);
  assert(persisted === 1, `reload 后弦组选择持久化（剩 ${persisted} 根）`);

  // 10. 无 console / page 错误
  assert(errors.length === 0, `无运行时错误（${errors.length} 条）` + (errors.length ? " -> " + errors.join(" | ") : ""));

  await page.screenshot({ path: "tests/shot-string-group.png", fullPage: true });
  await browser.close();
  console.log("\nALL STRING-GROUP CHECKS PASSED");
})().catch((e) => { console.error("\n" + e.message); process.exit(1); });
