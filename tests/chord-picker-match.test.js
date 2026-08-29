"use strict";
/* 验证按指板音查找的匹配逻辑：支持根音不在已选音中的和弦解释 */
const assert = require("node:assert");
const { CHORD_TYPES, noteName } = require("../chord-engine.js");

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

function findMatchingChords(pickedSet) {
  const matches = [];
  if (pickedSet.size === 0) return matches;
  const pickedArr = [...pickedSet];
  const comprehensive = pickedSet.size >= 3;
  const roots = comprehensive ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : pickedArr;
  for (const type of CHORD_TYPES) {
    const ivals = type.intervals.map((i) => mod12(i));
    for (const root of roots) {
      const chordSet = ivals.map((iv) => mod12(root + iv));
      if (!pickedArr.every((s) => chordSet.includes(s))) continue;
      const extra = chordSet.filter((s) => !pickedSet.has(s));
      const coveredDegrees = pickedArr
        .map((s) => ivals.indexOf(mod12(s - root)))
        .filter((idx) => idx >= 0);
      const degreeWeight = coveredDegrees.reduce((sum, idx) => sum + (ivals.length - idx), 0);
      matches.push({
        root,
        typeId: type.id,
        type,
        semis: chordSet,
        extraCount: extra.length,
        rootInPicked: pickedSet.has(root) ? 1 : 0,
        degreeWeight,
      });
    }
  }
  matches.sort((a, b) =>
    b.rootInPicked - a.rootInPicked ||
    a.extraCount - b.extraCount ||
    b.degreeWeight - a.degreeWeight ||
    a.type.intervals.length - b.type.intervals.length ||
    a.typeId.localeCompare(b.typeId)
  );
  return matches;
}

function symbolsFor(pickedSet, mode = "sharp") {
  return findMatchingChords(pickedSet).map((m) => noteName(m.root, mode) + m.type.suffix);
}

// 用例 1：已选音就是根音三音五音，应优先返回根音位置
const cMajorTriad = new Set([0, 4, 7]); // C E G
const cMatches = symbolsFor(cMajorTriad);
assert.ok(cMatches.indexOf("C") >= 0, "应找到 C 大三和弦");
assert.ok(cMatches.indexOf("Am7") >= 0, "应找到 Am7（C/E/G 作为 3/5/7 音）");
assert.ok(cMatches.indexOf("C") < cMatches.indexOf("Am7"), "C 应排在 Am7 之前");

// 用例 2：已选音为某 7 和弦的 3/5/b7，根音未选（E G Bb = C7 的 3/5/b7）
const c7WithoutRoot = new Set([4, 7, 10]); // E G Bb
const c7Matches = symbolsFor(c7WithoutRoot);
assert.ok(c7Matches.indexOf("C7") >= 0, "应找到 C7（根音 C 未选）");

// 用例 3： screenshot 中的 C D Gb，仍应找到 D7 家族
const screenshot = new Set([0, 2, 6]); // C D Gb
const dMatches = symbolsFor(screenshot);
assert.ok(dMatches.some((s) => s.startsWith("D7")), "仍应找到 D7 家族");

// 用例 4：单个音应返回包含它的和弦，但 3 音以上才更有意义
const singleC = new Set([0]);
const singleMatches = symbolsFor(singleC);
assert.ok(singleMatches.length > 0, "单个 C 应至少匹配一些和弦");

// 用例 5：斜线和弦解释：{C E G} 以 G 为低音时仍是 C/G，但搜索结果中应出现 C
assert.ok(cMatches.some((s) => s === "C"), "C/E/G 应可解释为 C（可转位为 C/G 等）");

console.log("按指板音查找匹配逻辑验证通过:");
console.log("  C E G 前 10:", symbolsFor(new Set([0, 4, 7])).slice(0, 10).join(", "));
console.log("  E G Bb:", symbolsFor(new Set([4, 7, 10])).slice(0, 10).join(", "));
console.log("  C D Gb 前 12:", symbolsFor(new Set([0, 2, 6])).slice(0, 12).join(", "));
