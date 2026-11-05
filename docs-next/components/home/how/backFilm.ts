/**
 * The How it works scenes: one wrong answer, walked back to its cause.
 *
 * Same rule as the home film: a frame is a pure function of a cursor. Home runs forward,
 * from the rules to the answer. This one runs the other way, from the answer to the source
 * that flipped it, and ends with the test that shows it. Each instance draws one scene, and
 * howTimeline.ts says which stretch of it each chapter plays.
 */
import { E, Stage, TAU, clamp, fade, lerp, win } from '../stand/stage';
import { H, type HowScene } from './howTimeline';
import type { HowLabels } from './howCopy';

const NOTES = [
  { k: 'classify', v: 'refund', back: false },
  { k: 'check', v: 'continue', back: false },
  { k: 'read memory', v: 'customer history', back: true },
  { k: 'read docs', v: 'policy/refunds-v1', back: true },
  { k: 'steering', v: 'tone rule', back: true },
  { k: 'CallLLM', v: 'send request', back: true },
  { k: 'decide', v: 'approved ✗', back: true },
] as const;

/** Each flavor, and the slots it really lands in. */
const FLAVORS = [
  { n: 'Steering', c: '#a855f7', to: [0] },
  { n: 'Skill', c: '#f97316', to: [0, 2] },
  { n: 'Fact', c: '#eab308', to: [0, 1] },
  { n: 'Memory', c: '#3b82f6', to: [1, 0] },
  { n: 'RAG', c: '#22c55e', to: [0, 1] },
  { n: 'Tool', c: '#06b6d4', to: [2] },
] as const;

const TRIGGERS = ['always', 'rule', 'on-tool-return', 'llm-activated'] as const;

const MODELS = [
  { who: 'gpt', says: 'the customer history', pct: '98%' },
  { who: 'claude', says: 'the policy doc', pct: '95%' },
  { who: 'llama', says: 'the tone rule', pct: '91%' },
] as const;

/* From the tool-choice walkthrough: embedding ties two tools, and a rewrite breaks the tie. */
const TOOLS = [
  { n: 'search_flights', a: 0, b: 0 },
  { n: 'search_hotels', a: 0.5, b: 0.9 },
  { n: 'book_hold', a: 1, b: 1 },
  { n: 'load_skill', a: 0.5, b: 0.2 },
] as const;

export class BackFilm extends Stage<HowLabels> {
  constructor(
    canvas: HTMLCanvasElement,
    labels: HowLabels,
    private scene: HowScene,
  ) {
    super(canvas, labels);
  }

  draw(t: number, clock: number) {
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.translate(this.ox, this.oy);
    c.scale(this.s, this.s);
    this.alpha = 1;
    if (this.scene === 'wrong') this.sceneWrong(t, clock);
    if (this.scene === 'ask') this.sceneAsk(t);
    if (this.scene === 'record') this.sceneRecord(t);
    if (this.scene === 'address') this.sceneAddress(t, clock);
    if (this.scene === 'rerun') this.sceneRerun(t);
    if (this.scene === 'forward') this.sceneForward(t);
    if (this.scene === 'loop') this.sceneLoop(t, clock);
    if (this.scene === 'end') this.sceneEnd(t, clock);
    c.globalAlpha = 1;
  }

