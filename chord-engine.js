/* chord-engine.js — 和弦速查：音乐理论数据与指法搜索算法（纯函数，无 DOM）
 *
 * 约定：
 *  - 音高一律用半音值表示（C=0, C#/Db=1 … B=11），循环取模 12。
 *  - 弦序约定：索引 0 = 6 弦（最低音），索引 5 = 1 弦（最高音）。
 *  - 品位 -1 表示闷弦（不发声），0 表示空弦，>=1 表示按弦品位。
 *
 * 可在浏览器与 Node（module.exports）中共同使用。
 *
 * 和弦类型系统完全对齐 oolimo.com：
 *  - 符号：^（大三/属七）、°（减）、maj7 / m7b5 / 6/9 / 7b9b13 / 7#11 / alt 等
 *  - 分组：Triads / Four tone / Extended / Altered / m(maj) / Power / Add-Sus
 *  - 音程：半音数表，按 oolimo 表格精确对照
 */

"use strict";

/* ---------- 音名表 ---------- */
const PITCH_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/* ---------- 调弦定义（半音值；索引 0=6 弦 … 5=1 弦） ---------- */
const TUNINGS = {
  standard: { cn: "标准调弦", pitches: [4, 9, 2, 7, 11, 4], desc: "E A D G B E，最常用的标准定弦。" },
  dropD: { cn: "Drop D", pitches: [2, 9, 2, 7, 11, 4], desc: "D A D G B E，6 弦降全音，摇滚 / 金属常用。" },
  dadgad: { cn: "DADGAD", pitches: [2, 9, 2, 7, 9, 2], desc: "D A D G A D，凯尔特民谣与指弹常用。" },
  openG: { cn: "Open G", pitches: [2, 7, 2, 7, 11, 2], desc: "D G D G B D，滑棒与开放调弦常用。" },
  openD: { cn: "Open D", pitches: [2, 9, 2, 6, 9, 2], desc: "D A D F♯ A D，滑棒与指弹常用。" },
  eb: { cn: "半音降调", pitches: [3, 8, 1, 6, 10, 3], desc: "E♭ A♭ D♭ G♭ B♭ E♭，整琴降半音。" },
};

/* ---------- 和弦类型分组（用于 UI 分组渲染） ---------- */
const TYPE_GROUPS = [
  { key: "triad", cn: "三和弦" },
  { key: "fourth", cn: "四音和弦" },
  { key: "extended", cn: "延伸和弦" },
  { key: "altered", cn: "变化属七" },
  { key: "mmaj", cn: "小大和弦" },
  { key: "power", cn: "强力和弦" },
  { key: "addsus", cn: "加音 / 挂留" },
];

