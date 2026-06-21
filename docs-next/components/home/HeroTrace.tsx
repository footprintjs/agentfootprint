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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(STEPS.length);
      setAsking(true);
      return;
    }
    let i = 0;
    const tick = () => {
      if (i < STEPS.length) {
        i += 1;
        setShown(i);
        timer.current = setTimeout(tick, 720);
      } else {
        setAsking(true);
        timer.current = setTimeout(() => {
          // reset and loop
          setAsking(false);
          setShown(0);
          i = 0;
          timer.current = setTimeout(tick, 700);
        }, 2800);
      }
    };
    timer.current = setTimeout(tick, 450);
    return () => clearTimeout(timer.current);
  }, []);

  const last = shown > 0 ? STEPS[shown - 1] : null;

  return (
    <div className="af-trace af-flowwrap" role="img" aria-label="A live agent run recording itself, ending in a wrong refund approval.">
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
