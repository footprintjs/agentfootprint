'use client';

import { useRef, type CSSProperties } from 'react';
import { useScrollProgress } from '@/lib/home/useScrollProgress';

const STAGES = [
  { model: 'Text', application: 'Prompt' },
  { model: 'Tools', application: 'Loop' },
  { model: 'Skills', application: 'Graph' },
  { model: 'Feedback', application: 'Replay' },
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
          <span className="v2-kicker">From prompt to production</span>
          <h2 id="v2-evolution-title">Prompts became systems. Systems need a runtime.</h2>
          <p>Scroll the two histories into one.</p>
        </header>

        <div className="v2-dual-rail">
          <div className="v2-rail-labels">
            <span>Model interface</span>
            <span>Application control</span>
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
            <strong>One graph for procedure, context, and evidence.</strong>
          </p>
        </div>
      </div>
    </section>
  );
}
