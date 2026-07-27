'use client';

import { useState } from 'react';
import { revealer } from '@/lib/features/useAdditiveSteps';

/**
 * 05 WATCH — one run, three lenses. The tabs are real: graph / timeline / status render the SAME
 * five stages of the SAME run (RUN below is the single source), so switching a lens re-frames the
 * run instead of showing a different one. The event log under them is shared.
 *
 * What's real behind the picture: the framework emits 67 typed events during traversal (the
 * "67 events" chip — src/events/registry.ts:503 `ALL_EVENT_TYPES`, asserted to be exactly 67 by
 * test/events/unit/registry.test.ts:88; see content/docs/monitor/observability.mdx, this beat's
 * Read-more). `evt 67` in the header is the run's event counter, and the numbers below are
 * illustrative for one such run.
 */

type Stage = {
  id: string;
  /** done → a finished stage · running → the live one · pending → not reached yet */
  state: 'done' | 'running' | 'pending';
  ms?: number;
  cost?: string;
  /** reveal layer (shared by all three lenses so the story lands in the same order) */
  layer: number;
  /** graph placement, as a fraction of the design's 722×190 canvas */
  x: string;
  y: string;
};

const RUN: readonly Stage[] = [
  { id: 'plan', state: 'done', ms: 184, cost: '$0.0009', layer: 2, x: '3.3%', y: '50%' },
  { id: 'search', state: 'done', ms: 612, cost: '$0.0012', layer: 3, x: '24.7%', y: '50%' },
  { id: 'read', state: 'done', ms: 212, cost: '$0.0031', layer: 4, x: '46.8%', y: '21%' },
  { id: 'verify', state: 'running', layer: 5, x: '46.8%', y: '79%' },
  { id: 'answer', state: 'pending', layer: 6, x: '75.1%', y: '50%' },
];

/** longest stage in the run — the timeline bars are scaled against it */
const MAX_MS = 612;

const LENSES = ['graph', 'timeline', 'status'] as const;
type Lens = (typeof LENSES)[number];

export function WatchStage({ step }: { step: number }) {
  const on = revealer(step);
  const [lens, setLens] = useState<Lens>('graph');

  return (
    <div className="aff-watch">
      <div className={`aff-watch-head ${on(1)}`}>
        <div className="aff-live">
          <span className="aff-pulse" aria-hidden="true" />
          live · evt 67
        </div>
        <div className="aff-tabs" role="tablist" aria-label="Trace lens">
          {LENSES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              id={`aff-watch-tab-${l}`}
              aria-selected={lens === l}
              aria-controls="aff-watch-panel"
              className={`aff-tab${lens === l ? ' on' : ''}`}
              onClick={() => setLens(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div id="aff-watch-panel" role="tabpanel" aria-labelledby={`aff-watch-tab-${lens}`} className="aff-watch-body">
        {lens === 'graph' && (
          <div className="aff-graph">
            <svg viewBox="0 0 722 190" preserveAspectRatio="none" aria-hidden="true">
              <path className={on(3)} d="M100 95 H 176" />
              <path className={on(4)} d="M268 95 C 302 95, 302 40, 334 40" />
              <path className={`aff-edge-live ${on(5)}`} d="M268 95 C 302 95, 302 150, 334 150" strokeDasharray="4 4" />
              <path className={`aff-edge-soft ${on(6)}`} d="M414 40 C 482 40, 482 95, 538 95" />
              <path className={`aff-edge-soft ${on(6)}`} d="M434 150 C 488 150, 488 95, 538 95" />
            </svg>
            {RUN.map((s) => (
              <span
                key={s.id}
                className={`aff-node is-${s.state} ${on(s.layer)}`}
                style={{ left: s.x, top: s.y }}
              >
                {s.id}
                {s.state === 'done' && ' ✓'}
                {s.state === 'running' && <span className="aff-pulse" aria-hidden="true" />}
              </span>
            ))}
          </div>
        )}

        {lens === 'timeline' && (
          <div className="aff-timeline">
            {RUN.map((s) => (
              <div key={s.id} className={`aff-tl-row is-${s.state} ${on(s.layer)}`}>
                <span className="aff-tl-name">{s.id}</span>
                <span className="aff-tl-track">
                  <span
                    className="aff-tl-fill"
                    style={{ width: s.ms ? `${Math.round((s.ms / MAX_MS) * 100)}%` : '14%' }}
                  />
                </span>
                <span className="aff-tl-ms">{s.ms ? `${s.ms}ms` : s.state === 'running' ? '…' : '—'}</span>
              </div>
            ))}
          </div>
        )}

        {lens === 'status' && (
          <div className="aff-status">
            <div className="aff-st-row is-head">
              <span>stage</span>
              <span>state</span>
              <span>ms</span>
              <span>cost</span>
            </div>
            {RUN.map((s) => (
              <div key={s.id} className={`aff-st-row is-${s.state} ${on(s.layer)}`}>
                <span className="aff-st-name">{s.id}</span>
                <span className="aff-st-state">{s.state}</span>
                <span>{s.ms ?? '—'}</span>
                <span>{s.cost ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the raw event stream — the same two events whichever lens is on top */}
      <div className={`aff-evlog ${on(7)}`}>
        <div>
          <span className="n">66</span>
          {'  '}tool_call{'  '}web.fetch{'  '}·{'  '}212ms{'  '}·{'  '}$0.0031
        </div>
        <div className="is-partial">
          <span className="n">67</span>
          {'  '}llm_call{'   '}verify{'  '}·{'  '}…
        </div>
      </div>
    </div>
  );
}
