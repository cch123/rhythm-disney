'use strict';

/* ============================================================================
 * 橡皮管拳击 RUBBER HOSE BOXING
 * 1920s 橡皮管动画（rubber hose animation）风格的节奏游戏 Demo
 *
 * 架构要点：
 *   - 单一时钟源：判定与动画插值均以 AudioContext.currentTime 为基准，
 *     避免 rAF (requestAnimationFrame，浏览器渲染回调) 时钟与音频时钟漂移。
 *   - 前瞻调度（lookahead scheduling）：setInterval(25ms) 轮询，把未来 120ms
 *     内的鼓点/音效提前提交给 Web Audio 的采样级定时队列。
 *   - 摇摆量化（swing）：八分反拍统一推迟到拍内 0.64 处；该映射同时作用于
 *     配乐调度与谱面判定时刻，听感与判定共用一张时间网格。
 *   - 暂停 = AudioContext.suspend()：音频时钟随之冻结，恢复后时序天然一致。
 *   - 判定窗口：|Δt| ≤ 60ms 完美；≤ 115ms 不错；超时未击 MISS。
 * ========================================================================== */

/* ---------------- 常量 ---------------- */
const W = 960, H = 540;
const BPM = 120;                       // BPM (beats per minute，每分钟拍数)
const BEAT = 60 / BPM;                 // 一拍 0.5 s
const SWING = 0.64;                    // 摇摆比：八分反拍落在拍内 0.64 处
const THROW_LEAD = 2;                  // 投掷提前量：物体滞空 2 拍（绝对时长 1s）
const PERFECT_WIN = 0.060;             // 完美判定窗口（秒）
const GOOD_WIN = 0.115;                // 不错判定窗口（秒）
const GROOVE_END_BEAT = 71.5;          // 常规律动终止拍（之后进入终止句）
const FINAL_BEAT = 76;                 // 终止句落点（最后一击 + 镲）
const RESULT_BEAT = 80;                // 该拍之后进入结算
const LOOKAHEAD = 0.12;                // 音频调度前瞻（秒）

const GROUND_Y = 430;
const CHAR_X = 250;                    // 角色基准 x
const HIT_X = 430, HIT_Y = 318;        // 出拳命中点
const THROW_X = W + 60, THROW_Y = 235; // 投掷起点（屏幕右侧外）

/* 谱面：物体“到达命中点”的拍号（x.5 = 摇摆反拍） */
const CHART_BEATS = [
  8, 12, 16, 20,                                       // 热身：每 4 拍
  24, 26, 28, 30, 32, 34, 36, 38,                      // 律动：每 2 拍
  40, 42, 43, 44, 46, 47, 48, 50, 51, 52, 54, 55,      // 加密：相邻四分连击
  56, 56.5, 58, 60, 60.5, 62,                          // 摇摆反拍双连
  64, 66, 68, 68.5, 70, 72, 75, 76,                    // 终段：收在终止句两击上
];

/* 和声：4 小节循环 C6 → A7 → Dm7 → G7（爵士回转进行） */
const CHORDS = [
  [261.63, 329.63, 392.00, 440.00],    // C6   (C4 E4 G4 A4)
  [220.00, 277.18, 329.63, 392.00],    // A7   (A3 C#4 E4 G4)
  [293.66, 349.23, 440.00, 523.25],    // Dm7  (D4 F4 A4 C5)
  [196.00, 246.94, 293.66, 349.23],    // G7   (G3 B3 D4 F4)
];

/* 行走贝斯（walking bass）：16 拍循环，每拍一音 */
const BASS_WALK = [
  65.41, 82.41, 98.00, 110.00,         // C:  C2 E2 G2 A2
  55.00, 69.30, 82.41, 77.78,          // A7: A1 C#2 E2 Eb2（半音逼近 D）
  73.42, 87.31, 110.00, 130.81,        // Dm7: D2 F2 A2 C3
  98.00, 87.31, 82.41, 73.42,          // G7: G2 F2 E2 D2（下行解决）
];
const BASS_OUTRO = [98.00, 87.31, 82.41, 73.42]; // 68–71 拍强制 G7 下行，导入终止句

/* 弱音小号即兴句（riff）：16 拍循环，[拍, 频率, 时值] */
const RIFF = [
  [0, 329.63, 0.40], [0.5, 392.00, 0.35], [1, 440.00, 0.40], [2, 392.00, 0.35], [2.5, 329.63, 0.50],
  [4, 277.18, 0.40], [4.5, 329.63, 0.35], [5, 392.00, 0.40], [6, 329.63, 0.60],
  [8, 440.00, 0.40], [8.5, 523.25, 0.35], [9, 440.00, 0.40], [10, 349.23, 0.35], [10.5, 440.00, 0.30], [11, 349.23, 0.50],
  [12, 392.00, 0.40], [12.5, 349.23, 0.35], [13, 293.66, 0.40], [14, 246.94, 0.80],
];
/* 结尾终止句：shave and a haircut, two bits（72–76 拍） */
const LICK = [
  [72, 261.63, 0.30], [72.5, 196.00, 0.28], [73, 196.00, 0.28], [73.5, 220.00, 0.28],
  [74, 196.00, 0.50], [75, 246.94, 0.30], [76, 261.63, 0.90],
];

