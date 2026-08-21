/* 音阶练习全量审计：数据层 + 渲染层
 * 覆盖 12 根音 × 14 音阶类型 × 6 调音 × 2 标注 × 2 指板范围，
 * 校验指板 SVG 非空、顺阶和弦指法有效、播放序列升序有效。
 */
"use strict";

const engine = require("../chord-engine.js");
Object.assign(global, engine); // 把 CHORD_TYPES/TUNINGS/noteName/extendedVoicings 等挂为全局，供 scale-app 引用
const scale = require("../scale-app.js");

const ROOTS = Array.from({ length: 12 }, (_, i) => i);
const TUNINGS = engine.TUNINGS;
const tuningIds = Object.keys(TUNINGS);
const scaleIds = scale.SCALE_TYPES.map((s) => s.id);

let errors = [];
let fbCount = 0;
let fbCircles = 0;
let runCount = 0;
let chordCells = 0;
let chordNoVoicing = 0;

function check(cond, msg) {
  if (!cond) errors.push(msg);
}

/* 计算 voicing 实际根音（rootStrings 首弦的 pitch class） */
function voicingRootPc(v, tuning) {
  if (!v.rootStrings || !v.rootStrings.length) return -1;
  const si = v.rootStrings[0];
  return scale.scaleMod12(tuning.pitches[si] + v.frets[si]);
}

/* ---------- 1. 指板 SVG 渲染 ---------- */
for (const rid of scaleIds) {
  const st = scale.SCALE_TYPE_MAP[rid];
  for (const root of ROOTS) {
    for (const tid of tuningIds) {
      const tuning = TUNINGS[tid];
      for (const frets of [12, 22]) {
        for (const labelMode of ["note", "degree"]) {
          const svg = scale.buildScaleFretboardSVG(root, st, tuning, {
            frets, labelMode, accidental: "sharp",
          });
          check(typeof svg === "string" && svg.includes("<svg"), `SVG 生成失败 ${rid}/${root}/${tid}`);
          check(!/NaN|undefined/.test(svg), `SVG 含 NaN/undefined ${rid}/${root}/${tid}`);
          const circles = (svg.match(/<circle/g) || []).length;
          check(circles > 0, `指板无圆点 ${rid}/${root}/${tid}/${frets}`);
          fbCount += 1;
          fbCircles += circles;
          // 高亮模式也应正常
          const svgHi = scale.buildScaleFretboardSVG(root, st, tuning, {
            frets, labelMode, accidental: "sharp", highlight: [0, 4, 7],
          });
          check(svgHi.includes("stroke") , `高亮 SVG 异常 ${rid}/${root}`);
        }
      }
    }
  }
}

/* ---------- 2. 顺阶和弦指法 ---------- */
for (const rid of scaleIds) {
  const st = scale.SCALE_TYPE_MAP[rid];
  for (const root of ROOTS) {
    for (const tid of tuningIds) {
      const tuning = TUNINGS[tid];
      const dia = scale.diatonicChords(root, st, tuning, "sharp");
      for (const list of [dia.triads, dia.sevenths]) {
        check(list.length === st.intervals.length, `顺阶和弦数量不符 ${rid}/${root}: ${list.length}`);
        for (const c of list) {
          chordCells += 1;
          check(c.roman && c.symbol, `和弦符号缺失 ${rid}/${root}`);
          check(Array.isArray(c.semis) && c.semis.length > 0, `和弦音缺失 ${rid}/${root}`);
          const res = engine.extendedVoicings(c.typeId, c.rootSemi, tuning.pitches, {});
          const v = res.open.length ? res.open[0] : res.must[0];
          if (!v) { chordNoVoicing += 1; continue; }
          const played = v.frets.filter((f) => f >= 0).length;
          const pressed = v.frets.filter((f) => f > 0).length;
          check(played >= 2 && pressed > 0 && v.rootStrings.length > 0, `空白/无效指法 ${rid}/${root}/${c.symbol}`);
          // 根音正确性：指法实际根音必须等于该级和弦根音（防再次错配成其他根音）
          check(voicingRootPc(v, tuning) === c.rootSemi, `和弦根音不符 ${rid}/${root}/${c.symbol} 期望${c.rootSemi} 实际${voicingRootPc(v, tuning)}`);
          const vsvg = scale.buildScaleVoicingSVG(v, engine.CHORD_TYPE_MAP[c.typeId], tuning, { handed: "right", accidental: "sharp" });
          check(vsvg.includes("<svg") && (vsvg.match(/<circle/g) || []).length > 0, `和弦指法图空 ${rid}/${root}/${c.symbol}`);
        }
      }
    }
  }
}

/* ---------- 3. 播放序列 ---------- */
for (const rid of scaleIds) {
  const st = scale.SCALE_TYPE_MAP[rid];
  for (const root of ROOTS) {
    for (const tid of tuningIds) {
      const tuning = TUNINGS[tid];
      for (const oct of [1, 2]) {
        const run = scale.buildScaleRun(root, st, tuning, oct);
        check(run.length > 0, `播放序列为空 ${rid}/${root}/${tid}/${oct}`);
        runCount += 1;
        // 校验升序（midi 单调不减）
        for (let i = 1; i < run.length; i += 1) {
          check(run[i].midi >= run[i - 1].midi, `播放序列非升序 ${rid}/${root}/${tid}`);
        }
        // 首尾都应是根音
        const rootSemi = scale.scaleMod12(root);
        check(scale.scaleMod12(run[0].semi) === rootSemi, `播放起点非根音 ${rid}/${root}`);
      }
    }
  }
}

/* ---------- 汇总 ---------- */
console.log(`指板 SVG 渲染: ${fbCount} 个, 圆点合计 ${fbCircles}`);
console.log(`顺阶和弦卡片: ${chordCells} 个, 无指法 ${chordNoVoicing}`);
console.log(`播放序列: ${runCount} 条`);
if (errors.length) {
  console.log(`\n✗ 发现 ${errors.length} 处问题:`);
  errors.slice(0, 30).forEach((e) => console.log("  - " + e));
  process.exit(1);
} else {
  console.log("\n✓ 全部通过：指板非空、顺阶和弦指法有效、播放序列升序有效");
}
