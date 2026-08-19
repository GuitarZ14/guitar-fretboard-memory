/* 和弦引擎算法验证 — 运行：node tests/chord-engine.test.js */
const assert = require("node:assert");
const {
  CHORD_TYPE_MAP,
  TUNINGS,
  findVoicings,
  fretboardPositions,
  chordSemitones,
  chordSymbol,
  noteName,
} = require("../chord-engine.js");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const standard = TUNINGS.standard.pitches;

/* 辅助：是否在候选指法中匹配某个品位模式 */
function hasShape(voicings, pattern) {
  return voicings.some((v) => v.frets.join(",") === pattern.join(","));
}

console.log("— 标准调弦经典指法 —");

// C 大调和弦（C=0）
const cMajor = findVoicings(0, CHORD_TYPE_MAP.major, standard, { maxVoicings: 6 });
check("C 大调 包含 x32010", () => {
  assert.ok(hasShape(cMajor, [-1, 3, 2, 0, 1, 0]), `候选: ${cMajor.map((v) => v.frets.join("")).join(" | ")}`);
});
check("C 大调 根音为 C(0)", () => {
  const v = cMajor[0];
  assert.ok(v.rootStrings.length > 0);
  assert.ok(v.frets.filter((f) => f >= 0).length >= 3, "至少 3 根弦发声");
});

// A 小三和弦（A=9）
const aMinor = findVoicings(9, CHORD_TYPE_MAP.minor, standard, { maxVoicings: 6 });
check("Am 包含 x02210", () => {
  assert.ok(hasShape(aMinor, [-1, 0, 2, 2, 1, 0]), `候选: ${aMinor.map((v) => v.frets.join("")).join(" | ")}`);
});

// F 大调和弦（F=5）—— 首推指法的低音弦必须是根音 F，且覆盖 F A C
const fMajor = findVoicings(5, CHORD_TYPE_MAP.major, standard, { maxVoicings: 6 });
check("F 大调 低音弦为根音 F 且覆盖 F A C", () => {
  assert.ok(fMajor.length > 0, "无候选");
  const v = fMajor[0];
  const lowest = v.frets.findIndex((f) => f >= 0);
  assert.ok(v.rootStrings.includes(lowest), `最低发声弦 ${lowest} 不是根音弦 ${v.rootStrings}`);
  const covered = new Set();
  v.frets.forEach((f, si) => {
    if (f >= 0) covered.add((standard[si] + f) % 12);
  });
  [5, 9, 0].forEach((p) => assert.ok(covered.has(p), `缺少构成音 ${p}`));
  assert.ok(v.frets.filter((f) => f >= 0).length >= 4, "发声弦少于 4 根");
});

// B 大调和弦（B=11）—— A 型横按 x24442 或 E 型 224442
const bMajor = findVoicings(11, CHORD_TYPE_MAP.major, standard, { maxVoicings: 8 });
check("B 大调 包含横按指法 x24442 / 224442", () => {
  assert.ok(
    hasShape(bMajor, [-1, 2, 4, 4, 4, 2]) || hasShape(bMajor, [2, 2, 4, 4, 4, 2]),
    `候选: ${bMajor.map((v) => v.frets.join("")).join(" | ")}`
  );
});

// E 大调和弦（E=4）—— 022100 经典开放
const eMajor = findVoicings(4, CHORD_TYPE_MAP.major, standard, { maxVoicings: 6 });
check("E 大调 包含 022100", () => {
  assert.ok(hasShape(eMajor, [0, 2, 2, 1, 0, 0]), `候选: ${eMajor.map((v) => v.frets.join("")).join(" | ")}`);
});

// G 大调和弦（G=7）—— 320003 经典
const gMajor = findVoicings(7, CHORD_TYPE_MAP.major, standard, { maxVoicings: 6 });
check("G 大调 包含 320003", () => {
  assert.ok(hasShape(gMajor, [3, 2, 0, 0, 0, 3]), `候选: ${gMajor.map((v) => v.frets.join("")).join(" | ")}`);
});

console.log("— 七和弦 / 挂留 —");