  /* ── the answer, cracked, over a pile nobody can read ─────────────────── */
  private sceneWrong(t: number, clock: number) {
    const scene = 1 - win(H.askA + 0.3, H.askA + 0.55, t);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const cx = dw / 2;
    const y = P ? 70 : 96;
    const bob = Math.sin(clock * 1.2) * 4;
    const leave = E.inOut(win(H.askA, H.askA + 0.5, t));
    this.plate(cx, lerp(y + bob, P ? 36 : 44, leave), lerp(P ? 300 : 430, P ? 220 : 280, leave), lerp(P ? 72 : 88, P ? 50 : 56, leave), {
      label: 'ANSWER',
      text: 'Your refund is approved.',
      size: lerp(P ? 16 : 22, P ? 12 : 14, leave),
      angle: 0.035 * (1 - leave),
      tint: th.red,
    });
    const pileIn = 1 - win(H.askA, H.askA + 0.3, t);
    if (pileIn <= 0) return;
    this.chip(cx, y + (P ? 58 : 72), '✗ should have been denied', { size: P ? 10.5 : 12.5, fg: th.red, border: th.red, alpha: win(H.wrongA + 0.2, H.wrongA + 0.4, t) * pileIn });
    const PILE = ['policy/refunds-v1', 'customer history', 'tone rule', 'memory', 'steering rule', 'tool result'];
    PILE.forEach((name, i) => {
      const a = E.out(win(H.wrongA + 0.25 + i * 0.09, H.wrongA + 0.55 + i * 0.09, t)) * pileIn;
      if (a <= 0) return;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = (P ? 62 : 150) + col * (P ? 118 : 230);
      const yy = (P ? 196 : 262) + row * (P ? 74 : 108);
      const c = this.c;
      c.save();
      c.translate(x, yy + (1 - a) * 30 + Math.sin(clock * 0.9 + i) * 3);
      c.rotate(((i % 2 ? 1 : -1) * (2 + i)) / 90);
      this.box(P ? -54 : -92, P ? -24 : -32, P ? 108 : 184, P ? 48 : 64, { r: 10, fill: th.card, stroke: th.lineStrong, alpha: a, shadow: true });
      this.text(name, 0, 0, { size: P ? 9.5 : 13, weight: 620, mono: true, align: 'center', base: 'middle', alpha: a });
      c.restore();
      const q = win(H.wrongA + 0.8, H.wrongA + 1.1, t) * pileIn;
      this.text('?', x + (P ? 44 : 78), yy - (P ? 26 : 34), { size: P ? 15 : 20, weight: 800, color: th.amber, align: 'center', alpha: q });
    });
    this.alpha = 1;
  }

  /* ── three models, three confident stories ────────────────────────────── */
  private sceneAsk(t: number) {
    const scene = fade(H.askA + 0.05, H.recordA, t, 0.2);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const a0 = H.askA + 0.15;
    const rowH = P ? 92 : 118;
    const y0 = P ? 100 : 136;
    MODELS.forEach((m, i) => {
      const a = E.out(win(a0 + i * 0.22, a0 + 0.3 + i * 0.22, t));
      if (a <= 0) return;
      const y = y0 + i * rowH;
      const ox = P ? 34 : 110;
      this.orb(ox, y, P ? 15 : 20, a);
      this.text(m.who, ox, y + (P ? 28 : 36), { size: P ? 9.5 : 11, weight: 650, mono: true, color: th.muted, align: 'center', alpha: a });
      const bx = ox + (P ? 26 : 40);
      const bw = dw - bx - (P ? 4 : 60);
      const bh = P ? 54 : 64;
      this.box(bx + (1 - a) * 20, y - bh / 2, bw, bh, { r: 14, fill: th.card, stroke: th.lineStrong, alpha: a, shadow: true });
      this.text(`“It was ${m.says}.”`, bx + 16 + (1 - a) * 20, y, { size: P ? 12 : 16, weight: 620, base: 'middle', alpha: a });
      this.chip(bx + bw - (P ? 26 : 38), y, m.pct, { size: P ? 10.5 : 12.5, fg: th.yellowInk, border: th.yellow, alpha: a });
    });
    const nope = E.out(win(a0 + 0.8, a0 + 1.05, t));
    if (nope > 0) this.chip(dw / 2, y0 + 3 * rowH - (P ? 26 : 34), 'none falsifiable', { size: P ? 12 : 15, fg: '#fff', bg: th.red, border: th.red, alpha: nope, scale: lerp(1.25, 1, nope) });
    this.alpha = 1;
  }

  /* ── the notes, then the walk back along their edges ──────────────────── */
  private noteGeom(i: number) {
    return this.P
      ? { x: 26, y: 8 + i * 54, w: 300, h: 46 }
      : { x: 130, y: 26 + i * 72, w: 470, h: 60 };
  }

