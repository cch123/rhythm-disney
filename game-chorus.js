'use strict';

/* ============================================================================
 * 节目三：剧院三重唱 THE HUMMING TRIO
 * 机制：长按 —— 左边两位歌手自动开口，你按住按键起声、到拍松开收声。
 *       每个乐句判定两个时刻：起音（onset）与收音（release），各按统一窗口计分。
 *       指挥在乐句起止前一拍各给一声预备提示音（低音=起，高音=收）。
 * 配乐：慢速轻摇摆 + 和声人声（双振荡器 + 低通 + LFO 颤音），
 *       玩家声部为三和声最高音，按准了和弦才完整。
 * ========================================================================== */
(() => {

  /* 三和声声部（低 / 中 / 玩家高声部），按和弦索引取 */
  const VOICES = [
    [130.81, 164.81, 196.00],            // C   (C3 E3 G3)
    [130.81, 174.61, 220.00],            // F/C (C3 F3 A3)
    [123.47, 174.61, 196.00],            // G7/B(B2 F3 G3)
  ];
  const ROOTS = [65.41, 87.31, 98.00];   // 伴奏低音根音 C2 / F2 / G2

  /* 乐句表：b 起拍，len 时值（拍），c 和弦索引 */
  const PHRASES = [
    { b: 8,  len: 4, c: 0 },
    { b: 16, len: 4, c: 1 },
    { b: 24, len: 4, c: 2 },
    { b: 32, len: 2, c: 0 },
    { b: 36, len: 2, c: 1 },
    { b: 40, len: 4, c: 2 },
    { b: 48, len: 2, c: 0 },
    { b: 52, len: 2, c: 2 },
    { b: 56, len: 6, c: 0 },             // 终曲长音
  ];
  const END = 64;
  const SX = [400, 545, 690];            // 低音 / 中音 / 玩家
  const COND_X = 170;

  /* 歌手体型与帽子：高个低音戴高顶帽，矮胖中音地中海，玩家戴草帽 */
  const SCFG = [
    { rx: 24, ry: 46, hr: 22, hat: 'top' },
    { rx: 32, ry: 30, hr: 24, hat: 'bald' },
    { rx: 24, ry: 38, hr: 24, hat: 'boater' },
  ];

  /* ---- 模块内状态 ---- */
  let onsets = [], releases = [], cues = [], glyphs = [];
  let phrIdx = 0, cueIdx = 0;
  let voice = null, holding = false;
  let lastGlyph = [0, 0, 0];

  /* ---- 音效 ---- */
  const tickIn  = t => osc('square', 880, t, 0.05, 0.16, 860);    // 起声预备
  const tickOut = t => osc('square', 1320, t, 0.05, 0.16, 1300);  // 收声预备
  function cough() {                                              // 错过起音：咳嗽两声
    const t = actx.currentTime;
    noise(t, 0.07, 0.25, 'lowpass', 700, 0.8);
    noise(t + 0.11, 0.05, 0.18, 'lowpass', 600, 0.8);
  }
  function lateTone() {                                           // 错过收音
    const t = actx.currentTime;
    osc('triangle', 320, t, 0.12, 0.2, 140);
  }

  /* ---- 乐句查询 ---- */
  function phraseAt(now) {
    for (const p of PHRASES) {
      if (now >= beatTime(p.b) - 0.1 && now < beatTime(p.b + p.len)) return p;
    }
    return null;
  }
  function chordAt(beat) {
    for (const p of PHRASES) if (beat >= p.b && beat < p.b + p.len) return p.c;
    return 0;
  }
  function cueProx(now) {
    let m = 0;
    for (const c of cues) m = Math.max(m, 1 - Math.abs(now - c.t) / 0.45);
    return Math.max(0, m);
  }

  /* ---- 指挥 ---- */
  function drawConductor(now, songBeat) {
    const x = COND_X;
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(x, GROUND_Y + 6, 44, 8, 0, 0, 7); g.fill();
    // 指挥台
    g.fillStyle = LIGHT;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(x - 34, GROUND_Y - 40, 68, 40, 4); g.fill(); g.stroke();
    g.fillStyle = dotPat;
    rrect(x - 34, GROUND_Y - 40, 68, 40, 4); g.fill();
    // 身体（背对观众的小燕尾服）
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, GROUND_Y - 78, 19, 30, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(x - 14, GROUND_Y - 58); g.lineTo(x - 20, GROUND_Y - 38); g.lineTo(x - 8, GROUND_Y - 54); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 14, GROUND_Y - 58); g.lineTo(x + 20, GROUND_Y - 38); g.lineTo(x + 8, GROUND_Y - 54); g.closePath(); g.fill();
    // 头
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath(); g.arc(x, GROUND_Y - 122, 17, 0, 7); g.fill(); g.stroke();
    g.fillStyle = INK;                                  // 后脑勺头发
    g.beginPath(); g.arc(x, GROUND_Y - 124, 17, Math.PI * 0.85, Math.PI * 2.15); g.fill();
    // 挥拍臂：随拍摆动，乐句起止前抬高蓄势（wind-up）
    const prox = cueProx(now);
    const base = (state === 'playing' && songBeat > 0) ? Math.sin(Math.PI * songBeat) : 0;
    const a = -0.35 + 0.5 * base - 1.0 * prox;
    const sx2 = x + 12, sy2 = GROUND_Y - 96;
    const hx2 = sx2 + 30 * Math.cos(a), hy2 = sy2 + 30 * Math.sin(a);
    hose(sx2, sy2, hx2, hy2, -8, 7);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.lineCap = 'round';
    line(hx2, hy2, hx2 + 26 * Math.cos(a - 0.3), hy2 + 26 * Math.sin(a - 0.3));
    glove(hx2, hy2, 8);
  }

  /* ---- 歌手 ---- */
  function bowTie(x, y) {
    g.fillStyle = CREAM;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 10, y - 5); g.lineTo(x - 10, y + 5); g.lineTo(x, y);
    g.lineTo(x + 10, y - 5); g.lineTo(x + 10, y + 5);
    g.closePath();
    g.fill();
  }

  function drawSinger(x, type, singing, now, songBeat) {
    const cfg = SCFG[type];
    const bob = (state === 'playing' && songBeat > 0) ? 2.2 * Math.abs(Math.sin(Math.PI * songBeat)) : 0;
    g.fillStyle = 'rgba(28,24,19,0.18)';
    g.beginPath(); g.ellipse(x, GROUND_Y + 8, 40, 8, 0, 0, 7); g.fill();
    shoe(x - 13, GROUND_Y, -1);
    shoe(x + 15, GROUND_Y, 1);
    const hipY = GROUND_Y - 26 - bob;
    hose(x - 8, hipY, x - 13, GROUND_Y - 10, -6, 8);
    hose(x + 8, hipY, x + 15, GROUND_Y - 10, 6, 8);
    const by = hipY - cfg.ry + 8;
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, by, cfg.rx, cfg.ry, 0, 0, 7); g.fill();
    // 合手于胸前
    hose(x - cfg.rx + 4, by - 8, x - 5, by + 16, 10, 8);
    hose(x + cfg.rx - 4, by - 8, x + 7, by + 16, -10, 8);
    glove(x - 5, by + 18, 9);
    glove(x + 7, by + 18, 9);
    bowTie(x, by - cfg.ry + 16);
    // 头
    const hy = by - cfg.ry - cfg.hr + 10;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(x, hy, cfg.hr, 0, 7); g.fill(); g.stroke();
    pieEye(x - 8, hy - 5, 3.5, 6);
    pieEye(x + 8, hy - 5, 3.5, 6);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, hy + 3, 3.5, 2.8, 0, 0, 7); g.fill();
    if (singing) {
      // 扬眉 + 张口（口型微颤）
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      line(x - 13, hy - 13, x - 4, hy - 16);
      line(x + 4, hy - 16, x + 13, hy - 13);
      g.fillStyle = INK;
      const mh = 9.5 * (0.8 + 0.2 * Math.sin(now * 9));
      g.beginPath(); g.ellipse(x, hy + 11, 6.5, mh, 0, 0, 7); g.fill();
    } else {
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, hy + 8, 6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    }
    // 帽子
    if (cfg.hat === 'top') {
      g.fillStyle = INK;
      g.beginPath(); g.ellipse(x, hy - cfg.hr + 4, 21, 4.5, 0, 0, 7); g.fill();
      rrect(x - 13, hy - cfg.hr - 26, 26, 29, 3); g.fill();
      g.strokeStyle = CREAM;
      g.lineWidth = 2.5;
      line(x - 12, hy - cfg.hr - 4, x + 12, hy - cfg.hr - 4);
    } else if (cfg.hat === 'bald') {
      g.fillStyle = INK;
      g.beginPath(); g.arc(x - cfg.hr + 4, hy - 4, 5, 0, 7); g.fill();
      g.beginPath(); g.arc(x + cfg.hr - 4, hy - 4, 5, 0, 7); g.fill();
    } else {
      g.fillStyle = CREAM;
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(x, hy - cfg.hr + 4, 22, 4.5, 0, 0, 7); g.fill(); g.stroke();
      rrect(x - 14, hy - cfg.hr - 10, 28, 13, 3); g.fill(); g.stroke();
      g.fillStyle = INK;
      g.fillRect(x - 14, hy - cfg.hr - 2, 28, 5);
    }
  }

  /* ---- 漂浮音符 ---- */
  function spawnGlyphs(now, singingFlags) {
    singingFlags.forEach((s, i) => {
      if (s && now - lastGlyph[i] > 0.38) {
        glyphs.push({
          x: SX[i] + (Math.random() * 24 - 12),
          y: 246,
          t0: now,
          ch: Math.random() < 0.5 ? '♪' : '♫',
        });
        lastGlyph[i] = now;
      }
    });
  }

  function drawGlyphs(now) {
    glyphs = glyphs.filter(q => now - q.t0 < 1.1);
    for (const q of glyphs) {
      const t = now - q.t0;
      g.globalAlpha = 1 - t / 1.1;
      text(q.ch, q.x + Math.sin(t * 6 + q.x) * 8, q.y - 70 * t, 20, INK);
      g.globalAlpha = 1;
    }
  }

  /* ---- 歌词卡：当前/下一乐句的时值图示 ---- */
  function drawLyricCard(now, songBeat) {
    let p = phraseAt(now), upcoming = false;
    if (!p) {
      p = PHRASES.find(q => beatTime(q.b) > now);
      upcoming = true;
      if (!p) return;
    }
    const x0 = W / 2 - 150, y0 = 88;
    g.fillStyle = CREAM;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    rrect(x0, y0, 300, 64, 8); g.fill(); g.stroke();
    g.lineWidth = 1.2;
    g.strokeRect(x0 + 6, y0 + 6, 288, 52);
    text(upcoming ? `下一句 ${p.len} 拍` : '唱！', x0 + 60, y0 + 32, 18, INK);
    // 时值点 + 收声方块
    const cx0 = W / 2 + 44 - (p.len * 26) / 2, dy = y0 + 32;
    const e = songBeat - p.b;                       // 已唱拍数
    for (let j = 0; j < p.len; j++) {
      const dx = cx0 + j * 26;
      g.strokeStyle = INK;
      g.fillStyle = INK;
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(dx, dy, 7, 0, 7);
      if (!upcoming && e >= j) g.fill();
      else g.stroke();
    }
    // 收声点：方块，临近时加粗提醒
    const sqx = cx0 + p.len * 26;
    const hot = !upcoming && e >= p.len - 0.5;
    g.strokeStyle = INK;
    g.lineWidth = hot ? 4 : 2.5;
    g.strokeRect(sqx - 7, dy - 7, 14, 14);
    if (hot) text('松!', sqx, dy - 18, 14, INK);
  }

  /* ---- 注册 ---- */
  registerGame({
    id: 'chorus',
    title: '剧院三重唱！',
    subtitle: 'THE HUMMING TRIO',
    menuDesc: '长按：起拍开口，收拍收声',
    bpm: 96,
    swing: 0.58,
    resultBeat: 68,

    init() {
      onsets = PHRASES.map(p => ({ hitTime: beatTime(p.b), state: 'pending', p }));
      releases = PHRASES.map(p => ({ hitTime: beatTime(p.b + p.len), state: 'pending', p }));
      cues = [];
      PHRASES.forEach(p => {
        cues.push({ t: beatTime(p.b - 1), kind: 'in' });
        cues.push({ t: beatTime(p.b + p.len - 1), kind: 'out' });
      });
      cues.sort((a, b) => a.t - b.t);
      glyphs = [];
      lastGlyph = [0, 0, 0];
      phrIdx = 0;
      cueIdx = 0;
      voice = null;
      holding = false;
    },

    scheduleStep(beat, t) {
      if (beat === END) {
        crash(t);
        kickS(t);
        bassN(t, 65.41);
        compChord(t, [261.63, 329.63, 392.00, 523.25], 0.06);
        return;
      }
      if (beat > END - 0.5) return;
      if (beat % 1 !== 0) return;
      const inBar = beat % 4;
      const c = chordAt(beat);
      const root = ROOTS[c];
      if (inBar === 0 || inBar === 2) {
        bassN(t, inBar === 0 ? root : root * 1.5);
      } else {
        compChord(t, VOICES[c].map(f => f * 2), 0.04);
        chick(t);
      }
    },

    scheduleAhead(ahead) {
      while (phrIdx < PHRASES.length) {
        const p = PHRASES[phrIdx];
        const t0 = beatTime(p.b);
        if (t0 > ahead) break;
        const t1 = beatTime(p.b + p.len);
        voiceAt(t0, t1, VOICES[p.c][0], 0.15);
        voiceAt(t0, t1, VOICES[p.c][1], 0.13);
        phrIdx++;
      }
      while (cueIdx < cues.length) {
        const cu = cues[cueIdx];
        if (cu.t > ahead) break;
        const tt = Math.max(cu.t, actx.currentTime + 0.001);
        cu.kind === 'in' ? tickIn(tt) : tickOut(tt);
        cueIdx++;
      }
    },

    onPress(now) {
      holding = true;
      const m = matchPress(onsets, now);
      const p = m ? m.note.p : phraseAt(now);
      if (voice) voice.stop();
      voice = voiceStart(p ? VOICES[p.c][2] : 196, 0.17);
      if (m) {
        m.note.state = 'hit';
        award(m.perfect, SX[2], 236);
        if (m.perfect) burstStars(SX[2], 262);
      }
    },

    onRelease(now) {
      if (!holding) return;
      holding = false;
      if (voice) { voice.stop(); voice = null; }
      if (paused || state !== 'playing') return;     // 暂停/退出引发的松手不参与判定
      const m = matchPress(releases, now);
      if (m) {
        m.note.state = 'hit';
        award(m.perfect, SX[2], 236);
        if (m.perfect) burstStars(SX[2], 262);
      }
    },

    update(now) {
      for (const n of onsets) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          missMark(SX[2], 236);
          cough();
        }
      }
      for (const n of releases) {
        if (n.state === 'pending' && now > n.hitTime + GOOD_WIN) {
          n.state = 'missed';
          missMark(SX[2], 236);
          lateTone();
        }
      }
    },

    draw(now, songBeat) {
      drawStageBack(now, songBeat);
      const curP = phraseAt(now);
      const auto = !!curP && now >= beatTime(curP.b);
      drawConductor(now, songBeat);
      drawSinger(SX[0], 0, auto, now, songBeat);
      drawSinger(SX[1], 1, auto, now, songBeat);
      drawSinger(SX[2], 2, holding, now, songBeat);
      if (holding && !curP && songBeat > 0 && state === 'playing') {
        text('?!', SX[1], 196, 24, INK, 'center', CREAM, 5);
      }
      spawnGlyphs(now, [auto, auto, holding]);
      drawGlyphs(now);
      drawStageFront(now, songBeat);
      drawLyricCard(now, songBeat);
      if (state === 'playing' && songBeat >= 0 && songBeat < 7) {
        text('起拍开口（按住），收拍收声（松开）——低音提示起，高音提示收！', W / 2, 498, 20, INK, 'center', CREAM, 6);
      }
    },

    onExit() {
      if (voice) { voice.stop(); voice = null; }
      holding = false;
    },
  });

})();
