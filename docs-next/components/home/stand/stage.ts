/**
 * What every film on the site draws with: the canvas, the theme, and the small
 * vocabulary of shapes. A film is a subclass with a `draw(t, clock)`, and the rule
 * is the same for all of them: a frame is a pure function of a cursor.
 */
export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of x through the window [a, b], clamped to 0..1. */
export const win = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
/** 1 inside [a, b], easing in and out over `edge` at each end. */
export const fade = (a: number, b: number, x: number, edge = 0.16) =>
  win(a, a + edge, x) * (1 - win(b - edge, b, x));
export const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  },
  bounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t - 1.5 / d) * (t - 1.5 / d) + 0.75;
    if (t < 2.5 / d) return n * (t - 2.25 / d) * (t - 2.25 / d) + 0.9375;
    return n * (t - 2.625 / d) * (t - 2.625 / d) + 0.984375;
  },
};
/** A colour at zero alpha, so a gradient fades out without passing through grey. */
export function clearOf(color: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 'rgba(255,255,255,0)';
  const n = parseInt(m[1]!, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0)`;
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Theme {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;
  card: string;
  cardAlt: string;
  yellow: string;
  yellowDeep: string;
  yellowInk: string;
  green: string;
  red: string;
  amber: string;
  blue: string;
  shadow: string;
}

export interface TextOpts {
  size?: number;
  weight?: number;
  mono?: boolean;
  color?: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  alpha?: number;
}

export interface BoxOpts {
  r?: number;
  fill?: string;
  stroke?: string;
  lw?: number;
  dash?: readonly number[];
  alpha?: number;
  shadow?: boolean;
}

export interface PlateOpts {
  text?: string;
  label?: string;
  sub?: string;
  subColor?: string;
  angle?: number;
  alpha?: number;
  dashed?: boolean;
  tint?: string;
  size?: number;
  mono?: boolean;
  textAlpha?: number;
}

export interface Word {
  size: number;
  xs: number[];
  widths: number[];
  base: number;
  capH: number;
  top: number;
  left: number;
  right: number;
}

export interface ResizeOpts {
  head?: number;
  capZone?: number;
  gutter?: number;
  capW?: number;
  rail?: number;
  still?: boolean;
  portrait?: boolean;
}

export const WORD = ['S', 'T', 'A', 'N', 'D'] as const;

export class Stage<L> {
  protected c: CanvasRenderingContext2D;
  protected W = 800;
  protected H = 500;
  protected dpr = 1;
  protected P = false;
  protected dw = 760;
  protected dh = 560;
  protected s = 1;
  protected ox = 0;
  protected oy = 0;
  protected alpha = 1;
  protected sans = 'system-ui, sans-serif';
  protected mono = 'ui-monospace, Menlo, Consolas, monospace';
  protected word: Word = { size: 200, xs: [], widths: [], base: 400, capH: 140, top: 260, left: 0, right: 0 };
  protected wraps = new Map<string, string[]>();
  protected labels: L;
  protected th: Theme = {
    bg: '#fff',
    ink: '#111',
    muted: '#666',
    faint: '#999',
    line: '#ddd',
    lineStrong: '#ccc',
    card: '#fff',
    cardAlt: '#f5f5f5',
    yellow: '#ffc700',
    yellowDeep: '#e6b400',
    yellowInk: '#8a6a00',
    green: '#16a34a',
    red: '#dc2626',
    amber: '#d97706',
    blue: '#2563eb',
    shadow: 'rgba(0,0,0,0.12)',
  };

  constructor(
    protected canvas: HTMLCanvasElement,
    labels: L,
  ) {
    const c = canvas.getContext('2d');
    if (!c) throw new Error('StandFilm: no 2d canvas context');
    this.c = c;
    this.labels = labels;
  }

  setLabels(labels: L) {
    this.labels = labels;
  }

  readPalette(el: Element) {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const t = this.th;
    this.th = {
      bg: v('--s-bg', t.bg),
      ink: v('--s-ink', t.ink),
      muted: v('--s-muted', t.muted),
      faint: v('--s-faint', t.faint),
      line: v('--s-line', t.line),
      lineStrong: v('--s-line-strong', t.lineStrong),
      card: v('--s-card', t.card),
      cardAlt: v('--s-card-alt', t.cardAlt),
      yellow: v('--s-yellow', t.yellow),
      yellowDeep: v('--s-yellow-deep', t.yellowDeep),
      yellowInk: v('--s-yellow-ink', t.yellowInk),
      green: v('--s-green', t.green),
      red: v('--s-red', t.red),
      amber: v('--s-amber', t.amber),
      blue: v('--s-blue', t.blue),
      shadow: v('--s-shadow', t.shadow),
    };
    const family = cs.fontFamily;
    if (family) this.sans = family;
    this.wraps.clear();
  }

  resize(W: number, H: number, dpr: number, o: ResizeOpts = {}) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.P = o.portrait ?? W < 720;
    this.dw = this.P ? 360 : 760;
    this.dh = this.P ? 470 : 560;
    let ax: number;
    let ay: number;
    let aw: number;
    let ah: number;
    if (o.still) {
      ax = 6;
      ay = 6;
      aw = W - 12;
      ah = H - 12;
    } else if (this.P) {
      ax = o.gutter ?? 12;
      ay = (o.head ?? 0) + (o.capZone ?? 0);
      aw = W - ax * 2;
      ah = H - ay - (o.rail ?? 0) - 4;
    } else {
      const left = (o.gutter ?? 24) + (o.capW ?? 300) + 12;
      ax = left;
      ay = (o.head ?? 0) + 6;
      aw = W - left - (o.gutter ?? 24) * 0.6;
      ah = H - ay - (o.rail ?? 0) - 6;
    }
    this.s = Math.min(aw / this.dw, ah / this.dh);
    this.ox = ax + (aw - this.dw * this.s) / 2;
    this.oy = ay + (ah - this.dh * this.s) / 2;
    this.onResize();
  }

  protected big(size: number) {
    return `900 ${size.toFixed(1)}px ${this.sans}`;
  }

  /** Lay out anything that depends on the design size. */
  protected onResize() {
    this.layoutWord();
  }

  protected layoutWord() {
    const c = this.c;
    let size = this.P ? 118 : 250;
    c.font = this.big(size);
    let widths = WORD.map((l) => c.measureText(l).width);
    let gap = size * 0.03;
    const total = widths.reduce((a, b) => a + b, 0) + gap * 4;
    const maxW = this.dw * 0.95;
    const k = Math.min(1, maxW / total);
    size *= k;
    widths = widths.map((w) => w * k);
    gap *= k;
    const span = widths.reduce((a, b) => a + b, 0) + gap * 4;
    let x = (this.dw - span) / 2;
    const left = x;
    const xs: number[] = [];
    widths.forEach((w) => {
      xs.push(x);
      x += w + gap;
    });
    const capH = size * 0.72;
    const base = this.P ? this.dh * 0.72 : this.dh * 0.76;
    this.word = { size, xs, widths, base, capH, top: base - capH, left, right: x - gap };
  }

  /* ── primitives ───────────────────────────────────────────────────────── */
  protected ga(a: number) {
    this.c.globalAlpha = clamp(this.alpha * a);
  }

  protected rr(x: number, y: number, w: number, h: number, r: number) {
    const c = this.c;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }

  protected box(x: number, y: number, w: number, h: number, o: BoxOpts = {}) {
    const c = this.c;
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    this.ga(a);
    this.rr(x, y, w, h, o.r ?? 12);
    if (o.fill) {
      if (o.shadow) {
        c.shadowColor = this.th.shadow;
        c.shadowBlur = 18 * this.s * this.dpr;
        c.shadowOffsetY = 6 * this.s * this.dpr;
      }
      c.fillStyle = o.fill;
      c.fill();
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.lineWidth = o.lw ?? 1;
      if (o.dash) c.setLineDash(o.dash as number[]);
      c.stroke();
      if (o.dash) c.setLineDash([]);
    }
  }

  protected font(size: number, weight = 500, mono = false) {
    return `${weight} ${size.toFixed(1)}px ${mono ? this.mono : this.sans}`;
  }

  protected text(str: string, x: number, y: number, o: TextOpts = {}) {
    const c = this.c;
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    this.ga(a);
    c.font = this.font(o.size ?? 13, o.weight ?? 500, o.mono ?? false);
    c.fillStyle = o.color ?? this.th.ink;
    c.textAlign = o.align ?? 'left';
    c.textBaseline = o.base ?? 'alphabetic';
    c.fillText(str, x, y);
  }

  protected wrap(str: string, maxW: number, fontStr: string): string[] {
    const key = `${fontStr}|${maxW}|${str}`;
    const hit = this.wraps.get(key);
    if (hit) return hit;
    const c = this.c;
    c.font = fontStr;
    const out: string[] = [];
    let cur = '';
    for (const word of str.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && c.measureText(next).width > maxW) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    this.wraps.set(key, out);
    return out;
  }

  /** Wrapped text. Returns the height used. */
  protected para(str: string, x: number, y: number, maxW: number, o: TextOpts & { lh?: number } = {}) {
    const size = o.size ?? 13;
    const lh = o.lh ?? size * 1.32;
    const lines = this.wrap(str, maxW, this.font(size, o.weight ?? 500, o.mono ?? false));
    lines.forEach((line, i) => this.text(line, x, y + i * lh, { ...o, size, base: 'top' }));
    return lines.length * lh;
  }

  protected chip(
    cx: number,
    cy: number,
    str: string,
    o: { fg?: string; bg?: string; border?: string; size?: number; mono?: boolean; alpha?: number; scale?: number } = {},
  ) {
    const a = o.alpha ?? 1;
    if (a <= 0 || !str) return;
    const c = this.c;
    const size = o.size ?? 11;
    const mono = o.mono ?? true;
    c.font = this.font(size, 600, mono);
    const w = c.measureText(str).width + size * 1.5;
    const h = size * 2;
    const k = o.scale ?? 1;
    c.save();
    c.translate(cx, cy);
    c.scale(k, k);
    this.box(-w / 2, -h / 2, w, h, {
      r: h / 2,
      fill: o.bg ?? this.th.card,
      stroke: o.border ?? this.th.lineStrong,
      alpha: a,
    });
    this.text(str, 0, 0.5, {
      size,
      weight: 600,
      mono,
      color: o.fg ?? this.th.muted,
      align: 'center',
      base: 'middle',
      alpha: a,
    });
    c.restore();
  }

  protected glow(x: number, y: number, r: number, color: string, a: number) {
    if (a <= 0) return;
    const c = this.c;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, clearOf(color));
    this.ga(a);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  protected pts(
    p0: readonly [number, number],
    p1: readonly [number, number],
    p2: readonly [number, number],
    p3: readonly [number, number],
    n = 28,
  ) {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = 1 - u;
      out.push([
        v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
        v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
      ]);
    }
    return out;
  }

  protected stroke(
    pts: readonly (readonly [number, number])[],
    f0: number,
    f1: number,
    o: { color?: string; lw?: number; alpha?: number; dash?: readonly number[] } = {},
  ) {
    const a = o.alpha ?? 1;
    if (a <= 0 || f1 <= f0) return;
    const c = this.c;
    const n = pts.length - 1;
    const i0 = f0 * n;
    const i1 = f1 * n;
    c.beginPath();
    const at = (f: number): [number, number] => {
      const i = Math.min(n - 1, Math.floor(f));
      const u = f - i;
      const p = pts[i]!;
      const q = pts[i + 1]!;
      return [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
    };
    const s = at(i0);
    c.moveTo(s[0], s[1]);
    for (let i = Math.ceil(i0); i <= Math.floor(i1); i++) c.lineTo(pts[i]![0], pts[i]![1]);
    const e = at(i1);
    c.lineTo(e[0], e[1]);
    this.ga(a);
    c.strokeStyle = o.color ?? this.th.yellow;
    c.lineWidth = o.lw ?? 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (o.dash) c.setLineDash(o.dash as number[]);
    c.stroke();
    if (o.dash) c.setLineDash([]);
  }

  protected at(pts: readonly (readonly [number, number])[], f: number): [number, number] {
    const n = pts.length - 1;
    const x = clamp(f) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const u = x - i;
    const p = pts[i]!;
    const q = pts[i + 1]!;
    return [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
  }

  /** A bright head running along a path. */
  protected comet(
    pts: readonly (readonly [number, number])[],
    f: number,
    o: { color?: string; lw?: number; alpha?: number; tail?: number } = {},
  ) {
    const a = o.alpha ?? 1;
    if (a <= 0 || f <= 0 || f >= 1) return;
    const color = o.color ?? this.th.yellow;
    const tail = o.tail ?? 0.22;
    this.stroke(pts, Math.max(0, f - tail), f, { color, lw: o.lw ?? 3, alpha: a * 0.9 });
    const p = this.at(pts, f);
    this.glow(p[0], p[1], 16, color, a * 0.8);
    this.dot(p[0], p[1], (o.lw ?? 3) * 1.15, color, a);
  }

  protected dot(x: number, y: number, r: number, color: string, a = 1) {
    if (a <= 0) return;
    const c = this.c;
    this.ga(a);
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fillStyle = color;
    c.fill();
  }

  protected ripple(x: number, y: number, f: number, r: number, color: string, a = 1) {
    if (f <= 0 || f >= 1) return;
    const c = this.c;
    this.ga(a * (1 - f));
    c.beginPath();
    c.arc(x, y, r * E.out(f), 0, TAU);
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.stroke();
  }

  protected sparks(x: number, y: number, f: number, color: string, seed: number, r: number, n = 12) {
    if (f <= 0 || f >= 1) return;
    const R = rng(seed);
    for (let i = 0; i < n; i++) {
      const ang = R() * TAU;
      const d = r * (0.35 + 0.75 * R()) * E.out(f);
      const size = 1 + 2.2 * R();
      this.dot(
        x + Math.cos(ang) * d,
        y + Math.sin(ang) * d + 26 * f * f,
        size * (1 - f * 0.5),
        color,
        1 - f,
      );
    }
  }

  /** The answer, as a physical slab. */
  protected plate(cx: number, cy: number, w: number, h: number, o: PlateOpts = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const c = this.c;
    const th = this.th;
    c.save();
    c.translate(cx, cy);
    c.rotate(o.angle ?? 0);
    if (o.dashed) {
      this.box(-w / 2, -h / 2, w, h, {
        r: 13,
        fill: th.card,
        stroke: o.tint ?? th.lineStrong,
        lw: 1.5,
        dash: [6, 5],
        alpha: a,
      });
    } else {
      this.box(-w / 2, -h / 2 + 7, w, h, { r: 13, fill: o.tint ?? th.yellowDeep, alpha: a });
      this.box(-w / 2, -h / 2, w, h, {
        r: 13,
        fill: th.card,
        stroke: o.tint ?? th.yellow,
        lw: 1.5,
        alpha: a,
        shadow: true,
      });
    }
    const pad = 15;
    const size = o.size ?? 15;
    const lh = size * 1.26;
    const ta = a * (o.textAlpha ?? 1);
    const textLines = o.text
      ? this.wrap(o.text, w - pad * 2, this.font(size, 620, o.mono ?? false)).length
      : 0;
    const subLines = o.sub ? this.wrap(o.sub, w - pad * 2, this.font(10.5, 600, true)).length : 0;
    const block = (o.label ? 15 : 0) + textLines * lh + (subLines ? 4 + subLines * 13.9 : 0);
    let y = -block / 2 - 1;
    if (o.label) {
      this.text(o.label, -w / 2 + pad, y, {
        size: 9.5,
        weight: 700,
        mono: true,
        color: o.tint ?? th.yellowInk,
        base: 'top',
        alpha: ta,
      });
      y += 15;
    }
    if (o.text) {
      y += this.para(o.text, -w / 2 + pad, y, w - pad * 2, {
        size,
        weight: 620,
        mono: o.mono ?? false,
        alpha: ta,
        lh,
      });
    }
    if (o.sub) {
      this.para(o.sub, -w / 2 + pad, y + 4, w - pad * 2, {
        size: 10.5,
        weight: 600,
        mono: true,
        color: o.subColor ?? th.muted,
        alpha: a,
      });
    }
    c.restore();
  }

  /** Evidence holding the answer up. grow 0..1 rises from the base. */
  protected pillar(
    x: number,
    top: number,
    base: number,
    w: number,
    o: { grow?: number; ghost?: number; crack?: number; alpha?: number; seed?: number; color?: string } = {},
  ) {
    const a = o.alpha ?? 1;
    const grow = o.grow ?? 1;
    if (a <= 0 || grow <= 0) return;
    const th = this.th;
    const c = this.c;
    const ghost = o.ghost ?? 0;
    const crack = o.crack ?? 0;
    const y0 = lerp(base, top, grow);
    const color = o.color ?? th.yellow;
    this.box(x - w / 2 - 7, base - 7, w + 14, 9, { r: 3, fill: th.lineStrong, alpha: a });
    const solidA = a * (1 - ghost);
    const body = (ya: number, yb: number) => {
      if (solidA > 0) {
        const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        g.addColorStop(0, th.yellowDeep);
        g.addColorStop(0.4, color);
        g.addColorStop(1, th.yellowDeep);
        this.ga(solidA);
        c.fillStyle = g;
        c.fillRect(x - w / 2, ya, w, yb - ya);
        this.ga(solidA * 0.22);
        c.fillStyle = th.ink;
        c.fillRect(x - w * 0.18, ya, 1.2, yb - ya);
        c.fillRect(x + w * 0.16, ya, 1.2, yb - ya);
      }
      if (ghost > 0) {
        this.ga(a * ghost);
        c.setLineDash([5, 4]);
        c.strokeStyle = th.faint;
        c.lineWidth = 1.5;
        c.strokeRect(x - w / 2, ya, w, yb - ya);
        c.setLineDash([]);
      }
    };
    if (crack > 0) {
      const breakY = lerp(y0, base, 0.34);
      const gap = 9 * crack;
      body(breakY + gap, base - 6);
      body(y0, breakY - gap * 0.2);
      /* the jagged break */
      const R = rng(o.seed ?? 7);
      this.ga(a * crack);
      c.beginPath();
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const px = x - w / 2 - 2 + ((w + 4) * i) / steps;
        const py = breakY + gap * 0.4 + (R() - 0.5) * 9;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.strokeStyle = th.red;
      c.lineWidth = 2;
      c.stroke();
    } else {
      body(y0, base - 6);
    }
    if (solidA > 0 && grow > 0.9) {
      this.box(x - w / 2 - 4, y0 - 3, w + 8, 7, { r: 2, fill: th.yellowDeep, alpha: solidA });
    }
  }

  protected book(cx: number, cy: number, w: number, h: number, title: string, a = 1) {
    if (a <= 0) return;
    const th = this.th;
    this.box(cx - w / 2 + 3, cy - h / 2 + 4, w, h, { r: 7, fill: th.lineStrong, alpha: a });
    this.box(cx - w / 2, cy - h / 2, w, h, { r: 7, fill: th.cardAlt, stroke: th.lineStrong, alpha: a, shadow: true });
    this.box(cx - w / 2, cy - h / 2, 9, h, { r: 4, fill: th.yellow, alpha: a });
    this.para(title, cx - w / 2 + 18, cy - h / 2 + 11, w - 26, { size: 12, weight: 650, alpha: a });
    this.box(cx - w / 2 + 18, cy + h / 2 - 20, w * 0.5, 2.5, { r: 1, fill: th.lineStrong, alpha: a });
    this.box(cx - w / 2 + 18, cy + h / 2 - 13, w * 0.34, 2.5, { r: 1, fill: th.lineStrong, alpha: a });
  }

  protected orb(cx: number, cy: number, r: number, a = 1, label?: string) {
    if (a <= 0) return;
    const c = this.c;
    const th = this.th;
    this.glow(cx, cy, r * 2.4, th.yellow, a * 0.3);
    const g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.55, th.yellow);
    g.addColorStop(1, th.yellowDeep);
    this.ga(a);
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fillStyle = g;
    c.fill();
    if (label) {
      this.text(label, cx, cy + r + 15, {
        size: 10.5,
        weight: 650,
        mono: true,
        color: th.muted,
        align: 'center',
        alpha: a,
      });
    }
  }

  protected person(cx: number, cy: number, r: number, a = 1, label?: string, color?: string) {
    if (a <= 0) return;
    const c = this.c;
    const th = this.th;
    const col = color ?? th.muted;
    this.ga(a);
    c.fillStyle = col;
    c.beginPath();
    c.arc(cx, cy - r * 0.55, r * 0.46, 0, TAU);
    c.fill();
    c.beginPath();
    c.moveTo(cx - r * 0.86, cy + r * 0.8);
    c.quadraticCurveTo(cx - r * 0.82, cy + r * 0.02, cx, cy + r * 0.02);
    c.quadraticCurveTo(cx + r * 0.82, cy + r * 0.02, cx + r * 0.86, cy + r * 0.8);
    c.closePath();
    c.fill();
    if (label) {
      this.text(label, cx, cy + r + 16, {
        size: 10.5,
        weight: 650,
        mono: true,
        color: th.muted,
        align: 'center',
        alpha: a,
      });
    }
  }

  protected lock(x: number, y: number, p: number, color?: string) {
    if (p <= 0) return;
    const c = this.c;
    const k = E.back(clamp(p));
    const col = color ?? this.th.ink;
    c.save();
    c.translate(x, y);
    c.scale(k, k);
    this.ga(clamp(p * 2));
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, -3, 4.4, Math.PI, 0);
    c.stroke();
    c.fillStyle = col;
    this.rr(-6.5, -3, 13, 10, 2.5);
    c.fill();
    c.restore();
  }

  protected fieldRow(
    x: number,
    y: number,
    w: number,
    key: string,
    val: string,
    o: { mark?: number; color?: string; alpha?: number; bg?: string; size?: number } = {},
  ) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const th = this.th;
    const size = o.size ?? 14;
    if (o.mark && o.mark > 0) {
      this.box(x - 6, y - 1, (w + 12) * o.mark, 39, { r: 7, fill: o.bg ?? th.yellow, alpha: a * 0.38 });
    } else if (o.bg) {
      this.box(x - 6, y - 1, w + 12, 39, { r: 7, fill: o.bg, alpha: a * 0.16 });
    }
    this.text(key, x, y + 3, { size: 9.5, weight: 700, mono: true, color: th.faint, base: 'top', alpha: a });
    this.text(val, x, y + 16, {
      size,
      weight: 620,
      mono: true,
      color: o.color ?? th.ink,
      base: 'top',
      alpha: a,
    });
  }

  protected cardHead(x: number, y: number, w: number, title: string, a = 1, mono = true) {
    this.text(title, x + 14, y + 13, {
      size: 11,
      weight: 700,
      mono,
      color: this.th.muted,
      base: 'top',
      alpha: a,
    });
    this.box(x + 1, y + 32, w - 2, 1, { r: 0, fill: this.th.line, alpha: a });
  }

  /** The mascot: a rounded triangle with a face, built from shapes so it stays sharp at any size. */
  protected triangle(cx: number, apexY: number, baseY: number, hw: number, clock: number) {
    const c = this.c;
    const th = this.th;
    const legY = baseY - 2;
    const shoeY = baseY + 22;
    this.ga(1);
    [-1, 1].forEach((side) => {
      const x = cx + side * hw * 0.3;
      this.box(x - hw * 0.05, legY, hw * 0.1, shoeY - legY, { fill: '#d99a00' });
      c.beginPath();
      c.ellipse(x + side * hw * 0.04, shoeY, hw * 0.2, hw * 0.085, 0, 0, TAU);
      c.fillStyle = '#ffffff';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = th.lineStrong;
      c.stroke();
    });
    const r = hw * 0.24;
    const g = c.createLinearGradient(0, apexY, 0, baseY);
    g.addColorStop(0, '#ffe066');
    g.addColorStop(1, '#f5b700');
    c.beginPath();
    c.moveTo((cx + cx + hw) / 2, (apexY + baseY) / 2);
    c.arcTo(cx + hw, baseY, cx - hw, baseY, r);
    c.arcTo(cx - hw, baseY, cx, apexY, r);
    c.arcTo(cx, apexY, cx + hw, baseY, r * 0.7);
    c.closePath();
    c.fillStyle = g;
    c.fill();
    /* the face looks towards the context coming in */
    const eyeY = apexY + (baseY - apexY) * 0.52;
    const blink = clock % 4.6 < 0.13;
    const look = Math.sin(clock * 0.7) * hw * 0.015 - hw * 0.012;
    [-1, 1].forEach((side) => {
      const x = cx + side * hw * 0.25;
      c.lineCap = 'round';
      c.strokeStyle = '#3f2d00';
      c.lineWidth = Math.max(1.4, hw * 0.028);
      c.beginPath();
      c.arc(x, eyeY - hw * 0.1, hw * 0.13, Math.PI * 1.2, Math.PI * 1.8);
      c.stroke();
      if (blink) {
        c.beginPath();
        c.moveTo(x - hw * 0.12, eyeY);
        c.lineTo(x + hw * 0.12, eyeY);
        c.stroke();
        return;
      }
      c.beginPath();
      c.ellipse(x, eyeY, hw * 0.135, hw * 0.175, 0, 0, TAU);
      c.fillStyle = '#ffffff';
      c.fill();
      c.beginPath();
      c.arc(x + look, eyeY + hw * 0.015, hw * 0.095, 0, TAU);
      c.fillStyle = '#2563eb';
      c.fill();
      c.beginPath();
      c.arc(x + look, eyeY + hw * 0.015, hw * 0.055, 0, TAU);
      c.fillStyle = '#0b1220';
      c.fill();
      c.beginPath();
      c.arc(x + look - hw * 0.03, eyeY - hw * 0.03, hw * 0.024, 0, TAU);
      c.fillStyle = '#ffffff';
      c.fill();
    });
    const mouthY = eyeY + hw * 0.25;
    c.beginPath();
    c.arc(cx, mouthY - hw * 0.04, hw * 0.15, Math.PI * 0.08, Math.PI * 0.92);
    c.closePath();
    c.fillStyle = '#7f1d1d';
    c.fill();
    c.save();
    c.clip();
    c.beginPath();
    c.ellipse(cx, mouthY + hw * 0.1, hw * 0.09, hw * 0.06, 0, 0, TAU);
    c.fillStyle = '#ef4444';
    c.fill();
    c.restore();
  }
}