  private sceneRecord(t: number) {
    const scene = fade(H.recordA + 0.02, H.addressA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P } = this;
    const th = this.th;
    const a0 = H.recordA + 0.12;
    const step = 0.2;
    const mid = (i: number) => {
      const n = this.noteGeom(i);
      return n.y + n.h / 2;
    };
    const walk = (x: number) => win(H.walkA + 0.15, H.walkA + 1.5, x);
    const w = walk(t);
    const n0 = this.noteGeom(0);
    const leftX = n0.x;
    const rightX = n0.x + n0.w;
    const left = (i: number) => this.pts([leftX, mid(i)], [leftX - (P ? 16 : 34), mid(i) + 14], [leftX - (P ? 16 : 34), mid(i + 1) - 14], [leftX, mid(i + 1)], 12);
    const fan = (j: number) => this.pts([rightX, mid(5)], [rightX + (P ? 24 : 70), mid(5)], [rightX + (P ? 24 : 70), mid(j)], [rightX, mid(j)], 16);
    /* the run's order, stitched down the left */
    for (let i = 0; i < NOTES.length - 1; i++) {
      const p = E.out(win(a0 + (i + 1) * step, a0 + (i + 1) * step + 0.14, t));
      this.stroke(left(i), 0, p, { color: th.lineStrong, lw: 1.6, alpha: 1 - 0.45 * clamp(w * 3) });
    }
    /* the walk: answer to model, then out to what the model read */
    const legA = clamp(w * 3);
    const legB = clamp((w - 0.33) * 1.5);
    if (w > 0) {
      const last = this.pts([leftX, mid(6)], [leftX - (P ? 16 : 34), mid(6) - 14], [leftX - (P ? 16 : 34), mid(5) + 14], [leftX, mid(5)], 12);
      this.stroke(last, 0, legA, { color: th.yellowDeep, lw: 3 });
      this.comet(last, legA, { lw: 3.4 });
      [2, 3, 4].forEach((j) => {
        this.stroke(fan(j), 0, legB, { color: th.yellowDeep, lw: 2.4 });
        this.comet(fan(j), legB, { lw: 2.8 });
      });
    }
    NOTES.forEach((note, i) => {
      const a = E.out(win(a0 + i * step, a0 + 0.16 + i * step, t));
      if (a <= 0) return;
      const n = this.noteGeom(i);
      const reached = i === 6 ? w > 0 : i === 5 ? legA >= 1 : legB >= 1;
      const dim = note.back ? 1 : lerp(1, 0.28, win(0.7, 1, w));
      const hot = note.back && reached;
      this.box(n.x + (1 - a) * 24, n.y, n.w, n.h, {
        r: 11,
        fill: th.card,
        stroke: i === 6 && w > 0 ? th.red : hot ? th.yellowDeep : th.lineStrong,
        lw: hot || (i === 6 && w > 0) ? 2 : 1,
        alpha: a * dim,
        shadow: true,
      });
      this.text(note.k, n.x + 14 + (1 - a) * 24, n.y + (P ? 11 : 15), { size: P ? 9 : 10.5, weight: 700, mono: true, color: th.muted, base: 'top', alpha: a * dim });
      this.text(note.v, n.x + (P ? 110 : 150) + (1 - a) * 24, n.y + n.h / 2, {
        size: P ? 11 : 15,
        weight: 650,
        mono: true,
        base: 'middle',
        color: i === 6 ? th.red : th.ink,
        alpha: a * dim,
      });
    });
    const rewind = win(H.walkA + 0.1, H.walkA + 0.3, t);
    if (rewind > 0) {
      const stepNow = Math.round(lerp(14, 6, w));
      this.chip(P ? 290 : 600, this.noteGeom(0).y + (P ? -2 : 4), `↩ rewinding · step ${stepNow}`, { size: P ? 9 : 11, fg: th.yellowInk, border: th.yellow, alpha: rewind * (1 - win(H.addressA - 0.3, H.addressA, t)) });
    }
    this.alpha = 1;
  }

  /* ── three slots, with an address for every piece ─────────────────────── */
  private binGeom(i: number) {
    return this.P
      ? { x: 4 + i * 120, y: 208, w: 112, h: 230 }
      : { x: 22 + i * 246, y: 232, w: 224, h: 286 };
  }

