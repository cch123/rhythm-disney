'use strict';

/* ============================================================================
 * core.js —— 共享引擎
 * 橡皮管歌舞秀 RUBBER HOSE REVUE：菜单 + 三个节奏小游戏的公共底座
 *
 *   - 单一时钟源：判定与动画插值均以 AudioContext.currentTime 为基准，
 *     避免 rAF (requestAnimationFrame，浏览器渲染回调) 时钟与音频时钟漂移。
 *   - 前瞻调度（lookahead scheduling）：setInterval(25ms) 轮询，把未来 120ms
 *     内的音符提前提交给 Web Audio 的采样级定时队列。
 *   - 摇摆量化（swing）：八分反拍推迟到拍内 SWING 处，配乐与判定共用网格。
 *   - 暂停 = AudioContext.suspend()：音频时钟冻结，恢复后时序天然一致。
 *
 * 游戏模块通过 registerGame({...}) 注册，约定接口：
 *   { id, title, subtitle, menuDesc, bpm, swing, resultBeat,
 *     init(), scheduleStep(beat,t), scheduleAhead(ahead),
 *     onPress(now), onRelease(now)?, update(now,songBeat),
 *     draw(now,songBeat), onExit()? }
 * ========================================================================== */

/* ---------------- 常量 ---------------- */
const W = 960, H = 540;
const PERFECT_WIN = 0.060;             // 完美判定窗口（秒）
const GOOD_WIN = 0.115;                // 不错判定窗口（秒）
const LOOKAHEAD = 0.12;                // 音频调度前瞻（秒）
const GROUND_Y = 430;

/* 单色赛璐珞调色板 */
const INK = '#1c1813';
const CREAM = '#f2ebd8';
const PAPER = '#e7dfc8';
const LIGHT = '#d9d1b9';
const MID = '#a89e87';

/* ---------------- 运行时状态 ---------------- */
const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

const GAMES = [];
let cur = null;                        // 当前游戏模块
let actx = null, master = null, noiseBuf = null;
let state = 'menu';                    // menu | playing | result
let paused = false;
let songStart = 0;
let BPM = 120, BEAT = 0.5, SWING = 0.64;
let nextStep = 0;                      // 八分音符步进指针（beat = nextStep * 0.5）
let schedTimer = null;

let score = 0, combo = 0, maxCombo = 0;
let stats = { perfect: 0, good: 0, miss: 0 };
let popups = [], stars = [];
let activeVoices = [];                 // 已预定的持续人声（退出时需要掐断）
let irisAt = -1;                       // 圈入转场（iris-in）起点
let finalRating = null;

function registerGame(game) { GAMES.push(game); }

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

/* 人声（合唱用）：双振荡器 + 低通 + 颤音 */
function makeVoice(f) {
  const o1 = actx.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = f;
  const o2 = actx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = f * 2.001;
  const vib = actx.createOscillator();
  vib.frequency.value = 5;
  const vg = actx.createGain();
  vg.gain.value = f * 0.01;
  vib.connect(vg);
  vg.connect(o1.frequency);
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 1.2;
  const g2 = actx.createGain();
  g2.gain.value = 0.25;
  const gn = actx.createGain();
  gn.gain.value = 0;
  o1.connect(lp);
  o2.connect(g2);
  g2.connect(lp);
  lp.connect(gn);
  gn.connect(master);
  return { o1, o2, vib, gn };
}

/* 预定区间人声（自动歌手）：t0 起声，t1 收声 */
function voiceAt(t0, t1, f, vol) {
  const v = makeVoice(f);
  v.gn.gain.setValueAtTime(0.0001, t0);
  v.gn.gain.linearRampToValueAtTime(vol, t0 + 0.08);
  v.gn.gain.setValueAtTime(vol, Math.max(t0 + 0.09, t1 - 0.06));
  v.gn.gain.linearRampToValueAtTime(0.0001, t1 + 0.06);
  [v.o1, v.o2, v.vib].forEach(o => { o.start(t0); o.stop(t1 + 0.2); });
  activeVoices.push(v);
}

/* 即时人声（玩家长按）：返回句柄，松手时 stop() */
function voiceStart(f, vol) {
  const t = actx.currentTime;
  const v = makeVoice(f);
  v.gn.gain.setValueAtTime(0.0001, t);
  v.gn.gain.linearRampToValueAtTime(vol, t + 0.06);
  [v.o1, v.o2, v.vib].forEach(o => o.start(t));
  return {
    stop() {
      const ts = actx.currentTime;
      v.gn.gain.cancelScheduledValues(ts);
      v.gn.gain.setValueAtTime(v.gn.gain.value, ts);
      v.gn.gain.linearRampToValueAtTime(0.0001, ts + 0.08);
      [v.o1, v.o2, v.vib].forEach(o => { try { o.stop(ts + 0.15); } catch (e) {} });
    },
  };
}

