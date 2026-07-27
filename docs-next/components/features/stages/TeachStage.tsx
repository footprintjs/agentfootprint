'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';

/**
 * 02 TEACH — a request pings in, a dotted line drops to the ONE skill that matches, its lock
 * opens and the card lifts. The others dim and stay (nothing is ever removed).
 *
 * The four names are illustrative skill ids, not API. The mechanism they illustrate is real:
 * `defineSkill` bodies + tools are activated on demand by the LLM (`read_skill`), so only the
 * matching skill's context lands — see content/docs/build/skills.mdx (the beat's Read-more).
 */

function Lock({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {/* an OPEN lock's shackle is lifted clear of the body on one side */}
      {open ? <path d="M8 11V7a4 4 0 0 1 8 0" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

const OTHERS = ['web-search', 'summarize', 'cite-check'];

export function TeachStage({ step }: { step: number }) {
  const on = revealer(step);

  return (
    <div className="aff-teach">
      <div className={on(1)}>
        <span className="aff-chip-req">read(&apos;q3-brief.pdf&apos;)</span>
      </div>
      <div className={`aff-teach-drop ${on(2)}`} aria-hidden="true" />

      <div className={`aff-skill ${on(3)}`} style={{ '--aff-op': 0.45 } as React.CSSProperties}>
        <Lock />
        {OTHERS[0]}
      </div>

      {/* the match — border goes gold, the card lifts, the lock opens, the dot pulses */}
      <div className={`aff-skill is-match ${on(4)}`}>
        <Lock open />
        read-pdf
        <span className="aff-pulse" aria-hidden="true" />
      </div>

      {OTHERS.slice(1).map((name) => (
        <div key={name} className={`aff-skill ${on(3)}`} style={{ '--aff-op': 0.45 } as React.CSSProperties}>
          <Lock />
          {name}
        </div>
      ))}
    </div>
  );
}