// C7（C=0）— 常见 x32310
const c7 = findVoicings(0, CHORD_TYPE_MAP["7"], standard, { maxVoicings: 8 });
check("C7 包含 x32310", () => {
  assert.ok(hasShape(c7, [-1, 3, 2, 3, 1, 0]), `候选: ${c7.map((v) => v.frets.join("")).join(" | ")}`);
});

// Am7 — x02010
const am7 = findVoicings(9, CHORD_TYPE_MAP.m7, standard, { maxVoicings: 8 });
check("Am7 包含 x02010", () => {
  assert.ok(hasShape(am7, [-1, 0, 2, 0, 1, 0]), `候选: ${am7.map((v) => v.frets.join("")).join(" | ")}`);
});

// Dsus2 — 至少 4 弦发声、覆盖 D E A、含根音标记
const dSus2 = findVoicings(2, CHORD_TYPE_MAP.sus2, standard, { maxVoicings: 6 });
check("Dsus2 指法覆盖 D E A 且至少 4 弦发声", () => {
  assert.ok(dSus2.length > 0, "无候选");
  const v = dSus2[0];
  const covered = new Set();
  v.frets.forEach((f, si) => {
    if (f >= 0) covered.add((standard[si] + f) % 12);
  });
  [2, 4, 9].forEach((p) => assert.ok(covered.has(p), `缺少构成音 ${p}`));
  assert.ok(v.frets.filter((f) => f >= 0).length >= 4, "发声弦少于 4 根");
  assert.ok(v.rootStrings.length > 0, "缺少根音标记");
});

// G7 — 320001（经典）或 323033（含 F 的合法变体）均可，且必须含 b7(F)
const g7 = findVoicings(7, CHORD_TYPE_MAP["7"], standard, { maxVoicings: 8 });
check("G7 包含经典指法 320001 / 323033", () => {
  assert.ok(
    hasShape(g7, [3, 2, 0, 0, 0, 1]) || hasShape(g7, [3, 2, 3, 0, 3, 3]),
    `候选: ${g7.map((v) => v.frets.join("")).join(" | ")}`
  );
});
check("G7 所有候选均含 b7(F)", () => {
  g7.forEach((v) => {
    const covered = new Set();
    v.frets.forEach((f, si) => {
      if (f >= 0) covered.add((standard[si] + f) % 12);
    });
    assert.ok(covered.has(5), `候选 ${v.frets.join("")} 缺少 b7(F)`);
  });
});

console.log("— 非标准调弦 —");

// Drop D 下 D 大调和弦（D=2）— 6 弦空弦 D 就是根音
const dropD = TUNINGS.dropD.pitches;
const dMajorDropD = findVoicings(2, CHORD_TYPE_MAP.major, dropD, { maxVoicings: 6 });
check("Drop D 下 D 大调 6 弦空弦为根音", () => {
  const v = dMajorDropD[0];
  assert.ok(v.frets[0] === 0 || v.frets[0] === -1, "6 弦空弦或闷弦（根音由空弦 D 提供）");
  assert.ok(v.rootStrings.includes(0), "6 弦是根音弦");
});

// DADGAD 下 D 大调——至少 3 弦发声且覆盖 D F# A
const dadgad = TUNINGS.dadgad.pitches;
const dMajorDADGAD = findVoicings(2, CHORD_TYPE_MAP.major, dadgad, { maxVoicings: 6 });
check("DADGAD 下 D 大调可生成指法", () => {
  assert.ok(dMajorDADGAD.length > 0, "无候选");
  const v = dMajorDADGAD[0];
  const covered = new Set();
  v.frets.forEach((f, si) => {
    if (f >= 0) covered.add((dadgad[si] + f) % 12);
  });
  [2, 6, 9].forEach((p) => assert.ok(covered.has(p), `缺少构成音 ${p}`));
});

console.log("— 理论数据 —");

check("C major 构成音 = C E G", () => {
  const semis = chordSemitones(0, CHORD_TYPE_MAP.major);
  assert.deepStrictEqual(semis.map((s) => noteName(s, "sharp")), ["C", "E", "G"]);
});

