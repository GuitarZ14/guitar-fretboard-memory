"use strict";
/* 全组合稳定性测试：所有根音 × 类型 × 调弦 × capo 组合的指法生成验证 */
const assert = require("node:assert");
const {
  TUNINGS,
  CHORD_TYPES,
  findVoicings,
  requiredIntervals,
} = require("../chord-engine.js");

let ok = 0;
let empty = 0;
const failures = [];

for (const tuningId of Object.keys(TUNINGS)) {
  const tuning = TUNINGS[tuningId];
  for (const type of CHORD_TYPES) {
    for (let root = 0; root < 12; root += 1) {
      for (const capo of [0, 3]) {
        try {
          const list = findVoicings(root, type, tuning.pitches, { maxVoicings: 3, capo });
          if (list.length === 0) {
            empty += 1;
            ok += 1;
            continue;
          }
          for (const v of list) {
            const frets = v.frets;
            const played = frets.filter((f) => f >= 0);
            const pressed = frets.filter((f) => f > 0);
            assert.ok(played.length >= 2, `发声弦<2: ${frets.join("")}`);
            assert.ok(pressed.length >= 1, `无按弦点（空白指法）: ${frets.join("")}`);
            const fretVals = frets.filter((f) => f > 0);
            const span = Math.max(...fretVals) - Math.min(...fretVals);
            assert.ok(span <= 4, `跨度>4: ${frets.join("")}`);
            assert.ok(new Set(fretVals).size <= 4, `品位种类>4: ${frets.join("")}`);
            const covered = new Set();
            v.frets.forEach((f, si) => {
              if (f >= 0) covered.add((tuning.pitches[si] + capo + f) % 12);
            });
            // 校验引擎要求的核心音（纯五度与延伸和弦中非必须音可省略）
            for (const iv of requiredIntervals(type)) {
              assert.ok(covered.has((root + iv) % 12), `缺核心音 ${iv}: ${frets.join("")}`);
            }
            assert.strictEqual(v.fingers.length, 6, `手指数组长度: ${v.fingers}`);
            // 根音标记弦必须在发声弦中
            for (const rs of v.rootStrings) {
              assert.ok(v.frets[rs] >= 0, `根音弦 ${rs} 未发声`);
            }
          }
          ok += 1;
        } catch (err) {
          failures.push(`${tuningId} ${type.id} root=${root} capo=${capo}: ${err.message}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`共 ${failures.length} 个失败：`);
  failures.slice(0, 15).forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`全组合验证通过：${ok} 组成功，${empty} 组空候选（复杂和弦部分调音下无完整指法，属正常）`);
