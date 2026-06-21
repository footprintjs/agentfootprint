'use client';

import { useEffect, useRef } from 'react';

/**
 * The three homepage chapters. Each has a sticky bar that pins under the nav as you
 * scroll; a scroll-spy highlights the in-view chapter's bar in the brand yellow.
 * (Chapter bodies are stubs until Phases 2–4 port the real animations.)
 */
const CHAPTERS = [
  { id: 'af-ch-problem', ix: '01', ti: 'The problem', sub: 'watch a run break', stub: 'backtrack-story → React component (Phase 2)' },
  { id: 'af-ch-context', ix: '02', ti: 'Context engineering', sub: 'build the context', stub: 'context-engineering → React component (Phase 3)' },
  { id: 'af-ch-core', ix: '03', ti: 'The engine', sub: 'record · reverse · prove', stub: 'core-engine → React component (Phase 4)' },
] as const;

export function Chapters() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('.af-chapter'));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          e.target.classList.toggle('is-active', e.isIntersecting);
        }
      },
      // "active" while the chapter's upper band sits in the viewport
      { rootMargin: '-18% 0px -62% 0px', threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {CHAPTERS.map((c) => (
        <section className="af-chapter" id={c.id} key={c.id}>
          <div className="af-chapter-bar">
            <span className="ix">{c.ix}</span>
            <span className="ti">{c.ti}</span>
            <span className="sub">{c.sub}</span>
          </div>
          <div className="af-chapter-stub">{c.stub}</div>
        </section>
      ))}
    </div>
  );
}