/* 退出/重开时掐断所有已预定人声，避免余音拖进菜单 */
function killVoices() {
  if (!actx) { activeVoices = []; return; }
  const t = actx.currentTime;
  for (const v of activeVoices) {
    try {
      v.gn.gain.cancelScheduledValues(t);
      v.gn.gain.setValueAtTime(v.gn.gain.value, t);
      v.gn.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      [v.o1, v.o2, v.vib].forEach(o => o.stop(t + 0.15));
    } catch (e) {}
  }
  activeVoices = [];
}

/* 爵士套鼓与共用配器 */
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

/* 滑笛（slide whistle）上滑：卡通投掷提示音 */
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

/* ---------------- 判定与计分 ---------------- */
/* 在待判定列表中找窗口内最近的一项；命中由调用方落账 */
function matchPress(list, now) {
  let best = null, bestD = Infinity;
  for (const n of list) {
    if (n.state !== 'pending') continue;
    const d = Math.abs(now - n.hitTime);
    if (d <= GOOD_WIN && d < bestD) { best = n; bestD = d; }
  }
  return best ? { note: best, perfect: bestD <= PERFECT_WIN } : null;
}

function award(perfect, x, y) {
  score += perfect ? 100 : 50;
  stats[perfect ? 'perfect' : 'good']++;
  combo++;
  if (combo > maxCombo) maxCombo = combo;
  addPopup(perfect ? '完美!!' : '不错!', perfect ? 34 : 27, x, y);
}

function missMark(x, y) {
  stats.miss++;
  combo = 0;
  popups.push({ text: 'MISS…', size: 26, t0: actx.currentTime, x, y });
}

/* ---------------- 特效 ---------------- */
function addPopup(text, size, x, y) {
  popups.push({ text, size, t0: actx.currentTime, x, y });
}

function burstStars(x, y) {
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 2 * i / 8 + Math.random() * 0.4;
    const sp = 220 + Math.random() * 160;
    stars.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, t0: actx.currentTime });
  }
}

