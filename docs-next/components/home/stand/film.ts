/**
 * The STAND film: motion graphics written as code.
 *
 * No video, no animation library. One canvas, one worked example, and the rule
 * the whole library is built on: a frame is a pure function of a cursor.
 * `draw(t, clock)` takes `t`, the position on the timeline in beats, and `clock`,
 * seconds since load for ambient drift. Nothing is stored between frames, so
 * scrolling is scrubbing, forward or back.
 *
 * The one idea on screen: an answer is a slab, and evidence is what holds it up.
 * The slab floats when nothing is under it, stands on pillars the record supports,
 * and tilts when a pillar cracks. The word STAND drops in, each letter opens into
 * its own scene, and in the last shot the five letters carry the slab.
 *
 * Editing: copy lives in copy.ts, timing in T, and each scene in its own method.
 * Scenes draw in a design space of 760 x 560 (360 x 470 on a phone), and resize()
 * fits that space into the free area beside the captions.
 */
import { CASES, REAL, STAND_LINE, UNIVERSE, type FilmLabels } from './copy';
import { T } from './timeline';
import { E, TAU, Stage, WORD, clamp, clearOf, fade, lerp, rng, win } from './stage';

const VERBS = ['State', 'Trace', 'Assess', 'Name', 'Decide'] as const;

export class Film extends Stage<FilmLabels> {
  /* ── the frame ────────────────────────────────────────────────────────── */
  draw(t: number, clock: number) {
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.translate(this.ox, this.oy);
    c.scale(this.s, this.s);
    this.alpha = 1;
    this.ghosts(t);
    this.sceneOpen(t, clock);
    this.sceneWord(t);
    this.sceneState(t);
    this.sceneTrace(t);
    this.sceneAssess(t);
    this.sceneMontage(t);
    this.sceneName(t, clock);
    this.sceneDecide(t);
    this.sceneGate(t);
    this.sceneExplain(t);
    this.sceneLimit(t, clock);
    this.sceneChain(t);
    this.sceneUniverse(t, clock);
    this.sceneFinale(t, clock);
    this.cutTraceToAssess(t);
    this.cutNameToDecide(t);
    c.globalAlpha = 1;
  }

  /* ── the giant letter behind each chapter ─────────────────────────────── */
  private ghostPose() {
    return this.P
      ? { x: this.dw - 78, y: this.dh - 8, size: 330 }
      : { x: this.dw - 170, y: this.dh - 14, size: 640 };
  }

  private ghosts(t: number) {
    this.ghost('S', T.sA + 0.32, T.tA, t, true);
    this.ghost('T', T.tA, T.aA, t);
    this.ghost('A', T.aA, T.nA, t);
    this.ghost('N', T.nA, T.dA, t);
    this.ghost('D', T.dA, T.limA, t);
  }

  private ghost(ch: string, a: number, b: number, t: number, noDraw = false) {
    const on = fade(a, b, t, 0.2);
    if (on <= 0) return;
    const c = this.c;
    const G = this.ghostPose();
    const drift = (t - a) * -7;
    c.font = this.big(G.size);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    this.ga(on * 0.032);
    c.fillStyle = this.th.ink;
    c.fillText(ch, G.x, G.y + drift);
    const L = G.size * 5;
    const p = noDraw ? 1 : E.inOut(win(a, a + 0.8, t));
    this.ga(on * lerp(0.7, 0.2, win(a + 0.6, a + 1.2, t)));
    c.strokeStyle = this.th.yellow;
    c.lineWidth = 2;
    c.setLineDash([L * p, L]);
    c.strokeText(ch, G.x, G.y + drift);
    c.setLineDash([]);
  }

  /* ── the opening: you, two books, one confident sentence ──────────────── */
  private sceneOpen(t: number, clock: number) {
    const scene = 1 - win(T.wordA - 0.14, T.wordA + 0.02, t);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;

    const plateY = P ? 122 : 136;
    const plateW = P ? 310 : 400;
    const plateH = P ? 78 : 84;
    const bookY = P ? 300 : 372;
    const bookW = P ? 118 : 150;
    const bookH = P ? 66 : 84;
    const b1x = P ? 92 : 214;
    const b2x = P ? 268 : 546;
    const slipY = P ? 390 : 476;
    const slipW = P ? 166 : 240;
    const slipH = P ? 80 : 88;

    /* windows */
    const bubble = E.back(win(T.askA, T.askA + 0.3, t)) * (1 - win(T.llmA, T.llmA + 0.2, t));
    const booksIn = E.out(win(T.askA + 0.12, T.askA + 0.5, t));
    const hunch = win(T.askA + 0.42, T.askA + 0.66, t) * (1 - win(T.ledgerA + 0.05, T.ledgerA + 0.25, t));
    const slip1 = E.out(win(T.ledgerA + 0.08, T.ledgerA + 0.38, t));
    const slip2 = E.out(win(T.ledgerA + 0.3, T.ledgerA + 0.6, t));
    const leaveLedger = 1 - win(T.llmA, T.llmA + 0.22, t);
    const pil = E.out(win(T.ledgerA + 0.56, T.ledgerA + 0.86, t)) * leaveLedger;
    const split = E.inOut(win(T.ledgerA + 0.66, T.ledgerA + 0.96, t)) * (1 - E.inOut(win(T.llmA, T.llmA + 0.3, t)));
    const tool = E.inOut(win(T.llmA + 0.05, T.llmA + 0.4, t));
    const llm = win(T.llmA + 0.12, T.llmA + 0.42, t);
    const lg = win(T.logsA, T.logsA + 0.82, t);
    const gone = E.inOut(win(T.logsA + 0.05, T.logsA + 0.45, t));
    const logsIn = win(T.logsA, T.logsA + 0.22, t);

    /* the bob of something with nothing under it */
    const floating = 1 - split;
    const heroDrop = P ? (1 - E.inOut(win(T.askA - 0.25, T.askA + 0.1, t))) * 48 : 0;
    const bob = Math.sin(clock * 1.25) * 5 * floating + heroDrop;
    const tilt = Math.sin(clock * 0.8) * 0.012 * floating;

    /* the opening shot: a slab with nothing under it */
    const heroA = 1 - win(T.askA - 0.12, T.askA + 0.22, t);
    if (heroA > 0) {
      const c = this.c;
      const gy = P ? 372 : 452;
      const gap = P ? 104 : 136;
      const top = plateY + plateH / 2 + 26 + heroDrop;
      [-1, 1].forEach((side) => {
        const x = dw / 2 + side * gap;
        this.ga(heroA * 0.75);
        c.setLineDash([5, 6]);
        c.strokeStyle = th.lineStrong;
        c.lineWidth = 1.5;
        c.strokeRect(x - (P ? 13 : 18), top, P ? 26 : 36, gy - top);
        c.setLineDash([]);
        this.text('?', x, (top + gy) / 2, {
          size: P ? 22 : 30,
          weight: 800,
          color: th.faint,
          align: 'center',
          base: 'middle',
          alpha: heroA * (0.55 + 0.2 * Math.sin(clock * 1.6 + side)),
        });
      });
      this.box(dw / 2 - (P ? 160 : 230), gy, P ? 320 : 460, 3, { r: 2, fill: th.line, alpha: heroA });
      this.ga(heroA * 0.12);
      c.fillStyle = th.ink;
      c.beginPath();
      c.ellipse(dw / 2, gy + 16, (P ? 120 : 180) + Math.sin(clock * 1.25) * 12, 7, 0, 0, TAU);
      c.fill();
      this.text('nothing under it', dw / 2, gy + (P ? 42 : 50), {
        size: P ? 10.5 : 12,
        weight: 650,
        mono: true,
        color: th.muted,
        align: 'center',
        alpha: heroA,
      });
    }

    /* the empty place where a ledger should be */
    if (llm > 0 && gone < 1) {
      const a = llm * (1 - gone);
      this.box(dw / 2 - (P ? 150 : 200), (P ? slipY : slipY) - slipH / 2 - 8, P ? 300 : 400, slipH, {
        r: 12,
        stroke: th.lineStrong,
        lw: 1.5,
        dash: [6, 6],
        alpha: a,
      });
      this.text('?', dw / 2, slipY - 8, {
        size: 38,
        weight: 800,
        color: th.faint,
        align: 'center',
        base: 'middle',
        alpha: a,
      });
    }

    /* pillar under the fact */
    const leftX = lerp(dw / 2, P ? 92 : 214, split);
    const rightX = lerp(dw / 2, P ? 268 : 546, split);
    this.pillar(b1x, plateY + plateH / 2 + 12, bookY - bookH / 2 + 2, P ? 26 : 34, { grow: pil });

    /* books, turning into tool calls */
    const bookOff = (1 - booksIn) * 44;
    this.book(b1x, bookY + bookOff, bookW, bookH, 'Refund ledger', booksIn * (1 - tool));
    this.book(b2x, bookY + bookOff, bookW, bookH, 'Bank file', booksIn * (1 - tool));
    const chipSize = P ? 11 : 13;
    this.chip(b1x, bookY, 'get_refund()', { alpha: tool, size: chipSize, fg: th.ink });
    this.chip(b2x, bookY, 'search_bank()', { alpha: tool, size: chipSize, fg: th.ink });

    /* the model where you were */
    if (llm > 0) {
      const oy = (plateY + bookY) / 2 + 12;
      const a = llm * (1 - gone);
      const ox = dw / 2;
      const left = this.pts([ox, oy], [ox - 40, oy + 30], [b1x + 30, bookY - 34], [b1x, bookY - 18]);
      const right = this.pts([ox, oy], [ox + 40, oy + 30], [b2x - 30, bookY - 34], [b2x, bookY - 18]);
      this.stroke(left, 0, 1, { color: th.lineStrong, lw: 1.5, alpha: a });
      this.stroke(right, 0, 1, { color: th.lineStrong, lw: 1.5, alpha: a });
      this.orb(ox, oy, P ? 15 : 18, a);
      this.text('an LLM', ox + (P ? 23 : 28), oy, {
        size: 11,
        weight: 650,
        mono: true,
        color: th.muted,
        base: 'middle',
        alpha: a,
      });
    }

    /* fact, or hunch? */
    if (hunch > 0) {
      [b1x, b2x].forEach((bx, i) => {
        const dirX = bx;
        const pts = this.pts(
          [dw / 2 + (i ? 60 : -60), plateY + plateH / 2 + 12],
          [dw / 2 + (i ? 60 : -60), plateY + 120],
          [dirX, bookY - 120],
          [dirX, bookY - bookH / 2 - 3],
        );
        this.stroke(pts, 0, E.out(hunch), { color: th.faint, lw: 1.5, dash: [4, 5], alpha: hunch });
        const m = this.at(pts, 0.55);
        this.text('?', m[0], m[1], {
          size: 18,
          weight: 800,
          color: th.amber,
          align: 'center',
          base: 'middle',
          alpha: hunch,
        });
      });
      this.chip(dw / 2, plateY + plateH / 2 + (P ? 44 : 56), 'fact, or hunch?', {
        alpha: hunch,
        fg: th.amber,
        border: th.amber,
        size: P ? 11 : 12.5,
      });
    }

    /* the ledger: one slip under each book */
    const slip = (x: number, n: string, name: string, why: string, found: string, ok: boolean, p: number, fp: number) => {
      if (p <= 0) return;
      const a = p * leaveLedger;
      const yy = slipY + (1 - p) * 16 - slipH / 2;
      this.box(x - slipW / 2, yy, slipW, slipH, { r: 10, fill: th.card, stroke: th.lineStrong, alpha: a, shadow: true });
      this.box(x - slipW / 2, yy, slipW, 5, { r: 2, fill: th.yellow, alpha: a });
      this.text(`${n} · ${name}`, x - slipW / 2 + 11, yy + 13, { size: 11, weight: 700, base: 'top', alpha: a });
      this.para(`why: ${why}`, x - slipW / 2 + 11, yy + 29, slipW - 20, {
        size: P ? 10 : 11,
        weight: 500,
        color: th.muted,
        alpha: a,
      });
      if (fp > 0) {
        this.text(found, x - slipW / 2 + 11, yy + slipH - 9, {
          size: 11,
          weight: 700,
          mono: true,
          color: ok ? th.green : th.red,
          alpha: a * fp,
        });
      }
    };
    slip(b1x, '1', 'Refund ledger', 'I’m sure it has the answer', '✓ says pending', true, slip1, win(T.ledgerA + 0.42, T.ledgerA + 0.56, t));
    slip(b2x, '2', 'Bank file', 'I assume it might', '✗ not in it', false, slip2, win(T.ledgerA + 0.62, T.ledgerA + 0.76, t));

    /* the answer */
    const gx = lerp(dw / 2, P ? 196 : 480, gone);
    const gy = lerp(plateY + bob, P ? 226 : 268, gone);
    const gk = lerp(1, P ? 0.52 : 0.56, gone);
    if (split < 1) {
      const c = this.c;
      c.save();
      c.translate(gx, gy);
      c.scale(gk, gk);
      this.plate(0, 0, plateW, plateH, { text: REAL.answer, label: 'ANSWER', angle: tilt, alpha: 1 - split, size: P ? 15 : 17 });
      c.restore();
    }
    if (split > 0) {
      const w = P ? 164 : 280;
      const h = P ? 96 : 92;
      this.plate(leftX, plateY, w, h, {
        label: 'FACT',
        text: 'The refund is still pending',
        sub: 'from: Refund ledger ✓',
        subColor: th.green,
        alpha: split,
        size: P ? 12.5 : 15,
      });
      const lean = Math.sin(clock * 1.1) * 0.02 + 0.03;
      this.plate(rightX, plateY + Math.sin(clock * 1.25) * 4, w, h, {
        label: 'HYPOTHESIS',
        text: 'The bank may have settled it',
        sub: 'not sure: no book says so',
        subColor: th.amber,
        angle: lean,
        dashed: true,
        tint: th.amber,
        alpha: split,
        size: P ? 12.5 : 15,
      });
      this.chip(dw / 2, plateY + (P ? 76 : 76) + 22, 'Honest: anyone can follow it and check it', {
        size: P ? 9.5 : 11.5,
        fg: th.yellowInk,
        border: th.yellow,
        alpha: split * leaveLedger,
        mono: false,
      });
    }

    /* the question */
    if (bubble > 0) {
      const c = this.c;
      c.save();
      c.translate(dw / 2, P ? 34 : 40);
      c.scale(bubble, bubble);
      c.font = this.font(P ? 13.5 : 16, 650);
      const w = c.measureText(REAL.question).width + 34;
      const h = P ? 36 : 42;
      this.box(-w / 2, -h / 2, w, h, { r: h / 2, fill: th.ink, alpha: clamp(bubble) });
      this.text(REAL.question, 0, 0.5, {
        size: P ? 13.5 : 16,
        weight: 650,
        color: th.bg,
        align: 'center',
        base: 'middle',
        alpha: clamp(bubble),
      });
      c.restore();
    }

    /* most frameworks: the log leaves for a dashboard, the answer for your user */
    if (logsIn > 0) {
      const mx = P ? 292 : 626;
      const my = P ? 66 : 92;
      const mw = P ? 104 : 164;
      const mh = P ? 72 : 108;
      this.box(mx - mw / 2, my - mh / 2, mw, mh, { r: 9, fill: th.cardAlt, stroke: th.lineStrong, lw: 1.5, alpha: logsIn, shadow: true });
      this.box(mx - 9, my + mh / 2, 18, 8, { r: 1, fill: th.lineStrong, alpha: logsIn });
      const bars = 7;
      const R = rng(11);
      for (let i = 0; i < bars; i++) {
        const v = 0.25 + 0.75 * R();
        const grow = win(i / bars, 1, lg);
        const bh = (mh - 34) * v * E.out(grow);
        const bw = (mw - 26) / bars - 3;
        this.box(mx - mw / 2 + 13 + i * (bw + 3), my + mh / 2 - 11 - bh, bw, bh, { r: 1.5, fill: th.faint, alpha: logsIn });
      }
      this.text('dashboard', mx, my - mh / 2 + 15, {
        size: 10,
        weight: 700,
        mono: true,
        color: th.muted,
        align: 'center',
        alpha: logsIn,
      });
      this.chip(mx, my + mh / 2 + 22, 'later, for your team', { alpha: win(T.logsA + 0.45, T.logsA + 0.65, t), size: P ? 9.5 : 10.5 });

      /* the stream */
      const N = 16;
      [b1x, b2x].forEach((bx, bi) => {
        const stream = this.pts(
          [bx, bookY - 16],
          [bx + (P ? 8 : 40), bookY - (P ? 90 : 120)],
          [mx - (P ? 22 : 60), my + (P ? 140 : 170)],
          [mx - mw * 0.2 + bi * 18, my + mh / 2 + 2],
          30,
        );
        for (let i = 0; i < N; i++) {
          const f = ((i / N + t * 1.1 + bi * 0.03) % 1 + 1) % 1;
          const p0 = this.at(stream, f);
          const p1 = this.at(stream, Math.min(1, f + 0.028));
          const a = logsIn * lerp(0.9, 0.25, f) * (1 - win(T.wordA - 0.3, T.wordA - 0.1, t));
          this.ga(a);
          const c = this.c;
          c.beginPath();
          c.moveTo(p0[0], p0[1]);
          c.lineTo(p1[0], p1[1]);
          c.strokeStyle = th.muted;
          c.lineWidth = 2;
          c.lineCap = 'round';
          c.stroke();
        }
      });

      /* your user already has it */
      const px = P ? 316 : 640;
      const py = P ? 222 : 268;
      this.person(px, py, P ? 19 : 24, gone, L.person);
      this.chip(P ? 196 : 480, P ? 260 : 308, 'already gone', {
        alpha: win(T.logsA + 0.4, T.logsA + 0.6, t),
        fg: th.red,
        border: th.red,
        size: P ? 10 : 11,
      });
    }
    this.alpha = 1;
  }

