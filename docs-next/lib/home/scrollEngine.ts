/**
 * One scroll engine for the whole home page.
 *
 * Every scrollytelling chapter used to attach its OWN `window.addEventListener('scroll')` +
 * requestAnimationFrame + getBoundingClientRect → setState (9 listeners, ~13 layout reads per
 * frame, ~6 verbatim copies of the same `-rect.top / total` math). That fans a single scroll
 * frame into many independent layout reads and React renders — the structural cause of jank.
 *
 * This collapses all of it into ONE passive scroll listener + ONE rAF loop + ONE ResizeObserver.
 * Each subscriber's geometry (document-relative top, scrollable span) is cached and only
 * recomputed on resize, so the hot path does ZERO getBoundingClientRect per frame — it derives
 * progress from `window.scrollY` against the cached numbers. Mirrors footprint's own principle:
 * read layout once, never re-walk on the hot path.
 *
 * Consumers use the `useScrollProgress` hook (./useScrollProgress); they never touch this directly.
 */

type Subscriber = {
  el: HTMLElement;
  top: number; // document-relative top of the pinned track
  total: number; // scrollable span = offsetHeight - innerHeight
  cb: (progress: number) => void;
};

const subs = new Set<Subscriber>();
let rafId = 0;
let started = false;

function progressOf(s: Subscriber, scrollY: number): number {
  if (s.total <= 0) return 0;
  const p = (scrollY - s.top) / s.total;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

function measure(s: Subscriber): void {
  // the ONLY getBoundingClientRect calls — at register + on resize, never per scroll frame
  const rect = s.el.getBoundingClientRect();
  s.top = rect.top + window.scrollY;
  s.total = s.el.offsetHeight - window.innerHeight;
}

function frame(): void {
  rafId = 0;
  const scrollY = window.scrollY;
  for (const s of subs) s.cb(progressOf(s, scrollY));
}

function schedule(): void {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function remeasureAll(): void {
  for (const s of subs) measure(s);
  schedule();
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', remeasureAll);
  // catch layout changes that don't fire 'resize': fonts, lazy content, images, reflow.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(remeasureAll).observe(document.documentElement);
  }
}

/**
 * Register a pinned track. `cb(progress)` is called with 0..1 once immediately and then on every
 * scroll/resize frame. Returns an unsubscribe function.
 */
export function registerScroll(el: HTMLElement, cb: (progress: number) => void): () => void {
  start();
  const s: Subscriber = { el, top: 0, total: 0, cb };
  measure(s);
  subs.add(s);
  cb(progressOf(s, typeof window === 'undefined' ? 0 : window.scrollY)); // seed initial state
  return () => {
    subs.delete(s);
  };
}
