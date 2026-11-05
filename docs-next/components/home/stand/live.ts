/**
 * The two ways the film runs.
 *
 * LiveFilm pins the stage and treats the scroll position as the cursor.
 * StillFilm, for reduced motion, holds one frame under each caption, in reading order.
 * With no JavaScript at all the page is the hero and the captions, as plain text.
 */
import type { ResizeOpts } from './stage';

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export interface FilmController<L> {
  setLabels(labels: L): void;
  destroy(): void;
}

/** What a film has to be able to do for this to run it. */
export interface FilmEngine<L> {
  draw(t: number, clock: number): void;
  resize(W: number, H: number, dpr: number, o?: ResizeOpts): void;
  readPalette(el: Element): void;
  setLabels(labels: L): void;
}

/** One film: how to make its engine, how long it runs, and when each caption shows. */
export interface FilmSpec<L> {
  make(canvas: HTMLCanvasElement, labels: L): FilmEngine<L>;
  readonly end: number;
  readonly chapters: readonly (readonly [string, number, number])[];
  readonly stills: Readonly<Record<string, number>>;
}

export class LiveFilm<L> implements FilmController<L> {
  readonly film: FilmEngine<L>;
  readonly stage: HTMLElement;
  running = false;
  t = 0;
  playing = false;
  private canvas: HTMLCanvasElement;
  private caps: HTMLElement[];
  private hero: HTMLElement | null;
  private lit: HTMLElement[];
  private stops: { el: HTMLElement; at: number }[];
  private target = 0;
  private startAt = performance.now();
  private last = this.startAt;
  private lastChapter: string | null = null;
  private scrollable = 1;
  private rootTop = 0;
  private cleanups: (() => void)[] = [];
  private clockNow = 0;

  constructor(private root: HTMLElement, labels: L, private spec: FilmSpec<L>) {
    root.classList.add('is-live');
    root.style.setProperty('--sf-beats', String(spec.end));
    this.stage = root.querySelector<HTMLElement>('.sf-stage')!;
    this.canvas = root.querySelector<HTMLCanvasElement>('.sf-canvas')!;
    this.caps = Array.from(root.querySelectorAll<HTMLElement>('.sf-cap'));
    this.hero = root.querySelector<HTMLElement>('.sf-hero');
    this.lit = Array.from(root.querySelectorAll<HTMLElement>('[data-lit]'));
    this.stops = Array.from(root.querySelectorAll<HTMLElement>('.sf-stop')).map((el) => ({
      el,
      at: Number(el.dataset.at),
    }));
    this.film = spec.make(this.canvas, labels);
    this.film.readPalette(root);
    this.measure();
    this.t = this.target = this.readScroll();
    this.bind();
    const io = new IntersectionObserver((entries) => {
      const on = entries[0]?.isIntersecting ?? false;
      if (on && !this.running) {
        this.running = true;
        this.last = performance.now();
        requestAnimationFrame(this.frame);
      }
      if (!on) this.running = false;
    });
    io.observe(this.stage);
    this.cleanups.push(() => io.disconnect());
    this.syncDom(this.t);
  }

  setLabels(labels: L) {
    this.film.setLabels(labels);
  }

  destroy() {
    this.running = false;
    this.cleanups.forEach((fn) => fn());
    this.root.classList.remove('is-live', 'is-playing');
  }

  measure() {
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    const pinnedAt = parseFloat(getComputedStyle(this.stage).top) || 0;
    const portrait = W < 860 || W / H < 1.1;
    /* the stage pins below the site header, so only the film's own line, if it has one, sits above it */
    const head = this.lit.length ? (portrait ? 30 : 46) : 0;
    const capZone = portrait ? clamp(H * 0.3, 172, 262) : 0;
    const gutter = clamp(W * 0.035, 14, 56);
    const capW = portrait ? 0 : clamp(W * 0.3, 290, 440);
    const s = this.stage.style;
    s.setProperty('--cap-w', `${capW}px`);
    s.setProperty('--cap-zone', `${capZone}px`);
    s.setProperty('--gutter', `${gutter}px`);
    s.setProperty('--head', `${head}px`);
    this.stage.classList.toggle('is-portrait', portrait);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.film.resize(W, H, dpr, { head, capZone, gutter, capW, rail: 54, portrait });
    this.scrollable = Math.max(1, this.root.offsetHeight - H);
    this.rootTop = this.root.getBoundingClientRect().top + window.scrollY - pinnedAt;
  }

