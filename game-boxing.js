'use strict';

/* ============================================================================
 * 节目一：橡皮管拳击 RUBBER HOSE BOXING
 * 机制：反应计时 —— 杂物滞空 2 拍飞抵命中点，到点的一瞬按键挥拳。
 * 配乐：摇摆爵士（ride 跳音 + 行走贝斯 + Charleston 和弦 + 弱音小号），
 *       结尾 "shave and a haircut, two bits" 终止句，最后两击落在 "two bits" 上。
 * ========================================================================== */
(() => {

  /* ---- 谱面与和声 ---- */
  const CHART_BEATS = [
    8, 12, 16, 20,                                       // 热身：每 4 拍
    24, 26, 28, 30, 32, 34, 36, 38,                      // 律动：每 2 拍
    40, 42, 43, 44, 46, 47, 48, 50, 51, 52, 54, 55,      // 加密：相邻四分连击
    56, 56.5, 58, 60, 60.5, 62,                          // 摇摆反拍双连
    64, 66, 68, 68.5, 70, 72, 75, 76,                    // 终段：收在终止句两击上
  ];
  const CHORDS = [
    [261.63, 329.63, 392.00, 440.00],    // C6
    [220.00, 277.18, 329.63, 392.00],    // A7
    [293.66, 349.23, 440.00, 523.25],    // Dm7
    [196.00, 246.94, 293.66, 349.23],    // G7
  ];
  const BASS_WALK = [
    65.41, 82.41, 98.00, 110.00,
    55.00, 69.30, 82.41, 77.78,
    73.42, 87.31, 110.00, 130.81,
    98.00, 87.31, 82.41, 73.42,
  ];
  const BASS_OUTRO = [98.00, 87.31, 82.41, 73.42];       // 68–71 拍 G7 下行导入终止句
  const RIFF = [
    [0, 329.63, 0.40], [0.5, 392.00, 0.35], [1, 440.00, 0.40], [2, 392.00, 0.35], [2.5, 329.63, 0.50],
    [4, 277.18, 0.40], [4.5, 329.63, 0.35], [5, 392.00, 0.40], [6, 329.63, 0.60],
    [8, 440.00, 0.40], [8.5, 523.25, 0.35], [9, 440.00, 0.40], [10, 349.23, 0.35], [10.5, 440.00, 0.30], [11, 349.23, 0.50],
    [12, 392.00, 0.40], [12.5, 349.23, 0.35], [13, 293.66, 0.40], [14, 246.94, 0.80],
  ];
  const LICK = [
    [72, 261.63, 0.30], [72.5, 196.00, 0.28], [73, 196.00, 0.28], [73.5, 220.00, 0.28],
    [74, 196.00, 0.50], [75, 246.94, 0.30], [76, 261.63, 0.90],
  ];

  const THROW_LEAD = 2;
  const GROOVE_END = 71.5;
  const FINAL_BEAT = 76;
  const CHAR_X = 250;
  const HIT_X = 430, HIT_Y = 318;
  const THROW_X = W + 60, THROW_Y = 235;

  /* ---- 模块内状态 ---- */
  let notes = [], melody = [], melodyIdx = 0;
  let punchAt = -10, powAt = -10, powBig = false, hatPopAt = -10;

  /* ---- 音效 ---- */
  function sPunch(perfect) {
    const t = actx.currentTime;
    noise(t, 0.07, 0.55, 'lowpass', 2800, 0.7);
    osc('sine', 150, t, 0.10, 0.5, 60);
    osc('square', 900, t, 0.03, 0.18, 700);
    if (perfect) { xylo(t + 0.02, 1567.98, 0.22); xylo(t + 0.09, 2093.00, 0.18); }
  }
  function sWhiff() {
    const t = actx.currentTime;
    noise(t, 0.08, 0.15, 'bandpass', 1400, 1.4);
    osc('sine', 500, t, 0.08, 0.08, 200);
  }
  function sMiss() {
    const t = actx.currentTime;
    osc('triangle', 240, t, 0.16, 0.4, 90);
    noise(t + 0.18, 0.12, 0.2, 'lowpass', 600, 0.8);
  }

  /* ---- 角色 ---- */
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
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(CHAR_X + 6, GROUND_Y + 8, 60, 10, 0, 0, 7); g.fill();
    shoe(CHAR_X - 30, GROUND_Y, -1);
    shoe(CHAR_X + 34, GROUND_Y, 1);
    const hipY = 376 - bob;
    hose(hx - 12, hipY, CHAR_X - 30, GROUND_Y - 12, 12 + bob * 2, 9);
    hose(hx + 14, hipY, CHAR_X + 34, GROUND_Y - 12, -(12 + bob * 2), 9);
    hose(hx - 6, 316 - bob, hx + 30, 330 - bob, 12, 9);
    glove(hx + 36, 330 - bob, 12);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(hx + 2, 336 - bob, 30, 42, 0, 0, 7); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(hx - 24, 348 - bob, 52, 26, 11); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.beginPath(); g.arc(hx - 6, 361 - bob, 2.6, 0, 7); g.fill();
    g.beginPath(); g.arc(hx + 12, 361 - bob, 2.6, 0, 7); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(hx + 10, 282 - bob, 28, 0, 7); g.fill(); g.stroke();
    pieEye(hx + 8, 276 - bob, 3.8, 6.5);
    pieEye(hx + 24, 276 - bob, 3.8, 6.5);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(hx + 34, 284 - bob, 4.5, 3.5, 0, 0, 7); g.fill();
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

  /* ---- 投掷物 ---- */
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
        const t = now - n.hitAt;
        if (t > 1.3) { n.state = 'gone'; continue; }
        const f = n.judge === 'perfect' ? 1.35 : 1.0;
        const x = HIT_X + 880 * f * t;
        const y = HIT_Y - 600 * f * t + 1350 * t * t;
        drawObj(n.kind, x, y, 9 * t);
        continue;
      }
      if (now < n.throwTime) continue;
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

  /* ---- 注册 ---- */
  registerGame({
    id: 'boxing',
    title: '橡皮管拳击！',
    subtitle: 'RUBBER HOSE BOXING',
    menuDesc: '反应：杂物飞到面前的一瞬挥拳击飞',
    bpm: 120,
    swing: 0.64,
    resultBeat: 80,

    init() {
      notes = CHART_BEATS.map((b, i) => ({
        hitTime: beatTime(b),
        throwTime: beatTime(b) - THROW_LEAD * BEAT,
        kind: i % 3,
        state: 'pending',
        judge: null,
        hitAt: 0,
        cueDone: false,
        landed: null,
      }));
      melody = [];
      for (const s of [0, 16, 32, 48])
        for (const [b, f, d] of RIFF) melody.push({ b: s + b, f, d, v: 0.11 });
      for (const [b, f, d] of LICK) melody.push({ b, f, d, v: 0.17 });
      melodyIdx = 0;
      punchAt = -10; powAt = -10; hatPopAt = -10;
    },

    scheduleStep(beat, t) {
      if (beat === FINAL_BEAT) { kickS(t); crash(t); return; }
      if (beat > GROOVE_END) return;
      const isOff = beat % 1 !== 0;
      const inBar = beat % 4;
      const ci = beat >= 68 ? 3 : Math.floor(beat / 4) % 4;
      if (!isOff) {
        ride(t, 0.20);
        if (inBar === 0 || inBar === 2) kickS(t);
        if (inBar === 1 || inBar === 3) { brush(t); chick(t); }
        bassN(t, beat >= 68 ? BASS_OUTRO[beat - 68] : BASS_WALK[beat % 16]);
        if (inBar === 0) compChord(t, CHORDS[ci], 0.05);
      } else {
        if (Math.floor(beat) % 2 === 1) ride(t, 0.13);
        if (inBar === 1.5) compChord(t, CHORDS[ci], 0.08);
      }
    },

    scheduleAhead(ahead) {
      while (melodyIdx < melody.length) {
        const m = melody[melodyIdx];
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
    },

    onPress(now) {
      punchAt = now;
      const m = matchPress(notes, now);
      if (m) {
        m.note.state = 'hit';
        m.note.hitAt = now;
        m.note.judge = m.perfect ? 'perfect' : 'good';
        powAt = now;
        powBig = m.perfect;
        sPunch(m.perfect);
        award(m.perfect, HIT_X + 10, HIT_Y - 62);
        if (m.perfect) { hatPopAt = now; burstStars(HIT_X, HIT_Y); }
      } else {
        sWhiff();
      }
    },

    update(now) {
      for (const n of notes) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          missMark(HIT_X + 8, HIT_Y - 62);
          sMiss();
        }
      }
    },

    draw(now, songBeat) {
      drawOutdoor(now, songBeat);
      // 命中点标记
      g.strokeStyle = 'rgba(28,24,19,0.5)';
      g.lineWidth = 3;
      g.setLineDash([7, 7]);
      g.beginPath(); g.arc(HIT_X, HIT_Y, 24, 0, 7); g.stroke();
      g.setLineDash([]);
      drawChar(now, songBeat);
      drawNotes(now);
      drawPow(now);
      drawArm(now, songBeat);
      if (state === 'playing' && songBeat >= 0 && songBeat < 7.2) {
        text('杂物飞到虚线圈时，按【空格】挥拳！', W / 2, 498, 22, INK, 'center', CREAM, 6);
      }
    },
  });

})();