/* ---------- 和弦类型（完全对齐 oolimo 命名与音程）---------- */
const CHORD_TYPES = [
  /* === Triads（三和弦）=== */
  {
    id: "major", group: "triad", suffix: "", cn: "大三和弦",
    intervals: [0, 4, 7], labels: ["1", "3", "5"],
    aliases: ["M"],
    desc: "最基础的和弦，明亮、稳定、开朗。由根音、大三度与纯五度构成，是绝大多数流行、民谣歌曲的和声底色。",
  },
  {
    id: "minor", group: "triad", suffix: "m", cn: "小三和弦",
    intervals: [0, 3, 7], labels: ["1", "b3", "5"],
    aliases: ["-", "MI", "min"],
    desc: "在三和弦基础上把三度音降低半音，音色柔和、忧郁、安静，常用于抒情与伤感色彩的段落。",
  },
  {
    id: "aug", group: "triad", suffix: "aug", cn: "增三和弦",
    intervals: [0, 4, 8], labels: ["1", "3", "#5"],
    aliases: ["+", "5+", "+5"],
    desc: "五度音升高半音，听感漂浮、神秘、略显奇异，常见于爵士与电影配乐中制造梦幻色彩。",
  },
  {
    id: "dim", group: "triad", suffix: "dim", cn: "减三和弦",
    intervals: [0, 3, 6], labels: ["1", "b3", "b5"],
    aliases: ["°"],
    desc: "三度与五度同时降低，充满紧张、阴郁与不协和感，常作为经过性与过渡性和弦使用。",
  },
  {
    id: "sus2", group: "triad", suffix: "sus2", cn: "挂二和弦",
    intervals: [0, 2, 7], labels: ["1", "2", "5"],
    desc: "用大二度音替换三度音，和弦没有大小调倾向，听感空灵、开放，常用于营造悬置的氛围。",
  },
  {
    id: "sus4", group: "triad", suffix: "sus", cn: "挂四和弦",
    intervals: [0, 5, 7], labels: ["1", "4", "5"],
    aliases: ["sus4"],
    desc: "用纯四度音替换三度音，产生悬而未决的张力，常解决到大三和弦，是摇滚与流行中的高频音色。",
  },
  {
    id: "sus4#5", group: "triad", suffix: "sus4#5", cn: "挂四升五和弦",
    intervals: [0, 5, 8], labels: ["1", "4", "#5"],
    aliases: ["sus4sharp5"],
    desc: "挂四和弦同时升高五度，形成 4 度与 #5 度并存的增四度张力，听感神秘，常出现在爵士与前卫摇滚中。",
  },

  /* === Four tone（四音和弦）=== */
  {
    id: "maj7", group: "fourth", suffix: "maj7", cn: "大七和弦",
    intervals: [0, 4, 7, 11], labels: ["1", "3", "5", "7"],
    aliases: ["Δ7", "j7", "M7", "MA7"],
    desc: "大调三和弦叠加大七度，色彩明亮又略带梦幻，是爵士、Funk 与现代 R&B 的标志性音响。",
  },
  {
    id: "7", group: "fourth", suffix: "7", cn: "属七和弦",
    intervals: [0, 4, 7, 10], labels: ["1", "3", "5", "b7"],
    aliases: ["dom7", "V7"],
    desc: "大调三和弦叠加小七度，带有强烈的推进感和蓝调味道，是蓝调、爵士与流行中最常出现的七和弦。",
  },
  {
    id: "m7", group: "fourth", suffix: "m7", cn: "小七和弦",
    intervals: [0, 3, 7, 10], labels: ["1", "b3", "5", "b7"],
    aliases: ["-7", "MI7", "min7"],
    desc: "小调三和弦叠加小七度，柔和松弛、没有压迫感，常用于 ii–V–I 进行与爵士 Funk。",
  },
  {
    id: "m7b5", group: "fourth", suffix: "m7b5", cn: "半减七和弦",
    intervals: [0, 3, 6, 10], labels: ["1", "b3", "b5", "b7"],
    aliases: ["ø", "∅"],
    desc: "在小七和弦基础下降五度，暗淡而紧张，是自然小调 ii 级与爵士 ii–V–I 中的常客。",
  },
  {
    id: "dim7", group: "fourth", suffix: "dim7", cn: "减七和弦",
    intervals: [0, 3, 6, 9], labels: ["1", "b3", "b5", "bb7"],
    aliases: ["°7"],
    desc: "四个音相距都是小三度，结构完全对称，紧张感极强，常用来做经过连接或转向离调和弦。",
  },
  {
    id: "6", group: "fourth", suffix: "6", cn: "大六和弦",
    intervals: [0, 4, 7, 9], labels: ["1", "3", "5", "6"],
    desc: "大调三和弦叠加大六度，温暖复古，是 60 年代流行与乡村音乐的代表性音色。",
  },
  {
    id: "m6", group: "fourth", suffix: "m6", cn: "小六和弦",
    intervals: [0, 3, 7, 9], labels: ["1", "b3", "5", "6"],
    aliases: ["-6"],
    desc: "小调三和弦叠加大六度，温柔中带一丝紧张，常见于爵士与拉丁风格的伴奏。",
  },

  /* === Extended（延伸和弦）=== */
  {
    id: "add9", group: "extended", suffix: "add9", cn: "加九和弦",
    intervals: [0, 4, 7, 14], labels: ["1", "3", "5", "9"],
    aliases: ["(add9)"],
    desc: "大调三和弦直接叠加九度音，不改变三和弦性格，音色清亮、晶莹，常用于 R&B 与指弹。",
  },
  {
    id: "9", group: "extended", suffix: "9", cn: "属九和弦",
    intervals: [0, 4, 7, 10, 14], labels: ["1", "3", "5", "b7", "9"],
    aliases: ["7(9)"],
    desc: "属七和弦叠加九度音，比属七更丰富饱满，是爵士乐中出现频率最高的和弦之一。",
  },
  {
    id: "maj9", group: "extended", suffix: "maj9", cn: "大九和弦",
    intervals: [0, 4, 7, 11, 14], labels: ["1", "3", "5", "7", "9"],
    aliases: ["Δ9", "j9", "M9", "MA9"],
    desc: "大七和弦叠加九度音，梦幻而华丽，是现代爵士与 Neo-Soul 的高频音色。",
  },
  {
    id: "m9", group: "extended", suffix: "m9", cn: "小九和弦",
    intervals: [0, 3, 7, 10, 14], labels: ["1", "b3", "5", "b7", "9"],
    aliases: ["-9"],
    desc: "小七和弦叠加九度音，柔和而富有爵士质感，常在小调 ii–V–I 中使用。",
  },
  {
    id: "6/9", group: "extended", suffix: "6/9", cn: "六九和弦",
    intervals: [0, 4, 7, 9, 14], labels: ["1", "3", "5", "6", "9"],
    desc: "在六和弦基础上去掉七度并叠加九度，明亮、开放、无压迫感，是 R&B 与放克的和声底色。",
  },
  {
    id: "m11", group: "extended", suffix: "m11", cn: "小十一和弦",
    intervals: [0, 3, 7, 10, 14, 17], labels: ["1", "b3", "5", "b7", "9", "11"],
    desc: "小九和弦叠加十一度，气质内敛而富有延展性，是现代爵士与融合乐的重要色彩。",
  },
  {
    id: "13", group: "extended", suffix: "13", cn: "属十三和弦",
    intervals: [0, 4, 7, 10, 14, 21], labels: ["1", "3", "5", "b7", "9", "13"],
    desc: "属九和弦叠加十三度（大六度），音色宽厚丰满，是爵士大乐队风格的标志性和弦，常省略五度。",
  },
  {
    id: "maj13", group: "extended", suffix: "maj13", cn: "大十三和弦",
    intervals: [0, 4, 7, 11, 14, 21], labels: ["1", "3", "5", "7", "9", "13"],
    aliases: ["Δ13", "j13", "M13", "MA13"],
    desc: "大九和弦叠加十三度（大六度），色彩梦幻而开阔，是现代爵士里少而精的奢华色彩。",
  },
  {
    id: "7#11", group: "extended", suffix: "7#11", cn: "属七升十一",
    intervals: [0, 4, 7, 10, 18], labels: ["1", "3", "5", "b7", "#11"],
    aliases: ["7(#11)", "lydian dominant"],
    desc: "属七和弦叠加大四度（#11），是利底亚调式音阶的标志，常用于爵士独奏的明亮解决感。",
  },

  /* === Altered dominant 7（变化属七）=== */
  {
    id: "7b5", group: "altered", suffix: "7b5", cn: "属七降五",
    intervals: [0, 4, 6, 10], labels: ["1", "3", "b5", "b7"],
    desc: "属七和弦降五度（= #11 的等音），多见于爵士进行与半减和弦的代理。",
  },
  {
    id: "7#5", group: "altered", suffix: "7#5", cn: "属七升五",
    intervals: [0, 4, 8, 10], labels: ["1", "3", "#5", "b7"],
    desc: "属七和弦升五度（= b13 的等音），强化属七的紧张与不稳定。",
  },
  {
    id: "7b9", group: "altered", suffix: "7b9", cn: "属七降九",
    intervals: [0, 4, 7, 10, 13], labels: ["1", "3", "5", "b7", "b9"],
    desc: "属七和弦叠加降九度，是小调布鲁斯与西班牙弗里几亚调式的核心张力。",
  },
  {
    id: "7#9", group: "altered", suffix: "7#9", cn: "属七升九",
    intervals: [0, 4, 7, 10, 15], labels: ["1", "3", "5", "b7", "#9"],
    desc: "Hendrix 风格标志性色彩，尖锐狂野，常见于硬摇滚与放克。",
  },
  {
    id: "7b13", group: "altered", suffix: "7b13", cn: "属七降十三",
    intervals: [0, 4, 7, 10, 20], labels: ["1", "3", "5", "b7", "b13"],
    desc: "属七和弦降十三度，常与小调 harmonic minor 配合使用，紧张而华丽。",
  },
  {
    id: "7b5b9", group: "altered", suffix: "7b5b9", cn: "属七降五降九",
    intervals: [0, 4, 6, 10, 13], labels: ["1", "3", "b5", "b7", "b9"],
    desc: "同时降五与降九的属七变形，常见于爵士进行的过渡与解决。",
  },
  {
    id: "7#5b9", group: "altered", suffix: "7#5b9", cn: "属七升五降九",
    intervals: [0, 4, 8, 10, 13], labels: ["1", "3", "#5", "b7", "b9"],
    desc: "升五与降九并存的属七变形，是 altered dominant 最典型的变化形式之一。",
  },
  {
    id: "7alt", group: "altered", suffix: "7alt", cn: "属七变化（alt）",
    intervals: [0, 4, 8, 10, 13, 15, 20], labels: ["1", "3", "b7", "b9", "#9", "b13"],
    desc: "统称所有 altered tensions 属七的集合，常以 7b9 / (b9,b13) / #9 / 7b5b9 等形式出现，含一个或多个 b9/#9/b13/#11/b5/#5 变化。",
  },

  /* === m(maj) —— 小大和弦 === */
  {
    id: "m(maj7)", group: "mmaj", suffix: "m(maj7)", cn: "小大和弦",
    intervals: [0, 3, 7, 11], labels: ["1", "b3", "5", "7"],
    desc: "小调三和弦叠加大七度，柔和却略带渴望，是爵士里富于色彩的人声式和弦。",
  },
  {
    id: "m(maj9)", group: "mmaj", suffix: "m(maj9)", cn: "小大九和弦",
    intervals: [0, 3, 7, 11, 14], labels: ["1", "b3", "5", "7", "9"],
    desc: "小大和弦叠加九度音，温柔而梦幻，是 R&B 与 Neo-Soul 里的进阶色彩。",
  },
  {
    id: "m(maj11)", group: "mmaj", suffix: "m(maj11)", cn: "小大十一和弦",
    intervals: [0, 3, 7, 11, 14, 17], labels: ["1", "b3", "5", "7", "9", "11"],
    desc: "在小大九基础上叠加纯十一度，气质更开阔延展，是现代爵士与电影配乐里少而精的色彩。",
  },
  {
    id: "m(maj13)", group: "mmaj", suffix: "m(maj13)", cn: "小大十三和弦",
    intervals: [0, 3, 7, 11, 14, 21], labels: ["1", "b3", "5", "7", "9", "13"],
    desc: "小大九叠加大六度（13），是小调与爵士交融的最高形态。",
  },

  /* === Power chord === */
  {
    id: "5", group: "power", suffix: "5", cn: "强力和弦",
    intervals: [0, 7], labels: ["1", "5"],
    desc: "只保留根音与纯五度（常叠八度），不含三度音，音色空旷有力，是摇滚、朋克与金属的基石。",
  },

  /* === Add / Sus === */
  {
    id: "m(add9)", group: "addsus", suffix: "m(add9)", cn: "小加九和弦",
    intervals: [0, 3, 7, 14], labels: ["1", "b3", "5", "9"],
    desc: "小调三和弦直接叠加九度音，不含七度，音色柔和且带闪烁感。",
  },
  {
    id: "7sus4", group: "addsus", suffix: "7sus4", cn: "属七挂四",
    intervals: [0, 5, 7, 10], labels: ["1", "4", "5", "b7"],
    desc: "属七和弦用纯四度替代三度，融合挂四的悬置感与属七的推动力，是灵魂乐与放克的常用音响。",
  },
  {
    id: "sus13", group: "addsus", suffix: "sus13", cn: "挂四十三",
    intervals: [0, 5, 7, 21], labels: ["1", "4", "5", "13"],
    desc: "挂四和弦叠加大六度（13），开放明亮，是流行与民谣的现代色彩。",
  },
  {
    id: "6sus4b9", group: "addsus", suffix: "6sus♭9", cn: "大六挂四降九",
    intervals: [0, 1, 5, 7, 9], labels: ["1", "b9", "4", "5", "6"],
    desc: "六和弦挂四并叠加降九度，色彩冷峻而紧张，常见于爵士小调语汇。",
  },
];