  /* ── the word drops in, and the answer lands on it ────────────────────── */
  private sceneWord(t: number) {
    const leave = win(T.sA, T.sA + 0.42, t);
    if (t < T.wordA || leave >= 1) return;
    const c = this.c;
    const w = this.word;
    const th = this.th;
    const G = this.ghostPose();
    const landing = T.wordA + 0.62;
    const dropH = this.dh + 40;
    const plateP = win(landing, landing + 0.3, t);
    const hit = win(landing + 0.13, landing + 0.32, t);
    const squash = Math.sin(clamp(hit) * Math.PI) * 0.03;
    WORD.forEach((ch, i) => {
      const a0 = T.wordA + i * 0.085;
      const p = win(a0, a0 + 0.3, t);
      if (p <= 0) return;
      const y = w.base - (1 - E.bounce(p)) * dropH;
      const isS = i === 0;
      const x = w.xs[i]!;
      c.font = this.big(w.size);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      if (isS && leave > 0) {
        /* the others clear out first, then the S carries on to become the letter behind its chapter */
        const k = E.inOut(win(0.22, 1, leave));
        c.font = this.big(lerp(w.size, G.size, k));
        c.textAlign = 'center';
        const sx = lerp(x + w.widths[0]! / 2, G.x, k);
        const sy = lerp(w.base, G.y, k);
        this.ga(lerp(1, 0.032, k));
        c.fillStyle = th.ink;
        c.fillText(ch, sx, sy);
        return;
      }
      const gone = win(0, 0.42, leave);
      this.ga(1 - gone);
      c.save();
      c.translate(x, y + E.out(gone) * (34 + i * 12));
      c.scale(1, 1 - squash);
      c.fillStyle = th.ink;
      c.fillText(ch, 0, 0);
      c.restore();
      const land = win(a0 + 0.2, a0 + 0.55, t);
      this.sparks(x + w.widths[i]! / 2, w.base, land, th.faint, 40 + i, 60, 8);
    });
    /* the answer lands */
    const pw = Math.min(w.right - w.left, this.P ? 330 : 660);
    const ph = this.P ? 62 : 72;
    if (plateP > 0) {
      const py = lerp(-90, w.top - ph / 2 - 11, E.bounce(plateP));
      this.alpha = 1 - win(0, 0.3, leave);
      this.plate(this.dw / 2, py - E.out(win(0, 0.3, leave)) * 30, pw, ph, {
        label: 'ANSWER',
        text: REAL.answer,
        size: this.P ? 12.5 : 17,
      });
      this.sparks(w.left + 30, w.top - 3, hit, th.yellow, 3, 48, 10);
      this.sparks(w.right - 30, w.top - 3, hit, th.yellow, 5, 48, 10);
      this.alpha = 1;
    }
  }

