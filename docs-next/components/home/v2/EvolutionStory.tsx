'use client';

import { useRef, type CSSProperties } from 'react';
import { useScrollProgress } from '@/lib/home/useScrollProgress';

const STAGES = [
  { model: 'Human', application: 'carries context between systems' },
  { model: 'Agent', application: 'inherits the same responsibility' },
  { model: 'Whole runbook', application: 'loads every instruction at once' },
  { model: 'Current step', application: 'reveals what is needed now' },
  { model: 'Traversal', application: 'advances and records together' },
] as const;

export function EvolutionStory() {
  const track = useRef<HTMLElement | null>(null);
  const progress = useScrollProgress(track, (value) => Math.round(value * 120) / 120, 0);
  const active = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));

  return (
    <section
      ref={track}
      className="v2-evolution"
      id="evolution"
      aria-labelledby="v2-evolution-title"
      style={{ '--v2-progress': progress } as CSSProperties}
    >
      <div className="v2-evolution-sticky">
        <header className="v2-evolution-head">
          <span className="v2-kicker">The handoff</span>
          <h2 id="v2-evolution-title">An agent inherits the context a person used to carry.</h2>
          <p>Then the runbook has to become executable.</p>
        </header>

        <div className="v2-dual-rail">
          <div className="v2-rail-labels">
            <span>The progression</span>
            <span>What changes</span>
          </div>
          <ol className="v2-rail-stages">
            {STAGES.map((stage, index) => (
              <li
                className={`${index < active ? 'is-past ' : ''}${
                  index === active ? 'is-current' : ''
                }`}
                key={stage.model}
              >
                <span className="v2-rail-word v2-rail-word-model">{stage.model}</span>
                <span className="v2-rail-node" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="v2-rail-word v2-rail-word-app">{stage.application}</span>
              </li>
            ))}
          </ol>
          <div className="v2-rail-merge" aria-hidden="true">
            <i />
            <i />
          </div>
          <p className="v2-convergence">
            <span aria-hidden="true">AF</span>
            <strong>The path is already a footprint as it runs.</strong>
          </p>
        </div>
      </div>
    </section>
  );
}
