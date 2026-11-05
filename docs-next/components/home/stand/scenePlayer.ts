/**
 * One scene, played in place beside its text. The page scrolls normally: a scene runs once when
 * enough of it is showing, then holds its last frame, so nothing keeps moving beside what you are
 * reading. Reduced motion holds that last frame from the start.
 */
import type { FilmEngine } from './live';

/* The pace the films run at when they play themselves. */
const BEATS_PER_SECOND = 1 / 1.9;
/* How much of a scene has to be showing before it starts. */
const SHOWING = 0.5;
/* The width the scenes switch to their tall layout. stand.css shapes the frame at the same width. */
const TALL = '(max-width: 620px)';

export class ScenePlayer<L> {
  private u: number;
  private clock = 0;
  private last = 0;
  private running = false;
  private done = false;
  private gone = false;
  private cleanups: (() => void)[] = [];

  constructor(
    private frame: HTMLElement,
    private film: FilmEngine<L>,
    private scene: { readonly from: number; readonly to: number },
  ) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.u = reduced ? scene.to : scene.from;
    if (reduced) {
      this.clock = 50;
      this.done = true;
    }
    film.readPalette(frame);
    this.measure();

    const ro = new ResizeObserver(() => this.measure());
    ro.observe(frame);
    this.cleanups.push(() => ro.disconnect());

    /* the theme switch repaints the canvas */
    const mo = new MutationObserver(() => {
      film.readPalette(frame);
      this.paint();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    this.cleanups.push(() => mo.disconnect());

    /* a held frame never redraws by itself, so it picks up the web font here */
    void document.fonts?.ready.then(() => {
      if (this.gone) return;
      film.readPalette(frame);
      this.paint();
    });

    if (reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting) this.running = false;
        else if (entry.intersectionRatio >= SHOWING) this.play();
      },
      { threshold: [0, SHOWING] },
    );
    io.observe(frame);
    this.cleanups.push(() => io.disconnect());

    const replay = frame.querySelector('[data-scene-replay]');
    const onReplay = () => {
      this.u = scene.from;
      this.done = false;
      frame.classList.remove('is-done');
      this.play();
    };
    replay?.addEventListener('click', onReplay);
    this.cleanups.push(() => replay?.removeEventListener('click', onReplay));
  }

  setLabels(labels: L) {
    this.film.setLabels(labels);
    this.paint();
  }

  destroy() {
    this.gone = true;
    this.running = false;
    this.cleanups.forEach((fn) => fn());
  }

  private measure() {
    const W = this.frame.clientWidth;
    const H = this.frame.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.film.resize(W, H, dpr, { still: true, portrait: window.matchMedia(TALL).matches });
    this.paint();
  }

  private paint() {
    this.film.draw(this.u, this.clock);
  }

  private play() {
    if (this.done || this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.u = Math.min(this.scene.to, this.u + dt * BEATS_PER_SECOND);
    this.paint();
    if (this.u < this.scene.to) {
      requestAnimationFrame(this.tick);
      return;
    }
    this.running = false;
    this.done = true;
    this.frame.classList.add('is-done');
  };
}