/* ---------------- 调色板（单色赛璐珞） ---------------- */
const INK = '#1c1813';
const CREAM = '#f2ebd8';
const PAPER = '#e7dfc8';
const LIGHT = '#d9d1b9';
const MID = '#a89e87';

/* ---------------- 运行时状态 ---------------- */
const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

let actx = null, master = null, noiseBuf = null;
let state = 'title';                   // title | playing | result
let paused = false;
let songStart = 0;
let nextStep = 0;                      // 八分音符步进指针（beat = nextStep * 0.5）
let melodyIdx = 0;
let melodyEvents = [];
let schedTimer = null;

let notes = [], popups = [], stars = [];
let score = 0, combo = 0, maxCombo = 0;
let stats = { perfect: 0, good: 0, miss: 0 };
let punchAt = -10;                     // 最近一次出拳时刻（音频时钟）
let powAt = -10, powBig = false;       // 命中爆闪
let hatPopAt = -10;                    // 完美时帽子弹跳
let irisAt = -1;                       // 圈入转场（iris-in）起点
let finalRating = null;

/* ---------------- 摇摆时间网格 ---------------- */
/* beat -> 绝对时刻：整数拍不动，反拍按 SWING 推迟 */
function beatTime(b) {
  const i = Math.floor(b), f = b - i;
  const sf = f < 0.5 ? f * (SWING / 0.5) : SWING + (f - 0.5) * ((1 - SWING) / 0.5);
  return songStart + (i + sf) * BEAT;
}

