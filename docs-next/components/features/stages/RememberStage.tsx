'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';

/**
 * 03 REMEMBER — a fact lifts out of Monday's conversation, flies along a dotted path, and docks
 * into Thursday's. Both turns stay on the canvas; the dock pulses once.
 *
 * Illustrates persistent memory across runs: `defineMemory({ type, strategy, store })` +
 * `.memory(...)` (see content/docs/build/memory.mdx, the beat's Read-more). The chat bubbles are
 * deliberately abstract grey bars — the point is the FACT moving, not the words.
 */

function Bar({ w }: { w: string }) {
  return <span className="aff-bar-line" style={{ width: w }} />;
}

export function RememberStage({ step }: { step: number }) {
  const on = revealer(step);

  return (
    <div className="aff-remember" aria-hidden="true">
      <div className={`aff-turn ${on(1)}`}>
        <div className="aff-turn-day">MON</div>
        <div className="aff-bub-row end">
          <div className="aff-bub user">
            <Bar w="100%" />
            <Bar w="62%" />
          </div>
        </div>
        <div className="aff-bub-row">
          <div className="aff-bub bot">
            <Bar w="100%" />
            <Bar w="84%" />
            <Bar w="45%" />
          </div>
        </div>
        <div className={`aff-fact ${on(2)}`}>⌗ prefers: metric</div>
      </div>

      {/* flight path — drawn before the card lifts off */}
      <svg className={`aff-flight ${on(4)}`} viewBox="0 0 120 90" width="120" height="90">
        <path d="M-30 24 C 20 -14, 90 -10, 174 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
      </svg>

      {/* the fact in flight */}
      <div className={`aff-flycard ${on(5)}`}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
          <path d="M6 3h12v18l-6-4.5L6 21z" />
        </svg>
        prefers: metric
      </div>

      <div className={`aff-turn ${on(3)}`} style={{ '--aff-op': 0.88 } as React.CSSProperties}>
        <div className="aff-turn-day">THU</div>
        <div className="aff-bub-row end">
          <div className="aff-bub user" style={{ width: '64%' }}>
            <Bar w="100%" />
          </div>
        </div>
        {/* the dock — where the recalled fact lands, pulsing once it's filled */}
        <div className={`aff-dock ${on(6)}`} />
        <div className="aff-bub-row">
          <div className="aff-bub bot faded" style={{ width: '72%' }}>
            <Bar w="100%" />
            <Bar w="58%" />
          </div>
        </div>
      </div>
    </div>
  );
}
