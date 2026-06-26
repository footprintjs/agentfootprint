'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAPTERS_META as CHAPTERS } from '@/lib/chapters';

/**
 * Home-only sticky chapter rail — a jump-nav under the shared top bar so readers can go
 * straight to a chapter without scrolling through every tall pinned animation. The active
 * link doubles as a "you are here / N of 5" progress indicator. Lives only on the home
 * surface, so it never touches the docs nav/sidebar/search.
 *
 * CLICK BEHAVIOUR — a plain, instant anchor jump, nothing more.
 * Each link is a real <a href="#id">; the browser jumps instantly to that chapter and
 * html { scroll-padding-top } lands it clear of the sticky nav + rail. We deliberately do
 * NOT drive the scroll from JS: an auto-scroll "play this chapter for you" tween moved the
 * page under the reader and fought their own scrolling (it lurched on any wheel/touch). So
 * the rule is simple and conflict-free: clicking takes you to the chapter, then YOU scroll —
 * and the animation plays as you scroll, the way the rest of the page already works.
 */
export function ChapterRail() {
  const [active, setActive] = useState(CHAPTERS[0]?.id ?? '');
  const railRef = useRef<HTMLElement>(null);

  // scroll-spy: the active chapter is the last section whose top has passed the rail's bottom edge.
  useEffect(() => {
    const sections = CHAPTERS.map((c) => document.getElementById(c.id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = (railRef.current?.getBoundingClientRect().bottom ?? 96) + 8;
        let cur = sections[0].id;
        for (const s of sections) {
          if (s.getBoundingClientRect().top <= line) cur = s.id;
        }
        setActive((prev) => (prev === cur ? prev : cur));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // keep the active pill centered when the rail overflows (mobile) — scrolls ONLY the rail,
  // never the page.
  useEffect(() => {
    const inner = railRef.current?.querySelector<HTMLElement>('.af-chaprail-inner');
    const link = inner?.querySelector<HTMLElement>(`a[data-id="${active}"]`);
    if (inner && link && inner.scrollWidth > inner.clientWidth) {
      inner.scrollTo({ left: link.offsetLeft - inner.clientWidth / 2 + link.clientWidth / 2, behavior: 'smooth' });
    }
  }, [active]);

  return (
    <nav className="af-chaprail" aria-label="Chapters" ref={railRef}>
      <div className="af-chaprail-inner">
        {CHAPTERS.map((c) => (
          <a
            key={c.id}
            href={`#${c.id}`}
            data-id={c.id}
            className={active === c.id ? 'on' : ''}
            aria-current={active === c.id ? 'true' : undefined}
          >
            <b>{c.ix}</b>
            {/* rail shows the CATEGORY as a table-of-contents label (The problem, The solution, …);
                the per-chapter heading bar owns the full title. Splitting them this way means the
                chapter title never appears twice on screen at once (rail = where you are, bar = the
                headline). Keep in sync with the bar in Chapters.tsx. */}
            <span>{c.cat}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
