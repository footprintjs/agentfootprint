'use client';

import { useEffect, useRef } from 'react';
import { COPY } from './copy';
import type { Film } from './film';
import { T } from './timeline';

const FROM = T.uniA + 0.85;

/** The last shot of the home film, on its own: context in, answer out, and the notes it leaves. Loads when it is near. */
export function StandUniverse() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const canvas = el?.querySelector('canvas');
    if (!el || !canvas) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let film: Film | null = null;
    let raf = 0;
    let start = 0;
    let visible = false;
    let cancelled = false;

    const size = () => {
      if (!film) return;
      const r = el.getBoundingClientRect();
      film.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2), { still: true, portrait: r.width < 560 });
    };
    const frame = (now: number) => {
      if (!film || !visible) return;
      if (!start) start = now;
      const t = still ? T.end : Math.min(T.end, FROM + ((now - start) / 1000) * 0.62);
      film.draw(t, now / 1000);
      if (!still) raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry!.isIntersecting;
        if (!visible) return;
        if (film) {
          run();
          return;
        }
        void import('./film').then(({ Film: Engine }) => {
          if (cancelled) return;
          film = new Engine(canvas, COPY.technical.labels);
          film.readPalette(el);
          size();
          run();
        });
      },
      { rootMargin: '200px 0px' },
    );
    io.observe(el);
    const ro = new ResizeObserver(() => {
      size();
      if (visible) run();
    });
    ro.observe(el);
    const mo = new MutationObserver(() => {
      film?.readPalette(el);
      if (visible) run();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div
      ref={root}
      className="su"
      role="img"
      aria-label="AgentFootprint in one picture. Skills, steering, memory, RAG, tools and policies go in. The agent composes them into the system, messages and tools it sends the model. The model's answer stands on the STAND pattern, on top of the agent, and every step leaves a connected note in the record kept by FootprintJS."
    >
      <canvas aria-hidden="true" />
    </div>
  );
}
