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
async function activeStrings(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn")]
      .filter((b) => b.classList.contains("active"))
      .map((b) => b.dataset.string)
      .sort());
}
async function stringInRangeNotDimmed(page, idx, maxFret) {
  return page.evaluate(({ i, max }) => {
    const cells = [...document.querySelectorAll(`.fret-cell[data-string-index="${i}"]`)]
      .filter((c) => Number(c.dataset.fret) <= max);
    return cells.length > 0 && cells.every((c) => !c.classList.contains("dimmed"));
  }, { i: idx, max: maxFret });
}
async function inRangeCells(page, idx, maxFret) {
  return page.evaluate(({ i, max }) => {
    const inRange = [...document.querySelectorAll(`.fret-cell[data-string-index="${i}"]`)]
      .filter((c) => Number(c.dataset.fret) <= max);
    const outRange = [...document.querySelectorAll(`.fret-cell[data-string-index="${i}"]`)]
      .filter((c) => Number(c.dataset.fret) > max);
    return {
      inAll: inRange.length > 0 && inRange.every((c) => c.classList.contains("in-range")),
      outNone: outRange.length > 0 && outRange.every((c) => !c.classList.contains("in-range")),
    };
  }, { i: idx, max: maxFret });
}
async function inRangeCount(page) {
  return page.evaluate(() => document.querySelectorAll(".fret-cell.in-range").length);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");

  // 1. 默认仅点亮 6 弦（低音 E 弦，便于进入点按模式即可直接点按）
  const defaultActive = await activeStrings(page);
  assert(JSON.stringify(defaultActive) === JSON.stringify(["6"]), `默认仅 6 弦 active（实际 ${defaultActive.join(",")}）`);

  // 2. 核对模式不应用难度筛选：全部 150 格均不 dimmed
  let dim = await dimmedCount(page);
  assert(dim === 0, `核对模式默认 dimmed=0（实际 ${dim}）`);

  // 3. 核对模式：难度卡片 disabled，弦按钮不可点击
  const browseDisabled = await page.evaluate(() =>
    document.querySelector("#difficultyCard").classList.contains("disabled"));
  assert(browseDisabled, "核对模式下难度卡片为 disabled");
  const pointerNone = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector("#stringButtons .string-btn"));
    return cs.pointerEvents === "none";
  });
  assert(pointerNone, "核对模式下弦按钮 pointer-events:none（禁止点击）");

  // 4. 切到点按模式：默认保留 6 弦，0-12 品未 dimmed；dim = 150 - 13 = 137
  await page.click("#practiceModeTab");
  await page.waitForTimeout(400);
  const practiceEnabled = await page.evaluate(() =>
    !document.querySelector("#difficultyCard").classList.contains("disabled"));
  assert(practiceEnabled, "点按模式下难度卡片启用");
  assert(JSON.stringify(await activeStrings(page)) === JSON.stringify(["6"]), "点按模式初始保留默认 6 弦");
  dim = await dimmedCount(page);
  assert(dim === 137, `点按模式默认 6 弦 dimmed=137（实际 ${dim}）`);

  // 5. 追加「一弦」→ 一、六弦 active；dim = 150 - 2*13 = 124
  await page.click('#stringButtons .string-btn[data-string="1"]');
  await page.waitForTimeout(300);
  assert(JSON.stringify(await activeStrings(page)) === JSON.stringify(["1", "6"]), "追加一弦后一、六弦 active");
  dim = await dimmedCount(page);
  assert(dim === 124, `选一、六弦后 dimmed=124（实际 ${dim}）`);

  // 6. 取消「六弦」→ 仅一弦 active；验证 in-range 高亮
  await page.click('#stringButtons .string-btn[data-string="6"]');
  await page.waitForTimeout(300);
  assert(JSON.stringify(await activeStrings(page)) === JSON.stringify(["1"]), "取消六弦后仅一弦 active");
  assert(await stringInRangeNotDimmed(page, 1, 12), "一弦 0-12 品范围未 dimmed");
  dim = await dimmedCount(page);
  assert(dim === 137, `仅一弦 active 时 dimmed=137（实际 ${dim}）`);
  const ir = await inRangeCells(page, 1, 12);
  assert(ir.inAll, "点按模式：选定弦 0-12 品范围内均带 in-range 高亮类");
  assert(ir.outNone, "点按模式：选定弦 12 品之外的格子不带 in-range 类");
  const irCount = await inRangeCount(page);
  assert(irCount === 13, `点按模式选一弦后 in-range 高亮数=13（实际 ${irCount}）`);
  const irStyle = await page.evaluate(() => {
    const c = document.querySelector(".fret-cell.in-range");
    if (!c) return { bg: "none", shadow: "none" };
    const cs = getComputedStyle(c);
    return { bg: cs.backgroundImage, shadow: cs.boxShadow };
  });
  assert(irStyle.bg.includes("gradient"), "in-range 单元格应用渐变高亮背景填充（非透明）");
  assert(irStyle.shadow !== "none", "in-range 单元格带描边/外发光阴影（与 dimmed 形成强对比）");

  // 7. 多选「二弦」→ 一、二弦 active；dim = 150 - 2*13 = 124
  await page.click('#stringButtons .string-btn[data-string="2"]');
  await page.waitForTimeout(300);
  assert(JSON.stringify(await activeStrings(page)) === JSON.stringify(["1", "2"]), "多选后一、二弦均 active");
  dim = await dimmedCount(page);
  assert(dim === 124, `选一、二弦后 dimmed=124（实际 ${dim}）`);

  // 8. 取消「一弦」→ 仅二弦 active；dim = 150 - 13 = 137
  await page.click('#stringButtons .string-btn[data-string="1"]');
  await page.waitForTimeout(300);
  assert(JSON.stringify(await activeStrings(page)) === JSON.stringify(["2"]), "取消一弦后仅二弦 active");
  dim = await dimmedCount(page);
  assert(dim === 137, `取消一弦后 dimmed=137（实际 ${dim}）`);

  // 9. 自由切换允许回到空集：取消最后一根 → 0 根；再次点击 → 1 根
  await page.click('#stringButtons .string-btn[data-string="2"]');
  await page.waitForTimeout(300);
  assert((await activeStrings(page)).length === 0, "取消最后一根弦后被允许为空（0 根）");
  dim = await dimmedCount(page);
  assert(dim === 150, `空集时 dimmed=150（实际 ${dim}）`);
  await page.click('#stringButtons .string-btn[data-string="2"]');
  await page.waitForTimeout(300);
  assert((await activeStrings(page)).length === 1, "空集下再次点击可重新选中（1 根）");

  // 10. 持久化子集：选中弦 2 后 reload，保留 1 根
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");
  const persisted = await activeStrings(page);
  assert(persisted.length === 1 && persisted[0] === "2", `reload 后弦组选择持久化（剩 ${persisted.join(",")}）`);

  // 11. 无 console / page 错误
  assert(errors.length === 0, `无运行时错误（${errors.length} 条）` + (errors.length ? " -> " + errors.join(" | ") : ""));

  await page.screenshot({ path: "tests/shot-string-group.png", fullPage: true });
  await browser.close();
  console.log("\nALL STRING-GROUP CHECKS PASSED");
})().catch((e) => { console.error("\n" + e.message); process.exit(1); });