  private sceneAddress(t: number, clock: number) {
    const scene = fade(H.addressA + 0.02, H.rerunA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw, labels } = this;
    const th = this.th;
    const a0 = H.addressA + 0.15;
    const each = 0.26;
    const suspect = win(H.suspectA + 0.05, H.suspectA + 0.3, t);
    const dimOthers = lerp(1, 0.28, suspect);

    /* the four triggers: when each one fires */
    const trigY = P ? 170 : 190;
    const trigW = dw / 4;
    TRIGGERS.forEach((name, i) => {
      const a = win(a0 - 0.1 + i * 0.05, a0 + 0.1 + i * 0.05, t);
      const beat = (clock * 0.7) % 4;
      const lit = suspect < 0.5 && Math.floor(beat) === i;
      this.chip(trigW * (i + 0.5), trigY, name, {
        size: P ? 8.2 : 11,
        fg: lit ? '#18181b' : th.muted,
        bg: lit ? th.yellow : undefined,
        border: lit ? th.yellow : undefined,
        alpha: a * dimOthers,
      });
    });

    /* the slots */
    labels.slots.forEach((slot, i) => {
      const b = this.binGeom(i);
      const a = E.out(win(a0 + i * 0.06, a0 + 0.25 + i * 0.06, t));
      this.box(b.x, b.y + (1 - a) * 24, b.w, b.h, { r: 14, fill: th.cardAlt, stroke: th.lineStrong, alpha: a * (i === 0 ? 1 : dimOthers) });
      this.text(slot, b.x + b.w / 2, b.y + (P ? 20 : 26) + (1 - a) * 24, { size: P ? 12 : 16, weight: 760, mono: true, align: 'center', base: 'middle', alpha: a * (i === 0 ? 1 : dimOthers) });
    });

    /* the flavors, each flying to where it really lands */
    const used = [0, 0, 0];
    const chipH = P ? 22 : 30;
    const rowGap = P ? 26 : 36;
    FLAVORS.forEach((f, i) => {
      const at0 = a0 + 0.2 + i * each;
      const homeX = (dw / FLAVORS.length) * (i + 0.5);
      const homeY = P ? 30 : 56;
      const inA = E.out(win(at0 - 0.2, at0, t));
      f.to.forEach((slot, k) => {
        const b = this.binGeom(slot);
        const row = used[slot]!++;
        const tx = b.x + b.w / 2;
        const ty = b.y + (P ? 48 : 62) + row * rowGap;
        const p = E.inOut(win(at0 + k * 0.05, at0 + 0.34 + k * 0.05, t));
        const path = this.pts([homeX, homeY], [homeX, homeY + (P ? 60 : 80)], [tx, ty - (P ? 60 : 90)], [tx, ty], 18);
        if (p > 0 && p < 1) this.stroke(path, 0, p, { color: f.c, lw: 1.6, alpha: 0.7 });
        const pos = this.at(path, p);
        const weak = k > 0 && f.to.length > 1 && f.n !== 'Skill';
        const w = P ? 76 : 118;
        const a = inA * (weak ? 0.75 : 1) * dimOthers;
        if (inA <= 0) return;
        this.box(pos[0] - w / 2, pos[1] - chipH / 2, w, chipH, { r: chipH / 2, fill: th.card, stroke: f.c, lw: weak ? 1 : 1.6, dash: weak ? [3, 3] : undefined, alpha: a, shadow: !P });
        this.text(f.n, pos[0], pos[1], { size: P ? 9.5 : 12.5, weight: 680, align: 'center', base: 'middle', alpha: a });
      });
    });

    /* the suspect: one retrieved policy, and the thread that reached it */
    if (suspect > 0) {
      const b = this.binGeom(0);
      const y = b.y + b.h - (P ? 40 : 54);
      const w = b.w - (P ? 8 : 20);
      const x = b.x + (b.w - w) / 2;
      this.box(x, y, w, P ? 32 : 42, { r: 9, fill: th.yellow, stroke: th.yellowDeep, lw: 2, alpha: suspect, shadow: true });
      this.text('policy/refunds-v1', x + w / 2, y + (P ? 16 : 21), { size: P ? 8.6 : 12, weight: 760, mono: true, color: '#18181b', align: 'center', base: 'middle', alpha: suspect });
      const from: [number, number] = [dw - (P ? 58 : 110), P ? 56 : 84];
      this.chip(from[0], from[1], 'decide → approved ✗', { size: P ? 9.5 : 12, fg: th.red, border: th.red, alpha: suspect });
      const thread = this.pts([from[0], from[1] + (P ? 10 : 12)], [from[0], y - 30], [x + w + 60, y + 16], [x + w, y + (P ? 16 : 21)], 26);
      const f = E.inOut(win(H.suspectA + 0.15, H.suspectA + 0.6, t));
      this.stroke(thread, 0, f, { color: th.yellowDeep, lw: 2.4 });
      this.comet(thread, f, { lw: 3 });
      const tag = win(H.suspectA + 0.55, H.suspectA + 0.75, t);
      this.chip(dw / 2 + (P ? 40 : 110), y - (P ? 22 : 30), 'a suspect, not proof', { size: P ? 10 : 12.5, fg: th.amber, border: th.amber, alpha: tag });
    }
    this.alpha = 1;
  }

