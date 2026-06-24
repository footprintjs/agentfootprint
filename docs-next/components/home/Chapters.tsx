'use client';

import { useEffect, useRef, type ComponentType } from 'react';
import { BacktrackStory } from './chapters/BacktrackStory';
import { WhyThisTool } from './chapters/WhyThisTool';
import { ContextEngineering } from './chapters/ContextEngineering';
import { CoreEngine } from './chapters/CoreEngine';

// Chapter 2 = context engineering (slots × triggers) + "Why this tool?" — forward tool
// selection by description lives here, where building the context is the subject.
function ContextChapter() {
  return (
    <>
      <ContextEngineering />
      <WhyThisTool />
    </>
  );
}

/**
 * The three homepage chapters = the interactive storyboard (what → how → how-it's-
 * implemented). Each is a full-bleed section with a yellow "category" pill, an
 * alternating background, and a sticky bar that highlights in brand yellow when active.
 */
type Chapter = {
  id: string;
  ix: string;
  cat: string;
  ti: string;
  sub: string;
  Body?: ComponentType;
  stub?: string;
};

const CHAPTERS: Chapter[] = [
  { id: 'af-ch-problem', ix: '01', cat: 'What we solve', ti: 'The problem', sub: 'It approved a refund it should have denied — why?', Body: BacktrackStory },
  { id: 'af-ch-context', ix: '02', cat: 'How you build context', ti: 'Context engineering', sub: 'slots × triggers', Body: ContextChapter },
  { id: 'af-ch-core', ix: '03', cat: "How it's implemented", ti: 'The engine', sub: 'React Fiber for agents', Body: CoreEngine },
];

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
      { rootMargin: '-18% 0px -62% 0px', threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {CHAPTERS.map((c, i) => (
        <section className={`af-chapter${i % 2 === 1 ? ' alt' : ''}`} id={c.id} key={c.id}>
          <div className="af-chapter-inner">
            <div className="af-chapter-bar">
              <span className="ix">{c.ix}</span>
              <span className="af-cat">{c.cat}</span>
              <span className="ti">{c.ti}</span>
              <span className="sub">{c.sub}</span>
            </div>
            {c.Body ? <c.Body /> : <div className="af-chapter-stub">{c.stub}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}
