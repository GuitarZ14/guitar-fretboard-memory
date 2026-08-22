const { chromium } = require("playwright-core");

const URL = "http://127.0.0.1:8624/index.html";
const EXEC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");

  // 清空 localStorage 的弦组选择，确保从已知默认状态开始
  await page.evaluate(() => localStorage.removeItem("guitar-fretboard-strings"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#stringButtons .string-btn");

  // 进入点按模式
  await page.click("#practiceModeTab");
  await page.waitForTimeout(400);

  // 选中一、二、三弦（默认 6 弦已 active，先取消 6 弦，再选 1/2/3）
  await page.click('#stringButtons .string-btn[data-string="6"]'); // 取消默认 6 弦
  await page.click('#stringButtons .string-btn[data-string="1"]');
  await page.click('#stringButtons .string-btn[data-string="2"]');
  await page.click('#stringButtons .string-btn[data-string="3"]');
  await page.waitForTimeout(400);

  const selected = await page.evaluate(() =>
    [...document.querySelectorAll("#stringButtons .string-btn.active")].map((b) => b.dataset.string).sort());
  assert(JSON.stringify(selected) === JSON.stringify(["1", "2", "3"]), `已选中一/二/三弦（实际 ${selected.join(",")}）`);

  // 读取当前题的目标弦集合与提示词
  const info = await page.evaluate(() => ({
    selected: state.practice.strings.slice().sort(),
    target: [...state.practice.targetStrings].sort(),
    targetCount: state.practice.targetStrings.size,
    status: document.querySelector("#answerStatus")?.textContent || "",
    note: state.note.display,
  }));
  console.log(`  当前题音名=${info.note} 选中弦=${info.selected.join("/")} 目标弦=${info.target.join("/")} 提示词="${info.status}"`);

  // 关键断言 1：提示词的「需找 N 根弦」必须与选中弦数一致（本例为 3）
  assert(info.targetCount === 3, `目标弦数=3（与勾选一致，实际 ${info.targetCount}）`);
  assert(info.target.join("/") === "1/2/3", `目标弦集合等于勾选弦组（实际 ${info.target.join("/")}）`);
  assert(info.status.includes("需找 3 根弦"), `提示词包含「需找 3 根弦」（实际 "${info.status}"）`);

  // 找到目标音在当前三弦上的所有可点格子
  const targetCells = await page.evaluate(() => {
    const note = state.note;
    const targets = [...state.practice.targetStrings];
    const cells = [];
    document.querySelectorAll(".fret-cell").forEach((c) => {
      if (c.dataset.pitch === note.pitch && targets.includes(Number(c.dataset.stringIndex))) {
        cells.push({ stringIndex: Number(c.dataset.stringIndex), fret: Number(c.dataset.fret) });
      }
    });
    // 每根弦取一个代表格（按品序最小）
    const byStr = {};
    cells.forEach((c) => { if (!byStr[c.stringIndex] || c.fret < byStr[c.stringIndex].fret) byStr[c.stringIndex] = c; });
    return Object.values(byStr).map((c) => ({ s: c.stringIndex, f: c.fret }));
  });
  assert(targetCells.length === 3, `三弦各有可点目标格（实际 ${targetCells.length}）`);

  // 关键断言 2：只点两根弦时，不应进入下一题（phase 仍为 pending，且进度未 +1）
  const beforeCompleted = await page.evaluate(() => state.practice.completed);
  // 用真实单元格直接触发 onCellClick（规避委托监听的去抖/坐标命中不稳定，专注验证计数与判定逻辑）
  const clickCell = (c) => page.evaluate(({ s, f }) => {
    const cell = document.querySelector(`.fret-cell[data-string-index="${s}"][data-fret="${f}"]`);
    onCellClick(cell);
  }, c);
  for (let i = 0; i < 2; i += 1) {
    const c = targetCells[i];
    await clickCell(c);
    await page.waitForTimeout(120);
    const dbg = await page.evaluate(() => ({ found: state.practice.foundStrings.size, phase: state.practice.phase, status: document.querySelector("#answerStatus")?.textContent.trim() }));
    console.log(`    点击第 ${i + 1} 弦(s=${c.s} f=${c.f}) 后 found=${dbg.found} phase=${dbg.phase} 提示="${dbg.status}"`);
  }
  const afterTwo = await page.evaluate(() => ({
    phase: state.practice.phase,
    completed: state.practice.completed,
    found: state.practice.foundStrings.size,
    status: document.querySelector("#answerStatus")?.textContent || "",
  }));
  console.log(`  点两根后 phase=${afterTwo.phase} found=${afterTwo.found} completed=${afterTwo.completed} 提示="${afterTwo.status}"`);
  assert(afterTwo.phase === "pending", `只点 2 根弦时仍为 pending（不应跳下一题，实际 ${afterTwo.phase}）`);
  assert(afterTwo.completed === beforeCompleted, `只点 2 根弦时已完成数不变（实际 ${afterTwo.completed} vs ${beforeCompleted}）`);

  // 关键断言 3：点齐第三根弦后，才进入 done 并触发下一题
  const third = targetCells[2];
  await clickCell(third);
  await page.waitForTimeout(200);
  const afterThree = await page.evaluate(() => ({ phase: state.practice.phase, found: state.practice.foundStrings.size }));
  console.log(`  点满三弦后 phase=${afterThree.phase} found=${afterThree.found}`);
  assert(afterThree.phase === "done", `点齐 3 根弦后 phase=done（实际 ${afterThree.phase}）`);
  assert(afterThree.found === 3, `点齐后 found=3（实际 ${afterThree.found}）`);

  // 等待自动跳题（1500ms）后，新题仍应保持三弦全选且提示一致
  await page.waitForTimeout(1800);
  const nextInfo = await page.evaluate(() => ({
    target: [...state.practice.targetStrings].sort(),
    targetCount: state.practice.targetStrings.size,
    status: document.querySelector("#answerStatus")?.textContent || "",
  }));
  assert(nextInfo.targetCount === 3, `跳题后新题目标弦数仍为 3（实际 ${nextInfo.targetCount}）`);
  assert(nextInfo.status.includes("需找 3 根弦"), `跳题后提示词仍为「需找 3 根弦」（实际 "${nextInfo.status}"）`);

  // 无运行时错误
  assert(errors.length === 0, `无运行时错误（${errors.length} 条）` + (errors.length ? " -> " + errors.join(" | ") : ""));

  await browser.close();
  console.log("\nALL PRACTICE STRING-COUNT CHECKS PASSED");
})().catch((e) => { console.error("\n" + e.message); process.exit(1); });
