import Link from 'next/link';
import { asset } from '@/lib/site';

// Inline GitHub mark (lucide dropped brand icons) — kept local so the summary chapter
// is self-contained.
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/**
 * Chapter 05 — "The payoff". The closing recap: the whole-system overview, the
 * record → reverse → prove → plug loop restated, and the call to action. Folds in
 * the page's former overview + closer band so the summary is a real numbered chapter.
 */
export function SummaryChapter() {
  return (
    <div className="af-summary">
      {/* whole-system overview — the recap diagram */}
      <section className="af-overview">
        <p className="af-overview-kicker">the whole system</p>
        <h2 className="af-overview-head">How it all fits together.</h2>
        <p className="af-overview-sub">
          Skills, RAG, memory, rules — composed into the <b>system / messages / tools</b> slots,
          run, and recorded as a traceable footprint you can reverse.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/system-overview.webp')}
          alt="agentfootprint system overview: context sources compose through the agent into the system, messages, and tools slots, then the LLM produces a structured answer"
          className="af-overview-img"
        />
      </section>

      {/* the payoff — record → reverse → prove → plug, then the call to action */}
      <div className="af-closer">
        <span className="af-pill">
          <span className="af-pill-dot" /> open source · MIT
        </span>
        <h2 className="af-closer-head">
          Stop guessing why your agent <em>answered wrong.</em>
        </h2>
        <p className="af-closer-lede">
          Record every run. Reverse it to the exact cause. Prove the fix by replaying it.
        </p>
        <div className="af-closer-flow" aria-hidden="true">
          <span>record</span>
          <i>→</i>
          <span>reverse</span>
          <i>→</i>
          <span>prove</span>
          <i>→</i>
          <span>plug your own</span>
        </div>
        <div className="af-hero-cta">
          <Link className="af-cta" href="/docs">
            Trace your first run →
          </Link>
          <Link className="af-cta-ghost" href="https://github.com/footprintjs/agentfootprint">
            <GitHubMark /> Star on GitHub
          </Link>
        </div>
        <div className="af-install">
          <span className="pr">$</span> npm i agentfootprint
        </div>
      </div>
    </div>
  );
}
