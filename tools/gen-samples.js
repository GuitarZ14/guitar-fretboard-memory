/**
 * 离线生成指板发声采样（空弦 + Karplus-Strong 预处理）
 * ------------------------------------------------------------
 * 生成 6 种调弦下所有空弦音的 WAV 文件到 samples/，按空弦音名命名（如 E2.wav）。
 * 浏览器侧以「空弦采样 + playbackRate 变调」方式播放任意品位，无需逐品采样。
 *
 * 运行：node tools/gen-samples.js
 * 依赖：无（仅 Node 内置模块）
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;
const DURATION = 2.6;

const PITCH_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const TUNING_BASE_MIDI = {
  standard: [40, 45, 50, 55, 59, 64],
  dropD:    [38, 45, 50, 55, 59, 64],
  dadgad:   [38, 45, 50, 55, 57, 64],
  openG:    [38, 43, 50, 55, 59, 62],
  openD:    [38, 45, 50, 54, 57, 62],
  eb:       [39, 44, 49, 54, 58, 63],
};

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function midiName(m) { return PITCH_SHARP[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

// Karplus-Strong 渲染一段拨弦
function ksPluck(freq, sr, duration) {
  const N = Math.floor(sr * duration);
  const out = new Float32Array(N);
  const delayLen = Math.max(2, Math.round(sr / freq));
  const buf = new Float32Array(delayLen);
  for (let i = 0; i < delayLen; i += 1) buf[i] = Math.random() * 2 - 1;
  // 初始低通平滑，去除过亮噪声
  let prev = 0;
  for (let i = 0; i < delayLen; i += 1) {
    const cur = buf[i];
    buf[i] = (cur + prev) * 0.5;
    prev = cur;
  }
  let idx = 0;
  const decay = 0.9965;
  const lowpass = 0.5; // 反馈低通系数（越小越暗）
  for (let n = 0; n < N; n += 1) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % delayLen];
    const filt = (cur + next) * lowpass;
    out[n] = cur;
    buf[idx] = filt * decay;
    idx = (idx + 1) % delayLen;
  }
  // 短促起音，避免起始咔哒声
  const attack = Math.floor(sr * 0.003);
  for (let n = 0; n < attack; n += 1) out[n] *= n / attack;
  // 末端淡出，避免截断咔哒声
  const fade = Math.floor(sr * 0.05);
  for (let n = 0; n < fade; n += 1) out[N - 1 - n] *= n / fade;
  // 归一化到峰值 0.9
  let peak = 0;
  for (let n = 0; n < N; n += 1) peak = Math.max(peak, Math.abs(out[n]));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let n = 0; n < N; n += 1) out[n] *= g;
  }
  return out;
}

function writeWav(filePath, float32, sr) {
  const numSamples = float32.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);   // PCM
  buffer.writeUInt16LE(1, 22);   // mono
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  let off = 44;
  for (let i = 0; i < numSamples; i += 1) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    buffer.writeInt16LE(Math.round(s * 32767), off);
    off += 2;
  }
  fs.writeFileSync(filePath, buffer);
}

const outDir = path.resolve(__dirname, '..', 'samples');
const midis = new Set();
Object.values(TUNING_BASE_MIDI).forEach((arr) => arr.forEach((m) => midis.add(m)));

console.log('生成空弦采样：');
[...midis].sort((a, b) => a - b).forEach((m) => {
  const name = midiName(m);
  const freq = midiToFreq(m);
  const wav = ksPluck(freq, SR, DURATION);
  writeWav(path.join(outDir, name + '.wav'), wav, SR);
  console.log(`  ${name}.wav  (MIDI ${m}, ${freq.toFixed(2)} Hz)`);
});
console.log('完成，输出目录：', outDir);