  /* ── S: the rules are fixed before the model sees anything ─────────────── */
  private sceneState(t: number) {
    const a0 = T.sA + 0.22;
    const scene = fade(a0, T.tA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;
    const barY = P ? 432 : 490;

    /* card geometry */
    const g = P
      ? {
          tool1: [6, 4, 348, 104],
          tool2: [6, 114, 348, 88],
          ans: [6, 208, 348, 106],
          rule: [6, 320, 348, 62],
        }
      : {
          tool1: [12, 26, 340, 148],
          tool2: [12, 190, 340, 136],
          ans: [408, 26, 340, 196],
          rule: [408, 238, 340, 88],
        };
    const inP = (i: number) => E.out(win(a0 + 0.05 + i * 0.26, a0 + 0.42 + i * 0.26, t));
    const lockAt = T.sA + 1.72;
    const head = win(lockAt, lockAt + 0.62, t);
    const gateX = P ? 262 : 610;
    const headX = lerp(18, gateX, E.inOut(head));
    const locked = (i: number) => win(lockAt + 0.08 + i * 0.12, lockAt + 0.26 + i * 0.12, t);

    const card = (key: 'tool1' | 'tool2' | 'ans' | 'rule', i: number, title: string, mono: boolean) => {
      const [x, y, w, h] = g[key] as [number, number, number, number];
      const p = inP(i);
      const lk = locked(i);
      const yy = y + (1 - p) * 18;
      this.box(x, yy, w, h, {
        r: 13,
        fill: th.card,
        stroke: lk > 0.5 ? th.ink : th.lineStrong,
        lw: lk > 0.5 ? 1.5 : 1,
        alpha: p,
        shadow: true,
      });
      this.cardHead(x, yy, w, title, p, mono);
      this.lock(x + w - 20, yy + 17, lk);
      this.ripple(x + w - 20, yy + 17, win(lockAt + 0.14 + i * 0.12, lockAt + 0.5 + i * 0.12, t), 26, th.ink, 0.7);
      return { x, y: yy, w, h, a: p };
    };

    const size = P ? 12 : 14;
    const rowGap = P ? 0 : 3;
    /* tool that marks a fact */
    const t1 = card('tool1', 0, 'get_refund returns', true);
    const [toolA, toolB] = L.toolRows;
    const markP = E.inOut(win(a0 + 0.42, a0 + 0.72, t));
    if (P) {
      this.fieldRow(t1.x + 14, t1.y + 40, 150, toolA[0], toolA[1], { alpha: t1.a, size });
      this.fieldRow(t1.x + 186, t1.y + 40, 148, toolB[0], toolB[1], { alpha: t1.a, mark: markP, size });
    } else {
      this.fieldRow(t1.x + 16, t1.y + 42, 300, toolA[0], toolA[1], { alpha: t1.a, size });
      this.fieldRow(t1.x + 16, t1.y + 42 + 46 + rowGap, 300, toolB[0], toolB[1], { alpha: t1.a, mark: markP, size });
    }
    this.chip(
      t1.x + t1.w - (P ? 56 : 66),
      P ? t1.y + t1.h - 13 : t1.y + 42 + 46 + 20,
      'marks the fact',
      { alpha: win(a0 + 0.56, a0 + 0.76, t), size: P ? 9 : 10.5, fg: th.yellowInk, border: th.yellow },
    );
    /* tool that says what it searched */
    const t2 = card('tool2', 1, 'search_bank declares', true);
    if (P) {
      this.fieldRow(t2.x + 14, t2.y + 38, 150, 'checked', REAL.accountCheckedItem, { alpha: t2.a, size: 11 });
      this.fieldRow(t2.x + 186, t2.y + 38, 148, 'not checked', REAL.accountNotCheckedItem, { alpha: t2.a, size: 11 });
    } else {
      this.fieldRow(t2.x + 16, t2.y + 40, 300, 'checked', REAL.accountCheckedItem, { alpha: t2.a, size: 13 });
      this.fieldRow(t2.x + 16, t2.y + 86, 300, 'not checked', REAL.accountNotCheckedItem, { alpha: t2.a, size: 13 });
    }
    /* the answer's required shape */
    const an = card('ans', 2, 'the answer must look like', false);
    if (P) {
      L.answerRows.forEach(([k, v], i) => {
        this.fieldRow(an.x + 14 + i * 112, an.y + 40, 96, k, v, { alpha: an.a, size: 10.5, mark: i === 1 ? markP : 0 });
      });
    } else {
      L.answerRows.forEach(([k, v], i) => {
        this.fieldRow(an.x + 16, an.y + 42 + i * 48, 300, k, v, { alpha: an.a, size, mark: i === 1 ? markP : 0 });
      });
    }
    /* field to fact */
    const link = E.inOut(win(a0 + 0.86, a0 + 1.26, t));
    const from: [number, number] = P ? [an.x + 176, an.y + 39] : [an.x - 2, an.y + 42 + 48 + 18];
    const to: [number, number] = P ? [t1.x + 340, t1.y + 59] : [t1.x + t1.w + 2, t1.y + 42 + 46 + rowGap + 18];
    const linkPts = P
      ? this.pts(from, [from[0] + 150, from[1] - 3], [to[0] + 34, to[1] + 80], to)
      : this.pts(from, [from[0] - 30, from[1]], [to[0] + 30, to[1]], to);
    this.stroke(linkPts, 0, link, { color: th.yellowDeep, lw: 2.4, alpha: scene > 0 ? 1 : 0 });
    if (link > 0.02 && link < 1) {
      const m = this.at(linkPts, link);
      this.glow(m[0], m[1], 15, th.yellow, 0.9);
    }
    if (link >= 1) {
      this.dot(from[0], from[1], 3.6, th.yellowDeep);
      this.dot(to[0], to[1], 3.6, th.yellowDeep);
    }
    const linkLabelA = win(a0 + 1.1, a0 + 1.3, t);
    if (P) {
      this.chip(dw / 2 + 62, an.y + an.h - 14, 'this field reports that fact', { alpha: linkLabelA, size: 9.5, fg: th.yellowInk, border: th.yellow, mono: false });
    } else {
      this.chip(dw / 2, (from[1] + to[1]) / 2 + 42, 'reports', { alpha: linkLabelA, size: 10.5, fg: th.yellowInk, border: th.yellow });
    }
    /* your rule */
    const ru = card('rule', 3, 'your rule', true);
    this.para(P ? 'Withhold it if a check fails.' : 'Withhold the answer if a check fails.', ru.x + 16, ru.y + (P ? 38 : 44), ru.w - 40, {
      size: P ? 12 : 14,
      weight: 620,
      alpha: ru.a,
    });

    /* the moment the rules freeze */
    const barA = win(a0 + 0.6, a0 + 0.9, t);
    this.box(18, barY, dw - 36, 3, { r: 2, fill: th.line, alpha: barA });
    this.box(18, barY, headX - 18, 3, { r: 2, fill: th.ink, alpha: barA });
    this.text('before the run', 18, barY - 11, { size: 10.5, weight: 700, mono: true, color: th.muted, alpha: barA });
    this.box(gateX - 1, barY - 12, 2.5, 27, { r: 1, fill: th.ink, alpha: barA });
    const wake = win(lockAt + 0.56, lockAt + 0.86, t);
    this.text('the run', gateX + 12, barY - 11, { size: 10.5, weight: 700, mono: true, color: wake > 0 ? th.yellowInk : th.faint, alpha: barA });
    if (head > 0) this.glow(headX, barY + 1, 18, th.yellow, 0.9 * (1 - win(0.96, 1, head) * 0.5));
    this.dot(headX, barY + 1.5, 5, th.ink, barA * (head > 0 ? 1 : 0));
    this.orb(P ? 322 : 690, barY + (P ? 2 : 2), lerp(8, P ? 15 : 19, E.back(wake)), wake);
    this.alpha = 1;
  }

  private traceNote(i: number) {
    return this.P
      ? { x: 34, y: 66 + i * 94, w: 320, h: 80 }
      : { x: 336, y: 26 + i * 130, w: 408, h: 104 };
  }

  /* ── T: every step writes its own note, with edges ─────────────────────── */
  private sceneTrace(t: number) {
    const scene = fade(T.tA + 0.02, T.aA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;
    const a0 = T.tA + 0.22;
    const step = 0.52;
    const fire = (i: number) => a0 + i * step;
    const NODES = ['Question', 'get_refund', 'search_bank', 'Answer'];
    const NOTES: { title: string; body: string; tag: string; color: string; gap?: string; mark?: boolean }[] = [
      { title: 'asked', body: REAL.question, tag: 'person', color: th.muted },
      { title: 'get_refund', body: 'status(A-1042) = "pending"', tag: 'tool', color: th.yellowInk, mark: true },
      { title: 'search_bank', body: 'nothing matched', tag: 'tool', color: th.yellowInk, gap: `not checked: ${REAL.accountNotCheckedItem}` },
      { title: 'answer', body: 'status: "completed"', tag: 'the model’s claim', color: th.amber },
    ];

    /* the flowchart */
    const node = (i: number) =>
      P
        ? { x: 6 + i * 89, y: 2, w: 81, h: 40 }
        : { x: 16, y: 44 + i * 122, w: 176, h: 58 };
    const note = (i: number) => this.traceNote(i);
    const edge = (i: number) => {
      const a = node(i);
      const b = node(i + 1);
      return P
        ? this.pts([a.x + a.w, a.y + a.h / 2], [a.x + a.w + 3, a.y + a.h / 2], [b.x - 3, b.y + b.h / 2], [b.x, b.y + b.h / 2], 8)
        : this.pts([a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, a.y + a.h + 20], [b.x + b.w / 2, b.y - 20], [b.x + b.w / 2, b.y], 14);
    };
    for (let i = 0; i < 3; i++) {
      const pts = edge(i);
      const p = win(fire(i) + 0.08, fire(i + 1), t);
      this.stroke(pts, 0, 1, { color: th.line, lw: 2 });
      this.stroke(pts, 0, p, { color: th.ink, lw: 2 });
      this.comet(pts, p, { lw: 3 });
    }
    NODES.forEach((label, i) => {
      const n = node(i);
      const lit = win(fire(i), fire(i) + 0.14, t);
      this.box(n.x, n.y, n.w, n.h, {
        r: 11,
        fill: th.card,
        stroke: lit > 0 ? th.yellowDeep : th.lineStrong,
        lw: lit > 0 ? 2 : 1,
        shadow: true,
      });
      if (lit > 0) this.glow(n.x + n.w / 2, n.y + n.h / 2, n.w * 0.7, th.yellow, 0.12 * lit);
      this.text(label, n.x + n.w / 2, n.y + n.h / 2 + 0.5, {
        size: P ? (label.length > 9 ? 8.6 : 10.5) : 13,
        weight: 650,
        mono: i === 1 || i === 2,
        align: 'center',
        base: 'middle',
      });
      this.ripple(n.x + n.w / 2, n.y + n.h / 2, win(fire(i), fire(i) + 0.4, t), n.w * 0.7, th.yellow);
    });

    /* who writes */
    const headA = win(a0 - 0.1, a0 + 0.15, t);
    if (!P) {
      this.text(L.recordHead, 336, 8, {
        size: 10.5,
        weight: 700,
        mono: true,
        color: th.muted,
        alpha: headA,
      });
    } else {
      this.text(L.recordHead, 34, 52, {
        size: 9,
        weight: 700,
        mono: true,
        color: th.muted,
        alpha: headA,
      });
    }

    /* the edges between notes, stitched as they land */
    const threadX = P ? 34 : 336;
    const noteMid = (i: number) => {
      const n = note(i);
      return n.y + n.h / 2;
    };
    const thread = (i: number) =>
      this.pts(
        [threadX, noteMid(i)],
        [threadX - (P ? 24 : 40), noteMid(i) + 18],
        [threadX - (P ? 24 : 40), noteMid(i + 1) - 18],
        [threadX, noteMid(i + 1)],
        16,
      );

    /* the walk back at the end */
    const walkA = T.aA - 0.86;
    const walk = win(walkA, walkA + 0.62, t);
    const walkIndex = 3 - walk * 3;

    for (let i = 0; i < 3; i++) {
      const p = E.out(win(fire(i + 1) + 0.3, fire(i + 1) + 0.5, t));
      const pts = thread(i);
      this.stroke(pts, 0, p, { color: th.yellowDeep, lw: 2.2 });
      if (walk > 0) {
        const span = clamp(i + 1 - walkIndex);
        const f = 1 - span;
        if (span > 0) this.stroke(pts, f, 1, { color: th.yellow, lw: 4, alpha: 0.9 });
        if (walkIndex < i + 1 && walkIndex > i) {
          const head = this.at(pts, walkIndex - i);
          this.glow(head[0], head[1], 18, th.yellow, 1);
          this.dot(head[0], head[1], 4, th.yellowDeep);
        }
      }
    }

    /* the notes */
    NOTES.forEach((n, i) => {
      const land = fire(i) + 0.05;
      const p = E.inOut(win(land, land + 0.34, t));
      if (p <= 0) return;
      const from = node(i);
      const to = note(i);
      const x = lerp(from.x + from.w / 2 - to.w * 0.2, to.x, p);
      const y = lerp(from.y, to.y, p);
      const k = lerp(0.4, 1, p);
      const c = this.c;
      c.save();
      c.translate(x, y);
      c.scale(k, k);
      const lit = walk > 0 && walkIndex <= i + 0.02;
      this.box(0, 0, to.w, to.h, {
        r: 11,
        fill: th.card,
        stroke: lit ? th.yellowDeep : i === 3 ? th.amber : th.lineStrong,
        lw: lit ? 2.2 : i === 3 ? 1.5 : 1,
        shadow: true,
        dash: i === 3 ? [5, 4] : undefined,
      });
      this.box(0, 0, to.w, 5, { r: 2, fill: i === 3 ? th.amber : th.yellow });
      this.text(n.title, 14, P ? 13 : 16, { size: P ? 9.5 : 10.5, weight: 700, mono: true, color: th.muted, base: 'top' });
      const mark = n.mark ? E.inOut(win(land + 0.34, land + 0.6, t)) : 0;
      if (mark > 0) this.box(10, P ? 28 : 34, (P ? 210 : 280) * mark, P ? 22 : 28, { r: 6, fill: th.yellow, alpha: 0.38 });
      this.text(n.body, 14, P ? 31 : 39, { size: P ? 12.5 : 16, weight: 620, mono: i !== 0, base: 'top' });
      if (n.gap) {
        const gp = win(land + 0.3, land + 0.5, t);
        this.text(n.gap, 14, P ? 56 : 72, { size: P ? 9.5 : 11, weight: 600, mono: true, color: th.amber, base: 'top', alpha: gp });
      }
      c.font = this.font(P ? 9 : 10, 650, true);
      const tw = c.measureText(n.tag).width + 16;
      this.box(to.w - tw - 10, P ? 10 : 12, tw, P ? 16 : 19, { r: 9, fill: th.cardAlt, stroke: th.line });
      this.text(n.tag, to.w - tw / 2 - 10, (P ? 10 : 12) + (P ? 8 : 9.5), {
        size: P ? 9 : 10,
        weight: 650,
        mono: true,
        color: n.color,
        align: 'center',
        base: 'middle',
      });
      c.restore();
    });
    this.alpha = 1;
  }

  /* ── A: two cards and a line ──────────────────────────────────────────── */
  private pairGeom() {
    return this.P
      ? { lx: 4, rx: 196, cw: 160, y: 44, h: 244, gap: 32, size: 11.5 }
      : { lx: 16, rx: 460, cw: 284, y: 88, h: 262, gap: 160, size: 15 };
  }

  private sceneAssess(t: number) {
    const scene = fade(T.aA + 0.02, T.mA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;
    const G = this.pairGeom();
    const a0 = T.aA + 0.26;
    const inL = E.out(win(a0 - 0.2, a0 + 0.1, t));
    const inR = E.out(win(a0 - 0.1, a0 + 0.2, t));
    const rowsY = (i: number) => G.y + (P ? 44 : 50) + i * (P ? 66 : 70);

    const hitAt = a0 + 0.72 + 0.32;
    const flinch = win(hitAt, hitAt + 0.28, t);
    const shake = flinch > 0 && flinch < 1 ? Math.sin(flinch * 34) * 5 * (1 - flinch) : 0;
    const cardAt = (x: number, title: string, p: number, dx: number) => {
      const xx = x + (1 - p) * dx + shake;
      this.box(xx, G.y, G.cw, G.h, { r: 13, fill: th.card, stroke: th.lineStrong, alpha: p, shadow: true });
      this.cardHead(xx, G.y, G.cw, title, p, false);
      return xx;
    };
    const lx = cardAt(G.lx, L.said, inL, -24);
    const rx = cardAt(G.rx, L.holds, inR, 24);

    /* row 1: agrees. row 2: contradicts. row 3: nobody marked it. */
    const r1 = a0 + 0.3;
    const r2 = a0 + 0.72;
    const r3 = a0 + 1.38;
    const hit = r2 + 0.32;
    const contradiction = win(hit, hit + 0.1, t);
    const lineFrom = (i: number): [number, number] => [lx + G.cw - (P ? 6 : 8), rowsY(i) + 19];
    const lineTo = (i: number): [number, number] => [rx + (P ? 6 : 8), rowsY(i) + 19];

    const rowW = G.cw - 28;
    this.fieldRow(lx + 14, rowsY(0), rowW, 'order', `"${CASES.contradicted.order}"`, { alpha: inL, size: G.size });
    this.fieldRow(lx + 14, rowsY(1), rowW, 'status', `"${CASES.contradicted.status}"`, {
      alpha: inL,
      size: G.size,
      color: contradiction > 0 ? th.red : th.ink,
      bg: contradiction > 0 ? th.red : undefined,
    });
    this.fieldRow(lx + 14, rowsY(2), rowW, 'reason', P ? '"the bank..."' : `"${CASES.contradicted.reason}"`, { alpha: inL, size: P ? 10.5 : 14 });

    this.fieldRow(rx + 14, rowsY(0), rowW, 'order', `"${CASES.contradicted.order}"`, { alpha: inR, size: G.size });
    this.fieldRow(rx + 14, rowsY(1), rowW, 'status(A-1042)', `"${CASES.known.status}"`, { alpha: inR, size: G.size, mark: inR });
    const slot = win(r3 + 0.3, r3 + 0.5, t);
    this.box(rx + 8, rowsY(2) - 1, G.cw - 16, 39, { r: 7, stroke: th.lineStrong, dash: [4, 4], alpha: inR });
    this.text(L.unmarkedSlot, rx + G.cw / 2, rowsY(2) + 19, {
      size: P ? 9.5 : 11,
      weight: 600,
      mono: true,
      color: th.faint,
      align: 'center',
      base: 'middle',
      alpha: inR * Math.max(0.5, slot),
    });

    const link = (i: number) =>
      this.pts(lineFrom(i), [lineFrom(i)[0] + G.gap * 0.5, lineFrom(i)[1]], [lineTo(i)[0] - G.gap * 0.5, lineTo(i)[1]], lineTo(i), 16);

    /* agrees */
    const p1 = E.inOut(win(r1, r1 + 0.26, t));
    this.stroke(link(0), 0, p1, { color: th.faint, lw: 2 });
    this.comet(link(0), p1, { lw: 2.6 });
    /* contradicts */
    const p2 = E.inOut(win(r2, hit, t));
    this.stroke(link(1), 0, p2, { color: contradiction > 0 ? th.red : th.yellowDeep, lw: contradiction > 0 ? 3 : 2.4 });
    this.comet(link(1), p2, { lw: 3.2 });
    /* unmarked: the line reaches out and finds nothing */
    const p3 = E.inOut(win(r3, r3 + 0.3, t));
    this.stroke(link(2), 0, p3 * 0.62, { color: th.faint, lw: 1.6, dash: [3, 5] });

    const mid = lx + G.cw + (rx - lx - G.cw) / 2;
    if (!P) {
      this.chip(mid, rowsY(0) + 2, L.agrees, { alpha: win(r1 + 0.2, r1 + 0.34, t), size: 10.5 });
      this.chip(mid, rowsY(1) + 2, L.contradicts, {
        alpha: contradiction,
        size: 11.5,
        fg: '#fff',
        bg: th.red,
        border: th.red,
        scale: lerp(1.4, 1, E.out(win(hit, hit + 0.2, t))),
      });
      this.chip(mid, rowsY(2) + 2, L.unmarked, { alpha: win(r3 + 0.24, r3 + 0.4, t), size: 10.5 });
    } else {
      this.chip(mid, rowsY(0) - 9, L.agrees, { alpha: win(r1 + 0.2, r1 + 0.34, t), size: 8.5 });
      this.chip(mid, rowsY(1) - 9, L.contradicts, { alpha: contradiction, size: 9, fg: '#fff', bg: th.red, border: th.red });
      this.chip(mid, rowsY(2) - 9, L.unmarked, { alpha: win(r3 + 0.24, r3 + 0.4, t), size: 8.5 });
    }
    /* the flash */
    const hx = (lineFrom(1)[0] + lineTo(1)[0]) / 2;
    const hy = lineFrom(1)[1];
    const flash = win(hit, hit + 0.34, t);
    this.ripple(lineTo(1)[0], hy, flash, 60, th.red);
    this.sparks(lineTo(1)[0], hy, flash, th.red, 21, 70, 16);
    this.glow(hx, hy, 80, th.red, 0.26 * (1 - flash) * (flash > 0 ? 1 : 0));

    /* the library's own sentence, typed out */
    const typeP = win(hit + 0.1, hit + 0.62, t);
    if (typeP > 0) {
      const y = G.y + G.h + (P ? 16 : 24);
      const n = Math.round(REAL.finding.length * typeP);
      const bw = dw - (P ? 8 : 32);
      const bh = P ? 76 : 74;
      this.box((dw - bw) / 2, y, bw, bh, { r: 11, fill: th.cardAlt, stroke: th.red, alpha: win(0, 0.12, typeP) });
      this.para(REAL.finding.slice(0, n), (dw - bw) / 2 + 13, y + 12, bw - 26, {
        size: P ? 11 : 14,
        weight: 600,
        mono: true,
        color: th.ink,
      });
    }
    this.alpha = 1;
  }

  /* ── the same picture, for every check ─────────────────────────────────── */
  private sceneMontage(t: number) {
    const scene = fade(T.mA + 0.02, T.nA, t, 0.14);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P } = this;
    const th = this.th;
    const G = this.pairGeom();
    const CHECKS: { name: string; say: [string, string]; rec: [string, string]; verdict: string }[] = [
      { name: 'invented value', say: ['the answer says', 'refund RF-90417'], rec: ['tool results', 'no result has it'], verdict: 'in no tool result' },
      { name: 'time window', say: ['the customer asked', 'refunds this year'], rec: ['the tool read', 'the last 30 days'], verdict: 'read less than was asked' },
      { name: 'an action that never ran', say: ['the answer says', 'I issued the refund'], rec: ['this run', 'issue_refund never ran'], verdict: 'your check fails it' },
      { name: '“not found” stretched too far', say: ['the answer says', 'the bank has no record'], rec: ['the search covered', 'today’s file only'], verdict: 'claim exceeds search' },
    ];
    const span = (T.nA - T.mA - 0.1) / CHECKS.length;
    const y = P ? 112 : 176;
    const h = P ? 128 : 150;
    CHECKS.forEach((cs, i) => {
      const a = T.mA + 0.05 + i * span;
      const b = a + span;
      if (t < a || t >= b) return;
      const open = E.out(win(a, a + 0.09, t));
      const close = 1 - win(b - 0.06, b, t);
      const k = open * (i === CHECKS.length - 1 ? 1 : close);
      const c = this.c;
      c.save();
      c.translate(0, y + h / 2);
      c.scale(1, Math.max(0.001, k));
      c.translate(0, -(y + h / 2));
      this.chip(this.dw / 2, y - (P ? 28 : 34), cs.name, { size: P ? 11.5 : 14, fg: th.ink, border: th.lineStrong, mono: false });
      const lx = G.lx;
      const rx = G.rx;
      const card = (x: number, row: [string, string]) => {
        this.box(x, y, G.cw, h, { r: 13, fill: th.card, stroke: th.lineStrong, shadow: true });
        this.text(row[0], x + 14, y + 22, { size: P ? 10 : 11.5, weight: 700, mono: true, color: th.faint, base: 'top' });
        this.para(row[1], x + 14, y + 44, G.cw - 28, { size: P ? 15 : 22, weight: 700, lh: P ? 19 : 28 });
      };
      card(lx, cs.say);
      card(rx, cs.rec);
      const from: [number, number] = [lx + G.cw - 8, y + h / 2];
      const to: [number, number] = [rx + 8, y + h / 2];
      const pts = this.pts(from, [from[0] + G.gap / 2, from[1]], [to[0] - G.gap / 2, to[1]], to, 12);
      const p = E.inOut(win(a + 0.05, a + 0.2, t));
      this.stroke(pts, 0, p, { color: p >= 1 ? th.red : th.yellowDeep, lw: 3 });
      this.comet(pts, p, { lw: 3 });
      const v = win(a + 0.2, a + 0.28, t);
      c.restore();
      this.sparks(to[0], to[1], win(a + 0.2, a + 0.36, t), th.red, 60 + i, 50, 10);
      this.chip(this.dw / 2, y + h + (P ? 26 : 34), cs.verdict, {
        alpha: v * k,
        size: P ? 11 : 13.5,
        fg: '#fff',
        bg: th.red,
        border: th.red,
        scale: lerp(1.25, 1, E.out(win(a + 0.2, a + 0.32, t))),
      });
    });
    this.alpha = 1;
  }

  /* ── N: five words, five ways of standing ─────────────────────────────── */
  private sceneName(t: number, clock: number) {
    const scene = fade(T.nA + 0.02, T.dA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;

    const START = T.nA + 0.3;
    const STEP = (T.namedA - START) / 5;
    const STATES = [
      { key: 'known', word: 'known', color: th.green, l: 1, r: 1, ghost: 0, crack: 0, angle: 0, lift: 0, ask: 0, label: 'STRUCTURED ANSWER', text: `order ${CASES.known.order} · status ${CASES.known.status}`, mono: true },
      { key: 'consistent', word: 'consistent', color: th.muted, l: 1, r: 1, ghost: 1, crack: 0, angle: 0, lift: 0, ask: 0, label: 'ANSWER', text: CASES.consistent, mono: false },
      { key: 'notSure', word: 'not sure', color: th.amber, l: 1, r: 1, ghost: 0, crack: 1, angle: 0.07, lift: 0, ask: 0, label: 'ANSWER', text: REAL.answer, mono: false },
      { key: 'ask', word: 'ask', color: th.blue, l: 1, r: 0, ghost: 0, crack: 0, angle: 0, lift: 0, ask: 1, label: 'NO ANSWER YET', text: 'Waiting on a person.', mono: false },
      { key: 'notAssessed', word: 'not assessed', color: th.faint, l: 0, r: 0, ghost: 0, crack: 0, angle: 0.015, lift: -22, ask: 0, label: 'ANSWER', text: CASES.notAssessed, mono: false },
    ] as const;
    const LINES: Record<string, string> = {
      known: 'standing: "known"',
      consistent: REAL.consistent,
      notSure: REAL.notSure,
      ask: REAL.ask,
      notAssessed: REAL.notAssessed,
    };
    const backAt = START + STEP * STATES.length;
    const stateIndex = () => {
      if (t >= backAt) return 2;
      return clamp(Math.floor((t - START) / STEP), 0, STATES.length - 1);
    };
    const idx = stateIndex();
    const prevIdx = t >= backAt ? 4 : Math.max(0, idx - 1);
    const stepStart = t >= backAt ? backAt : START + idx * STEP;
    const mix = E.inOut(win(stepStart, stepStart + 0.2, t));
    const A = STATES[prevIdx]!;
    const B = STATES[idx]!;
    const m = (k: 'l' | 'r' | 'ghost' | 'crack' | 'angle' | 'lift' | 'ask') => lerp(A[k], B[k], mix);
    const giving = idx === 2 ? E.back(win(stepStart, stepStart + 0.26, t)) : mix;

    const cx = dw / 2;
    const plateY = P ? 88 : 96;
    const plateW = P ? 330 : 500;
    const plateH = P ? 70 : 84;
    const groundY = P ? 280 : 356;
    const gapX = P ? 104 : 170;
    const rise = E.out(win(T.nA + 0.02, T.nA + 0.34, t));
    const lift = m('lift') + (idx === 4 ? Math.sin(clock * 1.3) * 5 * mix : 0) - (1 - rise) * 26;
    const angle = lerp(A.angle, B.angle, giving) + (idx === 4 ? Math.sin(clock * 0.9) * 0.01 * mix : 0);
    const under = (x: number) => plateY + lift + plateH / 2 + 7 + Math.tan(angle) * (x - cx);

    /* the ground */
    const gIn = E.out(win(T.nA, T.nA + 0.25, t));
    this.box(cx - (P ? 170 : 330), groundY, (P ? 340 : 660) * gIn, 3, { r: 2, fill: th.lineStrong });
    this.text(L.record, cx - (P ? 170 : 330), groundY + 18, { size: 10.5, weight: 700, mono: true, color: th.faint, alpha: gIn });

    /* the pillars */
    const lx = cx - gapX;
    const rx = cx + gapX;
    const w = P ? 28 : 40;
    const crackFx = win(START + STEP * 2, START + STEP * 2 + 0.3, t);
    this.pillar(lx, under(lx), groundY + 1, w, { grow: m('l') * rise, ghost: m('ghost') });
    this.pillar(rx, under(rx), groundY + 1, w, { grow: m('r') * rise, ghost: m('ghost'), crack: m('crack'), seed: 9 });
    /* each pillar is a result the last step left behind */
    const resultA = fade(T.nA + 0.02, START + STEP * 0.7, t, 0.1);
    this.chip(lx, (plateY + groundY) / 2 + 20, 'a result', { alpha: resultA, size: P ? 9.5 : 11, fg: th.yellowInk, border: th.yellow });
    this.chip(rx, (plateY + groundY) / 2 + 20, 'a result', { alpha: resultA, size: P ? 9.5 : 11, fg: th.yellowInk, border: th.yellow });
    this.sparks(rx, lerp(under(rx), groundY, 0.34), crackFx, th.red, 77, 54, 14);

    /* the slab */
    const word = B;
    const shown = mix < 0.5 ? A : B;
    this.plate(cx, plateY + lift, plateW, plateH, {
      label: shown.label,
      text: shown.text,
      mono: shown.mono,
      textAlpha: Math.abs(mix * 2 - 1),
      size: P ? 13 : 17,
      angle,
      tint: idx === 2 ? th.amber : undefined,
    });

    /* known gets its stamp */
    const stamp = fade(START, START + STEP, t, 0.08);
    if (stamp > 0) this.chip(cx, plateY + plateH / 2 + (P ? 30 : 42), '✓ your check passed', { alpha: stamp, fg: th.green, border: th.green, size: P ? 10.5 : 12 });

    /* ask: the slab waits for a person */
    const askA = fade(START + STEP * 3, START + STEP * 4, t, 0.08);
    if (askA > 0) {
      const px = P ? 318 : 650;
      const py = P ? 186 : 240;
      this.person(px, py, P ? 18 : 24, askA, L.person, th.blue);
      const bw = P ? 196 : 262;
      const bx = px - bw - (P ? 26 : 36);
      this.box(bx, py - 22, bw, 36, { r: 18, fill: th.blue, alpha: askA });
      this.text(REAL.ask, bx + bw / 2, py - 3.5, { size: P ? 11 : 14, weight: 650, color: '#fff', align: 'center', base: 'middle', alpha: askA });
    }

    /* the five words */
    const chipsY = P ? 322 : 412;
    const chipW = P ? 66 : 132;
    STATES.forEach((s, i) => {
      const x = cx + (i - 2) * chipW;
      const on = i === idx ? mix : i === prevIdx ? 1 - mix : 0;
      const inP = E.out(win(T.nA + 0.04 + i * 0.05, T.nA + 0.28 + i * 0.05, t));
      const size = P ? 9 : 13.5;
      if (on > 0.5) {
        this.chip(x, chipsY + (1 - inP) * 12, s.word, { alpha: inP, size, fg: '#fff', bg: s.color, border: s.color, mono: false, scale: lerp(1, 1.1, on) });
      } else {
        this.chip(x, chipsY + (1 - inP) * 12, s.word, { alpha: inP, size, fg: th.muted, mono: false });
      }
    });

    /* the library's own line */
    const lineA = mix * win(START, START + 0.1, t);
    if (lineA > 0) {
      const bw = dw - (P ? 8 : 60);
      const by = chipsY + (P ? 22 : 34);
      this.box((dw - bw) / 2, by, bw, P ? 122 : 104, { r: 11, fill: th.cardAlt, stroke: th.line, alpha: lineA });
      const used = this.para(L.glosses[word.key], (dw - bw) / 2 + 14, by + (P ? 10 : 12), bw - 28, {
        size: P ? 12 : 14.5,
        weight: 720,
        alpha: lineA,
        lh: P ? 15.5 : 19,
      });
      this.para(LINES[word.key]!, (dw - bw) / 2 + 14, by + (P ? 10 : 12) + used + (P ? 5 : 6), bw - 28, {
        size: P ? 10.5 : 12.5,
        weight: 560,
        mono: true,
        alpha: lineA,
        color: th.muted,
        lh: P ? 13.5 : 16,
      });
    }

    /* read from the record, never from how it sounded */
    const named = win(T.namedA + 0.05, T.namedA + 0.3, t);
    if (named > 0) {
      const y = P ? 188 : 240;
      const strike = win(T.namedA + 0.3, T.namedA + 0.55, t);
      const label = L.sounded;
      const c = this.c;
      c.font = this.font(P ? 10.5 : 12.5, 650);
      const tw = c.measureText(label).width;
      this.chip(cx, y, label, { alpha: named * lerp(1, 0.75, strike), size: P ? 10.5 : 12.5, mono: false });
      this.box(cx - tw / 2 - 4, y - 1, (tw + 8) * strike, 2, { r: 1, fill: th.red, alpha: named });
      /* the record is what is wired in */
      const wire = this.pts([cx, groundY], [cx, groundY - 30], [cx, plateY + plateH / 2 + 50], [cx, plateY + plateH / 2 + 8], 14);
      const f = win(T.namedA + 0.48, T.namedA + 0.8, t);
      this.stroke(wire, 0, Math.min(f, (groundY - y - 22) / (groundY - plateY - plateH / 2 - 8)), { color: th.yellowDeep, lw: 2.4 });
      this.chip(cx + (P ? 62 : 80), lerp(groundY, y, 0.5), 'the record', { alpha: f, size: P ? 9.5 : 10.5, fg: th.yellowInk, border: th.yellow });
    }
    this.alpha = 1;
  }

  /* ── D: a junction with four tracks ───────────────────────────────────── */
  private sceneDecide(t: number) {
    const scene = fade(T.dA + 0.02, T.gA, t, 0.16);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P } = this;
    const th = this.th;
    const L = this.labels;
    const a0 = T.dA + 0.2;
    const leg = (T.gA - a0 - 0.08) / 4;
    const COLORS = [th.amber, th.yellowDeep, th.blue, th.red];
    const startX = P ? 22 : 34;
    const midY = P ? 196 : 262;
    const hubX = P ? 66 : 176;
    const endX = P ? 300 : 640;
    const ys = P ? [40, 140, 240, 340] : [58, 192, 326, 460];

    const stem = this.pts([startX + 30, midY], [startX + 50, midY], [hubX - 20, midY], [hubX, midY], 8);
    this.stroke(stem, 0, 1, { color: th.lineStrong, lw: 3 });
    const paths = ys.map((y) => this.pts([hubX, midY], [hubX + (P ? 40 : 90), midY], [hubX + (P ? 30 : 80), y], [hubX + (P ? 100 : 200), y], 20));
    const runs = ys.map((y) => this.pts([hubX + (P ? 100 : 200), y], [hubX + (P ? 130 : 260), y], [endX - 60, y], [endX, y], 12));

    /* windows */
    const on = (i: number) => {
      const a = a0 + i * leg;
      return { a, b: a + leg, p: win(a, a + leg * 0.74, t), live: t >= a && t < a + leg, done: t >= a + leg };
    };

    ys.forEach((y, i) => {
      const w = on(i);
      const color = COLORS[i]!;
      this.stroke(paths[i]!, 0, 1, { color: w.live ? color : th.line, lw: w.live ? 3 : 2 });
      this.stroke(runs[i]!, 0, 1, { color: w.live ? color : th.line, lw: w.live ? 3 : 2 });
      const labelY = P ? y - 22 : y - 34;
      const labelX = hubX + (P ? 44 : 150);
      this.text(L.tracks[i]!, labelX, labelY, {
        size: P ? 13.5 : 17,
        weight: 750,
        color: w.live || w.done ? th.ink : th.muted,
        base: 'middle',
        mono: L.tracks[i]!.startsWith('a') && !L.tracks[i]!.includes(' ') || L.tracks[i] === 'guard' || L.tracks[i] === 'enforce',
      });
      const noteA = 0.5 + 0.5 * (w.live || w.done ? 1 : 0);
      if (P) {
        this.para(L.trackNotes[i]!, labelX, y + 7, 240, { size: 8.8, weight: 500, color: th.faint, alpha: noteA, lh: 10.5 });
      } else {
        this.text(L.trackNotes[i]!, labelX, y + 18, { size: 11, weight: 500, color: th.faint, base: 'middle', alpha: noteA });
      }
    });
    this.box(startX - 14, midY - 20, 58, 40, { r: 8, fill: th.card, stroke: th.yellow, lw: 1.5, shadow: true });
    this.text('answer', startX + 15, midY, { size: 10, weight: 700, mono: true, color: th.yellowInk, align: 'center', base: 'middle' });

    /* a token rides each track in turn */
    const token = (x: number, y: number, color: string, a = 1) => {
      this.glow(x, y, 20, color, 0.5 * a);
      this.box(x - 13, y - 8, 26, 16, { r: 4, fill: th.card, stroke: color, lw: 2, alpha: a });
    };
    const whole = (i: number) => [...paths[i]!, ...runs[i]!.slice(1)] as [number, number][];

    /* 0. flag: it goes out, wearing its reason */
    {
      const w = on(0);
      if (w.live || w.done) {
        const p = E.inOut(w.p);
        const pts = whole(0);
        const pos = this.at(pts, p);
        if (w.live) token(pos[0], pos[1], COLORS[0]!);
        this.person(endX + (P ? 24 : 40), ys[0]!, P ? 15 : 21, 1, undefined, p >= 1 ? th.amber : th.faint);
        if (p >= 1) this.chip(endX - (P ? 30 : 34), ys[0]! - (P ? 18 : 22), 'not sure', { fg: th.amber, border: th.amber, size: P ? 9 : 10.5, alpha: win(w.a + leg * 0.74, w.a + leg * 0.9, t) });
      } else this.person(endX + (P ? 24 : 40), ys[0]!, P ? 15 : 21, 1, undefined, th.line);
    }
    /* 1. one more turn: back to the comparison */
    {
      const w = on(1);
      const y = ys[1]!;
      const loopX = endX - (P ? 30 : 60);
      const loop = this.pts([loopX, y], [loopX + (P ? 44 : 70), y - (P ? 42 : 60)], [loopX - (P ? 90 : 130), y - (P ? 54 : 70)], [hubX + (P ? 64 : 150), y - (P ? 2 : 4)], 22);
      const lp = win(w.a + leg * 0.45, w.a + leg * 0.92, t);
      this.stroke(loop, 0, 1, { color: w.live ? COLORS[1]! : th.line, lw: 2, dash: [5, 5], alpha: 0.9 });
      if (w.live) {
        const p = E.inOut(win(w.a, w.a + leg * 0.45, t));
        const pts = whole(1);
        const f = p * 0.82;
        if (lp <= 0) {
          const pos = this.at(pts, f);
          token(pos[0], pos[1], COLORS[1]!);
        } else {
          const pos = this.at(loop, E.inOut(lp));
          token(pos[0], pos[1], COLORS[1]!);
        }
      }
      const apex = this.at(loop, 0.5);
      this.chip(apex[0] + (P ? 8 : 18), apex[1] - (P ? 7 : 10), '↻ re-checked by code', {
        size: P ? 8.5 : 10.5,
        fg: th.yellowInk,
        border: th.yellow,
        alpha: win(w.a + leg * 0.5, w.a + leg * 0.7, t),
      });
    }
    /* 2. ask: it stops and waits for the person */
    {
      const w = on(2);
      const y = ys[2]!;
      const col = w.live || w.done ? th.blue : th.line;
      this.person(endX + (P ? 24 : 40), y, P ? 15 : 21, 1, undefined, col);
      if (w.live || w.done) {
        const pts = whole(2);
        const p = E.inOut(win(w.a, w.a + leg * 0.5, t));
        const pos = this.at(pts, p * 0.84);
        if (w.live) token(pos[0], pos[1], COLORS[2]!);
        const bub = win(w.a + leg * 0.46, w.a + leg * 0.62, t);
        if (P) this.box(hubX + 40, y + 5, 200, 15, { r: 3, fill: th.bg, alpha: bub });
        this.chip(endX - (P ? 74 : 96), P ? y + 13 : y - 22, REAL.ask, { fg: '#fff', bg: th.blue, border: th.blue, size: P ? 8.8 : 10.5, mono: false, alpha: bub });
      }
    }
    /* 3. withhold: the gate drops */
    {
      const w = on(3);
      const y = ys[3]!;
      const gx = endX - (P ? 30 : 70);
      const drop = E.bounce(win(w.a + leg * 0.32, w.a + leg * 0.55, t));
      const gateH = P ? 44 : 60;
      this.box(gx - 4, y - gateH * 0.5 - (1 - drop) * 34, 8, gateH, { r: 3, fill: w.live || w.done ? th.red : th.lineStrong, alpha: 1 });
      if (w.live) {
        const hitAt = w.a + leg * 0.62;
        const pts = whole(3);
        const p = E.inOut(win(w.a, hitAt, t));
        const n = 1 - (endX - gx) / (endX - hubX);
        const pos = this.at(pts, p * n);
        const broke = win(hitAt, hitAt + 0.26, t);
        if (broke <= 0) token(pos[0], pos[1], COLORS[3]!);
        else this.sparks(pos[0], pos[1], broke, th.red, 91, 56, 16);
      }
      const textA = win(w.a + leg * 0.7, w.a + leg * 0.86, t);
      if (textA > 0) {
        this.chip(this.dw / 2 + (P ? 10 : 40), y + (P ? 32 : 44), REAL.withheld, {
          alpha: textA,
          size: P ? 7.6 : 10.5,
          fg: th.red,
          border: th.red,
          bg: th.card,
        });
      }
      this.person(endX + (P ? 24 : 40), y, P ? 15 : 21, 1, undefined, th.line);
    }
    this.alpha = 1;
  }

  /* ── typed answers wait, prose goes first ─────────────────────────────── */
  private sceneGate(t: number) {
    const scene = fade(T.gA + 0.02, T.xA, t, 0.14);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const L = this.labels;
    const a0 = T.gA + 0.1;
    const dur = T.xA - a0 - 0.1;
    const lane = (y: number) => {
      this.box(10, y, dw - 20, 3, { r: 2, fill: th.line });
    };
    const y1 = P ? 134 : 170;
    const y2 = P ? 318 : 392;
    const gateX = dw * (P ? 0.56 : 0.58);
    const px = dw - (P ? 26 : 46);
    lane(y1);
    lane(y2);
    this.text(L.typedLane, 10, y1 - (P ? 86 : 96), { size: P ? 12 : 15, weight: 750 });
    this.text(L.proseLane, 10, y2 - (P ? 86 : 96), { size: P ? 12 : 15, weight: 750 });
    this.person(px, y1 - (P ? 20 : 28), P ? 15 : 21, 1, undefined, th.muted);
    this.person(px, y2 - (P ? 20 : 28), P ? 15 : 21, 1, undefined, th.muted);

    const check = (x: number, y: number, label: string, done: number) => {
      this.box(x - 3, y - (P ? 54 : 74), 6, P ? 54 : 74, { r: 3, fill: th.ink });
      this.text(label, x, y - (P ? 62 : 84), { size: P ? 9.5 : 11, weight: 700, mono: true, color: done >= 1 ? th.green : th.muted, align: 'center' });
    };
    const checksDone = win(a0 + dur * 0.5, a0 + dur * 0.62, t);

    /* typed: drafts wait behind the checks */
    check(gateX, y1, checksDone >= 1 ? 'checks finished' : 'checks', checksDone);
    const N = 7;
    for (let i = 0; i < N; i++) {
      const hold = gateX - 18 - (N - 1 - i) * (P ? 20 : 28);
      const start = -30 + i * -30;
      const arrive = E.out(win(a0 + i * 0.03, a0 + dur * 0.36 + i * 0.03, t));
      let x = lerp(start, hold, arrive);
      if (checksDone >= 1) {
        const go = E.inOut(win(a0 + dur * 0.62 + i * 0.012, a0 + dur * 0.9 + i * 0.012, t));
        x = lerp(hold, px - 34, go);
      }
      this.box(x - (P ? 8 : 11), y1 - (P ? 16 : 20), P ? 16 : 22, P ? 12 : 15, { r: 3, fill: th.card, stroke: th.yellowDeep, lw: 1.6 });
    }
    this.chip(gateX - (P ? 74 : 110), y1 + (P ? 18 : 24), 'nothing has left yet', { size: P ? 9 : 11, alpha: (1 - checksDone) * win(a0 + dur * 0.2, a0 + dur * 0.34, t) });
    this.chip(px - (P ? 80 : 104), y1 + (P ? 18 : 24), 'checked first', { size: P ? 9 : 11, fg: th.green, border: th.green, alpha: win(a0 + dur * 0.84, a0 + dur * 0.96, t) });
    /* prose: words stream straight past */
    const proseChecks = win(a0 + dur * 0.56, a0 + dur * 0.68, t);
    check(gateX, y2, proseChecks >= 1 ? 'checks finished' : 'checks', proseChecks);
    /* each token is a piece of the sentence, and it reaches the person before the checks finish */
    const WORDS = REAL.answer.split(' ');
    const dest = px - (P ? 30 : 42);
    let arrived = 0;
    WORDS.forEach((_, i) => {
      const start = a0 + i * dur * 0.045;
      const f = win(start, start + dur * 0.26, t);
      if (f >= 1) arrived = i + 1;
      if (f > 0 && f < 1) {
        const x = lerp(-10, dest, f);
        this.glow(x, y2 - 1, 11, th.amber, 0.45);
        this.dot(x, y2 + 1, P ? 3 : 3.8, th.ink);
      }
    });
    if (arrived > 0) {
      const textX = gateX + (P ? 10 : 16);
      this.para(WORDS.slice(0, arrived).join(' '), textX, y2 - (P ? 44 : 52), dest - textX - 4, {
        size: P ? 10 : 13,
        weight: 620,
        lh: P ? 12.5 : 17,
      });
    }
    /* the standing runs after them and catches up */
    const catchUp = E.inOut(win(a0 + dur * 0.68, a0 + dur * 0.96, t));
    if (catchUp > 0) {
      const x = lerp(gateX, px - (P ? 100 : 124), catchUp);
      this.chip(x, y2 + (P ? 18 : 24), 'standing: not sure', { size: P ? 9 : 11, fg: th.amber, border: th.amber });
    }
    this.chip(gateX - (P ? 70 : 104), y2 + (P ? 18 : 24), 'already streaming', { size: P ? 9 : 11, alpha: win(a0 + dur * 0.2, a0 + dur * 0.34, t) * (1 - catchUp), fg: th.red, border: th.red });
    this.alpha = 1;
  }

  /* ── explain this answer ──────────────────────────────────────────────── */
  private sceneExplain(t: number) {
    const scene = fade(T.xA + 0.02, T.limA, t, 0.14);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const a0 = T.xA + 0.08;
    const ROWS: { h: string; body: string; who: string; color: string }[] = [
      { h: 'You asked', body: `“${REAL.question}”`, who: 'person', color: th.muted },
      { h: 'It checked', body: `${REAL.accountChecked} ${REAL.accountCheckedItem}`, who: 'tool', color: th.yellowInk },
      { h: 'It did not check', body: `${REAL.accountNotChecked} ${REAL.accountNotCheckedItem}`, who: 'tool', color: th.yellowInk },
      { h: 'It found', body: REAL.accountFound, who: 'tool', color: th.yellowInk },
      { h: 'How sure', body: `${REAL.accountSure} ${REAL.accountReasonGap} ${REAL.accountReasonEmpty}`, who: 'library', color: th.amber },
    ];
    const x = P ? 4 : 30;
    const w = dw - x * 2;
    const y = P ? 4 : 22;
    const size = P ? 12 : 14.5;
    const lh = P ? 15.5 : 19;
    const top = P ? 26 : 31;
    const textW = w - (P ? 92 : 130);
    const heights = ROWS.map((r) => top + this.wrap(r.body, textW, this.font(size, 560)).length * lh + 11);
    const headH = 44;
    const h = headH + heights.reduce((sum, rowH) => sum + rowH, 0) + 6;
    const inP = E.out(win(T.xA, T.xA + 0.2, t));
    this.box(x, y + (1 - inP) * 20, w, h, { r: 16, fill: th.card, stroke: th.lineStrong, alpha: inP, shadow: true });
    this.text('Explain this answer', x + 18, y + 16, { size: P ? 13 : 15, weight: 750, base: 'top', alpha: inP });
    this.box(x + 1, y + headH - 1, w - 2, 1, { r: 0, fill: th.line, alpha: inP });
    let rowTop = y + headH;
    ROWS.forEach((r, i) => {
      const rowH = heights[i]!;
      const a = E.out(win(a0 + i * 0.15, a0 + 0.16 + i * 0.15, t));
      if (a > 0) {
        const ry = rowTop + (1 - a) * 8;
        this.text(r.h, x + 18, ry + 10, { size: P ? 10.5 : 11.5, weight: 750, color: th.muted, base: 'top', alpha: a });
        this.para(r.body, x + 18, ry + top, textW, { size, weight: 560, alpha: a, lh });
        this.chip(x + w - (P ? 38 : 50), ry + rowH / 2, r.who, { size: P ? 9 : 10.5, fg: r.color, alpha: a });
        if (i < ROWS.length - 1) this.box(x + 18, ry + rowH - 1, w - 36, 1, { r: 0, fill: th.line, alpha: a * 0.7 });
      }
      rowTop += rowH;
    });
    this.alpha = 1;
  }

  /* ── the limit: the record is not the world ───────────────────────────── */
  private sceneLimit(t: number, clock: number) {
    const scene = fade(T.limA + 0.02, T.chainA, t, 0.16);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw, dh } = this;
    const th = this.th;
    const L = this.labels;
    const a0 = T.limA + 0.1;
    const pan = E.inOut(win(a0 + 0.42, a0 + 0.95, t));
    const shift = pan * (P ? 58 : 64);
    const c = this.c;
    c.save();
    c.translate(0, -shift);
    const cx = dw / 2;
    const plateY = P ? 96 : 138;
    const plateW = P ? 330 : 520;
    const plateH = P ? 74 : 86;
    const groundY = P ? 266 : 340;
    const gapX = P ? 104 : 170;
    /* the world, below the record */
    const worldTop = groundY + 3;
    c.save();
    c.beginPath();
    c.rect(-400, worldTop, dw + 800, dh + 400);
    c.clip();
    c.translate(cx, worldTop);
    c.scale(1, 0.56);
    const R0 = dw * 0.56;
    const worldG = c.createRadialGradient(0, 0, 0, 0, 0, R0);
    worldG.addColorStop(0, th.lineStrong);
    worldG.addColorStop(1, clearOf(th.lineStrong));
    this.ga(0.62 * win(a0 + 0.3, a0 + 0.7, t));
    c.fillStyle = worldG;
    c.fillRect(-R0, 0, R0 * 2, R0);
    c.restore();
    const R = rng(404);
    const seen = win(a0 + 0.3, a0 + 0.8, t);
    for (let i = 0; i < 300; i++) {
      const ang = R() * Math.PI;
      const rad = Math.sqrt(R());
      const r = 0.7 + R() * 1.3;
      const wobble = Math.sin(clock * 0.5 + i * 1.7) * 2;
      const fx = cx + Math.cos(ang) * rad * dw * 0.52 + wobble;
      const fy = worldTop + 6 + Math.sin(ang) * rad * (dw * 0.3);
      this.dot(fx, fy, r, th.muted, seen * 0.5 * (1 - rad * rad));
    }
    this.text(L.world, 10, worldTop + (P ? 118 : 160), { size: P ? 15 : 20, weight: 750, color: th.muted, alpha: win(a0 + 0.62, a0 + 0.9, t) });
    /* the ground */
    this.box(cx - (P ? 172 : 340), groundY, P ? 344 : 680, 3, { r: 2, fill: th.ink });
    this.text(L.record, cx - (P ? 172 : 340), groundY - 9, { size: 10.5, weight: 700, mono: true, color: th.muted });
    /* it stands, on real values */
    this.pillar(cx - gapX, plateY + plateH / 2 + 7, groundY + 1, P ? 28 : 40, { ghost: 1 });
    this.pillar(cx + gapX, plateY + plateH / 2 + 7, groundY + 1, P ? 28 : 40, { ghost: 1 });
    this.plate(cx, plateY, plateW, plateH, { label: 'ANSWER', text: CASES.limit, size: P ? 13 : 16 });
    this.chip(cx, (plateY + plateH / 2 + groundY) / 2 - (P ? 8 : 14), 'consistent', { size: P ? 10.5 : 12.5, fg: th.muted, mono: false });
    this.para('This is not a verification.', cx - (P ? 80 : 92), (plateY + plateH / 2 + groundY) / 2 + (P ? 8 : 6), P ? 170 : 200, {
      size: P ? 10 : 11.5,
      weight: 600,
      mono: true,
      color: th.muted,
    });
    /* below the line, nobody knows */
    const q = win(a0 + 0.72, a0 + 1.05, t);
    if (q > 0) {
      const fall = this.pts([cx + gapX, groundY + 4], [cx + gapX + 12, groundY + 40], [cx + gapX - 18, groundY + 70], [cx + gapX + 4, groundY + 112], 14);
      this.stroke(fall, 0, q, { color: th.red, lw: 2, dash: [3, 5] });
      this.stroke(this.pts([cx - gapX, groundY + 4], [cx - gapX - 10, groundY + 30], [cx - gapX + 12, groundY + 56], [cx - gapX - 4, groundY + 92], 14), 0, q, { color: th.faint, lw: 2, dash: [3, 5] });
      this.text('did the bank ask for documents?', cx + gapX + (P ? -130 : -110), groundY + (P ? 134 : 130), { size: P ? 11.5 : 14, weight: 650, color: th.red, alpha: win(a0 + 0.92, a0 + 1.1, t) });
    }
    c.restore();
    this.alpha = 1;
  }

  /* ── the chain: each step hands to the next ───────────────────────────── */
  private chainGeom() {
    return this.P
      ? { x: 6, badge: 42, gap: 74, y: (i: number) => 6 + i * 74, textX: 60, textW: 292, verb: 15, why: 12.5, last: 20, lastY: 392 }
      : { x: 40, badge: 54, gap: 88, y: (i: number) => 6 + i * 88, textX: 112, textW: 610, verb: 22, why: 16.5, last: 34, lastY: 462 };
  }

  private sceneChain(t: number) {
    if (t < T.chainA - 0.02) return;
    const out = win(T.endA - 0.14, T.endA + 0.12, t);
    if (out >= 1) return;
    const G = this.chainGeom();
    const th = this.th;
    const rows = this.labels.chain;
    const step = (T.endA - T.chainA - 0.62) / rows.length;
    const at = (i: number) => T.chainA + 0.12 + i * step;
    this.alpha = 1 - out;
    /* the thread that joins them */
    for (let i = 0; i < rows.length - 1; i++) {
      const x = G.x + G.badge / 2;
      const y0 = G.y(i) + G.badge;
      const y1 = G.y(i + 1);
      const pts = this.pts([x, y0], [x + 12, y0 + (y1 - y0) * 0.3], [x - 12, y0 + (y1 - y0) * 0.7], [x, y1], 12);
      const p = win(at(i) + step * 0.45, at(i + 1), t);
      this.stroke(pts, 0, 1, { color: th.line, lw: 3 });
      this.stroke(pts, 0, p, { color: th.yellowDeep, lw: 3 });
      this.comet(pts, p, { lw: 3.4, tail: 0.5 });
    }
    rows.forEach((row, i) => {
      const p = win(at(i), at(i) + step * 0.55, t);
      const k = E.back(clamp(p));
      const y = G.y(i);
      const c = this.c;
      c.save();
      c.translate(G.x + G.badge / 2, y + G.badge / 2);
      c.scale(Math.max(0.001, k), Math.max(0.001, k));
      this.box(-G.badge / 2, -G.badge / 2, G.badge, G.badge, {
        r: 12,
        fill: p > 0 ? th.yellow : th.line,
        alpha: clamp(p * 3),
      });
      c.font = this.big(G.badge * 0.62);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      this.ga(clamp(p * 3));
      c.fillStyle = '#18181b';
      c.fillText(WORD[i]!, 0, 1.5);
      c.restore();
      const ta = E.out(win(at(i) + step * 0.12, at(i) + step * 0.6, t));
      const dx = (1 - ta) * 16;
      this.text(row.verb, G.textX + dx, y + (this.P ? 2 : 3), { size: G.verb, weight: 780, base: 'top', alpha: ta });
      this.para(row.why, G.textX + dx, y + (this.P ? 21 : 32), G.textW, {
        size: G.why,
        weight: 500,
        color: th.muted,
        alpha: ta,
        lh: G.why * 1.25,
      });
    });
    /* the sentence it was all for */
    const lastA = E.out(win(at(rows.length) - 0.04, at(rows.length) + 0.26, t));
    this.text(STAND_LINE, this.P ? G.x : G.textX, G.lastY + (1 - lastA) * 14, {
      size: G.last,
      weight: 820,
      base: 'top',
      alpha: lastA,
    });
    this.alpha = 1;
  }

  /* ── match cuts: the same objects carry from one letter to the next ────── */
  /** The record's note and the model's note become the two sides of the comparison. */
  private cutTraceToAssess(t: number) {
    const f = win(T.aA - 0.16, T.aA + 0.3, t);
    if (f <= 0 || f >= 1) return;
    const th = this.th;
    const G = this.pairGeom();
    const k = E.inOut(f);
    const rowY = G.y + (this.P ? 44 : 50) + (this.P ? 66 : 70);
    const fromAnswer = this.traceNote(3);
    const fromRecord = this.traceNote(1);
    const size = lerp(this.P ? 12.5 : 16, G.size, k);
    const fly = (x0: number, y0: number, x1: number, y1: number, str: string, color: string) => {
      const x = lerp(x0, x1, k);
      const y = lerp(y0, y1, k) - Math.sin(k * Math.PI) * 26;
      this.glow(x + 12, y + 8, 34, th.yellow, 0.6 * (1 - k));
      this.text(str, x, y, { size, weight: 700, mono: true, color, base: 'top' });
    };
    fly(fromAnswer.x + 14 + (this.P ? 62 : 80), fromAnswer.y + (this.P ? 31 : 39), G.lx + 14, rowY + 16, `"${CASES.contradicted.status}"`, th.amber);
    fly(fromRecord.x + 14 + (this.P ? 128 : 163), fromRecord.y + (this.P ? 31 : 39), G.rx + 14, rowY + 16, `"${CASES.known.status}"`, th.yellowInk);
  }

  /** The answer, wearing its standing, shrinks into the start of the tracks. */
  private cutNameToDecide(t: number) {
    const f = win(T.dA - 0.14, T.dA + 0.3, t);
    if (f <= 0 || f >= 1) return;
    const { P, dw } = this;
    const k = E.inOut(f);
    const x = lerp(dw / 2, (P ? 22 : 34) + 15, k);
    const y = lerp(P ? 88 : 96, P ? 196 : 262, k);
    const w = lerp(P ? 330 : 500, 58, k);
    const h = lerp(P ? 70 : 84, 40, k);
    this.plate(x, y, w, h, {
      label: k < 0.45 ? 'ANSWER' : undefined,
      text: k < 0.45 ? REAL.answer : undefined,
      size: P ? 13 : 17,
      angle: lerp(0.07, 0, k),
      tint: this.th.amber,
    });
  }

  /* ── the last shot: the five letters carry the answer ─────────────────── */
  private sceneFinale(t: number, clock: number) {
    const scene = win(T.endA - 0.05, T.endA + 0.1, t);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P } = this;
    const c = this.c;
    const th = this.th;
    const w = this.word;
    const B = this.chainGeom();
    const pull = E.inOut(win(T.uniA, T.uniA + 0.8, t));
    c.save();
    if (pull > 0) {
      const U = this.uniGeom();
      const groundY = w.base + 3.5;
      c.translate(this.dw / 2, lerp(groundY, U.apexY, pull));
      c.scale(lerp(1, U.wordK, pull), lerp(1, U.wordK, pull));
      c.translate(-this.dw / 2, -groundY);
    }
    WORD.forEach((ch, i) => {
      const a0 = T.endA - 0.12 + i * 0.05;
      const p = E.inOut(win(a0, a0 + 0.42, t));
      const size = lerp(B.badge * 0.62, w.size, p);
      const fromX = B.x + B.badge / 2 - (B.badge * 0.62 * 0.36);
      const x = lerp(fromX, w.xs[i]!, p);
      const y = lerp(B.y(i) + B.badge * 0.72, w.base, p);
      c.font = this.big(size);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      this.ga(1);
      c.fillStyle = th.ink;
      c.fillText(ch, x, y);
      this.text(VERBS[i]!, w.xs[i]! + w.widths[i]! / 2, w.base + (P ? 22 : 30), {
        size: P ? 11.5 : 15,
        weight: 700,
        color: th.yellowInk,
        align: 'center',
        alpha: win(a0 + 0.42, a0 + 0.62, t) * (1 - win(0, 0.4, pull)),
      });
    });
    /* the ground line */
    this.box(w.left - 6, w.base + 2, (w.right - w.left + 12) * E.out(win(T.endA + 0.1, T.endA + 0.5, t)), 3, { r: 2, fill: th.ink });
    /* the answer settles on top */
    const land = T.endA + 0.42;
    const p = win(land, land + 0.42, t);
    if (p > 0) {
      const pw = Math.min(w.right - w.left + 8, P ? 340 : 700);
      const ph = P ? 58 : 76;
      const y = lerp(-80, w.top - ph / 2 - 11, E.bounce(p));
      this.plate(this.dw / 2, y, pw, ph, { label: 'YOUR ANSWER', text: STAND_LINE, size: P ? 14.5 : 24 });
      const hit = win(land + 0.15, land + 0.45, t);
      WORD.forEach((_, i) => this.sparks(w.xs[i]! + w.widths[i]! / 2, w.top - 2, hit, th.yellow, 200 + i, 40, 7));
      const glow = 0.1 + 0.05 * Math.sin(clock * 1.3);
      this.glow(this.dw / 2, y, pw * 0.6, th.yellow, glow * win(land + 0.3, land + 0.6, t));
    }
    c.restore();
    this.alpha = 1;
  }

