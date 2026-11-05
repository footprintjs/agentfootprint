/**
 * The Features film: eight verbs, eight posters.
 *
 * Same rule as the other films: a frame is a pure function of a cursor. A word arrives
 * small, you fly through it, and its poster is on the other side.
 */
import { FEATURE_BEATS } from '@/lib/features/beats';
import { E, Stage, clamp, lerp, win } from '../home/stand/stage';
import { POSTER_FLY, POSTER_LENGTH, POSTER_QUOTES, posterStart } from './posterTimeline';

const VERBS = FEATURE_BEATS.map((beat) => beat.verb);
const CODE_BG = '#18181b';
const CODE_INK = '#ffd84d';

/* The names are illustrative. `read_skill`, a skill's body and its tools are real. */
const SKILLS = ['billing', 'refunds', 'tech'];
const PIECES = [
  { n: 'LLMCall', x: 0.13, y: 0.14 },
  { n: 'Agent', x: 0.87, y: 0.12 },
  { n: 'Sequence', x: 0.11, y: 0.5 },
  { n: 'Parallel', x: 0.89, y: 0.48 },
  { n: 'Conditional', x: 0.15, y: 0.84 },
  { n: 'Loop', x: 0.85, y: 0.84 },
];
const MODELS = [
  { n: 'Claude', code: 'anthropic({ defaultModel })', c: '#f97316' },
  { n: 'GPT', code: 'openai({ defaultModel })', c: '#22c55e' },
  { n: 'your laptop', code: 'ollama({ defaultModel })', c: '#3b82f6' },
];
const NODES = ['plan', 'search', 'read', 'answer'];
const EVENTS = POSTER_QUOTES.events;
/* The three fields of a real check-in: willDo, read and drivers. */
const RECEIPT = [
  ['WILL DO', 'issue_refund · A-1042 · $129'],
  ['READ', 'get_refund · policy/refunds-v1'],
  ['WHAT DROVE THIS', 'the ledger row, then the policy'],
];
/* The story from How it works. The scores are illustrative: a ranking is a lead, and the rerun is the test. */
const SUSPECTS = [
  { n: 'docs: policy/refunds-v1', v: 0.82 },
  { n: 'memory: customer history', v: 0.41 },
  { n: 'steering: tone rule', v: 0.17 },
  { n: 'system: persona', v: 0.09 },
];

/* How far each poster sits down from the top, so it reads as centred in its frame. */
const NUDGE = {
  wide: [19, 46, 54, 8, 18, 39, 46, 9],
  tall: [30, 46, 40, 20, 32, 32, 35, 29],
};

export class PosterFilm extends Stage<null> {
  draw(t: number, clock: number) {
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.translate(this.ox, this.oy);
    c.scale(this.s, this.s);
    this.alpha = 1;
    this.wall(t, clock);
    const scenes = [this.build, this.teach, this.remember, this.swap, this.watch, this.ask, this.why, this.survive];
    const nudge = this.P ? NUDGE.tall : NUDGE.wide;
    scenes.forEach((scene, i) => {
      const a = posterStart(i);
      const end = a + POSTER_LENGTH;
      if (t < a || (i < scenes.length - 1 && t >= end)) return;
      /* The poster steps back as the next word arrives. */
      this.alpha = 1 - 0.85 * win(end - POSTER_FLY, end - POSTER_FLY + 0.16, t);
      c.save();
      c.translate(0, nudge[i]!);
      scene.call(this, t - a, clock);
      c.restore();
      this.alpha = 1;
    });
    this.flight(t);
    c.globalAlpha = 1;
  }

