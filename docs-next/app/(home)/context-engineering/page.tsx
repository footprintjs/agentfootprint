import Link from 'next/link';
import type { Metadata } from 'next';
import { ContextStory } from '@/components/context-story/ContextStory';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';

const title = 'Context engineering, step by step — AgentFootprint';
const description =
  'See how a question becomes a scoped, checked answer. Follow the context, data references and validation through two visual walkthroughs.';
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: `${SITE.url}/context-engineering/` },
  openGraph: { title, description, url: `${SITE.url}/context-engineering/`, type: 'website' },
};

export default function ContextEngineeringPage() {
  return (
    <main className="cx-page">
      <header className="cx-intro">
        <p className="cx-eyebrow">
          <span /> CONTEXT ENGINEERING, MADE VISIBLE
        </p>
        <h1>
          Give the model
          <br />
          <em>less to guess.</em>
        </h1>
        <p>
          A question becomes a clear task, a scoped data reference, and a checked finding.
          <br className="cx-wide-break" /> Follow what changes—one step at a time.
        </p>
      </header>
      <ContextStory />
      <section className="cx-layers" aria-labelledby="cx-layers-title">
        <div className="cx-section-heading">
          <p className="cx-eyebrow">THE DESIGN BEHIND THE STORY</p>
          <h2 id="cx-layers-title">Each layer has one job.</h2>
          <p>The host connects them. The model gets the context needed for its next decision.</p>
        </div>
        <div className="cx-layer-grid">
          <article>
            <span className="cx-layer-symbol" aria-hidden="true">
              01
            </span>
            <h3>Describe & retain</h3>
            <p>
              Your provider adapter declares the source, units, scope and limits. A configured store
              retains the data and resolves authorized references.
            </p>
            <Link href="/docs/build/artifacts-architecture">Data references →</Link>
          </article>
          <article>
            <span className="cx-layer-symbol" aria-hidden="true">
              02
            </span>
            <h3>Prepare & act</h3>
            <p>
              AgentFootprint coordinates skills, tools and model calls. The host can serve compact
              current context while backend tools do the calculations.
            </p>
            <Link href="/docs/build/skills-explained">Skills and disclosure →</Link>
          </article>
          <article>
            <span className="cx-layer-symbol" aria-hidden="true">
              03
            </span>
            <h3>Compare & validate</h3>
            <p>
              ContextFootprint identifies conflicting assertions. Your host sets the response policy
              and the checks required before an answer is delivered.
            </p>
            <Link href="/docs/monitor/context-integrity">Context integrity →</Link>
          </article>
        </div>
      </section>
      <section className="cx-boundaries" aria-labelledby="cx-boundary-title">
        <div>
          <p className="cx-eyebrow">LESS GUESSWORK. CLEAR LIMITS.</p>
          <h2 id="cx-boundary-title">Better context is a design choice.</h2>
          <p>
            Moving scope, calculation and value checks into code gives the model a smaller decision
            to make. Whether that improves a smaller model’s accuracy or cost must be measured on
            your tasks.
          </p>
        </div>
        <div className="cx-faq">
          <details>
            <summary>Does “checked” mean every statement is true?</summary>
            <p>
              No. ContextFootprint compares supplied, comparable assertions. Missing data, unknown
              values and different revisions can produce no conflict without supporting a claim.
              Structured answer validation checks the contract you configured; it does not verify
              arbitrary prose.
            </p>
          </details>
          <details>
            <summary>Who decides to pause, repair or ask a question?</summary>
            <p>
              The host policy does. AgentFootprint’s claims diagnostics and opt-in answerValidation
              have different roles: final delivery enforcement must be configured. The one-attempt
              repair shown here is example host logic, not a built-in retry loop.
            </p>
          </details>
          <details>
            <summary>Can this work without a dashboard?</summary>
            <p>
              Yes. Data references and backend operations do not require a visual interface. A store
              and authorized resolver are required; a reference is not permission to fetch a
              dataset. A dashboard can use those same operations when the application supplies the
              integration.
            </p>
          </details>
          <details>
            <summary>Is this a real model run?</summary>
            <p>
              No. The data and model proposals are invented to make the mechanism visible. The
              conflicting values reproduce the shape checked by the local comparator example. The
              walkthrough does not measure tokens, accuracy or causal diagnosis.
            </p>
          </details>
        </div>
      </section>
      <div className="cx-end">
        <p>Follow the context. Inspect the decision.</p>
        <Link href="/how-it-works">Explore a debugging walkthrough →</Link>
      </div>
      <SiteFooter />
    </main>
  );
}
