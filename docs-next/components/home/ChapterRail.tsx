'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAPTERS_META as CHAPTERS } from '@/lib/chapters';

/**
 * Home-only sticky chapter rail — a jump-nav under the shared top bar so readers can go
 * straight to a chapter without scrolling through every tall pinned animation. The active
 * link doubles as a "you are here / N of 5" progress indicator. Lives only on the home
 * surface, so it never touches the docs nav/sidebar/search.
 *
 * CLICK BEHAVIOUR — "jump, then play just that chapter":
 * The animations are scroll-driven — each chapter's progress is a function of how far its
 * own tall pinned track has scrolled past the top (see usePinProgress in the chapter files).
 * So instead of a plain anchor jump (which lands at frame 0 and makes you scroll the whole
 * track by hand) OR a CSS smooth-scroll (which would animate THROUGH every chapter above the
 * target), we: (1) instant-jump to the target chapter's start = animation frame 0, then
 * (2) auto-tween the scroll position through ONLY that chapter's track, which plays its
 * animation start→finish in place. The viewer sees the clicked chapter animate; the chapters
 * in between are skipped, not scrolled. Any real input (wheel / touch / key) cancels the tween
 * instantly so we never fight the reader. prefers-reduced-motion → plain instant jump.
 */
export function ChapterRail() {
  const [active, setActive] = useState(CHAPTERS[0]?.id ?? '');
  const railRef = useRef<HTMLElement>(null);
  const tweenRaf = useRef(0);
  const cancelTween = useRef<(() => void) | null>(null);

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

  // keep the active pill centered when the rail overflows (mobile) — scrolls ONLY the rail.
  useEffect(() => {
    const inner = railRef.current?.querySelector<HTMLElement>('.af-chaprail-inner');
    const link = inner?.querySelector<HTMLElement>(`a[data-id="${active}"]`);
    if (inner && link && inner.scrollWidth > inner.clientWidth) {
      inner.scrollTo({ left: link.offsetLeft - inner.clientWidth / 2 + link.clientWidth / 2, behavior: 'smooth' });
    }
  }, [active]);

  // clean up any in-flight tween on unmount
  useEffect(() => () => cancelTween.current?.(), []);

  const playChapter = useCallback((id: string) => {
    const section = document.getElementById(id);
    if (!section) return;

    // cancel any tween already running (rapid clicks)
    cancelTween.current?.();

    const docTop = section.getBoundingClientRect().top + window.scrollY;
    const railH = railRef.current?.getBoundingClientRect().height ?? 40;
    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fd-nav-height')) || 56;
    const offset = navH + railH; // land the chapter header clear of the sticky nav + rail

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // frame 0 of this chapter's animation = its track sitting just under the sticky bars
    const start = Math.max(0, docTop - offset);
    // frame 1 = the chapter's whole track has scrolled past (its bottom meets the viewport bottom)
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const end = Math.min(maxScroll, docTop + section.offsetHeight - window.innerHeight);

    // reflect the chapter in the URL without the browser's own (instant, offset-less) jump
    history.replaceState(null, '', `#${id}`);

    if (reduce || end <= start) {
      window.scrollTo({ top: start, behavior: 'auto' });
      return;
    }

    // (1) instant-jump to frame 0, skipping every chapter above the target
    window.scrollTo({ top: start, behavior: 'auto' });

    // (2) tween the scroll through ONLY this chapter's track → its animation plays in place
    const distance = end - start;
    const duration = Math.min(7000, Math.max(2800, distance / 0.8)); // ~constant velocity, readable
    let t0 = 0;
    let cancelled = false;
    const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

    const stop = () => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(tweenRaf.current);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', stop);
      cancelTween.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      // any navigation key = the reader took over
      if (
        ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar'].includes(e.key)
      ) {
        stop();
      }
    };
    cancelTween.current = stop;
    // listen for real input only — our own scrollTo fires 'scroll' (not listened) but never these
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', stop, { passive: true });

    const tick = (now: number) => {
      if (cancelled) return;
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + distance * easeInOut(k));
      if (k < 1) {
        tweenRaf.current = requestAnimationFrame(tick);
      } else {
        stop();
      }
    };
    tweenRaf.current = requestAnimationFrame(tick);
  }, []);

  const onLink = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      // let modified / non-left clicks behave normally (new tab, etc.)
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      playChapter(id);
    },
    [playChapter],
  );

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
            onClick={(e) => onLink(e, c.id)}
          >
            <b>{c.ix}</b>
            <span>{c.ti}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