  readScroll() {
    return clamp((window.scrollY - this.rootTop) / this.scrollable, 0, 1) * this.spec.end;
  }

  seek(t: number) {
    window.scrollTo({
      top: this.rootTop + (clamp(t, 0, this.spec.end) / this.spec.end) * this.scrollable,
      behavior: 'instant' as ScrollBehavior,
    });
  }

  play() {
    if (this.readScroll() > this.spec.end - 0.05) this.seek(0);
    this.playing = true;
    this.root.classList.add('is-playing');
    this.syncPlay();
  }

  pause() {
    this.playing = false;
    this.root.classList.remove('is-playing');
    this.syncPlay();
  }

  private syncPlay() {
    this.root.querySelectorAll<HTMLElement>('[data-film-play]').forEach((b) => {
      b.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
      const label = b.querySelector('[data-play-label]');
      if (label) label.textContent = this.playing ? 'Pause' : b.dataset.playIdle ?? 'Play';
    });
  }

  private bind() {
    const listen = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, fn, opts);
      this.cleanups.push(() => window.removeEventListener(type, fn, opts));
    };
    let timer = 0;
    listen(
      'resize',
      () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.measure(), 120);
      },
      { passive: true },
    );
    const ro = new ResizeObserver(() => this.measure());
    ro.observe(this.stage);
    this.cleanups.push(() => ro.disconnect());

    const stop = () => {
      if (this.playing) this.pause();
    };
    listen('wheel', stop, { passive: true });
    listen('touchstart', stop, { passive: true });
    listen('keydown', (e) => {
      if (
        this.playing &&
        [' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)
      )
        this.pause();
    });

    const onClick = (e: Event) => {
      const el = e.target as HTMLElement;
      const play = el.closest<HTMLElement>('[data-film-play]');
      if (play) {
        if (this.playing) this.pause();
        else this.play();
        return;
      }
      const stopEl = el.closest<HTMLElement>('.sf-stop');
      if (stopEl) {
        this.pause();
        this.seek(Number(stopEl.dataset.at));
      }
    };
    this.root.addEventListener('click', onClick);
    this.cleanups.push(() => this.root.removeEventListener('click', onClick));

    /* drag along the rail to scrub */
    const track = this.root.querySelector<HTMLElement>('.sf-track');
    if (track) {
      const toT = (e: PointerEvent) => {
        const r = track.getBoundingClientRect();
        return (clamp(e.clientX - r.left, 0, r.width) / r.width) * this.spec.end;
      };
      let down = false;
      const onDown = (e: PointerEvent) => {
        if ((e.target as HTMLElement).closest('.sf-stop')) return;
        down = true;
        track.setPointerCapture(e.pointerId);
        this.pause();
        this.seek(toT(e));
      };
      const onMove = (e: PointerEvent) => {
        if (down) this.seek(toT(e));
      };
      const onUp = () => {
        down = false;
      };
      track.addEventListener('pointerdown', onDown);
      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onUp);
      track.addEventListener('pointercancel', onUp);
      this.cleanups.push(() => {
        track.removeEventListener('pointerdown', onDown);
        track.removeEventListener('pointermove', onMove);
        track.removeEventListener('pointerup', onUp);
        track.removeEventListener('pointercancel', onUp);
      });
    }

    /* the theme switch repaints the canvas */
    const mo = new MutationObserver(() => this.film.readPalette(this.root));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    this.cleanups.push(() => mo.disconnect());
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const clock = (this.clockNow = (now - this.startAt) / 1000);
    if (this.playing) {
      const speed = this.scrollable / (this.spec.end * 1.9);
      const next = window.scrollY + speed * dt;
      window.scrollTo({ top: next, behavior: 'instant' as ScrollBehavior });
      if (next >= this.rootTop + this.scrollable - 1) this.pause();
    }
    this.target = this.readScroll();
    this.t += (this.target - this.t) * (1 - Math.exp(-dt / 0.085));
    if (Math.abs(this.target - this.t) < 0.0008) this.t = this.target;
    this.film.draw(this.t, clock);
    this.syncDom(this.t);
    requestAnimationFrame(this.frame);
  };

  /** Draw one exact frame. The video renderer drives this with a virtual clock. */
  renderAt(t: number, clock: number) {
    this.t = t;
    this.film.draw(t, clock);
    this.syncDom(t);
  }

  get clock() {
    return this.clockNow;
  }

  syncDom(t: number) {
    let chapter: string | null = null;
    for (const [id, a, b] of this.spec.chapters) if (t >= a && t < b) chapter = id;
    if (chapter !== this.lastChapter) {
      this.lastChapter = chapter;
      this.caps.forEach((cap) => cap.classList.toggle('on', cap.dataset.chapter === chapter));
      this.hero?.classList.toggle('on', chapter === 'hero');
      this.root.dataset.chapter = chapter ?? '';
      this.lit.forEach((el) =>
        el.classList.toggle('lit', (el.dataset.lit ?? '').split(' ').includes(chapter ?? '')),
      );
    }
    const end = this.spec.chapters.find(([id]) => id === chapter)?.[2] ?? 1e9;
    this.caps
      .find((cap) => cap.dataset.chapter === chapter)
      ?.classList.toggle('handoff', t > end - 0.78);
    this.root.style.setProperty('--sf-p', (t / this.spec.end).toFixed(4));
    this.root.style.setProperty('--sf-t', t.toFixed(3));
    let current = -1;
    this.stops.forEach((s, i) => {
      if (t >= s.at - 0.14) current = i;
    });
    this.stops.forEach((s, i) => {
      s.el.classList.toggle('on', i === current);
      s.el.classList.toggle('past', i < current);
    });
  }
}