  /* ── the eight words as one block of type, each cut to the column's width ── */
  private wall(t: number, clock: number) {
    const leave = posterStart(0) - POSTER_FLY;
    const a = 1 - win(leave - 0.3, leave, t);
    if (a <= 0) return;
    const { P, dw, dh, c, th } = this;
    const gap = P ? 10 : 18;
    const colW = (dw - gap) / 2;
    const rowGap = P ? 7 : 14;
    const fit = (word: string) => {
      c.font = this.big(100);
      const m = c.measureText(word);
      const scale = colW / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      return { word, size: 100 * scale, left: m.actualBoundingBoxLeft * scale, cap: m.actualBoundingBoxAscent * scale };
    };
    const lit = Math.floor(clock * 0.85) % VERBS.length;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    [VERBS.slice(0, 4), VERBS.slice(4)].forEach((words, col) => {
      const rows = words.map(fit);
      const height = rows.reduce((sum, r) => sum + r.cap, 0) + rowGap * (rows.length - 1);
      /* On a phone the hero's words sit up top, so the block waits below them. */
      let y = P ? dh - height - 16 : (dh - height) / 2;
      rows.forEach((row, i) => {
        const index = col * 4 + i;
        const rise = E.out(win(0.1 + index * 0.07, 0.55 + index * 0.07, clock));
        y += row.cap;
        c.font = this.big(row.size);
        this.ga(a * rise);
        c.fillStyle = index === lit ? th.yellowDeep : th.ink;
        c.fillText(row.word, col * (colW + gap) + row.left, y + (1 - rise) * 14);
        y += rowGap;
      });
    });
    this.ga(1);
  }

  /* ── the next word arrives small, and you fly through it ──────────────── */
  private flight(t: number) {
    const { W, H, c, th } = this;
    VERBS.forEach((word, i) => {
      const at = posterStart(i);
      const f = win(at - POSTER_FLY, at, t);
      const out = 1 - win(at, at + 0.2, t);
      if (f <= 0 || out <= 0) return;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const wash = clamp((f - 0.7) / 0.3) * out;
      if (f < 1) {
        const fit = Math.min(H * 0.5, (W * 0.8) / (word.length * 0.68));
        c.font = this.big(lerp(fit * 0.45, Math.min(Math.max(W, H) * 5, 4200), f * f * f * f));
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.globalAlpha = clamp(f * 4);
        c.fillStyle = th.yellow;
        c.fillText(word, W / 2, H / 2);
      }
      if (wash > 0) {
        c.globalAlpha = wash;
        c.fillStyle = th.yellow;
        c.fillRect(0, 0, W, H);
      }
    });
  }

  private card(x: number, y: number, w: number, h: number, label: string, a: number, o: { stroke?: string; size?: number; mono?: boolean } = {}) {
    if (a <= 0) return;
    const th = this.th;
    this.box(x - w / 2, y - h / 2, w, h, { r: 11, fill: th.card, stroke: o.stroke ?? th.lineStrong, lw: o.stroke ? 2 : 1, alpha: a, shadow: true });
    this.text(label, x, y, { size: o.size ?? (this.P ? 11 : 14), weight: 660, mono: o.mono ?? true, align: 'center', base: 'middle', alpha: a });
  }

  /** A dark strip of code. `shown` is how many characters have been typed so far. */
  private codeStrip(y: number, lines: readonly string[], shown = Infinity) {
    const { P, dw } = this;
    const w = P ? 344 : 600;
    const lineH = P ? 16 : 20;
    const h = (P ? 20 : 24) + lines.length * lineH;
    this.box(dw / 2 - w / 2, y - h / 2, w, h, { r: 10, fill: CODE_BG });
    let left = shown;
    lines.forEach((line, i) => {
      const part = line.slice(0, Math.max(0, left));
      left -= line.length;
      this.text(part, dw / 2 - (P ? 158 : 278), y + (i - (lines.length - 1) / 2) * lineH, { size: P ? 11 : 15, weight: 600, mono: true, color: CODE_INK, base: 'middle' });
    });
  }

