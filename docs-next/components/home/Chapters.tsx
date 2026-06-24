'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { BacktrackStory } from './chapters/BacktrackStory';
import { WhyThisTool } from './chapters/WhyThisTool';
import { ContextEngineering } from './chapters/ContextEngineering';
import { CoreEngine } from './chapters/CoreEngine';
import { SummaryChapter } from './chapters/SummaryChapter';
import { CHAPTERS_META, type ChapterMeta } from '@/lib/chapters';

/**
 * The homepage storyboard, told as a five-chapter arc: PROBLEM → SOLUTION → BENEFITS →
 * HOW → SUMMARY. Each is a full-bleed section with a category pill, an alternating
 * background, and a sticky bar that highlights in brand yellow when active. Read the
 * subtitles straight down and they form one sentence.
 *
 * The chapter DATA (ids/titles/subs) lives in lib/chapters.ts so the rail and the search
 * index share it; here we just bind each chapter to its animated Body component.
 */
type Chapter = ChapterMeta & { Body?: ComponentType; stub?: string };

const BODIES: Record<string, ComponentType> = {
  'af-ch-problem': BacktrackStory,
  'af-ch-solution': ContextEngineering,
  'af-ch-benefits': WhyThisTool,
  'af-ch-how': CoreEngine,
  'af-ch-payoff': SummaryChapter,
};

export const CHAPTERS: Chapter[] = CHAPTERS_META.map((c) => ({ ...c, Body: BODIES[c.id] }));

export function Chapters() {
  const ref = useRef<HTMLDivElement>(null);
  // the sticky bar's sub-line follows the section you're scrolling: any [data-narrative]
  // sub-section whose box holds the viewport center sets its chapter's sub (falls back to c.sub).
  const [activeSubs, setActiveSubs] = useState<Record<string, string>>({});

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
      { rootMargin: '-18% 0px -62% 0px', threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));

    // per-section narrative — center-of-viewport test (robust for the tall pinned tracks)
    const narrEls = Array.from(root.querySelectorAll<HTMLElement>('[data-narrative]'));
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = window.innerHeight / 2;
        const found: Record<string, string> = {};
        for (const el of narrEls) {
          const r = el.getBoundingClientRect();
          if (r.top <= center && r.bottom >= center) {
            const cid = el.closest('.af-chapter')?.id;
            const label = el.dataset.narrative;
            if (cid && label) found[cid] = label;
          }
        }
        setActiveSubs((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const cid in found) {
            if (next[cid] !== found[cid]) {
              next[cid] = found[cid];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref}>
      {CHAPTERS.map((c, i) => {
        const sub = activeSubs[c.id] ?? c.sub;
        return (
          <section className={`af-chapter${i % 2 === 1 ? ' alt' : ''}`} id={c.id} key={c.id}>
            <div className="af-chapter-inner">
              <div className="af-chapter-bar">
                <span className="ix">{c.ix}</span>
                <span className="af-cat">{c.cat}</span>
                <span className="ti">{c.ti}</span>
                <span className="sub" key={sub}>
                  {sub}
                </span>
              </div>
              {c.Body ? <c.Body /> : <div className="af-chapter-stub">{c.stub}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