/* ---------------- 音频：初始化与合成器 ---------------- */
function initAudio() {
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = actx.createDynamicsCompressor();
  master = actx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  comp.connect(actx.destination);
  noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/* 振荡器音符：可选指数滑频 f0 -> f1，指数衰减包络 */
function osc(type, f0, t0, dur, vol, f1) {
  const o = actx.createOscillator(), gn = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  gn.gain.setValueAtTime(vol, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(gn);
  gn.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/* 滤波噪声：打击乐基础 */
function noise(t0, dur, vol, type, freq, q) {
  const s = actx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q || 0.8;
  const gn = actx.createGain();
  gn.gain.setValueAtTime(vol, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f);
  f.connect(gn);
  gn.connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

/* 弱音小号：锯齿波 + 低通 + 颤音（LFO 调制频率），可选下滑音 */
function trumpet(t, f, dur, vol, bendTo) {
  const v = vol == null ? 0.12 : vol;
  const o = actx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t);
  if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, t + dur);
  const vib = actx.createOscillator();
  vib.frequency.value = 5.5;
  const vg = actx.createGain();
  vg.gain.value = f * 0.008;
  vib.connect(vg);
  vg.connect(o.frequency);
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500;
  lp.Q.value = 1;
  const gn = actx.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.linearRampToValueAtTime(v, t + 0.03);
  gn.gain.setValueAtTime(v, t + Math.max(0.04, dur - 0.08));
  gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(lp);
  lp.connect(gn);
  gn.connect(master);
  o.start(t); vib.start(t);
  o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}

/* 爵士套鼓与配器 */
const ride  = (t, v) => { noise(t, 0.30, v, 'highpass', 7500, 0.6); osc('sine', 5200, t, 0.12, v * 0.25); };
const chick = t => noise(t, 0.03, 0.14, 'highpass', 9000, 0.8);
const brush = t => noise(t, 0.16, 0.22, 'bandpass', 2200, 0.5);
const kickS = t => osc('sine', 120, t, 0.12, 0.5, 50);
const crash = t => noise(t, 0.9, 0.32, 'highpass', 5200, 0.4);
const bassN = (t, f) => { osc('triangle', f, t, 0.30, 0.32); osc('sawtooth', f, t, 0.12, 0.05); };
const xylo  = (t, f, v) => { osc('sine', f, t, 0.35, v); osc('sine', f * 2.76, t, 0.10, v * 0.2); };

function compChord(t, freqs, vol) {
  freqs.forEach((f, i) => osc('triangle', f, t + i * 0.008, 0.22, vol));
}

/* 投掷提示音：滑笛（slide whistle）上滑 */
function slideWhistle(t) {
  const o = actx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(950, t + 0.17);
  const gn = actx.createGain();
  gn.gain.setValueAtTime(0.001, t);
  gn.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
  gn.gain.setValueAtTime(0.22, t + 0.12);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(gn);
  gn.connect(master);
  o.start(t);
  o.stop(t + 0.25);
}

function sPunch(perfect) {
  const t = actx.currentTime;
  noise(t, 0.07, 0.55, 'lowpass', 2800, 0.7);          // 闷响
  osc('sine', 150, t, 0.10, 0.5, 60);                  // 低频冲击
  osc('square', 900, t, 0.03, 0.18, 700);              // 梆子点
  if (perfect) { xylo(t + 0.02, 1567.98, 0.22); xylo(t + 0.09, 2093.00, 0.18); }
}

function sWhiff() {
  const t = actx.currentTime;
  noise(t, 0.08, 0.15, 'bandpass', 1400, 1.4);
  osc('sine', 500, t, 0.08, 0.08, 200);
}

function sMiss() {
  const t = actx.currentTime;
  osc('triangle', 240, t, 0.16, 0.4, 90);              // “咣”
  noise(t + 0.18, 0.12, 0.2, 'lowpass', 600, 0.8);     // 落地闷响
}

function jingle(win) {
  const t = actx.currentTime + 0.15;
  if (win) {
    [523.25, 659.26, 783.99, 1046.50].forEach((f, i) => xylo(t + i * 0.11, f, 0.30));
    trumpet(t + 0.5, 523.25, 0.7, 0.15);
    crash(t + 0.5);
  } else {                                              // 弱音小号下滑“哇——”
    trumpet(t, 392.00, 0.35, 0.14);
    trumpet(t + 0.4, 369.99, 0.35, 0.14);
    trumpet(t + 0.8, 349.23, 1.0, 0.15, 277.18);
  }
}

/* ---------------- 前瞻调度器 ---------------- */
function schedulerTick() {
  if (state !== 'playing' || paused) return;
  const ahead = actx.currentTime + LOOKAHEAD;
  while (true) {
    const beat = nextStep * 0.5;
    const t = beatTime(beat);
    if (t > ahead) break;
    scheduleMusic(beat, t);
    nextStep++;
  }
  while (melodyIdx < melodyEvents.length) {
    const m = melodyEvents[melodyIdx];
    const t = beatTime(m.b);
    if (t > ahead) break;
    trumpet(Math.max(t, actx.currentTime + 0.001), m.f, m.d, m.v);
    melodyIdx++;
  }
  for (const n of notes) {
    if (!n.cueDone && n.throwTime <= ahead) {
      slideWhistle(Math.max(n.throwTime, actx.currentTime + 0.001));
      n.cueDone = true;
    }
  }
}

function scheduleMusic(beat, t) {
  if (beat === FINAL_BEAT) { kickS(t); crash(t); return; }   // “two bits” 落点
  if (beat > GROOVE_END_BEAT) return;                        // 终止句区间只留小号
  const isOff = beat % 1 !== 0;
  const inBar = beat % 4;
  const ci = beat >= 68 ? 3 : Math.floor(beat / 4) % 4;      // 68 拍起强制 G7 导向终止
  if (!isOff) {
    ride(t, 0.20);
    if (inBar === 0 || inBar === 2) kickS(t);
    if (inBar === 1 || inBar === 3) { brush(t); chick(t); }
    bassN(t, beat >= 68 ? BASS_OUTRO[beat - 68] : BASS_WALK[beat % 16]);
    if (inBar === 0) compChord(t, CHORDS[ci], 0.05);
  } else {
    if (Math.floor(beat) % 2 === 1) ride(t, 0.13);           // ding-ding-a-ding 跳音
    if (inBar === 1.5) compChord(t, CHORDS[ci], 0.08);       // 查尔斯顿（Charleston）反拍
  }
}

/* ---------------- 流程控制 ---------------- */
function buildNotes() {
  return CHART_BEATS.map((b, i) => ({
    beat: b,
    hitTime: beatTime(b),
    throwTime: beatTime(b) - THROW_LEAD * BEAT,
    kind: i % 3,                       // 0 馅饼 / 1 铁砧 / 2 皮靴
    state: 'pending',                  // pending | hit | missed | gone
    judge: null,
    hitAt: 0,
    cueDone: false,
    landed: null,
  }));
}

function buildMelody() {
  const ev = [];
  for (const s of [0, 16, 32, 48])
    for (const [b, f, d] of RIFF) ev.push({ b: s + b, f, d, v: 0.11 });
  for (const [b, f, d] of LICK) ev.push({ b, f, d, v: 0.17 });
  return ev;
}

function startGame() {
  if (!actx) initAudio();
  actx.resume();
  songStart = actx.currentTime + 1.2;  // 1.2s 准备时间
  nextStep = 0;
  melodyIdx = 0;
  melodyEvents = buildMelody();
  notes = buildNotes();
  popups = [];
  stars = [];
  score = 0; combo = 0; maxCombo = 0;
  stats = { perfect: 0, good: 0, miss: 0 };
  punchAt = -10; powAt = -10; hatPopAt = -10;
  irisAt = actx.currentTime;
  finalRating = null;
  paused = false;
  state = 'playing';
  if (!schedTimer) schedTimer = setInterval(schedulerTick, 25);
}

function finish() {
  state = 'result';
  const total = notes.length;
  const acc = (stats.perfect + 0.5 * stats.good) / total;
  finalRating =
    acc >= 0.92 ? { text: '太棒了!!', sub: 'HIGH LEVEL' } :
    acc >= 0.65 ? { text: '合格!',    sub: 'PASS' } :
                  { text: '再练练吧…', sub: 'TRY AGAIN' };
  finalRating.acc = acc;
  jingle(acc >= 0.65);
}

function togglePause() {
  paused = !paused;
  if (actx) paused ? actx.suspend() : actx.resume();
}

/* ---------------- 判定 ---------------- */
function punch() {
  const now = actx.currentTime;
  punchAt = now;
  let best = null, bestD = Infinity;
  for (const n of notes) {
    if (n.state !== 'pending') continue;
    const d = Math.abs(now - n.hitTime);
    if (d <= GOOD_WIN && d < bestD) { best = n; bestD = d; }
  }
  if (best) {
    best.state = 'hit';
    best.hitAt = now;
    const perfect = bestD <= PERFECT_WIN;
    best.judge = perfect ? 'perfect' : 'good';
    score += perfect ? 100 : 50;
    stats[perfect ? 'perfect' : 'good']++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    powAt = now;
    powBig = perfect;
    sPunch(perfect);
    addPopup(perfect ? '完美!!' : '不错!', perfect ? 34 : 27);
    if (perfect) { hatPopAt = now; burst(); }
  } else {
    sWhiff();
  }
}

function update(now, songBeat) {
  for (const n of notes) {
    if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
      n.state = 'missed';
      combo = 0;
      stats.miss++;
      popups.push({ text: 'MISS…', size: 26, t0: now, x: HIT_X + 8, y: HIT_Y - 62 });
      sMiss();
    }
  }
  if (songBeat > RESULT_BEAT) finish();
}

/* ---------------- 特效 ---------------- */
function addPopup(text, size) {
  popups.push({ text, size, t0: actx.currentTime, x: HIT_X + 10, y: HIT_Y - 62 });
}

function burst() {
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 2 * i / 8 + Math.random() * 0.4;
    const sp = 220 + Math.random() * 160;
    stars.push({ x: HIT_X, y: HIT_Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, t0: actx.currentTime });
  }
}

