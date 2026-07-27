'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';
import { CodeCard } from '../CodeCard';

/**
 * 06 ASK — the check-in receipt prints one line per scroll step, then the buttons arm. The run
 * stays paused until somebody chooses.
 *
 * The three receipt labels are the REAL evidence-pack fields, not invented UI:
 *   WILL DO         → CheckInEvidence.willDo  (src/core/checkin.ts:61)
 *   READ            → CheckInEvidence.read    (src/core/checkin.ts:65; :438 returns it)
 *   WHAT DROVE THIS → CheckInEvidence.drivers (src/core/checkin.ts:69, ranked by a pluggable scorer)
 * (`trail` — the compact run-so-far, src/core/checkin.ts:71 — is the "audit trail" chip.)
 * Wired on an agent with `.checkIn()` → src/core/agent/AgentBuilder.ts:811. See
 * content/docs/monitor/checkin.mdx, this beat's Read-more.
 */
export function AskStage({ step }: { step: number }) {
  const on = revealer(step);

  return (
    <div className="aff-stage-pad">
      <CodeCard className="aff-ask">
        <div className={`aff-ask-head ${on(1)}`}>
          <span className="aff-ask-dot" aria-hidden="true" />
          <span className="k">check-in</span>
          <span className="aff-ask-run">run #418 · paused</span>
        </div>
        <div className={`aff-ask-row ${on(2)}`}>
          <span className="lbl">WILL DO</span>
          <span>rm ./cache — 3 files</span>
        </div>
        <div className={`aff-ask-row ${on(3)}`}>
          <span className="lbl">READ</span>
          <span>config.ts · .env.example</span>
        </div>
        <div className={`aff-ask-row ${on(4)}`} style={{ '--aff-op': 0.5 } as React.CSSProperties}>
          <span className="lbl">WHAT DROVE THIS</span>
          <span>plan step 4 · rule: fs.delete → confirm</span>
        </div>
        <div className={`aff-ask-btns ${on(5)}`} aria-hidden="true">
          <span className="aff-btn-yes">APPROVE</span>
          <span className="aff-btn-no">DECLINE</span>
        </div>
      </CodeCard>
    </div>
  );
}
