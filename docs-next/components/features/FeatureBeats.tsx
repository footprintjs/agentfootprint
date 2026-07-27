'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { FEATURE_BEATS, type FeatureBeatId } from '@/lib/features/beats';
import { Beat } from './Beat';
import { BuildStage } from './stages/BuildStage';
import { TeachStage } from './stages/TeachStage';
import { RememberStage } from './stages/RememberStage';
import { SwapStage } from './stages/SwapStage';
import { WatchStage } from './stages/WatchStage';
import { AskStage } from './stages/AskStage';
import { WhyStage } from './stages/WhyStage';
import { SurviveStage } from './stages/SurviveStage';

/**
 * The eight beats, bound to their stages.
 *
 * TWO IntersectionObservers for the whole page (not per beat, and no scroll listeners here —
 * the per-beat step engine already shares ONE listener via lib/home/scrollEngine):
 *
 *  · `.is-active` — the beat you are reading. Turns its verb gold. The asymmetric rootMargin
 *    (top -20%, bottom -55%) narrows "active" to "occupying the upper-middle of the viewport", and
 *    then the callback picks EXACTLY ONE winner from whatever is in that band: at a beat boundary
 *    two sections legitimately straddle it, and two gold verbs would tell the reader they are in
 *    two places at once. The winner is the candidate whose top edge is nearest the reading line.
 *  · `.is-inview` — the beat is near the viewport. Until then features.css pauses every decorative
 *    @keyframes loop inside it, so eight off-screen stages cost zero animation work. Same gate the
 *    home page uses for its chapters (global.css `.af-chapter:not(.is-inview)`).
 */
// Keyed by the id UNION, not `string`: add a beat to beats.ts without a stage here and this object
// fails to typecheck, instead of rendering an empty panel.
const STAGES: Record<FeatureBeatId, (step: number) => ReactNode> = {
  build: (step) => <BuildStage step={step} />,
  teach: (step) => <TeachStage step={step} />,
  remember: (step) => <RememberStage step={step} />,
  swap: (step) => <SwapStage step={step} />,
  watch: (step) => <WatchStage step={step} />,
  ask: (step) => <AskStage step={step} />,
  why: (step) => <WhyStage step={step} />,
  survive: (step) => <SurviveStage step={step} />,
};

export function FeatureBeats() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const beats = Array.from(el.querySelectorAll<HTMLElement>('.aff-beat'));
    if (beats.length === 0) return;

    // candidates currently inside the reading band; the winner is derived, never accumulated
    const inBand = new Set<HTMLElement>();
    // the reading line: where in the viewport "the beat you're on" sits
    const READ_LINE = 0.22;

    const paintActive = () => {
      let winner: HTMLElement | null = null;
      let best = Infinity;
      for (const el of inBand) {
        const distance = Math.abs(el.getBoundingClientRect().top - window.innerHeight * READ_LINE);
        if (distance < best) {
          best = distance;
          winner = el;
        }
      }
      for (const b of beats) b.classList.toggle('is-active', b === winner);
    };

    const activeIo = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target as HTMLElement);
          else inBand.delete(e.target as HTMLElement);
        }
        paintActive();
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: 0 },
    );
    const inViewIo = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.classList.toggle('is-inview', e.isIntersecting);
      },
      { rootMargin: '60% 0px 60% 0px', threshold: 0 },
    );
    for (const b of beats) {
      activeIo.observe(b);
      inViewIo.observe(b);
    }
    return () => {
      activeIo.disconnect();
      inViewIo.disconnect();
    };
  }, []);

  return (
    <div ref={root}>
      {FEATURE_BEATS.map((beat) => (
        <Beat key={beat.id} beat={beat} stage={STAGES[beat.id]} />
      ))}
    </div>
  );
}