export class StillFilm<L> implements FilmController<L> {
  private buffer = document.createElement('canvas');
  private film: FilmEngine<L>;
  private frames: { canvas: HTMLCanvasElement; chapter: string }[] = [];
  private cleanups: (() => void)[] = [];

  constructor(private root: HTMLElement, labels: L, private spec: FilmSpec<L>) {
    root.classList.add('is-still');
    this.film = spec.make(this.buffer, labels);
    this.film.readPalette(root);
    root.querySelectorAll<HTMLElement>('.sf-cap').forEach((cap) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'sf-cap-still';
      canvas.setAttribute('aria-hidden', 'true');
      cap.appendChild(canvas);
      this.frames.push({ canvas, chapter: cap.dataset.chapter ?? '' });
    });
    this.render();
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => this.render(), 160);
    };
    window.addEventListener('resize', onResize, { passive: true });
    this.cleanups.push(() => window.removeEventListener('resize', onResize));
    const mo = new MutationObserver(() => {
      this.film.readPalette(this.root);
      this.render();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    this.cleanups.push(() => mo.disconnect());
  }

  setLabels(labels: L) {
    this.film.setLabels(labels);
    this.render();
  }

  destroy() {
    this.cleanups.forEach((fn) => fn());
    this.frames.forEach(({ canvas }) => canvas.remove());
    this.root.classList.remove('is-still');
  }

  private render() {
    const width = Math.min(this.root.clientWidth || 800, 980);
    const W = Math.max(320, width);
    const portrait = W < 620;
    const H = portrait ? W * 1.32 : W * 0.72;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.film.resize(W, H, dpr, { still: true, portrait });
    this.frames.forEach(({ canvas, chapter }) => {
      canvas.width = this.buffer.width;
      canvas.height = this.buffer.height;
      canvas.style.aspectRatio = `${W} / ${H}`;
      this.film.draw(this.spec.stills[chapter] ?? this.spec.end, 50);
      canvas.getContext('2d')?.drawImage(this.buffer, 0, 0);
    });
  }
}

export function bootFilm<L>(
  root: HTMLElement,
  labels: L,
  spec: FilmSpec<L>,
): FilmController<L> | null {
  if (!document.createElement('canvas').getContext) return null;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const inst = reduced ? new StillFilm(root, labels, spec) : new LiveFilm(root, labels, spec);
  /* The video renderer and the browser console can reach the running film here. */
  (window as unknown as { __standFilm?: FilmController<L> }).__standFilm = inst;
  return inst;
}
