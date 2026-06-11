'use strict';

/* ============================================================================
 * 节目五：抛硬币 HEADS OR TAILS
 * 机制：接抛（toss & catch），节奏二元化 ——
 *   - 2 拍小抛：硬币低抛全程可见，看着接，不必数拍；
 *   - 4 拍大抛：硬币配滑笛飞出画面顶部（顶部留 ▲ 位置标记），
 *     两声递升数拍音“哒、哒”后第四拍落回手心——必须数拍子。
 * 起抛由角色自动完成（带音效预告），玩家只判定接球一个动作。
 * 漏接：硬币坠地叮当散落淡出，角色掏出新硬币照常进行下一轮。
 * 配乐：112 BPM 慵懒双拍感（two-feel）摇摆：贝斯只踩 1/3 拍，
 *       颤音琴式和弦点缀 Charleston 反拍，弱音小号偶尔搭话。
 * ========================================================================== */
(() => {

  /* 抛接表：[接球拍号, 是否大抛]；小抛滞空 2 拍，大抛 4 拍 */
  const FLIPS = [
    [8, false], [12, false], [16, false], [20, false],   // 小抛热身
    [28, true],                                          // 大抛
    [32, false], [36, false], [40, false],
    [48, true],
    [52, false], [56, false],
    [64, true],
    [68, false], [72, false],
    [80, true],                                          // 终结大抛
  ];
  const END = 84;
  const CX = 430;                        // 角色基准 x
  const HAND = { x: 468, y: 302 };       // 持币手
  const POCKET = { x: CX + 8, y: 344 };  // 马甲口袋（接住后收币）

  /* 双拍感伴奏：F6 -> Dm7 -> Gm7 -> C7 */
  const C_CHORDS = [
    [174.61, 220.00, 261.63, 293.66],
    [146.83, 174.61, 220.00, 261.63],
    [196.00, 233.08, 293.66, 349.23],
    [196.00, 233.08, 261.63, 329.63],
  ];
  const C_ROOTS = [87.31, 73.42, 98.00, 65.41];

  /* 弱音小号点缀（16 拍循环） */
  const RIFF = [
    [0, 349.23, 0.40], [2, 440.00, 0.40], [2.5, 392.00, 0.35], [3, 349.23, 0.50],
    [8, 440.00, 0.40], [10, 523.25, 0.40], [10.5, 440.00, 0.35], [11, 392.00, 0.60],
  ];

  /* ---- 模块内状态 ---- */
  let notes = [];
  let tossIdx = 0;                       // 起抛音效指针
  let tickIdx = 0, ticks = [];           // 大抛数拍音
  let melodyIdx = 0, melody = [];
  let catchAt = -10, lastMissAt = -10;

  /* ---- 音效 ---- */
  function sTossSmall(t) {
    osc('sine', 600, t, 0.10, 0.16, 1100);
    osc('sine', 1800, t, 0.06, 0.18);
  }
  function sTossBig(t) {
    slideWhistle(t);
    osc('sine', 2000, t, 0.07, 0.20);
  }
  const countTick = (t, f) => osc('square', f, t, 0.05, 0.20, f - 40);
  function sCatch(perfect) {
    const t = actx.currentTime;
    noise(t, 0.05, 0.30, 'lowpass', 2400, 0.7);          // 合掌
    osc('sine', 2093, t + 0.01, 0.07, 0.25);             // 硬币“叮”
    osc('sine', 2637, t + 0.04, 0.09, 0.18);
    if (perfect) xylo(t + 0.08, 1567.98, 0.20);
  }
  function sWhiff() {
    const t = actx.currentTime;
    noise(t, 0.08, 0.13, 'bandpass', 1500, 1.4);
  }
  function sMiss() {                                     // 落地叮当散落
    const t = actx.currentTime;
    osc('sine', 1800, t, 0.06, 0.18);
    osc('sine', 1300, t + 0.12, 0.06, 0.15);
    osc('sine', 900, t + 0.22, 0.08, 0.12);
    noise(t + 0.3, 0.08, 0.15, 'lowpass', 800, 0.8);
  }

  /* 颤音琴式和弦：正弦泛音、缓释 */
  function vibesChord(t, freqs, vol) {
    freqs.forEach((f, i) => {
      osc('sine', f, t + i * 0.012, 0.50, vol);
      osc('sine', f * 2, t + i * 0.012, 0.20, vol * 0.2);
    });
  }

  /* ---- 硬币位置 ---- */
  function coinAt(now) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (now < n.tossTime) return { x: HAND.x, y: HAND.y - 6, spin: 0, held: true };
      if (n.state === 'hit') {
        const t = now - n.hitAt;
        if (t < 0.25) {                                   // 收进口袋
          const p = t / 0.25;
          return {
            x: HAND.x + (POCKET.x - HAND.x) * p,
            y: HAND.y + (POCKET.y - HAND.y) * p,
            spin: n.spinAtHit + t * 4,
            scale: 1 - 0.55 * p,
          };
        }
        continue;
      }
      // pending / missed：抛物线（起点终点都是手心），漏接后自然下坠
      if (now <= n.fallEnd) {
        const dur = n.hitTime - n.tossTime;
        const p = (now - n.tossTime) / dur;
        const h = n.big ? 480 : 170;
        let y = HAND.y - h * 4 * p * (1 - p);
        let landed = false;
        if (y > GROUND_Y - 8) { y = GROUND_Y - 8; landed = true; }
        const fade = p > 1 ? Math.max(0, 1 - (now - n.hitTime) / Math.max(0.2, n.fallEnd - n.hitTime)) : 1;
        return {
          x: HAND.x + 14 * p,
          y,
          spin: landed ? 0 : (now - n.tossTime) * (n.big ? 14 : 10),
          alpha: fade,
          flat: landed,
        };
      }
    }
    return null;
  }

  function drawCoin(c) {
    if (!c) return;
    if (c.y < -10) {                                     // 出画面顶部：位置标记
      g.fillStyle = 'rgba(28,24,19,0.55)';
      g.beginPath();
      g.moveTo(c.x, 10);
      g.lineTo(c.x - 8, 24);
      g.lineTo(c.x + 8, 24);
      g.closePath();
      g.fill();
      return;
    }
    g.save();
    g.globalAlpha = c.alpha == null ? 1 : c.alpha;
    g.translate(c.x, c.y);
    const sc = c.scale == null ? 1 : c.scale;
    const s = c.flat ? 0.25 : Math.cos(c.spin);          // 翻转投影
    g.scale(sc, sc * Math.max(Math.abs(s), 0.12));
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill(); g.stroke();
    if (Math.abs(s) > 0.5) star(0, 0, 6, 0, INK);        // 正面星徽
    else { g.lineWidth = 2; line(-8, 0, 8, 0); }         // 侧棱
    g.restore();
    g.globalAlpha = 1;
    if (!c.held && !c.flat) {
      g.fillStyle = 'rgba(28,24,19,0.10)';
      g.beginPath(); g.ellipse(c.x, GROUND_Y + 4, 10, 4, 0, 0, 7); g.fill();
    }
  }

  /* ---- 动作包络 ---- */
  function flickEnv(dt) {                                // 起抛甩腕
    if (dt < 0 || dt > 0.22) return 0;
    if (dt < 0.05) return dt / 0.05;
    return Math.max(0, 1 - (dt - 0.05) / 0.17);
  }
  function claspEnv(dt) {                                // 合掌接币
    if (dt < 0 || dt > 0.24) return 0;
    if (dt < 0.05) return dt / 0.05;
    if (dt < 0.10) return 1;
    return 1 - (dt - 0.10) / 0.14;
  }

  /* ---- 角色：马甲绅士 ---- */
  function drawFlipper(now, songBeat) {
    let tossE = 0;
    for (const n of notes) {
      const dt = now - n.tossTime;
      if (dt >= 0 && dt < 0.22) tossE = Math.max(tossE, flickEnv(dt));
      if (n.tossTime > now + 0.3) break;
    }
    const catchE = claspEnv(now - catchAt);
    const bob = (state === 'playing' && songBeat > 0) ? 2.5 * Math.abs(Math.sin(Math.PI * songBeat)) : 0;
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(CX, GROUND_Y + 8, 46, 9, 0, 0, 7); g.fill();
    shoe(CX - 16, GROUND_Y, -1);
    shoe(CX + 18, GROUND_Y, 1);
    const hipY = 380 - bob;
    hose(CX - 8, hipY, CX - 16, GROUND_Y - 12, -8, 8);
    hose(CX + 8, hipY, CX + 18, GROUND_Y - 12, 8, 8);
    // 躯干 + 马甲
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(CX, 344 - bob, 24, 36, 0, 0, 7); g.fill();
    g.strokeStyle = CREAM;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(CX - 10, 314 - bob); g.lineTo(CX, 336 - bob); g.lineTo(CX + 10, 314 - bob); g.stroke();
    g.fillStyle = CREAM;
    g.beginPath(); g.arc(CX, 342 - bob, 2, 0, 7); g.fill();
    g.beginPath(); g.arc(CX, 352 - bob, 2, 0, 7); g.fill();
    line(CX + 2, POCKET.y - bob - 4, CX + 16, POCKET.y - bob - 4);   // 口袋
    // 左臂叉腰
    hose(CX - 14, 322 - bob, CX - 30, 350 - bob, 14, 8);
    glove(CX - 30, 352 - bob, 9);
    // 头
    const hx = CX + 8, hy = 292 - bob;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(hx, hy, 22, 0, 7); g.fill(); g.stroke();
    pieEye(hx - 4, hy - 5, 3.2, 5.5);
    pieEye(hx + 8, hy - 5, 3.2, 5.5);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(hx + 16, hy + 1, 4, 3, 0, 0, 7); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    if (now - lastMissAt < 1.0) {                        // 刚漏接：倒八字眉 + 撇嘴
      line(hx - 10, hy - 13, hx - 1, hy - 11);
      line(hx + 3, hy - 11, hx + 12, hy - 13);
      g.beginPath(); g.arc(hx + 6, hy + 11, 5, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    } else {
      g.beginPath(); g.arc(hx + 6, hy + 7, 6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    }
    // 草帽
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(hx, hy - 18, 20, 4, 0, 0, 7); g.fill(); g.stroke();
    rrect(hx - 12, hy - 30, 24, 12, 3); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.fillRect(hx - 12, hy - 22, 24, 4);
    // 右臂（接抛手）：起抛甩腕、接球合掌时上抬
    const handY = HAND.y - bob - 16 * tossE - 6 * catchE;
    hose(CX + 14, 318 - bob, HAND.x, handY, -12, 8);
    glove(HAND.x, handY, 10);
    if (catchE > 0.6) {                                  // 合掌速度线
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      for (const a of [-0.6, 0, 0.6]) {
        g.beginPath(); g.arc(HAND.x, handY, 20, a - 0.18 - Math.PI / 2, a + 0.18 - Math.PI / 2); g.stroke();
      }
    }
  }

  /* ---- 场景：街角夜色 ---- */
  function drawStreet(now, songBeat) {
    const pulse = beatPulse(songBeat);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, 150);
    // 月亮（含脸）
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(120, 84, 34, 0, 7); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(28,24,19,0.25)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(120, 84, 45, 0, 7); g.stroke();
    pieEye(110, 78, 3.5, 5.5);
    pieEye(130, 78, 3.5, 5.5);
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(120, 91, 11, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    // 砖墙
    g.fillStyle = LIGHT;
    g.fillRect(0, 150, W, GROUND_Y - 150);
    g.fillStyle = dotPat;
    g.fillRect(0, 150, W, 56);
    g.strokeStyle = 'rgba(28,24,19,0.22)';
    g.lineWidth = 1.5;
    for (let row = 0; 178 + row * 26 < GROUND_Y; row++) {
      const y0 = 178 + row * 26;
      line(0, y0, W, y0);
      for (let x = (row % 2) * 44; x < W; x += 88) {
        line(x, y0, x, Math.min(y0 + 26, GROUND_Y));
      }
    }
    g.fillStyle = INK;
    g.fillRect(0, 150, W, 6);
    // 橱窗 + 条纹雨棚
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(640, 214, 196, 136, 6); g.fill(); g.stroke();
    g.lineWidth = 2;
    line(738, 216, 738, 348);
    line(642, 282, 834, 282);
    g.fillStyle = INK;
    g.fillRect(628, 350, 220, 8);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 === 0 ? INK : CREAM;
      g.beginPath();
      g.moveTo(622 + i * 39, 178);
      g.lineTo(622 + (i + 1) * 39, 178);
      g.lineTo(630 + (i + 1) * 36.5, 214);
      g.lineTo(630 + i * 36.5, 214);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.strokeRect(622, 178, 234, 4);
    g.beginPath(); g.moveTo(622, 178); g.lineTo(630, 214); g.lineTo(849, 214); g.lineTo(856, 178); g.closePath(); g.stroke();
    // 路灯（灯头随节拍呼吸）
    g.strokeStyle = INK;
    g.lineWidth = 5;
    line(150, GROUND_Y, 150, 214);
    g.beginPath(); g.moveTo(150, 214); g.quadraticCurveTo(150, 196, 168, 196); g.stroke();
    g.fillStyle = `rgba(242,235,216,${0.16 + 0.13 * pulse})`;
    g.beginPath(); g.ellipse(172, 204, 30, 24, 0, 0, 7); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(172, 202, 9, 0, 7); g.fill(); g.stroke();
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(164, 194); g.lineTo(180, 194); g.lineTo(172, 186); g.closePath(); g.fill();
    // 人行道与马路牙
    g.fillStyle = LIGHT;
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    line(0, GROUND_Y, W, GROUND_Y);
    g.strokeStyle = 'rgba(28,24,19,0.3)';
    g.lineWidth = 1.5;
    for (let x = 60; x < W; x += 120) line(x, GROUND_Y + 4, x, H - 44);
    line(0, H - 44, W, H - 44);
    g.fillStyle = MID;
    g.fillRect(0, H - 40, W, 40);
    g.fillStyle = dotPat;
    g.fillRect(0, H - 40, W, 40);
  }

  /* ---- 注册 ---- */
  registerGame({
    id: 'coin',
    title: '抛硬币！',
    subtitle: 'HEADS OR TAILS',
    menuDesc: '接住：两拍小抛看着接，四拍大抛数着接',
    bpm: 112,
    swing: 0.66,
    resultBeat: 88,

    init() {
      notes = FLIPS.map(([b, big]) => ({
        hitTime: beatTime(b),
        tossTime: beatTime(b - (big ? 4 : 2)),
        big,
        state: 'pending',
        hitAt: 0,
        spinAtHit: 0,
      }));
      notes.forEach((n, i) => {
        n.fallEnd = i + 1 < notes.length
          ? Math.min(n.hitTime + 0.6, notes[i + 1].tossTime - 0.02)
          : n.hitTime + 0.8;
      });
      ticks = [];
      FLIPS.forEach(([b, big]) => {
        if (big) {
          ticks.push({ t: beatTime(b - 2), f: 660 });
          ticks.push({ t: beatTime(b - 1), f: 880 });
        }
      });
      melody = [];
      for (const s of [0, 16, 32, 48, 64]) {
        for (const [b, f, d] of RIFF) {
          if (s + b < END - 2) melody.push({ b: s + b, f, d });
        }
      }
      tossIdx = 0;
      tickIdx = 0;
      melodyIdx = 0;
      catchAt = -10;
      lastMissAt = -10;
    },

    scheduleStep(beat, t) {
      if (beat === END) { kickS(t); crash(t); return; }
      if (beat > END - 0.5) return;
      const isOff = beat % 1 !== 0;
      const inBar = beat % 4;
      const bar = Math.floor(beat / 4) % 4;
      if (!isOff) {
        if (inBar === 0 || inBar === 2) {                // two-feel：贝斯只踩 1/3 拍
          bassN(t, inBar === 0 ? C_ROOTS[bar] : C_ROOTS[bar] * 1.5);
          if (inBar === 0) ride(t, 0.10);
        } else {
          brush(t);
          chick(t);
        }
      } else {
        if (Math.floor(beat) % 2 === 1) ride(t, 0.08);
        if (inBar === 1.5) vibesChord(t, C_CHORDS[bar], 0.045);
      }
    },

    scheduleAhead(ahead) {
      while (tossIdx < notes.length && notes[tossIdx].tossTime <= ahead) {
        const n = notes[tossIdx];
        const tt = Math.max(n.tossTime, actx.currentTime + 0.001);
        n.big ? sTossBig(tt) : sTossSmall(tt);
        tossIdx++;
      }
      while (tickIdx < ticks.length && ticks[tickIdx].t <= ahead) {
        countTick(Math.max(ticks[tickIdx].t, actx.currentTime + 0.001), ticks[tickIdx].f);
        tickIdx++;
      }
      while (melodyIdx < melody.length) {
        const m = melody[melodyIdx];
        const t = beatTime(m.b);
        if (t > ahead) break;
        trumpet(Math.max(t, actx.currentTime + 0.001), m.f, m.d, 0.08);
        melodyIdx++;
      }
    },

    onPress(now) {
      catchAt = now;
      const m = matchPress(notes, now);
      if (m) {
        m.note.state = 'hit';
        m.note.hitAt = now;
        m.note.spinAtHit = (now - m.note.tossTime) * (m.note.big ? 14 : 10);
        sCatch(m.perfect);
        award(m.perfect, HAND.x + 6, HAND.y - 56);
        if (m.perfect) burstStars(HAND.x, HAND.y - 10);
      } else {
        sWhiff();
      }
    },

    update(now) {
      for (const n of notes) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          lastMissAt = now;
          missMark(HAND.x + 6, HAND.y - 56);
          sMiss();
        }
      }
    },

    draw(now, songBeat) {
      drawStreet(now, songBeat);
      drawFlipper(now, songBeat);
      drawCoin(coinAt(now));
      if (state === 'playing' && songBeat >= 0 && songBeat < 7) {
        text('小抛看着接；听到滑笛抛高就数拍——哒、哒、接！', W / 2, 498, 20, INK, 'center', CREAM, 6);
      }
    },
  });

})();