  /* ── BUILD: the pieces snap together ──────────────────────────────────── */
  private build(u: number, clock: number) {
    const { P, dw, c, th } = this;
    const cx = dw / 2;
    const top = P ? 56 : 96;
    const base = P ? 226 : 320;
    const midY = (top + base) / 2;
    PIECES.forEach((piece, i) => {
      const move = E.inOut(win(0.6 + i * 0.04, 1.0 + i * 0.04, u));
      const gone = 1 - win(0.92 + i * 0.04, 1.04 + i * 0.04, u);
      const a = E.out(win(0.15 + i * 0.06, 0.4 + i * 0.06, u)) * gone;
      this.card(lerp(piece.x * dw, cx, move), lerp(piece.y * (P ? 300 : 430), midY, move), P ? 92 : 128, P ? 30 : 40, piece.n, a);
    });
    const snap = E.back(win(0.92, 1.25, u));
    if (u > 0.92) {
      c.save();
      c.translate(cx, midY);
      c.scale(snap, snap);
      c.translate(-cx, -midY);
      this.triangle(cx, top, base, P ? 66 : 96, clock);
      c.restore();
    }
    this.sparks(cx, midY, win(1.0, 1.4, u), th.yellow, 5, P ? 90 : 150, 18);
    const code = P ? ['Agent.create({ provider, model })', '  .tool(search).build()'] : ['Agent.create({ provider, model }).tool(search).build()'];
    const typed = Math.round(code.join('').length * win(1.2, 1.65, u));
    if (typed > 0) this.codeStrip(base + (P ? 62 : 84), code, typed);
  }

  /* ── TEACH: it opens only the one it needs ────────────────────────────── */
  private teach(u: number) {
    const { P, dw, th } = this;
    const y = P ? 62 : 112;
    const open = E.inOut(win(0.95, 1.35, u));
    this.chip(dw / 2, P ? 18 : 44, "read_skill('refunds')", { size: P ? 11.5 : 14.5, fg: th.yellowInk, border: th.yellow, alpha: win(0.6, 0.85, u) });
    SKILLS.forEach((name, i) => {
      const hot = i === 1;
      const a = E.out(win(0.1 + i * 0.1, 0.35 + i * 0.1, u)) * (hot ? 1 : lerp(1, 0.38, open));
      this.card(dw / 2 + (i - 1) * (P ? 118 : 234), y, P ? 104 : 208, P ? 46 : 62, name, a, { stroke: hot && u > 0.8 ? th.yellowDeep : undefined, size: P ? 12 : 16 });
    });
    if (open <= 0) return;
    const bw = P ? 300 : 460;
    const x = dw / 2 - bw / 2;
    const top = y + (P ? 32 : 44);
    this.box(x, top, bw, (P ? 214 : 280) * open, { r: 14, fill: th.card, stroke: th.yellowDeep, lw: 2, shadow: true });
    const ROWS = [
      ['body', 'the playbook it follows now'],
      ['tools', 'lookup_order · issue_refund'],
      ['the other two', 'stay one-line descriptions'],
    ];
    ROWS.forEach(([k, v], i) => {
      const yy = top + (P ? 22 : 30) + i * (P ? 62 : 80);
      const a = win(1.25 + i * 0.1, 1.42 + i * 0.1, u);
      this.text(k!, x + 20, yy, { size: P ? 10 : 12, weight: 700, mono: true, color: th.muted, base: 'top', alpha: a });
      this.text(v!, x + 20, yy + (P ? 16 : 20), { size: P ? 13.5 : 18, weight: 660, base: 'top', alpha: a });
    });
  }