const CHORD_TYPE_MAP = Object.fromEntries(CHORD_TYPES.map((t) => [t.id, t]));

/* ---------- 基础工具 ---------- */
function mod12(n) {
  return ((n % 12) + 12) % 12;
}

function noteName(semi, mode) {
  const n = mod12(semi);
  return (mode === "flat" ? PITCH_FLAT : PITCH_SHARP)[n];
}

function chordSemitones(root, type) {
  return type.intervals.map((i) => mod12(root + i));
}

function chordSymbol(root, type, mode) {
  return noteName(root, mode) + type.suffix;
}

/* ---------- 手指分配 ----------
 * frets: [6]，-1=不弹，0=空弦，>=1=品位。
 * 规则：品位相同的多弦组视为横按（食指 1），其余按品位从低到高分配 2/3/4。
 */
function assignFingers(frets) {
  const fingers = frets.map(() => 0);
  const pressed = [];
  frets.forEach((f, si) => {
    if (f > 0) pressed.push([si, f]);
  });
  if (pressed.length === 0) return fingers;

  const groups = new Map();
  pressed.forEach(([si, f]) => {
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(si);
  });
  const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length > 4) return fingers;

  const barre = sorted.find(([, sis]) => sis.length >= 2);
  let finger = 1;
  if (barre) {
    barre[1].forEach((si) => {
      fingers[si] = 1;
    });
    finger = 2;
  }
  sorted.forEach(([f, sis]) => {
    if (barre && f === barre[0]) return;
    sis.forEach((si) => {
      fingers[si] = finger;
    });
    finger += 1;
  });
  return fingers;
}

