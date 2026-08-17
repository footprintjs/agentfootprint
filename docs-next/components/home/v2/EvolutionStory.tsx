'use client';

import { useRef, type CSSProperties } from 'react';
import { useScrollProgress } from '@/lib/home/useScrollProgress';

const STAGES = [
  {
    signal: 'generate',
    model: ['Text', 'Natural-language completion made software generative.'],
    application: ['Prompts', 'Apps assembled one instruction and hoped it held.'],
  },
  {
    signal: 'converse',
    model: ['Roles', 'System, user, assistant, and tool messages gave conversations structure.'],
    application: [
      'Context assembly',
      'Apps now owned message history and what entered the window.',
    ],
  },
  {
    signal: 'act',
    model: ['Tool calling', 'Models could request named operations with structured arguments.'],
    application: ['Execution loops', 'Apps routed calls, returned results, and managed retries.'],
  },
  {
    signal: 'operate',
    model: [
      'Multi-step instructions',
      'Tasks became procedures that could carry progress forward.',
    ],
    application: [
      'SkillGraph',
      'State selects the next procedure, tool surface, and optional model.',
    ],
  },
  {
    signal: 'verify',
    model: ['Evaluated outputs', 'Teams began checking results before they became decisions.'],
    application: [
      'Evidence gates',
      'Apps attached coverage, approvals, and constraints to the run.',
    ],
  },
  {
    signal: 'improve',
    model: [
      'Production feedback',
      'Quality, cost, and failure became part of the interaction loop.',
    ],
    application: [
      'Provenance + rerun',
      'Trace an output to its sources; remove one and measure the counterfactual.',
    ],
  },
] as const;

export function EvolutionStory() {
  const track = useRef<HTMLElement | null>(null);
  const progress = useScrollProgress(track, (value) => Math.round(value * 100) / 100, 0);
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
          <span className="v2-kicker">Two timelines. One production problem.</span>
          <h2 id="v2-evolution-title">
            Model interaction evolved. Applications had to become a runtime.
          </h2>
          <p>
            Each interaction pattern opened a new door. Each door moved more responsibility into the
            application around it. Scroll to watch the two histories meet.
          </p>
        </header>

        <div className="v2-timeline-labels" aria-hidden="true">
          <span>How model interaction evolved</span>
          <span />
          <span>What the application had to learn</span>
        </div>

        <ol className="v2-timeline">
          {STAGES.map((stage, index) => {
            const revealed = index <= active;
            const current = index === active;
            return (
              <li
                className={`v2-time-row${revealed ? ' is-revealed' : ''}${
                  current ? ' is-current' : ''
                }`}
                key={stage.signal}
              >
                <article
                  className="v2-time-card v2-time-card-model"
                  aria-label={`Model interaction: ${stage.model[0]}`}
                >
                  <span className="v2-time-index">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{stage.model[0]}</h3>
                  <p>{stage.model[1]}</p>
                </article>
                <div className="v2-time-node" aria-hidden="true">
                  <span>{stage.signal}</span>
                  <i />
                </div>
                <article
                  className="v2-time-card v2-time-card-app"
                  aria-label={`Application response: ${stage.application[0]}`}
                >
                  <span className="v2-time-index">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{stage.application[0]}</h3>
                  <p>{stage.application[1]}</p>
                </article>
              </li>
            );
          })}
        </ol>

        <div className={`v2-convergence${progress > 0.86 ? ' is-revealed' : ''}`}>
          <span className="v2-convergence-mark" aria-hidden="true">
            AF
          </span>
          <p>
            <strong>AgentFootprint brings the timelines together.</strong> Procedure, context
            control, and counterfactual evidence live in one executable graph—not in disconnected
            prompts, logs, and dashboards.
          </p>
        </div>
      </div>
    </section>
  );
}
