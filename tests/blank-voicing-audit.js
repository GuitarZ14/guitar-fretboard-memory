"use strict";
/* 全面筛查空白/无效指法
 * 遍历：根音 × 和弦类型 × 调音 × capo（0,3,5）
 * 检查 extendedVoicings 返回的 must/open/moveable/capo 各组
 * 输出所有"空白"指法：发声弦<2、无按弦点（全空弦/闷弦）、无根音标记
 */

const {
  TUNINGS,
  CHORD_TYPES,
  extendedVoicings,
} = require("../chord-engine.js");

function isBlank(v) {
  const played = v.frets.filter((f) => f >= 0);
  const pressed = v.frets.filter((f) => f > 0);
  if (played.length < 2) return true;
  if (pressed.length === 0) return true;
  if (!v.rootStrings || v.rootStrings.length === 0) return true;
  return false;
}

const capos = [0, 3, 5];
let total = 0;
let blankCount = 0;
const reports = [];

for (const tuningId of Object.keys(TUNINGS)) {
  const tuning = TUNINGS[tuningId];
  for (const type of CHORD_TYPES) {
    for (let root = 0; root < 12; root += 1) {
      for (const capo of capos) {
        const groups = extendedVoicings(type.id, root, tuning.pitches, { capo });
        for (const groupName of ["must", "open", "moveable", "capo"]) {
          const list = groups[groupName] || [];
          for (const v of list) {
            total += 1;
            if (isBlank(v)) {
              blankCount += 1;
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

console.log(`总指法 ${total} 个，空白 ${blankCount} 个`);
if (blankCount > 0) {
  console.log("\n空白指法列表（前 50）：");
  reports.slice(0, 50).forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.tuning} ${r.type} root=${r.root} capo=${r.capo} [${r.group}] ` +
      `frets=[${r.frets.join(",")}] base=${r.baseFret} roots=[${(r.rootStrings || []).join(",")}] src=${r.source}`
    );
  });
  if (reports.length > 50) console.log(`... 还有 ${reports.length - 50} 个`);
  process.exit(1);
}
console.log("✓ 未发现空白指法");