/* ---------- 指法评分 ----------
 * 偏好根音在最低发声弦、低把位、跨度小、开放和弦；惩罚高音弦过高、6 弦横按成本。
 * 评分与 oolimo 的 "must know" 排序倾向一致（开放、低把位、清晰低音根音）。
 */
function scoreVoicing(v) {
  const { frets, span, baseFret, rootStrings } = v;
  let s = 0;

  // 最低发声弦（弦索引最小 = 音高最低）
  let lowest = -1;
  for (let si = 0; si < frets.length; si += 1) {
    if (frets[si] >= 0) {
      lowest = si;
      break;
    }
  }
  if (rootStrings.includes(lowest)) s += 60;

  const playedCount = frets.filter((f) => f >= 0).length;
  s += playedCount * 9;

  const openStrings = frets.filter((f) => f === 0).length;
  s += openStrings * 4; // 开放弦更经典，区分同分

  // 偏好：低把位优先（把位越低分越高，权重加大，让低把位明显胜出）
  s -= baseFret * 6;
  s -= span * 2.2;

  // 低把位整体加分；不再因为"6 弦是横按根音"而扣分（E 型横按也是标准、好按的把位）
  if (baseFret <= 4) s += 14;
  if (baseFret <= 4 && (frets[0] === -1 || frets[0] === 0)) s += 6;
  if (baseFret <= 4 && rootStrings.includes(1)) s += 6;
  // 高把位（手指够不到、难按）明显降权
  if (baseFret > 4) s -= (baseFret - 4) * 4;
  if (Math.max(frets[4], frets[5]) > 12) s -= 5;

  return s;
}

/* ---------- 精选指法库（SHAPES）----------
 * 基于 oolimo 经典指法的形状库，以 C 基准根音录入。
 * 通过 transposition 引擎适用于所有 12 根音。
 * 未列出的类型由 findVoicings 算法补全。
 *
 * 字段：
 *  - types: 该 shape 适用的和弦类型 id 列表
 *  - base: 录入时使用的根音半音（C = 0）
 *  - frets: [6] 品位模式，-1=闷弦、0=空弦、>=1=按弦
 *  - label: 中文标签
 *
 * 验证：transposition 后所有发声音必须在和弦音名集合内；否则该 shape 对该根音无效。
 */
const SHAPES = [
  { types: ["major"], base: 0, frets: [-1, 3, 2, 0, 1, 0], label: "开放 A 型" },
  { types: ["major"], base: 0, frets: [8, 10, 10, 9, 8, 8], label: "E 型 1 品（6 弦根）" },
  { types: ["minor"], base: 0, frets: [-1, 3, 5, 5, 4, 3], label: "A 型 3 品" },
  { types: ["minor"], base: 0, frets: [3, 3, 5, 5, 4, 3], label: "A 型 3 品（6 弦根）" },
  { types: ["minor"], base: 0, frets: [8, 10, 10, 8, 8, 8], label: "E 型 3 品" },
  { types: ["sus2"], base: 0, frets: [-1, 3, 0, 0, 1, 3], label: "开放" },
  { types: ["sus2"], base: 0, frets: [8, 10, 10, 12, 8, 8], label: "E 型 1 品" },
  { types: ["sus4"], base: 0, frets: [1, 3, 3, 0, 1, 1], label: "E 型 1 品" },
  { types: ["sus4"], base: 0, frets: [-1, 3, 3, 0, 1, 1], label: "开放" },
  { types: ["maj7"], base: 0, frets: [-1, 3, 2, 0, 0, 0], label: "开放" },
  { types: ["7"], base: 0, frets: [-1, 3, 2, 3, 1, 0], label: "开放" },
  { types: ["7"], base: 0, frets: [3, 3, 2, 3, 1, 0], label: "A 型 3 品" },
  { types: ["7"], base: 0, frets: [8, 10, 8, 9, 8, 8], label: "E 型 1 品（6 弦根）" },
  { types: ["m7"], base: 0, frets: [-1, 3, 5, 3, 4, 3], label: "A 型 3 品" },
  { types: ["m7"], base: 0, frets: [3, 3, 5, 3, 4, 3], label: "A 型 3 品（6 弦根）" },
  { types: ["m7"], base: 0, frets: [8, 10, 10, 8, 8, 8], label: "E 型 3 品" },
  { types: ["6"], base: 0, frets: [-1, 3, 2, 2, 1, 0], label: "开放" },
  { types: ["6"], base: 0, frets: [8, 10, 10, 9, 10, 8], label: "E 型 1 品（6 弦根）" },
  { types: ["add9"], base: 0, frets: [-1, 3, 2, 0, 1, 3], label: "开放" },
  { types: ["add9"], base: 0, frets: [8, 10, 10, 12, 8, 8], label: "E 型 1 品" },
  { types: ["maj9"], base: 0, frets: [3, 3, 2, 0, 0, 0], label: "A 型 3 品" },
  { types: ["m9"], base: 0, frets: [-1, 3, 5, 0, 3, 3], label: "A 型 3 品" },
  { types: ["6/9"], base: 0, frets: [-1, 3, 2, 2, 3, 0], label: "开放" },
  { types: ["6/9"], base: 0, frets: [8, 10, 10, 9, 10, 10], label: "E 型 1 品" },
  { types: ["m11"], base: 0, frets: [3, 3, 5, 3, 4, 3], label: "A 型 3 品" },
  { types: ["m11"], base: 0, frets: [-1, 3, 5, 3, 4, 3], label: "A 型 3 品" },
  { types: ["13"], base: 0, frets: [8, 10, 10, 9, 10, 10], label: "E 型 1 品" },
  { types: ["13"], base: 0, frets: [3, 3, 2, 0, 3, 0], label: "A 型 3 品" },
  { types: ["maj13"], base: 0, frets: [8, 10, 9, 7, 10, 7], label: "E 型 1 品" },
  { types: ["7#11"], base: 0, frets: [8, 10, 10, 11, 8, 8], label: "E 型 1 品" },
  { types: ["m(maj11)"], base: 0, frets: [1, 3, 5, 5, 4, 3], label: "A 型 3 品" },
  { types: ["5"], base: 0, frets: [-1, 3, 5, 5, -1, -1], label: "A 型 3 品" },
  { types: ["m(add9)"], base: 0, frets: [-1, 3, 5, 5, 3, 3], label: "A 型 3 品" },
  { types: ["7sus4"], base: 0, frets: [-1, 3, 3, 0, 1, 1], label: "开放" },
  { types: ["sus13"], base: 0, frets: [1, 3, 3, 0, 1, 1], label: "E 型 1 品" }
];