  /* ── the test: same case, one source gone ─────────────────────────────── */
  private sceneRerun(t: number) {
    const scene = fade(H.rerunA + 0.02, H.forwardA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const a0 = H.rerunA + 0.12;
    const lane = (y: number, title: string, removed: number, resultP: number, flipped: boolean, a: number) => {
      const h = P ? 150 : 176;
      this.box(P ? 2 : 14, y, dw - (P ? 4 : 28), h, { r: 16, fill: th.card, stroke: flipped && resultP >= 1 ? th.green : th.lineStrong, lw: flipped && resultP >= 1 ? 2 : 1, alpha: a, shadow: true });
      this.text(title, (P ? 14 : 32), y + (P ? 14 : 18), { size: P ? 9.5 : 11, weight: 700, mono: true, color: th.muted, base: 'top', alpha: a });
      const names = ['customer history', 'policy/refunds-v1', 'tone rule'];
      names.forEach((name, i) => {
        const yy = y + (P ? 36 : 44) + i * (P ? 36 : 42);
        const x = P ? 12 : 32;
        const w = P ? 132 : 200;
        const gone = i === 1 ? removed : 0;
        const ca = a * (1 - gone * 0.75);
        this.box(x, yy, w, P ? 28 : 34, { r: 8, fill: th.cardAlt, stroke: gone > 0.5 ? th.red : th.lineStrong, dash: gone > 0.5 ? [4, 4] : undefined, alpha: ca });
        this.text(name, x + 10, yy + (P ? 14 : 17), { size: P ? 9.5 : 12, weight: 620, mono: true, base: 'middle', alpha: ca });
        if (gone > 0) this.box(x + 6, yy + (P ? 13 : 16), (w - 12) * gone, 1.6, { fill: th.red, alpha: a });
      });
      const midY = y + h / 2 + (P ? 6 : 8);
      const ox = P ? 196 : 340;
      this.orb(ox, midY, P ? 14 : 19, a, 'LLM');
      const rx = P ? 290 : 560;
      const path = this.pts([ox + (P ? 16 : 22), midY], [ox + 40, midY], [rx - (P ? 50 : 90), midY], [rx - (P ? 38 : 70), midY], 10);
      this.stroke(path, 0, resultP, { color: flipped ? th.green : th.red, lw: 2.4, alpha: a });
      if (resultP >= 1) {
        this.chip(rx, midY, flipped ? 'denied ✓' : 'approved ✗', { size: P ? 12 : 17, fg: '#fff', bg: flipped ? th.green : th.red, border: flipped ? th.green : th.red, mono: false, alpha: a });
      }
    };
    const y1 = P ? 4 : 12;
    const y2 = P ? 164 : 206;
    lane(y1, 'ORIGINAL RUN', 0, E.inOut(win(a0, a0 + 0.3, t)), false, E.out(win(a0 - 0.1, a0 + 0.15, t)));
    const lane2 = E.out(win(a0 + 0.35, a0 + 0.6, t));
    if (lane2 > 0) lane(y2, 'RERUN, SAME BASELINE, ONE SOURCE REMOVED', E.inOut(win(a0 + 0.55, a0 + 0.85, t)), E.inOut(win(a0 + 0.85, a0 + 1.2, t)), true, lane2);
    const hit = win(a0 + 1.2, a0 + 1.45, t);
    if (hit > 0) {
      this.sparks(P ? 290 : 560, y2 + (P ? 81 : 96), hit, th.green, 31, 60, 14);
      const y = y2 + (P ? 150 : 176) + (P ? 22 : 34);
      this.chip(dw / 2, y, 'tested, not guessed', { size: P ? 12.5 : 16, fg: th.yellowInk, border: th.yellow, scale: lerp(1.2, 1, E.out(hit)), alpha: hit });
      this.text('evidence in this case, not hidden reasoning', dw / 2, y + (P ? 22 : 28), { size: P ? 10 : 12.5, weight: 560, color: th.muted, align: 'center', base: 'middle', alpha: win(a0 + 1.35, a0 + 1.55, t) });
    }
    this.alpha = 1;
  }

  /* ── forward: why this tool? ──────────────────────────────────────────── */
  private sceneForward(t: number) {
    const scene = fade(H.forwardA + 0.02, H.loopA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const a0 = H.forwardA + 0.12;
    const grow = E.inOut(win(a0 + 0.1, a0 + 0.45, t));
    const sharpen = E.inOut(win(a0 + 0.95, a0 + 1.25, t));
    const ox = P ? 26 : 70;
    const rows = P ? 62 : 84;
    const y0 = P ? 74 : 112;
    this.text('why this tool?', dw / 2, P ? 26 : 44, { size: P ? 15 : 22, weight: 780, align: 'center', base: 'middle', alpha: win(a0 - 0.1, a0 + 0.1, t) });
    this.orb(ox, y0 + rows * 1.5, P ? 15 : 20, win(a0 - 0.1, a0 + 0.1, t), 'LLM');
    TOOLS.forEach((tool, i) => {
      const y = y0 + i * rows;
      const x = P ? 56 : 150;
      const w = dw - x - (P ? 44 : 90);
      const a = E.out(win(a0 + i * 0.05, a0 + 0.2 + i * 0.05, t));
      const line = this.pts([ox + (P ? 16 : 22), y0 + rows * 1.5], [ox + 34, y0 + rows * 1.5], [x - 24, y + 14], [x, y + 14], 12);
      this.stroke(line, 0, a, { color: th.lineStrong, lw: 1.3 });
      this.text(tool.n, x, y, { size: P ? 10.5 : 13.5, weight: 680, mono: true, base: 'middle', alpha: a });
      this.box(x, y + 12, w, P ? 10 : 14, { r: 6, fill: th.line, alpha: a });
      const v = lerp(tool.a, tool.b, sharpen) * grow;
      const tied = (tool.n === 'search_hotels' || tool.n === 'load_skill') && sharpen < 0.5 && grow >= 1;
      this.box(x, y + 12, w * v, P ? 10 : 14, { r: 6, fill: tied ? th.amber : th.yellow, alpha: a });
      this.text(v.toFixed(2), x + w + (P ? 6 : 10), y + (P ? 17 : 19), { size: P ? 10 : 12.5, weight: 700, mono: true, color: tied ? th.amber : th.muted, base: 'middle', alpha: a });
    });
    const tie = win(a0 + 0.45, a0 + 0.6, t) * (1 - win(a0 + 0.95, a0 + 1.1, t));
    if (tie > 0) this.chip(dw / 2 + (P ? 30 : 60), y0 + rows * 2 - (P ? 6 : 10), 'ambiguous tie at 0.50', { size: P ? 10.5 : 13, fg: '#fff', bg: th.amber, border: th.amber, alpha: tie });
    const fix = win(a0 + 1.05, a0 + 1.25, t);
    if (fix > 0) this.chip(dw / 2 + (P ? 30 : 60), y0 + rows * 2 - (P ? 6 : 10), 'description rewritten', { size: P ? 10.5 : 13, fg: th.green, border: th.green, alpha: fix });
    const own = win(a0 + 1.3, a0 + 1.5, t);
    if (own > 0) this.text('We map. You decide.', dw / 2, y0 + rows * 4 + (P ? 2 : 6), { size: P ? 13 : 18, weight: 760, align: 'center', base: 'middle', alpha: own });
    this.alpha = 1;
  }

  /* ── the loop, leaving its notes behind ───────────────────────────────── */
  private sceneLoop(t: number, clock: number) {
    const scene = fade(H.loopA + 0.02, H.endA, t, 0.18);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const c = this.c;
    const cx = dw / 2;
    const cy = P ? 140 : 190;
    const rx = P ? 120 : 210;
    const ry = P ? 92 : 132;
    const a0 = H.loopA + 0.1;
    const inA = E.out(win(a0 - 0.1, a0 + 0.2, t));
    const NODES = ['Context', 'CallLLM', 'Route', 'ToolCalls'];
    const EVENTS = ['prompt', 'ask', 'return', 'answer'];
    this.ga(inA);
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    c.strokeStyle = th.lineStrong;
    c.lineWidth = 2;
    c.stroke();
    const head = ((t - a0) * 1.6) % 1;
    const pos = (f: number): [number, number] => [cx + Math.cos(f * TAU - Math.PI / 2) * rx, cy + Math.sin(f * TAU - Math.PI / 2) * ry];
    NODES.forEach((name, i) => {
      const [x, y] = pos(i / 4);
      const lit = t > a0 && Math.abs(((head - i / 4 + 1.5) % 1) - 0.5) < 0.09;
      this.box(x - (P ? 44 : 64), y - (P ? 17 : 22), P ? 88 : 128, P ? 34 : 44, { r: 11, fill: th.card, stroke: lit ? th.yellowDeep : th.lineStrong, lw: lit ? 2 : 1, alpha: inA, shadow: true });
      this.text(name, x, y, { size: P ? 11 : 14, weight: 680, mono: true, align: 'center', base: 'middle', alpha: inA });
    });
    if (t > a0) {
      const [hx, hy] = pos(head);
      this.glow(hx, hy, 18, th.yellow, 0.9);
      this.dot(hx, hy, 5, th.yellowDeep);
    }
    this.orb(cx, cy, P ? 15 : 22, inA);
    /* the typed log: every pass leaves an event, and they stack up */
    const logY = P ? 300 : 396;
    this.text('typed log', P ? 8 : 40, logY - 14, { size: 10.5, weight: 700, mono: true, color: th.muted, alpha: inA });
    this.box(P ? 4 : 30, logY, dw - (P ? 8 : 60), P ? 130 : 126, { r: 14, fill: th.cardAlt, stroke: th.line, alpha: inA });
    const shown = clamp(Math.floor((t - a0) * 6.4), 0, 8);
    for (let i = 0; i < shown; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const w = (dw - (P ? 30 : 100)) / 4;
      const x = (P ? 10 : 42) + col * (w + (P ? 3 : 6));
      const y = logY + (P ? 12 : 14) + row * (P ? 56 : 52);
      const fresh = i === shown - 1 ? 1 - win(i / 6.4, (i + 0.7) / 6.4, t - a0) : 0;
      this.box(x, y, w, P ? 44 : 42, { r: 8, fill: th.card, stroke: th.yellowDeep, lw: 1, alpha: 1 - fresh * 0.7 });
      this.text(EVENTS[col]!, x + w / 2, y + (P ? 22 : 21), { size: P ? 9.5 : 12, weight: 650, mono: true, align: 'center', base: 'middle', alpha: 1 - fresh * 0.7 });
    }
    void clock;
    this.alpha = 1;
  }

  /* ── the answer again, this time standing ─────────────────────────────── */
  private sceneEnd(t: number, clock: number) {
    const scene = win(H.endA, H.endA + 0.2, t);
    if (scene <= 0) return;
    this.alpha = scene;
    const { P, dw } = this;
    const th = this.th;
    const cx = dw / 2;
    const ground = P ? 360 : 450;
    const plateY = P ? 110 : 150;
    const gap = P ? 96 : 170;
    const w = P ? 28 : 40;
    const rise = E.out(win(H.endA + 0.05, H.endA + 0.5, t));
    this.box(cx - (P ? 170 : 320), ground, (P ? 340 : 640) * E.out(win(H.endA, H.endA + 0.3, t)), 3, { r: 2, fill: th.ink });
    this.text(this.labels.record, cx - (P ? 170 : 320), ground + 18, { size: 10.5, weight: 700, mono: true, color: th.muted });
    this.pillar(cx - gap, plateY + (P ? 40 : 50), ground + 1, w, { grow: rise });
    this.pillar(cx + gap, plateY + (P ? 40 : 50), ground + 1, w, { grow: rise });
    const land = E.bounce(win(H.endA + 0.45, H.endA + 0.85, t));
    if (land > 0) {
      const y = lerp(-60, plateY, land);
      this.plate(cx, y, P ? 300 : 460, P ? 70 : 88, { label: 'ANSWER', text: 'Your refund was denied.', size: P ? 16 : 22 });
      const hit = win(H.endA + 0.6, H.endA + 0.95, t);
      this.sparks(cx - gap, plateY + 44, hit, th.yellow, 11, 46, 10);
      this.sparks(cx + gap, plateY + 44, hit, th.yellow, 12, 46, 10);
      this.glow(cx, y, P ? 150 : 240, th.yellow, (0.1 + 0.05 * Math.sin(clock * 1.3)) * win(H.endA + 0.7, H.endA + 1, t));
    }
    ['record', 'walk back', 'test'].forEach((word, i) => {
      const a = E.out(win(H.endA + 0.85 + i * 0.12, H.endA + 1.05 + i * 0.12, t));
      this.chip(cx + (i - 1) * (P ? 92 : 150), (plateY + ground) / 2 + (P ? 20 : 26), word, { size: P ? 11 : 13.5, fg: th.yellowInk, border: th.yellow, alpha: a });
    });
    this.alpha = 1;
  }
}