/* ---------------- 绘制基础件 ---------------- */
function rrect(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function line(x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function text(str, x, y, size, fill, align, stroke, sw) {
  g.font = `900 ${size}px "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif`;
  g.textAlign = align || 'center';
  g.textBaseline = 'middle';
  if (sw) {
    g.lineWidth = sw;
    g.strokeStyle = stroke || CREAM;
    g.lineJoin = 'round';
    g.strokeText(str, x, y);
  }
  g.fillStyle = fill;
  g.fillText(str, x, y);
}

function star(cx, cy, r, rot, fill, stroke) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot || 0);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 5 * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill || CREAM;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  g.restore();
}

/* 多圆并集轮廓：先粗描每个圆，再整体填充盖掉内部线，只留外缘墨线 */
function blobOutline(circles, fill) {
  g.strokeStyle = INK;
  g.lineWidth = 7;
  for (const [cx, cy, r] of circles) {
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  }
  g.fillStyle = fill;
  g.beginPath();
  for (const [cx, cy, r] of circles) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, 7); }
  g.fill();
}

/* 派切眼（pie-cut eyes）：竖椭圆 + 朝左上的扇形缺口 */
function pieEye(cx, cy, rx, ry) {
  g.save();
  g.translate(cx, cy);
  g.scale(rx / ry, 1);
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, ry, -1.22, -2.27, false);
  g.closePath();
  g.fill();
  g.restore();
}

/* 橡皮管肢体：两点间外凸二次曲线 */
function hose(x1, y1, x2, y2, bulge, w) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  g.strokeStyle = INK;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.quadraticCurveTo(mx + nx * bulge, my + ny * bulge, x2, y2);
  g.stroke();
}

function glove(x, y, r) {
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
  g.beginPath(); g.arc(x - r * 0.55, y - r * 0.45, r * 0.42, 0, 7); g.fill(); g.stroke();
  g.lineWidth = 2.5;
  line(x - r * 0.2, y + r * 0.55, x + r * 0.45, y + r * 0.35);
}

function shoe(x, y, dir) {
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 3.5;
  g.beginPath(); g.ellipse(x + 5 * dir, y - 8, 17, 9, 0, 0, 7); g.fill(); g.stroke();
}

function cloud(x, y, s) {
  blobOutline([
    [x, y, 20 * s],
    [x + 22 * s, y - 11 * s, 16 * s],
    [x + 45 * s, y, 18 * s],
    [x + 22 * s, y + 6 * s, 15 * s],
  ], CREAM);
}

function hill(cx, cy, r) {
  g.fillStyle = MID;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fill();
  g.fillStyle = dotPat;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.stroke();
}

function tree(x, baseY, s, songBeat, phase) {
  const sq = (state === 'playing' && songBeat > 0) ? 1 + 0.05 * Math.sin(Math.PI * songBeat + phase) : 1;
  const topY = baseY - 52 * s * sq;
  g.strokeStyle = INK;
  g.lineWidth = 7 * s;
  g.lineCap = 'round';
  line(x, baseY, x, topY + 10);
  const c = [
    [x, topY - 8 * s, 24 * s],
    [x - 20 * s, topY + 4 * s, 16 * s],
    [x + 20 * s, topY + 4 * s, 16 * s],
  ];
  blobOutline(c, CREAM);
  g.fillStyle = dotPat;
  g.beginPath();
  for (const [cx, cy, r] of c) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, 7); }
  g.fill();
}

