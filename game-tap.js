'use strict';

/* ============================================================================
 * 节目二：踢踏回声 ECHO TAPS
 * 机制：呼叫-应答（call & response）—— 搭档先在 4 拍内踏出一段舞步，
 *       下一个 4 拍你按相同的相对节拍原样踏回去。考节奏记忆而非反应。
 * 配乐：跨步钢琴（stride piano，低音八度与和弦柱交替的 oom-pah 织体），
 *       质地刻意稀疏，给踏步声留出前景。
 * ========================================================================== */
(() => {

  /* 舞步谱：每段的踏点（相对小节起点的拍偏移，x.5 = 摇摆反拍） */
  const PATTERNS = [
    [0, 2],
    [0, 1, 2],
    [0, 2, 2.5],
    [0, 1.5, 2],
    [0, 0.5, 1, 2],
    [0, 1, 1.5, 2],
    [0, 0.5, 2, 2.5],
    [0, 1, 2, 2.5, 3],
    [0, 0.5, 1, 1.5, 2, 3],
  ];
  const INTRO = 8;                       // 前奏拍数
  const PAIR = 8;                        // 一组 = 4 拍呼叫 + 4 拍应答
  const END = INTRO + PATTERNS.length * PAIR;   // 80
  const CALLER_X = 330, PLAYER_X = 610;

  /* 跨步钢琴：F6 -> D7 -> Gm7 -> C7，每小节换一格 */
  const T_CHORDS = [
    [174.61, 220.00, 261.63, 293.66],    // F6
    [146.83, 185.00, 220.00, 261.63],    // D7
    [196.00, 233.08, 293.66, 349.23],    // Gm7
    [196.00, 233.08, 261.63, 329.63],    // C7
  ];
  const T_BASS = [[87.31, 130.81], [73.42, 110.00], [98.00, 146.83], [65.41, 98.00]];

  /* ---- 模块内状态 ---- */
  let notes = [], pairNotes = [], callTaps = [], hups = [];
  let callIdx = 0, hupIdx = 0;
  let playerTapAt = -10, playerLeg = 0;

  /* ---- 音效 ---- */
  const tapCall = t => { osc('square', 1500, t, 0.045, 0.22, 1000); noise(t, 0.03, 0.12, 'highpass', 6000, 1); };
  function tapHit(perfect) {
    const t = actx.currentTime;
    osc('square', 1050, t, 0.05, 0.26, 700);
    noise(t, 0.035, 0.14, 'highpass', 5000, 1);
    if (perfect) xylo(t + 0.02, 1567.98, 0.18);
  }
  function tapWhiff() {
    const t = actx.currentTime;
    osc('square', 650, t, 0.05, 0.10, 480);
  }
  function missTone() {
    const t = actx.currentTime;
    osc('triangle', 200, t, 0.15, 0.3, 90);
  }
  const hupCue = t => osc('sine', 620, t, 0.09, 0.2, 940);   // “唔哼！”换班提示

  /* ---- 踢腿包络：0-70ms 抬起，停 50ms，120ms 放下 ---- */
  function kickEnv(dt) {
    if (dt < 0 || dt > 0.24) return 0;
    if (dt < 0.07) return dt / 0.07;
    if (dt < 0.12) return 1;
    return 1 - (dt - 0.12) / 0.12;
  }

  /* ---- 舞者（正面朝观众） ---- */
  function drawDancer(x, isCaller, env, legSide, now, songBeat) {
    const bob = (state === 'playing' && songBeat > 0) ? 2.5 * Math.abs(Math.sin(Math.PI * songBeat)) : 0;
    const lift = 6 * env;
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(x, GROUND_Y + 8, 46, 9, 0, 0, 7); g.fill();
    const kd = legSide ? 1 : -1;
    const hipY = 378 - bob - lift;
    // 支撑腿
    shoe(x - kd * 16, GROUND_Y, -kd);
    hose(x - kd * 8, hipY, x - kd * 16, GROUND_Y - 12, -kd * 10, 8);
    // 踢腿
    if (env > 0.02) {
      const kx = x + kd * (22 + 18 * env), ky = GROUND_Y - 44 * env;
      hose(x + kd * 8, hipY, kx, ky - 6, kd * 14, 8);
      shoe(kx, ky + 6, kd);
    } else {
      shoe(x + kd * 16, GROUND_Y, kd);
      hose(x + kd * 8, hipY, x + kd * 16, GROUND_Y - 12, kd * 10, 8);
    }
    // 平衡臂
    hose(x - 14, 322 - bob - lift, x - 36 - 12 * env, 334 - bob - lift - 34 * env, 12, 8);
    glove(x - 38 - 12 * env, 334 - bob - lift - 34 * env, 10);
    // 躯干
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, 342 - bob - lift, 24, 36, 0, 0, 7); g.fill();
    // 领结
    g.fillStyle = CREAM;
    g.beginPath();
    g.moveTo(x, 314 - bob - lift);
    g.lineTo(x - 10, 309 - bob - lift); g.lineTo(x - 10, 319 - bob - lift); g.lineTo(x, 314 - bob - lift);
    g.lineTo(x + 10, 309 - bob - lift); g.lineTo(x + 10, 319 - bob - lift);
    g.closePath(); g.fill();
    // 手杖臂
    const chx = x + 32 + 10 * env, chy = 330 - bob - lift - 52 * env;
    hose(x + 14, 322 - bob - lift, chx, chy, -12, 8);
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    line(chx, chy, chx + 8 + 46 * env, chy + 62 - 100 * env);
    glove(chx, chy, 10);
    // 头
    const hy = 286 - bob - lift;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(x, hy, 24, 0, 7); g.fill(); g.stroke();
    pieEye(x - 8, hy - 4, 3.5, 6);
    pieEye(x + 8, hy - 4, 3.5, 6);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, hy + 3, 3.5, 2.8, 0, 0, 7); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(x, hy + 8, env > 0.3 ? 8 : 6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    if (isCaller) {                      // 搭档蓄小胡子
      g.beginPath(); g.arc(x - 5, hy + 6, 4.5, Math.PI * 1.05, Math.PI * 1.85); g.stroke();
      g.beginPath(); g.arc(x + 5, hy + 6, 4.5, Math.PI * 1.15, Math.PI * 1.95); g.stroke();
    }
    // 草帽（boater），踢腿时俏皮歪一下
    g.save();
    g.translate(x, hy - 22);
    g.rotate(-0.18 * env * kd);
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, 2, 22, 4.5, 0, 0, 7); g.fill(); g.stroke();
    rrect(-14, -12, 28, 13, 3); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.fillRect(-14, -4, 28, 5);
    g.restore();
  }

  /* ---- 节奏卡：当前舞步的踏点图示 ---- */
  function drawPatternCard(songBeat, k, ph, inPairs, isCall) {
    if (!inPairs) return;
    const P = PATTERNS[k];
    const x0 = W / 2 - 150, y0 = 88, w = 300, h = 64;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(x0, y0, w, h, 8); g.fill(); g.stroke();
    g.lineWidth = 1.2;
    g.strokeRect(x0 + 6, y0 + 6, w - 12, h - 12);
    text(isCall ? '听！' : '该你了！', x0 + 46, y0 + 32, 20, INK);
    const rx = x0 + 96, rw = 184, ry = y0 + 44;
    g.strokeStyle = 'rgba(28,24,19,0.45)';
    g.lineWidth = 2;
    line(rx, ry, rx + rw, ry);
    for (let b = 0; b < 4; b++) line(rx + b * (rw / 3.5), ry - 5, rx + b * (rw / 3.5), ry + 5);
    P.forEach((o, j) => {
      const dx = rx + o * (rw / 3.5), dy = y0 + 26;
      const n = pairNotes[k][j];
      let mode = 'hollow';
      if (isCall) { if (ph >= o) mode = 'fill'; }
      else if (n.state === 'hit') mode = n.judge === 'perfect' ? 'star' : 'fill';
      else if (n.state === 'missed') mode = 'miss';
      g.strokeStyle = INK;
      g.fillStyle = INK;
      g.lineWidth = 2.5;
      if (mode === 'star') {
        star(dx, dy, 9, 0, CREAM, INK);
      } else if (mode === 'fill') {
        g.beginPath(); g.arc(dx, dy, 7, 0, 7); g.fill();
      } else if (mode === 'miss') {
        g.beginPath(); g.arc(dx, dy, 7, 0, 7); g.stroke();
        line(dx - 8, dy + 8, dx + 8, dy - 8);
      } else {
        g.beginPath(); g.arc(dx, dy, 7, 0, 7); g.stroke();
      }
    });
  }

  /* ---- 注册 ---- */
  registerGame({
    id: 'tap',
    title: '踢踏回声！',
    subtitle: 'ECHO TAPS',
    menuDesc: '记忆：听一段舞步，下一小节原样踏回去',
    bpm: 120,
    swing: 0.64,
    resultBeat: 84,

    init() {
      notes = []; pairNotes = []; callTaps = []; hups = [];
      callIdx = 0; hupIdx = 0;
      playerTapAt = -10; playerLeg = 0;
      PATTERNS.forEach((P, k) => {
        const cs = INTRO + k * PAIR, rs = cs + 4;
        pairNotes[k] = [];
        P.forEach(o => {
          callTaps.push({ t: beatTime(cs + o), i: callTaps.length });
          const n = { hitTime: beatTime(rs + o), state: 'pending', judge: null, off: o, pair: k };
          notes.push(n);
          pairNotes[k].push(n);
        });
        hups.push(beatTime(cs + 3.5));
      });
    },

    scheduleStep(beat, t) {
      if (beat === END) { kickS(t); crash(t); return; }
      if (beat > END - 0.5) return;
      const isOff = beat % 1 !== 0;
      const inBar = beat % 4;
      const bar = Math.floor(beat / 4) % 4;
      if (!isOff) {
        chick(t);
        if (inBar === 0 || inBar === 2) bassN(t, T_BASS[bar][inBar === 0 ? 0 : 1]);
        else compChord(t, T_CHORDS[bar], 0.05);
        if (inBar === 0 && Math.floor(beat / 4) % 2 === 0) ride(t, 0.10);
      } else if (inBar === 3.5) {
        chick(t);
      }
    },

    scheduleAhead(ahead) {
      while (callIdx < callTaps.length && callTaps[callIdx].t <= ahead) {
        tapCall(Math.max(callTaps[callIdx].t, actx.currentTime + 0.001));
        callIdx++;
      }
      while (hupIdx < hups.length && hups[hupIdx] <= ahead) {
        hupCue(Math.max(hups[hupIdx], actx.currentTime + 0.001));
        hupIdx++;
      }
    },

    onPress(now) {
      playerTapAt = now;
      playerLeg ^= 1;
      const m = matchPress(notes, now);
      if (m) {
        m.note.state = 'hit';
        m.note.judge = m.perfect ? 'perfect' : 'good';
        tapHit(m.perfect);
        award(m.perfect, PLAYER_X, 236);
        if (m.perfect) burstStars(PLAYER_X, 380);
      } else {
        tapWhiff();
      }
    },

    update(now) {
      for (const n of notes) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          missMark(PLAYER_X, 236);
          missTone();
        }
      }
    },

    draw(now, songBeat) {
      drawStageBack(now, songBeat);
      const k = Math.floor((songBeat - INTRO) / PAIR);
      const ph = (songBeat - INTRO) - k * PAIR;
      const inPairs = songBeat >= INTRO && k >= 0 && k < PATTERNS.length;
      const isCall = inPairs && ph < 4;
      // 聚光灯跟随当班舞者
      if (inPairs) {
        const sx = isCall ? CALLER_X : PLAYER_X;
        g.fillStyle = 'rgba(242,235,216,0.30)';
        g.beginPath(); g.ellipse(sx, GROUND_Y + 26, 140, 26, 0, 0, 7); g.fill();
      }
      // 搭档：扫描呼叫踏点驱动踢腿
      let last = null;
      for (const c of callTaps) {
        if (now >= c.t && now - c.t < 0.24) last = c;
        if (c.t > now + 0.3) break;
      }
      const cEnv = last ? kickEnv(now - last.t) : 0;
      const cLeg = last ? last.i % 2 : 0;
      drawDancer(CALLER_X, true, cEnv, cLeg, now, songBeat);
      drawDancer(PLAYER_X, false, kickEnv(now - playerTapAt), playerLeg, now, songBeat);
      drawStageFront(now, songBeat);
      drawPatternCard(songBeat, k, ph, inPairs, isCall);
      if (state === 'playing' && songBeat >= 0 && songBeat < INTRO - 0.5) {
        text('先听搭档踏一段，下一小节原样踏回去！', W / 2, 498, 22, INK, 'center', CREAM, 6);
      }
    },
  });

})();