  /* ── REMEMBER: it keeps what matters between conversations ─────────────── */
  private remember(u: number) {
    const { P, dw, th } = this;
    const y1 = P ? 14 : 26;
    const panelW = P ? 168 : 320;
    const panelH = P ? 140 : 172;
    const lx = P ? 2 : 20;
    const rx = dw - panelW - lx;
    const panel = (x: number, title: string, a: number) => {
      this.box(x, y1, panelW, panelH, { r: 14, fill: th.card, stroke: th.lineStrong, alpha: a, shadow: true });
      this.text(title, x + 14, y1 + 12, { size: P ? 9.5 : 11, weight: 700, mono: true, color: th.muted, base: 'top', alpha: a });
    };
    const bubble = (x: number, y: number, str: string, me: boolean, a: number) => {
      if (a <= 0) return;
      const w = panelW - (P ? 24 : 60);
      const bx = me ? x + panelW - w - 12 : x + 12;
      this.box(bx, y, w, P ? 40 : 50, { r: 12, fill: me ? th.yellow : th.cardAlt, alpha: a });
      this.text(str, bx + w / 2, y + (P ? 20 : 25), { size: P ? 11 : 15, weight: 640, color: me ? CODE_BG : th.ink, align: 'center', base: 'middle', alpha: a });
    };
    panel(lx, 'MONDAY', E.out(win(0.05, 0.25, u)));
    bubble(lx, y1 + (P ? 36 : 44), 'I’m on the Pro plan.', true, win(0.2, 0.35, u));
    bubble(lx, y1 + (P ? 88 : 108), 'Noted.', false, win(0.34, 0.46, u));
    panel(rx, 'FRIDAY', E.out(win(0.85, 1.05, u)));
    bubble(rx, y1 + (P ? 36 : 44), 'Which plan am I on?', true, win(1.05, 1.2, u));
    bubble(rx, y1 + (P ? 88 : 108), 'You’re on Pro.', false, win(1.5, 1.65, u));
    const storeY = P ? 262 : 348;
    const half = P ? 80 : 120;
    const sa = E.out(win(0.35, 0.55, u));
    this.box(dw / 2 - half, storeY - (P ? 30 : 40), half * 2, P ? 60 : 80, { r: 14, fill: th.cardAlt, stroke: th.yellowDeep, lw: 2, alpha: sa, shadow: true });
    this.text('memory', dw / 2, storeY, { size: P ? 14 : 19, weight: 760, mono: true, align: 'center', base: 'middle', alpha: sa });
    const drop = this.pts([lx + panelW / 2, y1 + panelH], [lx + panelW / 2, storeY - 30], [dw / 2 - half - 60, storeY], [dw / 2 - half, storeY], 22);
    const lift = this.pts([dw / 2 + half, storeY], [dw / 2 + half + 60, storeY], [rx + panelW / 2, storeY - 30], [rx + panelW / 2, y1 + panelH], 22);
    const f1 = E.inOut(win(0.45, 0.85, u));
    const f2 = E.inOut(win(1.2, 1.5, u));
    this.stroke(drop, 0, f1, { color: th.yellowDeep, lw: 2.2 });
    if (f1 > 0 && f1 < 1) this.comet(drop, f1, { lw: 3 });
    this.stroke(lift, 0, f2, { color: th.yellowDeep, lw: 2.2 });
    if (f2 > 0 && f2 < 1) this.comet(lift, f2, { lw: 3 });
    this.chip(dw / 2, storeY + (P ? 50 : 66), 'plan: Pro', { size: P ? 12 : 14.5, fg: th.yellowInk, border: th.yellow, alpha: win(0.8, 1, u) });
  }

  /* ── SWAP: same agent, another provider ───────────────────────────────── */
  private swap(u: number, clock: number) {
    const { P, th } = this;
    const cx = P ? 84 : 200;
    const top = P ? 70 : 100;
    const base = P ? 214 : 336;
    const hw = P ? 58 : 92;
    this.triangle(cx, top, base, hw, clock);
    this.text('same agent', cx, base + (P ? 44 : 60), { size: P ? 12.5 : 16, weight: 720, color: th.muted, align: 'center' });
    const active = clamp(Math.floor(win(0.3, 1.75, u) * MODELS.length), 0, MODELS.length - 1);
    const x = P ? 272 : 590;
    MODELS.forEach((model, i) => {
      const y = (P ? 62 : 90) + i * (P ? 82 : 124);
      const on = i === active;
      const a = E.out(win(0.08 + i * 0.08, 0.28 + i * 0.08, u));
      const midY = base - (P ? 34 : 56);
      const path = this.pts([cx + hw * 0.62, midY], [cx + hw + 40, midY], [x - (P ? 90 : 170), y], [x - (P ? 58 : 105), y], 20);
      this.stroke(path, 0, 1, { color: on ? model.c : th.line, lw: on ? 3 : 1.4, alpha: a });
      if (on) this.comet(path, (clock * 0.9) % 1, { lw: 3.4 });
      this.card(x, y, P ? 116 : 210, P ? 50 : 72, model.n, a, { stroke: on ? model.c : undefined, mono: false, size: P ? 13.5 : 19 });
    });
    this.codeStrip(P ? 352 : 468, [`provider: ${MODELS[active]!.code},`]);
  }