function wrapX(x0, speed, t) {
  const m = W + 260;
  return (((x0 - t * speed) % m) + m) % m - 130;
}

function beatPulse(songBeat) {
  if (songBeat <= 0) return 0;
  const frac = songBeat - Math.floor(songBeat);
  return Math.max(0, 1 - frac * 3);
}

/* ---------------- 场景绘制 ---------------- */
function drawBG(now, songBeat) {
  const pulse = beatPulse(songBeat);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // 太阳（含脸，随节拍轻微缩放）
  g.save();
  g.translate(800, 106);
  const ss = 1 + 0.04 * pulse;
  g.scale(ss, ss);
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(0, 0, 42, 0, 7); g.fill(); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + now * 0.05;
    line(Math.cos(a) * 52, Math.sin(a) * 52, Math.cos(a) * 62, Math.sin(a) * 62);
  }
  pieEye(-13, -6, 4.5, 7);
  pieEye(13, -6, 4.5, 7);
  g.lineWidth = 3;
  g.beginPath(); g.arc(0, 6, 15, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  g.restore();
  // 云
  const ct = now || performance.now() / 1000;
  cloud(wrapX(900, 14, ct), 92, 1.0);
  cloud(wrapX(400, 9, ct), 152, 0.8);
  cloud(wrapX(650, 11, ct), 58, 0.65);
  // 远山（半调网点）
  hill(170, GROUND_Y + 40, 150);
  hill(760, GROUND_Y + 60, 210);
  // 舞台地板
  g.fillStyle = LIGHT;
  g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  g.strokeStyle = INK;
  g.lineWidth = 3;
  line(0, GROUND_Y, W, GROUND_Y);
  g.strokeStyle = 'rgba(28,24,19,0.35)';
  g.lineWidth = 1.2;
  for (let x = 24; x < W; x += 88) line(x, GROUND_Y + 3, x, H);
  line(0, GROUND_Y + 36, W, GROUND_Y + 36);
  line(0, GROUND_Y + 80, W, GROUND_Y + 80);
  // 聚光灯（随节拍呼吸）
  g.fillStyle = `rgba(242,235,216,${0.22 + 0.16 * pulse})`;
  g.beginPath(); g.ellipse(340, GROUND_Y + 54, 300, 46, 0, 0, 7); g.fill();
  // 树（背景元素随节拍律动）
  tree(84, GROUND_Y, 0.95, songBeat, 0);
  tree(886, GROUND_Y, 0.75, songBeat, Math.PI / 2);
  // 命中点标记
  g.strokeStyle = 'rgba(28,24,19,0.5)';
  g.lineWidth = 3;
  g.setLineDash([7, 7]);
  g.beginPath(); g.arc(HIT_X, HIT_Y, 24, 0, 7); g.stroke();
  g.setLineDash([]);
}

/* 出拳动画包络：0-60ms 伸出，停 40ms，160ms 收回 */
function armExtent(now) {
  const dt = now - punchAt;
  if (dt < 0 || dt > 0.26) return 0;
  if (dt < 0.06) return dt / 0.06;
  if (dt < 0.10) return 1;
  return 1 - (dt - 0.10) / 0.16;
}

function pose(now, songBeat) {
  const ext = armExtent(now);
  return {
    ext,
    lean: 10 * ext,
    bob: (state === 'playing' && songBeat > 0) ? 3.5 * Math.abs(Math.sin(Math.PI * songBeat)) : 0,
  };
}