/* ---------- SHAPES transposition 引擎 ----------
 * 给定 typeId + targetRoot + tuningPitches + capo，输出所有适用的 transposition 后 shape。
 * 严格验证：transposition 后所有发声音必须在和弦音名集合内。
 */
function transposedShapes(typeId, targetRoot, tuningPitches, opts = {}) {
  const type = CHORD_TYPE_MAP[typeId];
  if (!type) return [];
  const capo = opts.capo ?? 0;
  const pitches = tuningPitches.map((p) => mod12(p + capo));
  const chordSet = new Set(type.intervals.map((i) => mod12(targetRoot + i)));
  const required = requiredIntervals(type).map((i) => mod12(targetRoot + i));

  const out = [];
  for (const sh of SHAPES) {
    if (!sh.types.includes(typeId)) continue;
    const trans = targetRoot - sh.base;
    // 同一个形状尝试 trans 与 trans-12 两个八度，取把位更低（baseFret 更小）的合法候选。
    // 这样 CAGED 各形状对每一个根音都能落在尽量低的品位，而不是被推到高把位。
    let best = null;
    for (const off of [trans, trans - 12]) {
      const newFrets = sh.frets.map((f) => {
        if (f < 0) return -1; // 闷
        if (f === 0) return 0; // 空弦
        return f + off; // 按弦 + off
      });

      // 验证
      const covered = new Set();
      let playedCount = 0;
      let baseFret = Infinity;
      const fs = [];
      for (let si = 0; si < 6; si += 1) {
        const f = newFrets[si];
        if (f < 0) continue;
        playedCount += 1;
        const semi = mod12(pitches[si] + f);
        covered.add(semi);
        if (f > 0) {
          fs.push(f);
          if (f < baseFret) baseFret = f;
        } else {
          // 空弦：baseFret=0 表示开放
          if (baseFret > 0) baseFret = 0;
        }
      }
      if (playedCount < 3) continue;
      if (baseFret === Infinity) baseFret = 0;

      // 必须在 0..15
      if (fs.length && (fs.some((f) => f < 0 || f > 15))) continue;
      // 必须覆盖 required（核心音）
      if (!required.every((r) => covered.has(r))) continue;
      // 跨度过大
      let span = 0;
      if (fs.length) {
        span = Math.max(...fs) - Math.min(...fs);
        if (span > 4) continue;
      }

      // 根音弦
      const rootStrings = [];
      for (let si = 0; si < 6; si += 1) {
        if (newFrets[si] >= 0 && mod12(pitches[si] + newFrets[si]) === targetRoot) {
          rootStrings.push(si);
        }
      }
      if (rootStrings.length === 0) continue;

      const cand = {
        frets: newFrets,
        baseFret,
        span,
        rootStrings,
        fingers: assignFingers(newFrets),
        group: classifyVoicing({ frets: newFrets, baseFret }, true),
        label: sh.label,
        cageShape: sh.cageShape || null,
        source: "shape",
      };
      if (!best || cand.baseFret < best.baseFret) best = cand;
    }
    if (best) out.push(best);
  }
  // 去重
  const seen = new Set();
  return out.filter((v) => {
    const k = v.frets.join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------- 必须覆盖的核心音 ----------
 * 吉他演奏中纯五度（7）常被省略，复杂延伸和弦只要求骨架：
 * 根音 + 三音 + 七/六音 + 最高延伸音。
 */
function requiredIntervals(type) {
  const intervals = type.intervals;
  const withoutFifth = intervals.filter((i) => mod12(i) !== 7);
  if (withoutFifth.length <= 4) return withoutFifth;
  const essential = [0, intervals[1]];
  const seventh = intervals.find((i) => [9, 10, 11].includes(mod12(i)));
  if (seventh !== undefined) {
    essential.push(seventh);
  }
  essential.push(intervals[intervals.length - 1]);
  return [...new Set(essential)];
}

/* ---------- CAGED 五型生成器 ----------
 * 用「度数模板」描述每个 CAGED 形状：数组为 6 根弦（6→1），
 * 数值 = 该弦相对根音的半音度数（0=根音,4=大三,3=小三,7=纯五,10=b7,11=大七），null = 该弦不发声。
 * 根音所在的弦即「形状的根弦」。给定目标根音与调弦后，自动在最低把位求出每根弦的实际品位，
 * 保证：所有发声音都是和弦音、跨度 ≤4 品、可使用空弦（即含开放形态）。不依赖手工写死的把位数。
 */
const CAGED_TEMPLATES = {
  // 大三和弦：C/A/G/E/D 五型
  major: {
    C: [null, 0, 4, 7, 0, 7],
    A: [null, 0, 7, 0, 4, 7],
    // G 型使用完整开放 G 大形：根音在 6 弦与 1 弦（如 C 的 G 型为 8-7-5-5-5-8）
    G: [0, 4, 7, 0, 4, 0],
    E: [0, 7, 0, 4, 7, 0],
    D: [null, null, 0, 7, 0, 4],
  },
  // 小三和弦：三音 4 → 3
  minor: {
    C: [null, 0, 3, 7, 0, 7],
    A: [null, 0, 7, 0, 3, 7],
    G: [7, null, 7, 0, 3, 7],
    E: [0, 7, 0, 3, 7, 0],
    D: [null, null, 0, 7, 0, 3],
  },
  // 属七：在大小三和弦基础上加入 b7(10)，仅给最实用的 E 型 / A 型横按
  "7": {
    E: [0, 7, 10, 4, 7, 0],
    A: [null, 0, 7, 10, 4, 7],
  },
  // 大七：加入大七(11)
  maj7: {
    E: [0, 7, 11, 4, 7, 0],
    A: [null, 0, 7, 11, 4, 7],
  },
  // 小七：加入 b7(10)，三音为小三(3)
  m7: {
    E: [0, 7, 10, 3, 7, 0],
    A: [null, 0, 7, 10, 3, 7],
  },
};

function generateCaged(typeId, root, tuningPitches) {
  const tpls = CAGED_TEMPLATES[typeId];
  if (!tpls) return [];
  const out = [];
  for (const shape of Object.keys(tpls)) {
    const tpl = tpls[shape];
    const rootStr = tpl.indexOf(0); // 根音所在弦（0-based，6→1 对应 0→5）
    if (rootStr < 0) continue;

    let best = null;
    // 遍历根弦可能按的品位（0=空弦 ~ 15）
    // 强制：根弦在该品位必须真的发出目标根音，避免形状被错误压低到非根弦上
    for (let r = 0; r <= 15; r += 1) {
      if (mod12(tuningPitches[rootStr] + r) !== root) continue;
      const frets = tpl.map((deg, si) => {
        if (deg === null) return -1; // 不发声
        if (si === rootStr) return r; // 根弦就按在 r
        // 其它弦：需要发出的音 = root + deg；在该弦上取「与 r 同把位、最接近 r」的品位（±6 品内）
        const need = mod12(root + deg);
        const open = mod12(tuningPitches[si]);
        let off = mod12(need - (open + r)); // 相对 r 的偏移（0..11）
        // 取最接近 r 的等价偏移（落在 -6..+6），保证把位紧凑、跨度小
        if (off > 6) off -= 12;
        let f = r + off;
        // 若越界，尝试另一个八度
        if (f > 15) f -= 12;
        if (f < 0) f += 12;
        return f;
      });
      // 校验：所有发声弦必须在 0..15，且跨度 ≤4
      const pressed = frets.filter((f) => f > 0);
      const allOk = frets.every((f) => f === -1 || (f >= 0 && f <= 15));
      if (!allOk) continue;
      const minF = Math.min(...frets.filter((f) => f >= 0));
      const maxF = Math.max(...frets.filter((f) => f >= 0));
      const span = maxF - minF;
      if (span > 4) continue;
      // 校验每个发声音确实是和弦音（度数模板本身保证，这里再兜底）
      const type = CHORD_TYPE_MAP[typeId];
      const set = new Set(type.intervals.map((i) => mod12(root + i)));
      const notesOk = frets.every((f, si) => {
        if (f < 0) return true;
        return set.has(mod12(tuningPitches[si] + f));
      });
      if (!notesOk) continue;

      const baseFret = pressed.length ? minF : 0;
      const rootStrings = [];
      frets.forEach((f, si) => {
        if (f >= 0 && mod12(tuningPitches[si] + f) === root) rootStrings.push(si);
      });
      if (rootStrings.length === 0) continue;

      const cand = {
        frets,
        baseFret,
        span,
        rootStrings,
        fingers: assignFingers(frets),
        group: classifyVoicing({ frets, baseFret }, true),
        label: `${shape} 型`,
        cageShape: shape,
        source: "caged",
      };
      // 取把位最低（优先含空弦的开放形态）
      const score = baseFret * 10 + (frets.includes(0) ? -1 : 0);
      if (!best || score < best._s) {
        cand._s = score;
        best = cand;
      }
    }
    if (best) {
      delete best._s;
      out.push(best);
    }
  }
  return out;
}

/* ---------- 指法搜索 ----------
 * root: 根音半音（0-11）
 * type: CHORD_TYPE_MAP 中的类型对象
 * tuningPitches: [6] 空弦半音
 * opts: { maxSpan, maxVoicings, capo, group }
 *  返回按分数排序去重的 voicing 数组：
 *   { frets:[6], span, baseFret, rootStrings:[弦索引], score, fingers:[6] }
 *   group: "open" | "moveable" | "other"（oolimo 的 MUST KNOW / OPEN / MOVEABLE / CAPO 分组来源）
 */
function classifyVoicing(v, baseOpen = false) {
  const { frets, baseFret } = v;
  // 真正的"open"：baseFret 为 0 且至少有一根空弦（6 弦空或 1 弦空）
  if (baseFret === 0 && frets.some((f) => f === 0)) return "open";
  // 其它（有横按或按弦的）统称 moveable
  return "moveable";
}

function findVoicings(root, type, tuningPitches, opts = {}) {
  const maxSpan = opts.maxSpan ?? 4;
  const maxVoicings = opts.maxVoicings ?? 30;
  const capo = opts.capo ?? 0;
  const maxFret = 15;

  const pitches = tuningPitches.map((p) => mod12(p + capo));
  const chordSet = new Set(type.intervals.map((i) => mod12(root + i)));
  const required = requiredIntervals(type).map((i) => mod12(root + i));

  const seen = new Set();
  const all = [];

  for (let base = 0; base <= 12; base += 1) {
    const cand = pitches.map((strPitch) => {
      const list = [-1];
      const lo = base === 0 ? 0 : base;
      for (let f = lo; f <= base + maxSpan; f += 1) {
        if (f === 0) {
          if (chordSet.has(mod12(strPitch))) list.push(0);
        } else if (f <= maxFret && chordSet.has(mod12(strPitch + f))) {
          list.push(f);
        }
      }
      return list;
    });

    const stack = [{ idx: 0, frets: [] }];
    while (stack.length) {
      const cur = stack.pop();
      if (cur.idx === 6) {
        const frets = cur.frets;
        const played = [];
        frets.forEach((f, si) => {
          if (f >= 0) played.push([si, f]);
        });
        if (played.length < 2) continue; // 强力和弦允许 2 根发声弦
        const pressed = played.filter(([si, f]) => f > 0);
        if (pressed.length === 0) continue; // 必须至少有一个按弦点，否则是指板上的空白

        const covered = new Set();
        played.forEach(([si, f]) => covered.add(mod12(pitches[si] + f)));
        if (!required.every((r) => covered.has(r))) continue;

        const fs = played.filter((p) => p[1] > 0).map((p) => p[1]);
        const span = fs.length ? Math.max(...fs) - Math.min(...fs) : 0;
        if (span > maxSpan) continue;
        if (new Set(fs).size > 4) continue;

        const rootStrings = played
          .filter(([si, f]) => mod12(pitches[si] + f) === root)
          .map((p) => p[0]);
        if (rootStrings.length === 0) continue;

        const key = frets.join(",");
        if (seen.has(key)) continue;
        seen.add(key);

        const baseFret = fs.length ? Math.min(...fs) : 0;
        const score = scoreVoicing({ frets, span, baseFret, rootStrings });
        all.push({ frets: frets.slice(), span, baseFret, rootStrings, score });
        continue;
      }
      for (const f of cand[cur.idx]) {
        stack.push({ idx: cur.idx + 1, frets: cur.frets.concat(f) });
      }
    }
  }

  all.sort((a, b) => b.score - a.score);

  const bestByBase = new Map();
  all.forEach((v) => {
    if (!bestByBase.has(v.baseFret)) bestByBase.set(v.baseFret, v);
  });
  const result = [];
  const used = new Set();
  all.forEach((v) => {
    if (result.length >= maxVoicings) return;
    if (bestByBase.get(v.baseFret) === v && !used.has(v)) {
      result.push(v);
      used.add(v);
    }
  });
  all.forEach((v) => {
    if (result.length >= maxVoicings) return;
    if (!used.has(v)) {
      result.push(v);
      used.add(v);
    }
  });

  return result
    .slice(0, maxVoicings)
    .map((v) => ({
      ...v,
      fingers: assignFingers(v.frets),
      group: classifyVoicing(v),
    }));
}

/* ---------- 综合指法（SHAPES + 算法） ----------
 * 输出 oolimo 风格的 4 分组：must know / open / moveable / capo
 *  - must: 评分最高的 3-4 个（跨分组）
 *  - open: 含空弦的低把位指法
 *  - moveable: 闭横按或纯按弦，按 baseFret 分层
 *  - capo: 包含 capo>0 的指法（同一指法在 capo 升降下变调）
 */
function extendedVoicings(typeId, rootSemitone, tuningPitches, opts = {}) {
  const type = CHORD_TYPE_MAP[typeId];
  if (!type) return { must: [], open: [], moveable: [], capo: [], caged: [] };

  const capo = opts.capo ?? 0;
  const maxSpan = opts.maxSpan ?? 4;

  // 1) SHAPES transposition（base 形状库 + transposition）
  const shapeList = transposedShapes(typeId, rootSemitone, tuningPitches, { capo });
  // 2) 算法生成
  const algoList = findVoicings(rootSemitone, type, tuningPitches, {
    maxVoicings: 30,
    capo,
  });
  const algoNorm = algoList.map((v) => ({ ...v, source: "algo", label: "算法" }));

  // 合并去重
  const all = [...shapeList, ...algoNorm];
  const seen = new Set();
  const merged = [];
  for (const v of all) {
    const k = v.frets.join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(v);
  }

  // 补 score 和 group
  for (const v of merged) {
    if (typeof v.score !== "number") {
      const played = v.frets.filter((f) => f >= 0).length;
      const fs = v.frets.filter((f) => f > 0);
      const span = fs.length ? Math.max(...fs) - Math.min(...fs) : 0;
      let lowest = -1;
      for (let si = 0; si < 6; si += 1) if (v.frets[si] >= 0) { lowest = si; break; }
      const bassRoot = v.rootStrings.includes(lowest) ? 60 : 0;
      const openBonus = v.frets.filter((f) => f === 0).length * 4;
      const baseFret = fs.length ? Math.min(...fs) : 0;
      const basePenalty = baseFret * 1.6;
      const spanPenalty = span * 2.2;
      const openLowPenalty = baseFret <= 4 && v.frets[0] > 0 ? 8 : 0;
      const openLowBonus = baseFret <= 4 && (v.frets[0] === -1 || v.frets[0] === 0) ? 12 : 0;
      v.score = bassRoot + played * 9 + openBonus - basePenalty - spanPenalty - openLowPenalty + openLowBonus;
      v.span = span;
      if (fs.length) v.baseFret = baseFret;
    }
    if (!v.group) v.group = classifyVoicing({ frets: v.frets, baseFret: v.baseFret }, true);
  }
  merged.sort((a, b) => b.score - a.score);

  // 分配到各组（各组独立，按各自维度选 top 候选，不互斥去重）
  const must = [];
  const open = [];
  const moveable = [];

  // MUST KNOW：优先低把位（baseFret ≤ 4）里评分最高的，不足再补其它把位。
  // 这样「推荐给用户看」的永远是低把位、4 根手指够得到的标准按法。
  const lowPos = merged.filter((v) => v.baseFret <= 4);
  const otherPos = merged.filter((v) => v.baseFret > 4);
  for (const v of lowPos) {
    if (must.length >= 3) break;
    must.push(v);
  }
  for (const v of otherPos) {
    if (must.length >= 3) break;
    must.push(v);
  }

  // OPEN：open group 的 top 5
  for (const v of merged) {
    if (open.length >= 5) break;
    if (v.group === "open") open.push(v);
  }

  // MOVEABLE：按 baseFret 分组，每组最多 2 个
  const moveableByBase = new Map();
  for (const v of merged) {
    if (v.baseFret < 1 || v.baseFret > 12) continue;
    if (v.group !== "moveable") continue;
    if (!moveableByBase.has(v.baseFret)) moveableByBase.set(v.baseFret, []);
    const arr = moveableByBase.get(v.baseFret);
    if (arr.length < 2) arr.push(v);
  }
  for (let bf = 1; bf <= 12; bf += 1) {
    if (moveableByBase.has(bf)) moveable.push(...moveableByBase.get(bf));
    if (moveable.length >= 16) break;
  }

  // CAPO：用其他调的 open/低把位 shape 加 capo 得到当前和弦
  // 例如 C major 可用 Bb major 形状 + capo 1，或 A major + capo 3 等
  const capoArr = [];
  if (capo === 0) {
    const capoLevels = [1, 2, 3, 4, 5];
    const usedKeys = new Set();
    for (const k of capoLevels) {
      const templateRoot = mod12(rootSemitone - k);
      // 用算法生成 templateRoot 的低把位候选（含空弦、跨度小）
      const templates = findVoicings(templateRoot, type, tuningPitches, {
        maxVoicings: 10,
        capo: 0,
      }).filter((v) => v.span <= 4 && v.frets.some((f) => f === 0));
      for (const sh of templates) {
        const shifted = sh.frets.map((f) => {
          if (f === -1) return -1;
          if (f === 0) return k; // 空弦被 capo 压住，实际按在 capo 品位
          return f + k;
        });
        const pressed = shifted.filter((f) => f > 0);
        if (pressed.length === 0) continue;
        if (Math.max(...pressed) > 15) continue;
        const span = Math.max(...pressed) - Math.min(...pressed);
        if (span > maxSpan) continue;
        const baseFret = Math.min(...pressed);
        const rootStrings = [];
        shifted.forEach((f, si) => {
          if (f >= 0 && mod12(tuningPitches[si] + f) === rootSemitone) rootStrings.push(si);
        });
        if (rootStrings.length === 0) continue;
        const key = shifted.join(",");
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        capoArr.push({
          ...sh,
          capo: k,
          _capoVariant: true,
          frets: shifted,
          baseFret,
          span,
          rootStrings,
          fingers: assignFingers(shifted),
          source: sh.source,
        });
        if (capoArr.length >= 6) break;
      }
      if (capoArr.length >= 6) break;
    }
  }

  // 兜底：过滤掉任何没有按弦点的"空白指法"
  const isValid = (v) => {
    const played = v.frets.filter((f) => f >= 0);
    const pressed = v.frets.filter((f) => f > 0);
    return played.length >= 2 && pressed.length > 0 && v.rootStrings && v.rootStrings.length > 0;
  };

  // CAGED 五型：由度数模板生成（含开放形态），按 C→A→G→E→D 顺序，缺失的型不列出。
  const rawCaged = generateCaged(typeId, rootSemitone, tuningPitches);
  const cagedByShape = new Map();
  for (const v of rawCaged) {
    if (!cagedByShape.has(v.cageShape) || v.baseFret < cagedByShape.get(v.cageShape).baseFret) {
      cagedByShape.set(v.cageShape, v);
    }
  }
  const CAGED_ORDER = ["C", "A", "G", "E", "D"];
  const caged = CAGED_ORDER.filter((s) => cagedByShape.has(s)).map((s) => cagedByShape.get(s));

  return {
    must: must.filter(isValid),
    open: open.filter(isValid),
    moveable: moveable.filter(isValid),
    capo: capoArr.filter(isValid),
    caged: caged.filter(isValid),
  };
}

/* ---------- 全指板可用位置（横向图用） ---------- */
function fretboardPositions(root, type, tuningPitches, opts = {}) {
  const capo = opts.capo ?? 0;
  const frets = opts.frets ?? 24;
  const chordSet = new Set(type.intervals.map((i) => mod12(root + i)));
  const positions = [];
  for (let si = 0; si < tuningPitches.length; si += 1) {
    for (let f = 0; f <= frets; f += 1) {
      const semi = mod12(tuningPitches[si] + capo + f);
      if (chordSet.has(semi)) {
        positions.push({ si, fret: f, isRoot: semi === root });
      }
    }
  }
  return positions;
}

/* ---------- Node 导出 ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PITCH_SHARP,
    PITCH_FLAT,
    TUNINGS,
    CHORD_TYPES,
    CHORD_TYPE_MAP,
    TYPE_GROUPS,
    noteName,
    chordSemitones,
    chordSymbol,
    assignFingers,
    scoreVoicing,
    requiredIntervals,
    classifyVoicing,
    findVoicings,
    transposedShapes,
    extendedVoicings,
    fretboardPositions,
  };
}
