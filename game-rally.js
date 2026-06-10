'use strict';

/* ============================================================================
 * 节目四：橡皮羽球 RUBBER RACKETS
 * 机制：往返对拉（rally），节奏二元化 ——
 *   - 基础回合固定 2 拍间隔：弧线低平，看球反应即可；
 *   - 高吊球 4 拍间隔：搭档把球挑出画面顶部，滞空 3 拍，必须数拍子接杀
 *     （滑笛挑高 + 两声递升数拍音“哒、哒”，第三拍击球；顶部有位置标记）。
 * 漏接：球坠地淡出，搭档换一只新球照常发起下一回合（回合表不脱轨）。
 * ========================================================================== */
(() => {

  /* 玩家击球拍号表：相邻差值只有 2 拍（常规）与 4 拍（高吊）两种 */
  const HIT_BEATS = [
    8, 10, 12, 14,                       // 2 拍热身
    18,                                  // 高吊
    20, 22, 24, 26,                      // 2 拍
    30,                                  // 高吊
    32, 34, 36, 38,                      // 2 拍
    42,                                  // 高吊
    44, 46, 48, 50,                      // 2 拍
    54,                                  // 高吊
    56, 58, 60, 62,                      // 2 拍
    66,                                  // 高吊终结扣杀
  ];
  const END = 68;
  const PLAYER_X = 240, PARTNER_X = 760;
  const P_HIT = { x: 300, y: 298 };      // 玩家击球点
  const Q_HIT = { x: 696, y: 298 };      // 搭档击球点
  const NET_X = 480;

  /* 轻摇摆伴奏：C6 -> Am7 -> Dm7 -> G7 */
  const R_CHORDS = [
    [261.63, 329.63, 392.00, 440.00],
    [220.00, 261.63, 329.63, 392.00],
    [293.66, 349.23, 440.00, 523.25],
    [196.00, 246.94, 293.66, 349.23],
  ];
  const R_ROOTS = [65.41, 55.00, 73.42, 98.00];

  /* ---- 模块内状态 ---- */
  let notes = [];
  let pIdx = 0;                          // 搭档击球音效指针
  let lobCues = [], lobIdx = 0;          // 高吊数拍音指针
  let swingAt = -10;                     // 玩家挥拍时刻

  /* ---- 音效 ---- */
  const pokMid = t => { osc('square', 950, t, 0.05, 0.22, 750); noise(t, 0.03, 0.10, 'highpass', 5000, 1); };
  const pokLob = t => { slideWhistle(t); osc('sine', 300, t, 0.12, 0.18, 520); };
  const countTick = (t, f) => osc('square', f, t, 0.05, 0.20, f - 40);
  function sHit(perfect) {
    const t = actx.currentTime;
    osc('square', 820, t, 0.05, 0.25, 640);
    noise(t, 0.04, 0.15, 'highpass', 4000, 1);
    if (perfect) xylo(t + 0.02, 1567.98, 0.20);
  }
  function sWhiff() {
    const t = actx.currentTime;
    noise(t, 0.08, 0.14, 'bandpass', 1600, 1.4);
  }
  function sMiss() {
    const t = actx.currentTime;
    osc('sine', 500, t, 0.12, 0.12, 180);
    noise(t + 0.25, 0.08, 0.18, 'lowpass', 700, 0.8);
  }

  /* ---- 球路 ---- */
  function arcPos(a, b, p, h) {
    return {
      x: a.x + (b.x - a.x) * p,
      y: a.y + (b.y - a.y) * p - h * 4 * p * (1 - p),
    };
  }
  /* 常规腿低平；高吊腿（滞空 ≥ 1.5 拍）冲出画面顶部，逼出数拍 */
  function legH(durSec) {
    const lb = durSec / BEAT;
    return lb >= 1.5 ? 430 : 130 * lb;
  }

  /* 某时刻球的位置与朝向；返回 null 表示球已退场 */
  function ballAt(now) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (now < n.pStart) return { x: Q_HIT.x - 16, y: Q_HIT.y + 6, rot: 0, alpha: 1, held: true };
      if (n.state === 'hit') {
        if (now <= n.hitTime) {
          const p = (now - n.pStart) / (n.hitTime - n.pStart);
          return { ...arcPos(Q_HIT, P_HIT, p, legH(n.hitTime - n.pStart)), seg: [Q_HIT, P_HIT, p, legH(n.hitTime - n.pStart)], alpha: 1 };
        }
        if (i === notes.length - 1) {                       // 终结扣杀飞出场外
          const p = (now - n.hitTime) / 0.5;
          if (p > 1.2) return null;
          return { x: P_HIT.x + (W + 120 - P_HIT.x) * p, y: P_HIT.y - 260 * p + 120 * p * p, rot: 0.8, alpha: 1 };
        }
        if (now <= n.outEnd) {
          const p = (now - n.hitTime) / (n.outEnd - n.hitTime);
          return { ...arcPos(P_HIT, Q_HIT, p, legH(n.outEnd - n.hitTime)), seg: [P_HIT, Q_HIT, p, legH(n.outEnd - n.hitTime)], alpha: 1 };
        }
        continue;
      }
      // pending / missed：照常飞入，过点后坠地淡出
      if (now <= n.fallEnd) {
        const p = (now - n.pStart) / (n.hitTime - n.pStart);
        const pos = arcPos(Q_HIT, P_HIT, p, legH(n.hitTime - n.pStart));
        if (pos.y > GROUND_Y - 8) pos.y = GROUND_Y - 8;
        const fade = p > 1 ? Math.max(0, 1 - (now - n.hitTime) / Math.max(0.2, n.fallEnd - n.hitTime)) : 1;
        return { ...pos, seg: [Q_HIT, P_HIT, p, legH(n.hitTime - n.pStart)], alpha: fade };
      }
      // 坠地结束 -> 下一回合（搭档换新球）
    }
    return null;
  }

  function drawShuttle(b) {
    if (!b) return;
    // 球在画面顶部之外：画位置标记，辅助数拍
    if (b.y < -10) {
      g.fillStyle = 'rgba(28,24,19,0.55)';
      g.beginPath();
      g.moveTo(b.x, 10);
      g.lineTo(b.x - 8, 24);
      g.lineTo(b.x + 8, 24);
      g.closePath();
      g.fill();
      return;
    }
    let rot = b.rot != null ? b.rot : 0;
    if (b.seg) {                          // 由轨迹切线求朝向
      const [a, c, p, h] = b.seg;
      const dx = c.x - a.x;
      const dy = (c.y - a.y) - h * 4 * (1 - 2 * p);
      rot = Math.atan2(dy, dx);
    }
    g.save();
    g.globalAlpha = b.alpha == null ? 1 : b.alpha;
    g.translate(b.x, b.y);
    g.rotate(rot);
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.fillStyle = CREAM;
    g.beginPath();
    g.moveTo(-2, 0); g.lineTo(-16, -7); g.lineTo(-16, 7);
    g.closePath(); g.fill(); g.stroke();
    line(-4, 0, -15, -4);
    line(-4, 0, -15, 4);
    g.fillStyle = CREAM;
    g.beginPath(); g.arc(2, 0, 5.5, 0, 7); g.fill(); g.stroke();
    g.restore();
    g.globalAlpha = 1;
    if (!b.held) {
      g.fillStyle = 'rgba(28,24,19,0.10)';
      g.beginPath(); g.ellipse(b.x, GROUND_Y + 4, 12, 4, 0, 0, 7); g.fill();
    }
  }

  /* ---- 挥拍包络 ---- */
  function swingEnv(dt) {
    if (dt < 0 || dt > 0.24) return 0;
    if (dt < 0.06) return dt / 0.06;
    if (dt < 0.11) return 1;
    return 1 - (dt - 0.11) / 0.13;
  }

  /* ---- 运动员（facing: 1 朝右 / -1 朝左） ---- */
  function drawAthlete(x, facing, env, isPartner, now, songBeat) {
    const bob = (state === 'playing' && songBeat > 0) ? 2.5 * Math.abs(Math.sin(Math.PI * songBeat)) : 0;
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(x, GROUND_Y + 8, 46, 9, 0, 0, 7); g.fill();
    shoe(x - 16, GROUND_Y, -1);
    shoe(x + 18, GROUND_Y, 1);
    const hipY = 380 - bob;
    hose(x - 8, hipY, x - 16, GROUND_Y - 12, -8, 8);
    hose(x + 8, hipY, x + 18, GROUND_Y - 12, 8, 8);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, 344 - bob, 24, 36, 0, 0, 7); g.fill();
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(x - 20, 356 - bob, 40, 22, 9); g.fill(); g.stroke();
    // 后臂
    hose(x - 12 * facing, 330 - bob, x - 30 * facing, 344 - bob, 10 * facing, 8);
    glove(x - 32 * facing, 344 - bob, 9);
    // 头
    const hx = x + 8 * facing, hy = 292 - bob;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(hx, hy, 22, 0, 7); g.fill(); g.stroke();
    pieEye(hx + 2 * facing - 6, hy - 5, 3.2, 5.5);
    pieEye(hx + 2 * facing + 6, hy - 5, 3.2, 5.5);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(hx + 14 * facing, hy + 1, 4, 3, 0, 0, 7); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(hx + 5 * facing, hy + 7, 6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    if (isPartner) {                      // 小胡子 + 鸭舌帽
      g.beginPath(); g.arc(hx + 5 * facing - 5, hy + 6, 4, Math.PI * 1.05, Math.PI * 1.85); g.stroke();
      g.beginPath(); g.arc(hx + 5 * facing + 5, hy + 6, 4, Math.PI * 1.15, Math.PI * 1.95); g.stroke();
      g.fillStyle = INK;
      g.beginPath(); g.arc(hx, hy - 14, 18, Math.PI, 0); g.closePath(); g.fill();
      rrect(hx + (facing > 0 ? 2 : -22), hy - 19, 20, 4, 2); g.fill();
    } else {                              // 草帽
      g.fillStyle = CREAM;
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(hx, hy - 18, 20, 4, 0, 0, 7); g.fill(); g.stroke();
      rrect(hx - 12, hy - 30, 24, 12, 3); g.fill(); g.stroke();
      g.fillStyle = INK;
      g.fillRect(hx - 12, hy - 22, 24, 4);
    }
    // 持拍臂与球拍
    const sx = x + 12 * facing, sy = 318 - bob;
    const a = 0.85 + (-0.7 - 0.85) * env;
    const hax = sx + 34 * Math.cos(a) * facing, hay = sy + 34 * Math.sin(a);
    hose(sx, sy, hax, hay, -10 * facing, 8);
    g.save();
    g.translate(hax, hay);
    g.scale(facing, 1);
    g.rotate(a * 0.9);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    line(0, 0, 16, -8);
    g.fillStyle = 'rgba(242,235,216,0.55)';
    g.beginPath(); g.ellipse(28, -14, 13, 17, -0.5, 0, 7); g.fill(); g.stroke();
    g.lineWidth = 1.2;
    line(20, -22, 36, -6);
    line(18, -12, 38, -16);
    g.restore();
    glove(hax, hay, 9);
  }

  function drawNet() {
    g.strokeStyle = INK;
    g.lineWidth = 4;
    line(NET_X, GROUND_Y, NET_X, GROUND_Y - 72);
    g.lineWidth = 3;
    line(NET_X - 26, GROUND_Y - 70, NET_X + 26, GROUND_Y - 70);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(28,24,19,0.45)';
    for (let yy = GROUND_Y - 62; yy < GROUND_Y; yy += 9) line(NET_X - 24, yy, NET_X + 24, yy);
    for (let xx = NET_X - 24; xx <= NET_X + 24; xx += 8) line(xx, GROUND_Y - 66, xx, GROUND_Y);
  }

  /* ---- 注册 ---- */
  registerGame({
    id: 'rally',
    title: '橡皮羽球！',
    subtitle: 'RUBBER RACKETS',
    menuDesc: '往返：两拍看球打，四拍数拍杀',
    bpm: 120,
    swing: 0.64,
    resultBeat: 72,

    init() {
      notes = HIT_BEATS.map((b, i) => {
        const prev = i === 0 ? b - 2 : HIT_BEATS[i - 1];
        const iv = b - prev;
        const lead = iv >= 4 ? 3 : iv / 2;             // 高吊滞空 3 拍，常规取中点
        return {
          hitTime: beatTime(b),
          pStart: beatTime(b - lead),
          state: 'pending',
          judge: null,
        };
      });
      notes.forEach((n, i) => {
        n.outEnd = i + 1 < notes.length ? notes[i + 1].pStart : n.hitTime + 0.8;
        n.fallEnd = i + 1 < notes.length
          ? Math.min(n.hitTime + 0.6, notes[i + 1].pStart - 0.02)
          : n.hitTime + 0.8;
        n.cueKind = (n.hitTime - n.pStart) / BEAT;
      });
      // 高吊数拍音：到达前两拍“哒、哒”递升
      lobCues = [];
      HIT_BEATS.forEach((b, i) => {
        const prev = i === 0 ? b - 2 : HIT_BEATS[i - 1];
        if (b - prev >= 4) {
          lobCues.push({ t: beatTime(b - 2), f: 660 });
          lobCues.push({ t: beatTime(b - 1), f: 880 });
        }
      });
      pIdx = 0;
      lobIdx = 0;
      swingAt = -10;
    },

    scheduleStep(beat, t) {
      if (beat === END) { kickS(t); crash(t); return; }
      if (beat > END - 0.5) return;
      const isOff = beat % 1 !== 0;
      const inBar = beat % 4;
      const bar = Math.floor(beat / 4) % 4;
      if (!isOff) {
        chick(t);
        if (inBar === 0) ride(t, 0.12);
        if (inBar === 0 || inBar === 2) bassN(t, inBar === 0 ? R_ROOTS[bar] : R_ROOTS[bar] * 1.5);
        else { compChord(t, R_CHORDS[bar], 0.04); brush(t); }
      } else if (Math.floor(beat) % 2 === 1) {
        ride(t, 0.09);
      }
    },

    scheduleAhead(ahead) {
      while (pIdx < notes.length && notes[pIdx].pStart <= ahead) {
        const n = notes[pIdx];
        const tt = Math.max(n.pStart, actx.currentTime + 0.001);
        if (n.cueKind >= 1.5) pokLob(tt);
        else pokMid(tt);
        pIdx++;
      }
      while (lobIdx < lobCues.length && lobCues[lobIdx].t <= ahead) {
        countTick(Math.max(lobCues[lobIdx].t, actx.currentTime + 0.001), lobCues[lobIdx].f);
        lobIdx++;
      }
    },

    onPress(now) {
      swingAt = now;
      const m = matchPress(notes, now);
      if (m) {
        m.note.state = 'hit';
        m.note.judge = m.perfect ? 'perfect' : 'good';
        sHit(m.perfect);
        award(m.perfect, P_HIT.x + 10, P_HIT.y - 56);
        if (m.perfect) burstStars(P_HIT.x, P_HIT.y);
      } else {
        sWhiff();
      }
    },

    update(now) {
      for (const n of notes) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          missMark(P_HIT.x + 8, P_HIT.y - 56);
          sMiss();
        }
      }
    },

    draw(now, songBeat) {
      drawOutdoor(now, songBeat);
      drawNet();
      let qEnv = 0;
      for (const n of notes) {
        const dt = now - n.pStart;
        if (dt >= 0 && dt < 0.24) qEnv = Math.max(qEnv, swingEnv(dt));
        if (n.pStart > now + 0.3) break;
      }
      drawAthlete(PLAYER_X, 1, swingEnv(now - swingAt), false, now, songBeat);
      drawAthlete(PARTNER_X, -1, qEnv, true, now, songBeat);
      drawShuttle(ballAt(now));
      if (state === 'playing' && songBeat >= 0 && songBeat < 7) {
        text('两拍回合看着打；听到滑笛挑高就数拍——哒、哒、打！', W / 2, 498, 20, INK, 'center', CREAM, 6);
      }
    },
  });

})();