function drawChar(now, songBeat) {
  const { ext, lean, bob } = pose(now, songBeat);
  const hx = CHAR_X + lean;
  // 影子
  g.fillStyle = 'rgba(28,24,19,0.18)';
  g.beginPath(); g.ellipse(CHAR_X + 6, GROUND_Y + 8, 60, 10, 0, 0, 7); g.fill();
  // 鞋钉在地上，髋部随身体起伏 -> 软管腿自然拉伸
  shoe(CHAR_X - 30, GROUND_Y, -1);
  shoe(CHAR_X + 34, GROUND_Y, 1);
  const hipY = 376 - bob;
  hose(hx - 12, hipY, CHAR_X - 30, GROUND_Y - 12, 12 + bob * 2, 9);
  hose(hx + 14, hipY, CHAR_X + 34, GROUND_Y - 12, -(12 + bob * 2), 9);
  // 后侧防御臂（被躯干遮一半）
  hose(hx - 6, 316 - bob, hx + 30, 330 - bob, 12, 9);
  glove(hx + 36, 330 - bob, 12);
  // 躯干（墨色豆形）
  g.fillStyle = INK;
  g.beginPath(); g.ellipse(hx + 2, 336 - bob, 30, 42, 0, 0, 7); g.fill();
  // 拳击短裤（米色 + 两粒扣）
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  rrect(hx - 24, 348 - bob, 52, 26, 11); g.fill(); g.stroke();
  g.fillStyle = INK;
  g.beginPath(); g.arc(hx - 6, 361 - bob, 2.6, 0, 7); g.fill();
  g.beginPath(); g.arc(hx + 12, 361 - bob, 2.6, 0, 7); g.fill();
  // 头
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(hx + 10, 282 - bob, 28, 0, 7); g.fill(); g.stroke();
  // 派切眼（面朝右）
  pieEye(hx + 8, 276 - bob, 3.8, 6.5);
  pieEye(hx + 24, 276 - bob, 3.8, 6.5);
  // 鼻头
  g.fillStyle = INK;
  g.beginPath(); g.ellipse(hx + 34, 284 - bob, 4.5, 3.5, 0, 0, 7); g.fill();
  // 嘴（出拳时咧大）
  g.strokeStyle = INK;
  g.lineWidth = ext > 0.4 ? 3.5 : 2.5;
  g.beginPath(); g.arc(hx + 22, 288 - bob, ext > 0.4 ? 10 : 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  // 礼帽（完美时弹起）
  let hatJump = 0;
  const ht = now - hatPopAt;
  if (ht >= 0 && ht < 0.35) { const p = ht / 0.35; hatJump = 26 * 4 * p * (1 - p); }
  const hatY = 256 - bob - hatJump;
  g.fillStyle = INK;
  g.beginPath(); g.ellipse(hx + 10, hatY, 21, 5, 0, 0, 7); g.fill();
  rrect(hx - 2, hatY - 17, 24, 16, 5); g.fill();
  g.strokeStyle = CREAM;
  g.lineWidth = 2.5;
  line(hx - 1, hatY - 5, hx + 21, hatY - 5);
}

/* 出拳臂单独最后画，盖在物体上层 */
function drawArm(now, songBeat) {
  const { ext, lean, bob } = pose(now, songBeat);
  const hx = CHAR_X + lean;
  const sx = hx + 16, sy = 308 - bob;
  const gx = hx + 52, gy = 320 - bob;
  const fx = gx + (HIT_X - gx) * ext;
  const fy = gy + (HIT_Y - gy) * ext;
  hose(sx, sy, fx, fy, (1 - ext) * 14, 9);
  glove(fx, fy, 15 + 3 * ext);
  if (ext > 0.93) {
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const a of [-0.5, 0, 0.5]) {
      g.beginPath(); g.arc(fx, fy, 30, a - 0.2, a + 0.2); g.stroke();
    }
  }
}

function drawObj(kind, x, y, rot, alpha) {
  g.save();
  g.globalAlpha = alpha == null ? 1 : alpha;
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = INK;
  if (kind === 0) {             // 馅饼
    g.lineWidth = 3;
    g.fillStyle = LIGHT;
    g.beginPath(); g.ellipse(0, 8, 21, 7, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = CREAM;
    g.beginPath();
    g.moveTo(-17, 6);
    g.quadraticCurveTo(-19, -12, 0, -13);
    g.quadraticCurveTo(19, -12, 17, 6);
    g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(-6, -2, 4, Math.PI, 0); g.stroke();
    g.beginPath(); g.arc(6, -2, 4, Math.PI, 0); g.stroke();
  } else if (kind === 1) {      // 铁砧
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-22, -12); g.lineTo(16, -12);
    g.quadraticCurveTo(26, -10, 22, -2);
    g.lineTo(6, -2); g.lineTo(9, 10); g.lineTo(-13, 10); g.lineTo(-10, -2); g.lineTo(-22, -2);
    g.closePath(); g.fill();
    rrect(-16, 10, 28, 7, 2); g.fill();
    g.strokeStyle = CREAM;
    g.lineWidth = 2;
    line(-18, -9, 10, -9);
  } else {                      // 皮靴
    g.fillStyle = INK;
    rrect(-4, -18, 16, 20, 4); g.fill();
    rrect(-24, -2, 30, 12, 6); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    rrect(-6, -21, 20, 7, 3); g.fill(); g.stroke();
    g.fillStyle = CREAM;
    g.beginPath(); g.arc(2, -8, 1.8, 0, 7); g.fill();
    g.beginPath(); g.arc(6, -3, 1.8, 0, 7); g.fill();
  }
  g.restore();
}

function drawNotes(now) {
  for (const n of notes) {
    if (n.state === 'gone') continue;
    if (n.state === 'hit') {
      // 被击飞：向右上抛物线 + 旋转
      const t = now - n.hitAt;
      if (t > 1.3) { n.state = 'gone'; continue; }
      const f = n.judge === 'perfect' ? 1.35 : 1.0;
      const x = HIT_X + 880 * f * t;
      const y = HIT_Y - 600 * f * t + 1350 * t * t;
      drawObj(n.kind, x, y, 9 * t);
      continue;
    }
    if (now < n.throwTime) continue;
    // 飞行抛物线：p∈[0,1] 为投掷段，p>1 为漏击后的自然延伸下坠
    const p = (now - n.throwTime) / (THROW_LEAD * BEAT);
    const x = THROW_X + (HIT_X - THROW_X) * p;
    const y = THROW_Y + (HIT_Y - THROW_Y) * p - 520 * p * (1 - p);
    if (n.state === 'missed') {
      if (!n.landed && y >= GROUND_Y - 14) n.landed = { x, at: now };
      if (n.landed) {
        const a = 1 - (now - n.landed.at) / 0.8;
        if (a <= 0) { n.state = 'gone'; continue; }
        drawObj(n.kind, n.landed.x, GROUND_Y - 14, 0.5, a);
        continue;
      }
    }
    drawObj(n.kind, x, y, p * 1.2);
    if (p < 1.05) {
      g.fillStyle = 'rgba(28,24,19,0.12)';
      g.beginPath(); g.ellipse(x, GROUND_Y + 4, 18, 5, 0, 0, 7); g.fill();
    }
  }
}

