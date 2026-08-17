'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live "trace" hero visual — a compact, product-representative animation: a real run
 * recording itself step by step (classify → retrieve → check → decide → approved ✗),
 * tally ticking up, then a "↶ why?" prompt — the whole thesis in 4 lines. Loops.
 * Gives the homepage the "live product" energy a static hero lacks (cf. cocoindex.io).
 */

type Step = { t: string; r: string; bad?: boolean; steps: number; tok: number; ms: number };
const STEPS: Step[] = [
  { t: 'classify', r: 'refund', steps: 3, tok: 210, ms: 320 },
  { t: 'retrieve', r: 'policy doc', steps: 6, tok: 540, ms: 760 },
  { t: 'check', r: 'continue', steps: 9, tok: 820, ms: 1180 },
  { t: 'decide', r: 'approved ✗', bad: true, steps: 14, tok: 1280, ms: 2270 },
];

export function HeroTrace() {
  const [shown, setShown] = useState(0); // number of steps revealed
  const [asking, setAsking] = useState(false); // the "why?" prompt
  const [isInViewport, setIsInViewport] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const element = root.current;
    if (!element || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInViewport(entry.isIntersecting),
      { rootMargin: '200px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setIsPageVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(STEPS.length);
      setAsking(true);
      return;
    }

    if (!isInViewport || !isPageVisible) return;

    if (shown < STEPS.length) {
      timer.current = setTimeout(
        () => setShown((current) => Math.min(current + 1, STEPS.length)),
        shown === 0 ? 450 : 720,
      );
    } else if (!asking) {
      timer.current = setTimeout(() => setAsking(true), 720);
    } else {
      timer.current = setTimeout(() => {
        setAsking(false);
        setShown(0);
      }, 2800);
    }

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    };
  }, [asking, isInViewport, isPageVisible, shown]);

  const last = shown > 0 ? STEPS[shown - 1] : null;

  return (
    <div
      ref={root}
      className="af-trace af-flowwrap"
      role="img"
      aria-label="A live agent run recording itself, ending in a wrong refund approval."
    >
      <div className="af-trace-head">
        <span className="af-trace-name">refunds-agent</span>
        <span className="af-trace-rec">
          <span className="af-trace-dot" />
          recording
        </span>
      </div>
      <div className="af-trace-log">
        {STEPS.map((s, idx) => (
          <div key={s.t} className={`af-trace-ln${idx < shown ? ' in' : ''}${s.bad ? ' bad' : ''}`}>
            <span className="af-trace-i">{String(idx + 1).padStart(2, '0')}</span>
            <span className="af-trace-step">{s.t}</span>
            <span className="af-trace-arr">→</span>
            <span className="af-trace-res">{s.r}</span>
          </div>
        ))}
      </div>
      <div className="af-trace-foot">
        <span className="af-trace-tally">
          <b>{last ? last.steps : 0}</b> steps · <b>{last ? last.tok.toLocaleString() : 0}</b> tok ·{' '}
          <b>{last ? last.ms.toLocaleString() : 0}</b> ms
        </span>
        <span className={`af-trace-why${asking ? ' in' : ''}`}>↶ why?</span>
      </div>
    </div>
  );
}