  /* ── the last shot: the whole agent on one record, with STAND on top ───── */
  private uniGeom() {
    const cx = this.dw / 2;
    return this.P
      ? {
          cx,
          apexY: 170,
          baseY: 328,
          hw: 66,
          wordK: 0.56,
          src: { x: 0, w: 72, y0: 122, step: 38, h: 31 },
          slots: { x: 286, w: 74, y0: 162, step: 58, h: 48 },
          orb: [323, 92] as const,
          threadY: 356,
          notes: { y: 368, h: 32 },
        }
      : {
          cx,
          apexY: 238,
          baseY: 432,
          hw: 104,
          wordK: 0.42,
          src: { x: 4, w: 146, y0: 108, step: 58, h: 48 },
          slots: { x: 600, w: 154, y0: 196, step: 76, h: 60 },
          orb: [677, 98] as const,
          threadY: 462,
          notes: { y: 476, h: 42 },
        };
  }

  private sceneUniverse(t: number, clock: number) {
    const a0 = T.uniA;
    const on = E.out(win(a0 + 0.15, a0 + 0.8, t));
    if (on <= 0) return;
    const c = this.c;
    const th = this.th;
    const { P, dw, labels } = this;
    const U = this.uniGeom();
    const { cx, apexY, baseY, hw } = U;
    const midY = (apexY + baseY) / 2 + 14;
    this.alpha = on;

    /* the rings, and what drifts on them */
    const rings = P ? [[108, 80], [150, 112], [190, 150]] : [[200, 130], [282, 178], [360, 228]];
    rings.forEach(([rx, ry], i) => {
      this.ga(0.55 * on);
      c.beginPath();
      c.ellipse(cx, midY, rx! * lerp(0.7, 1, on), ry! * lerp(0.7, 1, on), 0, 0, TAU);
      c.setLineDash(i === 1 ? [3, 7] : []);
      c.strokeStyle = th.line;
      c.lineWidth = 1;
      c.stroke();
      c.setLineDash([]);
      for (let k = 0; k < 3; k++) {
        const ang = clock * (0.14 - i * 0.03) + (k / 3) * TAU + i;
        this.dot(cx + Math.cos(ang) * rx!, midY + Math.sin(ang) * ry!, 1.7, k === 0 ? th.yellowDeep : th.faint, on * 0.9);
      }
    });
    this.glow(cx, midY, hw * 2.1, th.yellow, 0.22 * on);

    /* the triangle rises, and stands on the thread */
    const rise = (1 - on) * (P ? 150 : 240);
    const handL: [number, number] = [cx - hw - 6, baseY - 26 + rise];
    const handR: [number, number] = [cx + hw + 8, baseY - 26 + rise];
    const stackX = handR[0] + (P ? 10 : 24);
    const layerH = P ? 11 : 15;
    const layerW = P ? 18 : 30;
    const layerY = (i: number) => handR[1] - (P ? 12 : 16) - i * (P ? 11 : 15);

    /* what goes in */
    const paths = UNIVERSE.sources.map((src, i) => {
      const y = U.src.y0 + i * U.src.step + U.src.h / 2;
      const x0 = U.src.x + U.src.w;
      return this.pts([x0, y], [x0 + (P ? 14 : 70), y], [handL[0] - (P ? 14 : 70), handL[1] + (y - handL[1]) * 0.2], handL, 22);
    });
    paths.forEach((path, i) => {
      const color = UNIVERSE.sources[i]!.color;
      const rev = E.inOut(win(a0 + 0.35 + i * 0.07, a0 + 0.95 + i * 0.07, t));
      this.stroke(path, 0, rev, { color, lw: P ? 1 : 1.5, alpha: 0.6 * on });
      if (rev >= 1) {
        for (let k = 0; k < 7; k++) {
          const f = (k / 7 + clock * (0.17 + i * 0.012) + i * 0.09) % 1;
          const pos = this.at(path, f);
          this.dot(pos[0], pos[1], (P ? 1.1 : 1.5) + (k % 3) * 0.45, color, Math.sin(f * Math.PI) * on);
        }
      }
    });

    /* where it lands: the three things the model is sent */
    const framePad = P ? 5 : 10;
    const frameTop = U.slots.y0 - framePad - (P ? 0 : 16);
    const frameH = U.slots.step * 2 + U.slots.h + framePad * 2 + (P ? 0 : 16);
    const frameIn = E.out(win(a0 + 0.7, a0 + 1.1, t));
    const slide = (1 - frameIn) * 40;
    this.box(U.slots.x - framePad + slide, frameTop, U.slots.w + framePad * 2, frameH, {
      r: 14,
      stroke: th.lineStrong,
      dash: [5, 5],
      alpha: frameIn,
    });
    if (!P) {
      this.text('what the model is sent', U.slots.x + U.slots.w / 2 + slide, frameTop + 15, {
        size: 10,
        weight: 650,
        mono: true,
        color: th.muted,
        align: 'center',
        alpha: frameIn,
      });
    }
    UNIVERSE.slots.forEach((slot, i) => {
      const y = U.slots.y0 + i * U.slots.step;
      const midSlot = y + U.slots.h / 2;
      const path = this.pts([stackX + layerW, layerY(i)], [stackX + layerW + (P ? 6 : 26), layerY(i)], [U.slots.x - (P ? 8 : 30), midSlot], [U.slots.x, midSlot], 18);
      const rev = E.inOut(win(a0 + 0.95 + i * 0.08, a0 + 1.35 + i * 0.08, t));
      this.stroke(path, 0, rev, { color: slot.color, lw: P ? 1.2 : 1.8, alpha: 0.8 * on });
      if (rev >= 1) {
        for (let k = 0; k < 4; k++) {
          const f = (k / 4 + clock * 0.24 + i * 0.13) % 1;
          const pos = this.at(path, f);
          this.dot(pos[0], pos[1], P ? 1.3 : 1.9, slot.color, Math.sin(f * Math.PI) * on);
        }
      }
      this.box(U.slots.x + slide, y, U.slots.w, U.slots.h, { r: 10, fill: th.card, stroke: slot.color, lw: 1.5, alpha: frameIn, shadow: true });
      this.text(slot.name, U.slots.x + slide + (P ? 8 : 14), y + (P ? U.slots.h / 2 : 21), {
        size: P ? 10.5 : 14,
        weight: 750,
        mono: true,
        base: 'middle',
        alpha: frameIn,
      });
      if (!P) {
        this.text(slot.sub, U.slots.x + slide + 14, y + 41, { size: 10, weight: 500, color: th.muted, base: 'middle', alpha: frameIn });
      }
    });

    /* the model, and the answer it sends back */
    const [ox, oy] = U.orb;
    const orbIn = E.back(win(a0 + 1.2, a0 + 1.5, t));
    if (orbIn > 0) {
      const up = this.pts([ox, frameTop], [ox, frameTop - 12], [ox, oy + 34], [ox, oy + 20], 8);
      this.stroke(up, 0, 1, { color: th.yellowDeep, lw: 2, alpha: orbIn * on });
      this.comet(up, (clock * 0.7) % 1, { lw: 2.4 });
      this.orb(ox, oy, (P ? 15 : 20) * clamp(orbIn, 0, 1.2), on, 'LLM');
    }
    const w = this.word;
    const plateH = P ? 58 : 76;
    const slabY = apexY - U.wordK * (w.base + 3.5 - (w.top - plateH / 2 - 11));
    const slabEnd = cx + (Math.min(w.right - w.left + 8, P ? 340 : 700) * U.wordK) / 2;
    const reply = this.pts([ox - (P ? 14 : 19), oy - 3], [ox - (P ? 26 : 70), oy - (P ? 28 : 56)], [slabEnd + (P ? 14 : 60), slabY - (P ? 30 : 60)], [slabEnd + 1, slabY - 4], 26);
    const replyIn = win(a0 + 1.45, a0 + 1.85, t);
    if (replyIn > 0) {
      this.stroke(reply, 0, replyIn, { color: th.yellowDeep, lw: 2, dash: [5, 5], alpha: on });
      if (replyIn >= 1) {
        const f = (clock * 0.34) % 1;
        this.comet(reply, f, { lw: 3.2 });
        if (f > 0.9) this.glow(slabEnd, slabY, 34, th.yellow, (f - 0.9) * 8);
      }
    }

    /* the notes, connected: the run writes them, and a walk back reads them */
    const n = UNIVERSE.notes.length;
    const margin = P ? 2 : 4;
    const gap = P ? 3 : 6;
    const noteW = (dw - margin * 2 - gap * (n - 1)) / n;
    const noteX = (i: number) => margin + i * (noteW + gap);
    const threadIn = E.inOut(win(a0 + 0.55, a0 + 1.5, t));
    const x0 = noteX(0) + noteW / 2;
    const x1 = noteX(n - 1) + noteW / 2;
    this.box(x0, U.threadY, x1 - x0, 2, { r: 1, fill: th.line, alpha: on });
    this.box(x0, U.threadY, (x1 - x0) * threadIn, 2, { r: 1, fill: th.yellowDeep, alpha: on });
    /* forward as the run writes, then backward along the same edges */
    const cycle = (clock % 9) / 9;
    const forward = cycle < 0.5;
    const headF = forward ? cycle * 2 : 2 - cycle * 2;
    const head = x0 + (x1 - x0) * E.inOut(headF);
    UNIVERSE.notes.forEach((note, i) => {
      const x = noteX(i);
      const y = U.notes.y + (1 - E.out(win(a0 + 0.6 + i * 0.09, a0 + 0.95 + i * 0.09, t))) * 26;
      const a = win(a0 + 0.6 + i * 0.09, a0 + 0.85 + i * 0.09, t);
      if (a <= 0) return;
      const mid = x + noteW / 2;
      const lit = threadIn >= 1 ? clamp(1 - Math.abs(head - mid) / (noteW * 0.7)) : 0;
      this.box(mid - 1, U.threadY, 2, y - U.threadY, { fill: lit > 0 ? th.yellowDeep : th.lineStrong, alpha: a * on });
      this.box(x, y, noteW, U.notes.h, { r: P ? 5 : 8, fill: th.card, stroke: lit > 0.1 ? th.yellowDeep : th.lineStrong, lw: lit > 0.1 ? 1.6 : 1, alpha: a * on });
      if (lit > 0) this.box(x + 1, y + 1, noteW - 2, U.notes.h - 2, { r: P ? 5 : 8, fill: th.yellow, alpha: 0.4 * lit * a * on });
      this.text(P ? note.short : note.long, mid, y + U.notes.h / 2 + 0.5, {
        size: P ? 7.8 : 9.8,
        weight: 650,
        mono: true,
        align: 'center',
        base: 'middle',
        alpha: a * on,
      });
    });
    if (threadIn >= 1) {
      this.glow(head, U.threadY + 1, 16, th.yellow, 0.9 * on);
      this.dot(head, U.threadY + 1, P ? 3 : 4, th.yellowDeep, on);
      this.chip(clamp(head, P ? 40 : 60, dw - (P ? 40 : 60)), U.threadY - (P ? 9 : 11), forward ? 'writes a note' : 'walks back', {
        size: P ? 7.6 : 9.5,
        fg: th.yellowInk,
        border: th.yellow,
        alpha: on,
      });
    }
    this.text('the record, kept by FootprintJS', dw / 2, U.notes.y + U.notes.h + (P ? 13 : 16), {
      size: P ? 9 : 10.5,
      weight: 650,
      mono: true,
      color: th.muted,
      align: 'center',
      alpha: win(a0 + 1.3, a0 + 1.6, t) * on,
    });
    /* every step drips a note onto the thread */
    if (threadIn >= 1) {
      [handL[0], stackX, ox].forEach((x, i) => {
        const fromY = i === 2 ? frameTop + frameH : handL[1] + 8;
        this.ga(0.5 * on);
        c.setLineDash([2, 5]);
        c.strokeStyle = th.lineStrong;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, fromY);
        c.lineTo(x, U.threadY);
        c.stroke();
        c.setLineDash([]);
        const f = (clock * 0.4 + i * 0.37) % 1;
        this.dot(x, lerp(fromY, U.threadY, f), P ? 1.6 : 2.2, th.yellowDeep, Math.sin(f * Math.PI) * on);
      });
    }

