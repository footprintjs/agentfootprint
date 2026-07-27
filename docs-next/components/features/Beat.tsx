'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { useAdditiveSteps } from '@/lib/features/useAdditiveSteps';
import type { FeatureBeat } from '@/lib/features/beats';

/**
 * One beat of the /features story: the verb rail on the left, the stage pinned on the right.
 *
 * The section is `dwell` tall (~180vh, more for the flagship) and the stage is `position: sticky`,
 * so the stage holds still while the rail scrolls past it — the storyboard's shot. `useAdditiveSteps`
 * turns that scroll budget into a monotonically increasing layer count which the stage renders
 * from; layers arrive and stay.
 *
 * `steps` comes from the beat data, so the stage and its scroll budget can't drift apart.
 */
export function Beat({
  beat,
  stage,
}: {
  beat: FeatureBeat;
  /** render the stage for a given number of revealed layers */
  stage: (step: number) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  // the rail is the beat's COPY: how long it stays on screen is one of the two things that bound the
  // reveal, so the stage can never finish composing after its explanation has scrolled away
  const railRef = useRef<HTMLDivElement>(null);
  const step = useAdditiveSteps(ref, beat.steps, railRef);

  return (
    <section
      className="aff-beat"
      id={beat.id}
      ref={ref}
      style={{ '--aff-dwell': beat.dwell } as React.CSSProperties}
      aria-labelledby={`aff-h-${beat.id}`}
    >
      <div className="aff-beat-inner">
        <div className="aff-rail" ref={railRef}>
          <div className="aff-rail-ix">{beat.ix}</div>
          <h2 className="aff-rail-verb" id={`aff-h-${beat.id}`}>
            {beat.verb}
          </h2>
          <p className="aff-rail-line">{beat.line}</p>

          {/* real disclosure — native <details> so it works with the keyboard and without JS.
              SWAP ships open (the design shows it expanded); the rest start closed. */}
          <details className="aff-inside" open={beat.id === 'swap'}>
            <summary>
              what&apos;s inside
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="aff-chips">
              {beat.inside.map((c) => (
                <span className="aff-chip" key={c}>
                  {c}
                </span>
              ))}
            </div>
          </details>

          <Link className="aff-more" href={beat.href} aria-label={beat.hrefLabel}>
            Read more →
          </Link>
        </div>

        <div className="aff-stagewrap">
          <div className="aff-stage">{stage(step)}</div>
        </div>
      </div>
    </section>
  );
}
