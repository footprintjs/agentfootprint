import Link from 'next/link';
import { Chapters } from '@/components/home/Chapters';

export const metadata = {
  title: 'agentfootprint — Find the context that made your agent answer wrong',
  description:
    'The explainable agent framework. Every run records its own causal trace, so when the answer is wrong you backtrack to the exact context that caused it — confirmed by re-running without it. Why is a query, not a guess.',
};

export default function HomePage() {
  return (
    <main className="af-home">
      <section className="af-hero">
        <h1>
          Find the context that made your agent <em>answer wrong.</em>
        </h1>
        <p className="lede">
          agentfootprint is the explainable agent framework — every run records its
          own causal trace, so when the answer is wrong you backtrack from the output
          to the exact piece of context that caused it, confirmed by re-running
          without it.
        </p>
        <p className="tagline">
          <em>Why</em> is a query, not a guess.
        </p>
      </section>

      {/* The three chapters — sticky bars + scroll-spy now; real animations in Phases 2–4. */}
      <Chapters />

      <footer className="af-endcap">
        <Link className="af-cta" href="https://github.com/footprintjs/agentfootprint">
          Star on GitHub →
        </Link>
        <div className="af-install">
          <span className="pr">$</span> npm i agentfootprint
        </div>
        <div className="af-legal">open source · MIT · © 2026 footprintjs</div>
      </footer>
    </main>
  );
}