function drawFXLayer(now) {
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

/* ---------------- 场景：户外（拳击用） ---------------- */
function drawOutdoor(now, songBeat) {
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
  // 地板
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
  // 聚光（随节拍呼吸）
  g.fillStyle = `rgba(242,235,216,${0.22 + 0.16 * pulse})`;
  g.beginPath(); g.ellipse(340, GROUND_Y + 54, 300, 46, 0, 0, 7); g.fill();
  // 树（背景元素随节拍律动）
  tree(84, GROUND_Y, 0.95, songBeat, 0);
  tree(886, GROUND_Y, 0.75, songBeat, Math.PI / 2);
}

/* ---------------- 场景：剧院舞台（踢踏 / 合唱用） ---------------- */
function drawStageBack(now, songBeat) {
  const pulse = beatPulse(songBeat);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // 后幕（中灰布幔 + 折痕 + 网点）
  g.fillStyle = MID;
  g.fillRect(70, 64, W - 140, GROUND_Y - 64);
  g.fillStyle = dotPat;
  g.fillRect(70, 64, W - 140, GROUND_Y - 64);
  g.strokeStyle = 'rgba(28,24,19,0.4)';
  g.lineWidth = 2;
  for (let x = 110; x < W - 90; x += 56) {
    g.beginPath();
    g.moveTo(x, 68);
    g.quadraticCurveTo(x + 8, (64 + GROUND_Y) / 2, x, GROUND_Y - 4);
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(70, 64, W - 140, GROUND_Y - 64);
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
  // 台心柔光
  g.fillStyle = `rgba(242,235,216,${0.10 + 0.10 * pulse})`;
  g.beginPath(); g.ellipse(W / 2, GROUND_Y + 40, 360, 52, 0, 0, 7); g.fill();
}

function drawStageFront(now, songBeat) {
  const pulse = beatPulse(songBeat);
  // 侧幕
  g.fillStyle = INK;
  g.fillRect(0, 0, 86, H);
  g.fillRect(W - 86, 0, 86, H);
  g.strokeStyle = 'rgba(242,235,216,0.18)';
  g.lineWidth = 3;
  for (const x of [18, 40, 62]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.quadraticCurveTo(x + 10, H / 2, x, H);
    g.stroke();
    g.beginPath();
    g.moveTo(W - x, 0);
    g.quadraticCurveTo(W - x - 10, H / 2, W - x, H);
    g.stroke();
  }
  // 上沿帷幔（scalloped valance）
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 46);
  for (let x = 0; x < W; x += 80) g.quadraticCurveTo(x + 40, 88, x + 80, 46);
  g.lineTo(W, 0);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(242,235,216,0.3)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 46);
  for (let x = 0; x < W; x += 80) g.quadraticCurveTo(x + 40, 88, x + 80, 46);
  g.stroke();
  // 脚灯（footlights）
  for (let x = 130; x < W - 100; x += 110) {
    g.fillStyle = `rgba(242,235,216,${0.14 + 0.12 * pulse})`;
    g.beginPath(); g.ellipse(x, H - 42, 36, 24, 0, 0, 7); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath(); g.arc(x, H - 6, 13, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
  }
}

/* ---------------- 流程控制 ---------------- */
function startGame(game) {
  cur = game;
  if (!actx) initAudio();
  actx.resume();
  killVoices();
  BPM = game.bpm;
  BEAT = 60 / BPM;
  SWING = game.swing;
  songStart = actx.currentTime + 1.2;  // 1.2s 准备时间
  nextStep = 0;
  score = 0; combo = 0; maxCombo = 0;
  stats = { perfect: 0, good: 0, miss: 0 };
  popups = [];
  stars = [];
  finalRating = null;
  paused = false;
  irisAt = actx.currentTime;
  game.init();
  state = 'playing';
  if (!schedTimer) schedTimer = setInterval(schedulerTick, 25);
}

function finishGame() {
  state = 'result';
  cur.onExit && cur.onExit();
  const total = stats.perfect + stats.good + stats.miss;
  const acc = total ? (stats.perfect + 0.5 * stats.good) / total : 0;
  finalRating =
    acc >= 0.92 ? { text: '太棒了!!', sub: 'HIGH LEVEL' } :
    acc >= 0.65 ? { text: '合格!',    sub: 'PASS' } :
                  { text: '再练练吧…', sub: 'TRY AGAIN' };
  finalRating.acc = acc;
  jingle(acc >= 0.65);
}

function exitToMenu() {
  cur && cur.onExit && cur.onExit();
  killVoices();
  if (paused) { paused = false; actx && actx.resume(); }
  popups = [];
  stars = [];
  state = 'menu';
}

function pauseToggle() {
  paused = !paused;
  if (paused) {
    cur && cur.onRelease && cur.onRelease(actx.currentTime);
    actx.suspend();
  } else {
    actx.resume();
  }
}

/* ---------------- 前瞻调度器 ---------------- */
function schedulerTick() {
  if (state !== 'playing' || paused || !cur) return;
  const ahead = actx.currentTime + LOOKAHEAD;
  while (true) {
    const beat = nextStep * 0.5;
    const t = beatTime(beat);
    if (t > ahead) break;
    cur.scheduleStep(beat, t);
    nextStep++;
  }
  cur.scheduleAhead && cur.scheduleAhead(ahead);
}

/* ---------------- 字幕卡与 UI ---------------- */
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

const MENU_Y0 = 196, MENU_DY = 64;

function drawMenu(rt) {
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  cardFrame(36, 30, W - 72, H - 60);
  text('今晚节目单', W / 2, 96, 44, CREAM);
  text("— TONIGHT'S PROGRAMME · RUBBER HOSE REVUE —", W / 2, 142, 15, MID);
  GAMES.forEach((game, i) => {
    const y = MENU_Y0 + i * MENU_DY;
    text(`${i + 1} · ${game.title}`, W / 2, y - 11, 26, CREAM);
    text(`${game.subtitle} ・ ${game.menuDesc}`, W / 2, y + 15, 13, MID);
  });
  if (Math.floor(rt * 2) % 2 === 0) text(`▶ 按 1-${GAMES.length} 或点击选择节目`, W / 2, 492, 20, CREAM);
}

function menuIndexAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  for (let i = 0; i < GAMES.length; i++) {
    const ry = MENU_Y0 + i * MENU_DY;
    if (x > 120 && x < W - 120 && y > ry - 30 && y < ry + 32) return i;
  }
  return -1;
}

function drawResult() {
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  cardFrame(36, 30, W - 72, H - 60);
  text(cur.title, W / 2, 84, 18, MID);
  text('—— 演奏终了 ——', W / 2, 122, 28, MID);
  text(finalRating.text, W / 2, 192, 56, CREAM);
  star(W / 2 - 170, 192, 9, 0.3, CREAM);
  star(W / 2 + 170, 192, 9, -0.3, CREAM);
  text(finalRating.sub, W / 2, 240, 20, MID);
  text(`完美 ${stats.perfect}　不错 ${stats.good}　失误 ${stats.miss}`, W / 2, 300, 24, CREAM);
  text(`最高连击 ${maxCombo}　准确率 ${(finalRating.acc * 100).toFixed(1)}%`, W / 2, 338, 20, MID);
  text('得分 ' + score, W / 2, 386, 32, CREAM);
  text('空格 再演一场 ・ Esc 回节目单', W / 2, 438, 20, MID);
}