check("Db 记法下 Db7 构成音 = Db F Ab B", () => {
  const semis = chordSemitones(1, CHORD_TYPE_MAP["7"]);
  assert.deepStrictEqual(semis.map((s) => noteName(s, "flat")), ["Db", "F", "Ab", "B"]);
});

check("和弦符号生成", () => {
  assert.strictEqual(chordSymbol(0, CHORD_TYPE_MAP.major, "sharp"), "C");
  assert.strictEqual(chordSymbol(9, CHORD_TYPE_MAP.minor, "sharp"), "Am");
  assert.strictEqual(chordSymbol(9, CHORD_TYPE_MAP["7"], "sharp"), "A7");
  assert.strictEqual(chordSymbol(10, CHORD_TYPE_MAP.maj7, "flat"), "Bbmaj7");
  assert.strictEqual(chordSymbol(2, CHORD_TYPE_MAP["6/9"], "sharp"), "D6/9");
});

check("组成音标签统一为数字音级（maj7→7，m3→b3）", () => {
  assert.deepStrictEqual(CHORD_TYPE_MAP.maj7.labels, ["1", "3", "5", "7"]);
  assert.deepStrictEqual(CHORD_TYPE_MAP.maj9.labels, ["1", "3", "5", "7", "9"]);
  assert.deepStrictEqual(CHORD_TYPE_MAP.maj13.labels, ["1", "3", "5", "7", "9", "13"]);
  assert.deepStrictEqual(CHORD_TYPE_MAP.minor.labels, ["1", "b3", "5"]);
  assert.deepStrictEqual(CHORD_TYPE_MAP.m7.labels, ["1", "b3", "5", "b7"]);
  assert.deepStrictEqual(CHORD_TYPE_MAP["m(maj7)"].labels, ["1", "b3", "5", "7"]);
  // 验证没有遗留 maj7 / m3 符号混用
  const badLabels = [];
  Object.values(CHORD_TYPE_MAP).forEach((t) => {
    t.labels.forEach((l) => {
      if (l === "maj7" || l === "m3") badLabels.push(`${t.id}:${l}`);
    });
  });
  assert.deepStrictEqual(badLabels, []);
});

check("全指板位置覆盖与根音标记", () => {
  const pos = fretboardPositions(0, CHORD_TYPE_MAP.major, standard, { frets: 12 });
  const roots = pos.filter((p) => p.isRoot);
  assert.ok(pos.length > 0);
  assert.ok(roots.length >= 2, "前 12 品内根音至少 2 处");
  // 6 弦 8 品应为根音 C（E+8=C）
  assert.ok(pos.some((p) => p.si === 0 && p.fret === 8 && p.isRoot), "6 弦 8 品应为根音 C");
});

check("手指分配：x32010 → [0,3,2,0,1,0]", () => {
  const cMajorAgain = findVoicings(0, CHORD_TYPE_MAP.major, standard, { maxVoicings: 1 });
  const v = cMajorAgain[0];
  assert.deepStrictEqual(v.fingers, [0, 3, 2, 0, 1, 0], JSON.stringify(v.fingers));
});

check("手指分配：224442（E 型横按）→ 食指横按 + 4 品用 2/3/4", () => {
  const bMajorAgain = findVoicings(11, CHORD_TYPE_MAP.major, standard, { maxVoicings: 8 });
  const v =
    bMajorAgain.find((x) => x.frets.join(",") === "2,2,4,4,4,2") ||
    bMajorAgain.find((x) => x.frets.join(",") === "-1,2,4,4,4,2");
  assert.ok(v, "找不到横按指法");
  // 品位 2（横按）使用食指 1
  assert.strictEqual(v.fingers[v.frets.indexOf(2)], 1, JSON.stringify(v.fingers));
  // 品位 4 的三根弦用 2/3/4 指
  const f4 = [];
  v.frets.forEach((f, si) => {
    if (f === 4) f4.push(v.fingers[si]);
  });
  assert.ok(f4.length === 3 && f4.every((x) => [2, 3, 4].includes(x)), JSON.stringify(v.fingers));
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