  /* ── WATCH: see it think, in real time ────────────────────────────────── */
  private watch(u: number, clock: number) {
    const { P, dw, th } = this;
    const shown = win(0.2, 1.75, u) * EVENTS.length;
    const count = Math.min(EVENTS.length, Math.floor(shown));
    const x0 = P ? 42 : 80;
    const stepX = (dw - x0 * 2) / (NODES.length - 1);
    const pos = (i: number): [number, number] => [x0 + i * stepX, (P ? 52 : 70) + (i % 2) * (P ? 36 : 48)];
    for (let i = 0; i < NODES.length - 1; i++) {
      const [ax, ay] = pos(i);
      const [bx, by] = pos(i + 1);
      const path = this.pts([ax, ay], [ax + stepX * 0.45, ay], [bx - stepX * 0.45, by], [bx, by], 14);
      const p = clamp(shown - (2 * i + 1));
      this.stroke(path, 0, 1, { color: th.line, lw: 2 });
      this.stroke(path, 0, p, { color: th.yellowDeep, lw: 2.6 });
      if (p > 0 && p < 1) this.comet(path, p, { lw: 3 });
    }
    NODES.forEach((name, i) => {
      const [x, y] = pos(i);
      this.card(x, y, P ? 68 : 108, P ? 32 : 44, name, E.out(win(0.04 + i * 0.05, 0.2 + i * 0.05, u)), { stroke: shown >= i * 2 ? th.yellowDeep : undefined, size: P ? 11 : 15 });
    });
    const pulse = 0.55 + 0.45 * Math.sin(clock * 5);
    this.dot(P ? 10 : 30, P ? 12 : 20, P ? 4 : 5, th.red, pulse);
    this.text(`LIVE · ${String(count).padStart(2, '0')} events`, P ? 20 : 44, P ? 12 : 20, { size: P ? 10.5 : 12.5, weight: 700, mono: true, color: th.muted, base: 'middle' });
    const rowY = P ? 110 : 158;
    const rowH = P ? 31 : 44;
    const x = P ? 2 : 24;
    const w = dw - x * 2;
    for (let i = 0; i < count; i++) {
      const y = rowY + i * rowH;
      const fresh = i === count - 1 && count < EVENTS.length;
      const a = clamp(shown - i);
      this.box(x, y, w, rowH - 6, { r: 7, fill: th.card, stroke: fresh ? th.yellowDeep : th.line, lw: fresh ? 2 : 1, alpha: a });
      this.text(EVENTS[i]!, x + 12, y + (rowH - 6) / 2, { size: P ? 10 : 13.5, weight: 620, mono: true, base: 'middle', alpha: a });
      this.text(NODES[Math.floor(i / 2)]!, x + w - 12, y + (rowH - 6) / 2, { size: P ? 10 : 13, weight: 700, mono: true, color: th.muted, align: 'right', base: 'middle', alpha: a });
    }
  }