function drawHUD(now, songBeat) {
  const pr = Math.min(Math.max(songBeat, 0) / cur.resultBeat, 1);
  g.fillStyle = 'rgba(28,24,19,0.45)';
  g.fillRect(0, 0, W * pr, 5);
  g.fillStyle = CREAM;
  rrect(16, 14, 178, 46, 8); g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.stroke();
  g.lineWidth = 1.2;
  g.strokeRect(22, 20, 166, 34);
  text('得分 ' + score, 105, 38, 22, INK);
  text(cur.subtitle, W - 100, 32, 13, 'rgba(28,24,19,0.55)', 'center');
  if (combo >= 2) text(combo + ' 连击!', W / 2, 86, 34, INK, 'center', CREAM, 8);
  if (songBeat < 0) text('预备……', W / 2, 200, 44, INK, 'center', CREAM, 9);
}

function drawPaused() {
  g.fillStyle = 'rgba(28,24,19,0.78)';
  g.fillRect(0, 0, W, H);
  cardFrame(W / 2 - 200, H / 2 - 90, 400, 180);
  text('幕间休息', W / 2, H / 2 - 18, 40, CREAM);
  text('P 继续 ・ Esc 回节目单', W / 2, H / 2 + 36, 18, MID);
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
  const songBeat = (actx && cur) ? (now - songStart) / BEAT : 0;
  const rt = performance.now() / 1000;
  if (state === 'playing' && !paused) {
    cur.update(now, songBeat);
    if (songBeat > cur.resultBeat) finishGame();
  }
  if (state === 'menu') {
    drawMenu(rt);
  } else {
    cur.draw(now, songBeat);
    drawFXLayer(now);
    if (state === 'playing') drawHUD(now, songBeat);
    if (state === 'result') drawResult();
  }
  if (paused) drawPaused();
  drawIris();
  drawFilmFX(rt);
  requestAnimationFrame(frame);
}

/* ---------------- 输入 ---------------- */
/* 键位隔离原则：
 *   - 带 Cmd / Ctrl / Alt 修饰键的组合一律放行给浏览器，不进入游戏；
 *   - 游戏消费的裸按键统一 preventDefault + stopPropagation，
 *     阻断浏览器默认行为（空格滚动、Enter 激活焦点元素等）；
 *   - 其余按键完全不拦截。 */
const GAME_KEYS = new Set([
  'Space', 'KeyJ', 'KeyP', 'Escape', 'Enter', 'KeyM',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5',
]);
const MENU_DIGIT = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4,
};

window.addEventListener('keydown', e => {
  if (e.isComposing) return;                           // 输入法组合中
  if (e.metaKey || e.ctrlKey || e.altKey) return;      // 浏览器快捷键放行
  if (!GAME_KEYS.has(e.code)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  if (state === 'playing') {
    if (e.code === 'KeyP') { pauseToggle(); return; }
    if (e.code === 'Escape') { exitToMenu(); return; }
    if (!paused && (e.code === 'Space' || e.code === 'KeyJ')) cur.onPress(actx.currentTime);
  } else if (state === 'result') {
    if (e.code === 'Escape' || e.code === 'KeyM') { exitToMenu(); return; }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ') startGame(cur);
  } else {
    const i = MENU_DIGIT[e.code];
    if (i != null && GAMES[i]) startGame(GAMES[i]);
  }
});

window.addEventListener('keyup', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  /* 松键不按修饰键过滤：长按期间即使误触了修饰键，松手也必须触发收声 */
  if (state === 'playing' && !paused && (e.code === 'Space' || e.code === 'KeyJ') && cur && cur.onRelease) {
    cur.onRelease(actx.currentTime);
  }
});

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;                          // 仅响应主键，右键/中键交还浏览器
  e.preventDefault();
  if (state === 'playing') {
    if (!paused) cur.onPress(actx.currentTime);
  } else if (state === 'result') {
    startGame(cur);
  } else {
    const i = menuIndexAt(e);
    if (i >= 0) startGame(GAMES[i]);
  }
});

canvas.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (state === 'playing' && !paused && cur && cur.onRelease) cur.onRelease(actx.currentTime);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing' && !paused) pauseToggle();
});

/* 窗口失焦（如 Cmd+Tab 切走）自动进入幕间休息，长按状态由 pauseToggle 内的强制收声兜底 */
window.addEventListener('blur', () => {
  if (state === 'playing' && !paused) pauseToggle();
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
const vgc = vig.getContext('2d');
const rad = vgc.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
rad.addColorStop(0, 'rgba(20,16,12,0)');
rad.addColorStop(1, 'rgba(20,16,12,0.42)');
vgc.fillStyle = rad;
vgc.fillRect(0, 0, W, H);

function fit() {
  const s = Math.min((window.innerWidth - 64) / W, (window.innerHeight - 120) / H, 1.3);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

requestAnimationFrame(frame);