/* 命中爆闪（漫画式锯齿星） */
const POW_J = [1, 0.86, 1.05, 0.92, 1.1, 0.88, 1.02, 0.9, 1.07, 0.85, 1.04, 0.93];
function drawPow(now) {
  const t = now - powAt;
  if (t < 0 || t > 0.16) return;
  const a = 1 - t / 0.16;
  const R = (powBig ? 60 : 44) * (0.75 + t * 2.2);
  g.save();
  g.translate(HIT_X, HIT_Y);
  g.rotate(t * 2.5);
  g.globalAlpha = a;
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const ang = Math.PI * i / 12;
    const r = (i % 2 === 0 ? R : R * 0.52) * POW_J[(i >> 1) % 12];
    if (i === 0) g.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
    else g.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
  }
  g.closePath();
  g.fillStyle = CREAM;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.stroke();
  g.restore();
  g.globalAlpha = 1;
}

function drawFX(now) {
  stars = stars.filter(s => now - s.t0 < 0.55);
  for (const s of stars) {
    const t = now - s.t0, a = 1 - t / 0.55;
    g.globalAlpha = a;
    star(s.x + s.vx * t, s.y + s.vy * t + 500 * t * t, 11 * (1 - t * 0.8), t * 7, CREAM, INK);
    g.globalAlpha = 1;
  }
  popups = popups.filter(p => now - p.t0 < 0.65);
  for (const p of popups) {
    const t = now - p.t0;
    const a = 1 - Math.max(0, (t - 0.3) / 0.35);
    g.globalAlpha = a;
    text(p.text, p.x, p.y - 46 * t, p.size, INK, 'center', CREAM, 6);
    g.globalAlpha = 1;
  }
}

/* ---------------- 老电影字幕卡与 UI ---------------- */
function cardFrame(x, y, w, h) {
  g.strokeStyle = CREAM;
  g.lineWidth = 4;
  g.strokeRect(x, y, w, h);
  g.lineWidth = 1.5;
  g.strokeRect(x + 10, y + 10, w - 20, h - 20);
  g.fillStyle = CREAM;
  for (const [cx, cy] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + h - 10], [x + w - 10, y + h - 10]]) {
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.fillRect(-4, -4, 8, 8);
    g.restore();
  }
}

function drawTitle() {
  const t = performance.now() / 1000;
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  cardFrame(36, 30, W - 72, H - 60);
  text('橡皮管拳击！', W / 2, 152, 64, CREAM);
  text('— RUBBER HOSE BOXING —', W / 2, 210, 20, MID);
  star(W / 2 - 220, 210, 7, 0.3, MID);
  star(W / 2 + 220, 210, 7, -0.3, MID);
  text('爵士鼓点摇摆不停，杂物飞到面前的一瞬，', W / 2, 272, 22, CREAM);
  text('按【空格 / J / 点击】挥拳击飞！', W / 2, 306, 22, CREAM);
  text('完美 ±60ms ・ 不错 ±115ms ・ P 暂停', W / 2, 346, 16, MID);
  if (Math.floor(t * 2) % 2 === 0) text('▶ 按任意键开演', W / 2, 400, 28, CREAM);
  text('INKWELL PICTURES 出品 · MCMXXVI', W / 2, 462, 14, MID);
}

function drawResult() {
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  cardFrame(36, 30, W - 72, H - 60);
  text('—— 演奏终了 ——', W / 2, 116, 30, MID);
  text(finalRating.text, W / 2, 190, 56, CREAM);
  star(W / 2 - 170, 190, 9, 0.3, CREAM);
  star(W / 2 + 170, 190, 9, -0.3, CREAM);
  text(finalRating.sub, W / 2, 238, 20, MID);
  text(`完美 ${stats.perfect}　不错 ${stats.good}　失误 ${stats.miss}`, W / 2, 300, 24, CREAM);
  text(`最高连击 ${maxCombo}　准确率 ${(finalRating.acc * 100).toFixed(1)}%`, W / 2, 338, 20, MID);
  text('得分 ' + score, W / 2, 388, 32, CREAM);
  text('按【空格】再演一场', W / 2, 440, 20, MID);
}