  /* ── ASK: it checks in before doing anything big ───────────────────────── */
  private ask(u: number) {
    const { P, dw, th } = this;
    const y = P ? 36 : 56;
    const gateX = dw * 0.62;
    const cardW = P ? 150 : 220;
    const stopAt = gateX - cardW / 2 - 14;
    const roll = E.inOut(win(1.5, 1.8, u));
    const x = lerp(lerp(-cardW, stopAt, E.out(win(0.08, 0.45, u))), dw - cardW / 2 - 4, roll);
    this.box(0, y + (P ? 24 : 34), dw, 3, { r: 2, fill: th.line });
    const drop = E.bounce(win(0.42, 0.66, u));
    const lift = E.inOut(win(1.42, 1.6, u));
    const gateH = P ? 56 : 78;
    this.box(gateX - 4, y - gateH / 2 - (1 - drop) * 50 - lift * 60, 8, gateH, { r: 3, fill: th.red, alpha: drop * (1 - lift) });
    this.card(x, y, cardW, P ? 40 : 56, 'issue_refund', 1, { size: P ? 12 : 16, stroke: th.yellowDeep });
    const a = E.out(win(0.6, 0.85, u));
    if (a <= 0) return;
    const w = P ? 346 : 560;
    const px = dw / 2 - w / 2;
    const top = y + (P ? 42 : 66);
    const rowH = P ? 54 : 66;
    const h = (P ? 48 : 62) + rowH * RECEIPT.length + (P ? 58 : 72);
    this.box(px, top, w, h, { r: 16, fill: CODE_BG, alpha: a, shadow: true });
    const pressed = win(1.3, 1.42, u);
    this.text('check-in', px + 20, top + (P ? 18 : 24), { size: P ? 11 : 13, weight: 760, mono: true, color: CODE_INK, base: 'top', alpha: a });
    this.text(pressed > 0.5 ? 'approved · on the record' : 'run paused, tool not run', px + w - 20, top + (P ? 18 : 24), { size: P ? 10.5 : 12.5, weight: 700, mono: true, color: pressed > 0.5 ? '#4ade80' : '#d4d4d8', align: 'right', base: 'top', alpha: a });
    RECEIPT.forEach(([label, value], i) => {
      const ry = top + (P ? 48 : 62) + i * rowH;
      const ra = win(0.72 + i * 0.1, 0.88 + i * 0.1, u) * a;
      this.text(label!, px + 20, ry, { size: P ? 9.5 : 11, weight: 700, mono: true, color: '#a1a1aa', base: 'top', alpha: ra });
      this.text(value!, px + 20, ry + (P ? 15 : 18), { size: P ? 13 : 17, weight: 620, color: '#fff', base: 'top', alpha: ra });
    });
    const by = top + h - (P ? 50 : 62);
    const bw = P ? 118 : 156;
    const bh = P ? 36 : 44;
    const armed = win(1.08, 1.22, u);
    this.box(px + 20, by, bw, bh, { r: 9, fill: th.yellow, alpha: a * armed });
    this.text('APPROVE', px + 20 + bw / 2, by + bh / 2, { size: P ? 11.5 : 13.5, weight: 820, color: CODE_BG, align: 'center', base: 'middle', alpha: a * armed });
    this.text('DECLINE', px + 20 + bw + 24, by + bh / 2, { size: P ? 11.5 : 13.5, weight: 700, color: '#d4d4d8', base: 'middle', alpha: a * armed * (1 - pressed * 0.7) });
    this.ripple(px + 20 + bw / 2, by + bh / 2, win(1.3, 1.6, u), 70, th.yellow);
  }

  /* ── WHY: it answers with receipts ────────────────────────────────────── */
  private why(u: number) {
    const { P, dw, th } = this;
    const x = P ? 4 : 60;
    const w = dw - x * 2;
    const flip = win(1.32, 1.46, u);
    const y = P ? 40 : 56;
    const a = E.out(win(0.05, 0.25, u));
    this.plate(dw / 2, y, w, P ? 62 : 80, { label: 'ANSWER', text: 'Your refund is approved.', size: P ? 15 : 21, alpha: a * (1 - flip) });
    this.plate(dw / 2, y, w, P ? 62 : 80, { label: 'WITHOUT IT', text: 'Your refund was denied.', size: P ? 15 : 21, alpha: flip });
    const listY = P ? 92 : 122;
    this.text('suspects, ranked', x, listY, { size: P ? 10 : 12, weight: 700, mono: true, color: th.muted, alpha: win(0.3, 0.45, u) });
    const grow = E.inOut(win(0.42, 0.95, u));
    const rowH = P ? 60 : 78;
    const top = listY + (P ? 14 : 18);
    SUSPECTS.forEach((suspect, i) => {
      const ry = top + i * rowH;
      const ra = win(0.32 + i * 0.06, 0.48 + i * 0.06, u);
      const hot = i === 0 && u > 1.12;
      this.box(x, ry, w, rowH - 10, { r: 11, fill: th.card, stroke: hot ? th.yellowDeep : th.lineStrong, lw: hot ? 2 : 1, alpha: ra, shadow: true });
      this.text(suspect.n, x + 14, ry + (P ? 15 : 20), { size: P ? 12 : 15, weight: 660, mono: true, base: 'middle', alpha: ra });
      this.box(x + 14, ry + (P ? 30 : 40), (w - 74) * suspect.v * grow, P ? 7 : 9, { r: 4, fill: i === 0 ? th.yellow : th.lineStrong, alpha: ra });
      this.text(suspect.v.toFixed(2), x + w - 14, ry + (P ? 33 : 44), { size: P ? 10.5 : 12.5, weight: 700, mono: true, color: th.muted, align: 'right', base: 'middle', alpha: ra * grow });
    });
    const stamp = E.back(win(1.15, 1.42, u));
    if (stamp > 0) this.chip(x + w - (P ? 112 : 150), top + (P ? -8 : -10), 'tested: without it, the answer changed', { size: P ? 9.6 : 13, fg: '#fff', bg: th.green, border: th.green, scale: lerp(1.25, 1, clamp(stamp)), alpha: clamp(stamp) });
  }