    /* the sources, on top of their streams */
    UNIVERSE.sources.forEach((src, i) => {
      const y = U.src.y0 + i * U.src.step;
      const a = E.out(win(a0 + 0.3 + i * 0.07, a0 + 0.65 + i * 0.07, t));
      if (a <= 0) return;
      const x = U.src.x - (1 - a) * 40;
      this.box(x, y, U.src.w, U.src.h, { r: P ? 7 : 10, fill: th.card, stroke: src.color, lw: 1.3, alpha: a * on, shadow: !P });
      this.dot(x + (P ? 7 : 14), y + U.src.h / 2, P ? 2.6 : 4, src.color, a * on);
      const showApi = labels.apis && !P;
      this.text(src.name, x + (P ? 13 : 25), y + U.src.h / 2 + (showApi ? -8 : 0), { size: P ? 9.4 : 13.5, weight: 720, base: 'middle', alpha: a * on });
      if (showApi) {
        this.text(src.api, x + 25, y + U.src.h / 2 + 9, { size: 9, weight: 600, mono: true, color: th.muted, base: 'middle', alpha: a * on });
      }
    });

    /* and the triangle itself, in front of everything it composes */
    c.save();
    c.translate(0, rise);
    this.triangle(cx, apexY, baseY, hw, clock);
    this.text('AgentFootprint', cx, baseY - hw * 0.14, { size: P ? 10.5 : 14, weight: 800, color: '#3f2d00', align: 'center', base: 'middle' });
    c.restore();
    /* hands, and the stack it holds out */
    this.ga(1);
    c.strokeStyle = '#d99a00';
    c.lineCap = 'round';
    c.lineWidth = P ? 3 : 5;
    c.beginPath();
    c.moveTo(cx - hw * 0.62, baseY - hw * 0.22 + rise);
    c.lineTo(handL[0], handL[1]);
    c.moveTo(cx + hw * 0.62, baseY - hw * 0.22 + rise);
    c.lineTo(handR[0], handR[1]);
    c.stroke();
    [handL, handR].forEach(([hx, hy]) => {
      c.beginPath();
      c.arc(hx, hy, P ? 5 : 8, 0, TAU);
      c.fillStyle = '#ffffff';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = th.lineStrong;
      c.stroke();
    });
    this.dot(handL[0], handL[1], (P ? 7 : 10) + Math.sin(clock * 3) * 1.5, th.yellow, 0.35 * on);
    this.ga(1);
    UNIVERSE.slots.slice().reverse().forEach((slot, ri) => {
      const i = UNIVERSE.slots.length - 1 - ri;
      const y = layerY(i) + Math.sin(clock * 1.6 + i) * 0.8;
      c.beginPath();
      c.moveTo(stackX - layerW, y);
      c.lineTo(stackX, y - layerH / 2);
      c.lineTo(stackX + layerW, y);
      c.lineTo(stackX, y + layerH / 2);
      c.closePath();
      c.fillStyle = slot.color;
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(0,0,0,0.18)';
      c.stroke();
    });
    this.alpha = 1;
  }
}
