"use strict";
/* 渲染层端到端核查
 * 用真实的 buildVoicingSVG（从 chord-app.js 提取）对每个指法生成 SVG，
 * 统计 <circle> 数量。数据层已保证 ≥1 按弦点，若渲染层画不出圆点则为渲染 bug。
 * 覆盖：根音(0-11) × 全部和弦类型 × 全部调音 × capo[0,3,5]
 */

const fs = require("fs");
const path = require("path");

const engine = require("../chord-engine.js");
const {
  TUNINGS,
  CHORD_TYPES,
  extendedVoicings,
  noteName,
} = engine;

// 提取 buildVoicingSVG 源码
const appSrc = fs.readFileSync(path.join(__dirname, "..", "chord-app.js"), "utf8");
const m = appSrc.match(/function buildVoicingSVG\([\s\S]*?\n\}\n/);
if (!m) throw new Error("找不到 buildVoicingSVG");
const fnSrc = m[0];

// 桩：渲染所需的全局
const state = { handed: "right", accidental: "sharp" };
const DIAGRAM_COLORS = {
  line: "rgba(120,120,140,0.4)",
  nut: "#8a8aa0",
  root: "#4f8fb0",
  tone: "#f5a69c",
};

// 在沙箱里定义函数
// eslint-disable-next-line no-new-func
const buildVoicingSVG = new Function(
  "v",
  "type",
  "tuning",
  "state",
  "DIAGRAM_COLORS",
  "noteName",
  fnSrc + "\nreturn buildVoicingSVG(v, type, tuning);"
);

function countCircles(svg) {
  const matches = svg.match(/<circle/g);
  return matches ? matches.length : 0;
}

const capos = [0, 3, 5];
let total = 0;
let blankRender = 0;
const reports = [];

for (const tuningId of Object.keys(TUNINGS)) {
  const tuning = TUNINGS[tuningId];
  for (const type of CHORD_TYPES) {
    for (let root = 0; root < 12; root += 1) {
      for (const capo of capos) {
        const groups = extendedVoicings(type.id, root, tuning.pitches, { capo });
        for (const groupName of ["must", "open", "moveable", "capo"]) {
          for (const v of groups[groupName] || []) {
            total += 1;
            const svg = buildVoicingSVG(v, type, tuning, state, DIAGRAM_COLORS, noteName);
            const n = countCircles(svg);
            // 渲染层空白：没有画出任何按弦圆点
            if (n === 0) {
              blankRender += 1;
              reports.push({
                tuning: tuningId,
                type: type.id,
                root,
                capo,
                group: groupName,
                frets: v.frets,
                baseFret: v.baseFret,
                rootStrings: v.rootStrings,
                source: v.source,
              });
            }
          }
        }
      }
    }
  }
}

console.log(`渲染指法总数 ${total} 个，渲染空白(0 圆点) ${blankRender} 个`);
if (blankRender > 0) {
  console.log("\n渲染空白列表（前 50）：");
  reports.slice(0, 50).forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.tuning} ${r.type} root=${r.root} capo=${r.capo} [${r.group}] ` +
      `frets=[${r.frets.join(",")}] base=${r.baseFret} roots=[${(r.rootStrings || []).join(",")}] src=${r.source}`
    );
  });
  if (reports.length > 50) console.log(`... 还有 ${reports.length - 50} 个`);
  process.exit(1);
}
console.log("✓ 渲染层未发现空白指法（每个指板均画出按弦圆点）");