  /* ── SURVIVE: outages happen, runs continue ───────────────────────────── */
  private survive(u: number, clock: number) {
    const { P, dw, th } = this;
    const y = P ? 110 : 170;
    const runX = P ? 50 : 90;
    const aX = dw - (P ? 60 : 130);
    const aY = y - (P ? 70 : 104);
    const bY = y + (P ? 70 : 104);
    const edge = P ? 50 : 80;
    const from: [number, number] = [runX + (P ? 40 : 62), y];
    const toA = this.pts(from, [dw * 0.42, y], [aX - edge - 70, aY], [aX - edge, aY], 26);
    const toB = this.pts(from, [dw * 0.42, y], [aX - edge - 70, bY], [aX - edge, bY], 26);
    const fail = win(0.62, 0.78, u);
    const shift = win(0.92, 1.12, u);
    this.stroke(toA, 0, 1, fail > 0 ? { color: th.red, lw: 1.6, dash: [4, 6] } : { color: th.yellowDeep, lw: 2.6 });
    this.stroke(toB, 0, 1, { color: shift > 0 ? th.green : th.line, lw: shift > 0 ? 2.8 : 1.4 });
    if (fail <= 0) this.comet(toA, (clock * 0.8) % 1, { lw: 3 });
    if (shift > 0) this.comet(toB, (clock * 0.8) % 1, { lw: 3.2 });
    this.card(runX, y, P ? 84 : 124, P ? 44 : 60, 'your run', 1, { size: P ? 12 : 16, stroke: th.yellowDeep });
    this.card(aX, aY, P ? 100 : 160, P ? 44 : 60, 'anthropic', 1, { stroke: fail > 0 ? th.red : undefined, size: P ? 12 : 16 });
    this.card(aX, bY, P ? 100 : 160, P ? 44 : 60, 'openai', 1, { stroke: shift > 0 ? th.green : undefined, size: P ? 12 : 16 });
    if (fail > 0) {
      this.sparks(aX, aY, win(0.62, 1.0, u), th.red, 71, 70, 16);
      this.chip(aX, aY + (P ? 34 : 48), '✕ 429', { size: P ? 11 : 13, fg: th.red, border: th.red, alpha: fail });
    }
    if (shift > 0) this.chip(aX, bY + (P ? 34 : 48), '✓ withFallback', { size: P ? 11 : 13, fg: th.green, border: th.green, alpha: shift });
    /* One dot per iteration, each with its checkpoint. The run never stops for the outage. */
    const lineY = P ? 290 : 420;
    const steps = 12;
    const x0 = P ? 16 : 44;
    const stepX = (dw - x0 * 2) / (steps - 1);
    const done = clamp(u / 1.75) * steps;
    this.box(x0, lineY - 1.5, (dw - x0 * 2) * clamp(done / (steps - 1)), 3, { r: 2, fill: th.yellowDeep });
    for (let i = 0; i < steps; i++) {
      const on = i < done;
      this.dot(x0 + i * stepX, lineY, P ? 6 : 8, on ? th.yellowDeep : th.line);
      if (on) this.dot(x0 + i * stepX, lineY, P ? 2.5 : 3.5, th.card);
    }
    const note = win(1.3, 1.5, u);
    this.text('A checkpoint at every iteration.', dw / 2, lineY + (P ? 30 : 42), { size: P ? 14 : 18, weight: 720, align: 'center', base: 'top', alpha: note });
    this.text('agent.resumeOnError(checkpoint, input)', dw / 2, lineY + (P ? 54 : 72), { size: P ? 11 : 14, weight: 620, mono: true, color: th.muted, align: 'center', base: 'top', alpha: note });
  }
}