function drawUI(now, songBeat) {
  if (state === 'playing') {
    // 进度条
    const pr = Math.min(Math.max(songBeat, 0) / RESULT_BEAT, 1);
    g.fillStyle = 'rgba(28,24,19,0.45)';
    g.fillRect(0, 0, W * pr, 5);
    // 分数牌
    g.fillStyle = CREAM;
    rrect(16, 14, 178, 46, 8); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeRect(22, 20, 166, 34);
    text('得分 ' + score, 105, 38, 22, INK);
    if (combo >= 2) text(combo + ' 连击!', W / 2, 86, 34, INK, 'center', CREAM, 8);
    if (songBeat < 0) text('预备……', W / 2, 200, 44, INK, 'center', CREAM, 9);
    else if (songBeat < 7.2) text('杂物飞到虚线圈时，按【空格】挥拳！', W / 2, 498, 22, INK, 'center', CREAM, 6);
  }
  if (state === 'title') drawTitle();
  if (state === 'result') drawResult();
  if (paused) {
    g.fillStyle = 'rgba(28,24,19,0.78)';
    g.fillRect(0, 0, W, H);
    cardFrame(W / 2 - 200, H / 2 - 90, 400, 180);
    text('幕间休息', W / 2, H / 2 - 18, 40, CREAM);
    text('按 P 继续', W / 2, H / 2 + 36, 20, MID);
  }
}

/* 圈入转场（iris-in）：开场黑幕收圆 */
function drawIris() {
  if (irisAt < 0 || !actx) return;
  const t = (actx.currentTime - irisAt) / 0.8;
  if (t >= 1) { irisAt = -1; return; }
  const R = Math.hypot(W, H) * 0.62 * Math.max(t, 0.001);
  g.fillStyle = INK;
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(W / 2, H / 2, R, 0, 7);
  g.fill('evenodd');
}

/* 胶片效果：颗粒 / 划痕 / 闪烁 / 暗角（使用挂钟，暂停时胶片继续转） */
function drawFilmFX(rt) {
  g.fillStyle = 'rgba(28,24,19,0.05)';
  for (let i = 0; i < 26; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
  g.fillStyle = 'rgba(244,239,226,0.06)';
  for (let i = 0; i < 14; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
  if (Math.random() < 0.06) {
    g.fillStyle = 'rgba(28,24,19,0.08)';
    g.fillRect(Math.random() * W, 0, 1.2, H);
  }
  if (Math.random() < 0.03) {
    g.fillStyle = 'rgba(244,239,226,0.10)';
    g.fillRect(Math.random() * W, 0, 1, H);
  }
  const fl = 0.02 + 0.018 * Math.sin(rt * 11.3) + 0.012 * Math.sin(rt * 29.7);
  if (fl > 0) {
    g.fillStyle = `rgba(28,24,19,${fl})`;
    g.fillRect(0, 0, W, H);
  }
  g.drawImage(vig, 0, 0, W, H);
}

/* ---------------- 主循环 ---------------- */
function frame() {
  const now = actx ? actx.currentTime : 0;
  const songBeat = actx ? (now - songStart) / BEAT : 0;
  const rt = performance.now() / 1000;
  if (state === 'playing' && !paused) update(now, songBeat);
  drawBG(actx ? now : 0, state === 'title' ? 0 : songBeat);
  drawChar(now, songBeat);
  drawNotes(now);
  drawPow(now);
  drawArm(now, songBeat);
  drawFX(now);
  drawUI(now, songBeat);
  drawIris();
  drawFilmFX(rt);
  requestAnimationFrame(frame);
}

/* ---------------- 输入 ---------------- */
window.addEventListener('keydown', e => {
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (state === 'playing' && e.code === 'KeyP') { togglePause(); return; }
  if (state === 'playing') {
    if (!paused && (e.code === 'Space' || e.code === 'KeyJ')) punch();
  } else if (state === 'title' || (state === 'result' && (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'Enter'))) {
    startGame();
  }
});

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (state === 'playing') {
    if (!paused) punch();
  } else {
    startGame();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing' && !paused) togglePause();
});

/* ---------------- 画布与离屏资源初始化 ---------------- */
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr;
canvas.height = H * dpr;
g.setTransform(dpr, 0, 0, dpr, 0, 0);

/* 半调网点图案（halftone）：7px 平铺小片 */
const dots = document.createElement('canvas');
dots.width = dots.height = 7;
const dg = dots.getContext('2d');
dg.fillStyle = 'rgba(28,24,19,0.45)';
dg.beginPath();
dg.arc(3.5, 3.5, 1.25, 0, 7);
dg.fill();
const dotPat = g.createPattern(dots, 'repeat');

/* 暗角（vignette）：离屏一次性生成 */
const vig = document.createElement('canvas');
vig.width = W;
vig.height = H;
const vg = vig.getContext('2d');
const rad = vg.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
rad.addColorStop(0, 'rgba(20,16,12,0)');
rad.addColorStop(1, 'rgba(20,16,12,0.42)');
vg.fillStyle = rad;
vg.fillRect(0, 0, W, H);

function fit() {
  const s = Math.min((window.innerWidth - 64) / W, (window.innerHeight - 120) / H, 1.3);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

requestAnimationFrame(frame);
