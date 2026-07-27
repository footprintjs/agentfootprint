'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';

/**
 * 07 WHY — the flagship. A wrong answer flips in with an ✕; the suspect context cascades in,
 * ranked by influence; the bars fill; the ablation re-run stamps the winner PROVEN; a thread
 * draws from the answer down to the root cause. Nothing that arrives ever leaves.
 *
 * What's real behind the picture (content/docs/debug/localize-context-bug.mdx — the Read-more):
 * the localizer ranks candidate context by influence and then PROVES the top one by re-running
 * without it. "PROVEN" is that counterfactual verdict, not a confidence score — which is why the
 * beat's line says "receipts".
 */

type Suspect = { rank: string; label: string; score: string; w: string; layer: number; dim?: boolean };

const SUSPECTS: readonly Suspect[] = [
  { rank: '1', label: 'doc: q3-brief.pdf §2', score: '.82', w: '82%', layer: 4 },
  { rank: '2', label: 'mem: pricing-2024', score: '.41', w: '41%', layer: 5 },
  { rank: '3', label: 'tool: web.search #3', score: '.17', w: '17%', layer: 5 },
  { rank: '4', label: 'sys: persona', score: '.09', w: '9%', layer: 5, dim: true },
];

export function WhyStage({ step }: { step: number }) {
  const on = revealer(step);

  return (
    <div className="aff-why">
      {/* the thread from the wrong answer down to the proven root cause — drawn last */}
      <svg className={`aff-thread ${on(8)}`} viewBox="0 0 640 480" preserveAspectRatio="none" aria-hidden="true">
        <path d="M170 96 C 120 160, 120 200, 170 240" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 5" />
      </svg>

      <div className={`aff-wrong ${on(1)}`}>
        <span className="aff-bar-line" style={{ width: '82%' }} />
        <span className="aff-bar-line" style={{ width: '60%' }} />
        <div className="aff-wrong-val">
          <span className="v">$4.2M</span>
          <span className={`aff-x ${on(2)}`} aria-label="wrong answer">
            ✕
          </span>
        </div>
      </div>

      <div className="aff-suspects">
        <div className={`aff-suspects-lab ${on(3)}`}>SUSPECT CONTEXT · RANKED BY INFLUENCE</div>
        {SUSPECTS.map((s) => (
          <div
            key={s.rank}
            className={`aff-suspect${s.rank === '1' ? ' is-top' : ''} ${on(s.layer)}`}
            style={s.dim ? ({ '--aff-op': 0.42 } as React.CSSProperties) : undefined}
          >
            <span className="n">{s.rank}</span>
            <span className="lbl">{s.label}</span>
            <span className="aff-infl">
              {/* the bar fills on its own step — the "ranked by influence" beat lands after the list */}
              <span className={`aff-infl-fill ${on(6)}`} style={{ '--aff-w': s.w } as React.CSSProperties} />
            </span>
            <span className="sc">{s.score}</span>
            {s.rank === '1' && (
              <span className={`aff-proven ${on(7)}`} title="confirmed by re-running the agent without this context">
                PROVEN
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
