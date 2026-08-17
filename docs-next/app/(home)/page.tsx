import Link from 'next/link';
import type { Metadata } from 'next';
import { EvolutionStory } from '@/components/home/v2/EvolutionStory';
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import { SITE } from '@/lib/site';
import './v2.css';

const HOME_TITLE = 'AgentFootprint — Control agent context. Prove what made it fail.';
const HOME_DESC =
  'A TypeScript SkillGraph runtime that scopes procedure, tools, and models per step, records context provenance, and tests failures by controlled rerun.';

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESC,
  alternates: { canonical: `${SITE.url}/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/`,
    siteName: SITE.name,
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [{ url: `${SITE.url}/opengraph-image`, width: 1200, height: 630, alt: HOME_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE.twitter,
    creator: SITE.twitter,
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [`${SITE.url}/opengraph-image`],
  },
};

const CAPABILITIES = [
  {
    number: '01',
    label: 'Direct the work',
    title: 'State-aware SkillGraph',
    copy: 'Turn a runbook or multi-turn product flow into an executable graph. Each state can reveal the next procedure, the relevant tools, and an optional model only when the work reaches it.',
    link: '/docs/build/skill-graph-quickstart',
    action: 'Build one in five minutes',
  },
  {
    number: '02',
    label: 'Control data movement',
    title: 'References, not prompt payloads',
    copy: 'Pass large or sensitive results by reference, compute beside the data, and return a renderable artifact. The model reasons over what it needs instead of ingesting the whole payload.',
    link: '/docs/build/artifacts',
    action: 'See artifact data flow',
  },
  {
    number: '03',
    label: 'Test the cause',
    title: 'Context provenance + rerun',
    copy: 'Start at the failed output, backward-slice through decisions to the context that influenced it, remove a named source, and measure the counterfactual result.',
    link: '/docs/debug/rerun-without-sources',
    action: 'Rerun without a source',
  },
  {
    number: '04',
    label: 'Fit the real stack',
    title: 'Ports, adapters, and observers',
    copy: 'Keep the agent logic stable while providers, memory, storage, hosting, and telemetry change around it. Attach the observability system you already operate.',
    link: '/docs/infrastructure/observability-sinks',
    action: 'Connect an observer',
  },
] as const;

export default function HomePage() {
  return (
    <div className="v2-home">
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />

      <section className="v2-hero" id="overview">
        <div className="v2-hero-copy">
          <p className="v2-kicker">
            <span /> Open source · TypeScript · MIT
          </p>
          <h1>
            Control what your agent sees. <em>Prove what made it fail.</em>
          </h1>
          <p className="v2-hero-lede">
            AgentFootprint scopes the procedure, tools, and model for each step—then records the
            context lineage needed to backtrack a bad output, remove the suspect source, and rerun
            the same case.
          </p>
          <div className="v2-actions">
            <Link className="v2-button v2-button-primary" href="/docs/build/skill-graph-quickstart">
              Build a SkillGraph <span aria-hidden="true">→</span>
            </Link>
            <Link className="v2-button v2-button-quiet" href="/how-it-works">
              Watch a failure unwind <span aria-hidden="true">↘</span>
            </Link>
          </div>
          <code className="v2-install" aria-label="Install AgentFootprint">
            <span aria-hidden="true">$</span> npm i agentfootprint
          </code>
        </div>

        <figure className="v2-proof">
          <figcaption>
            <span className="v2-proof-live">
              <i /> run 8f2 · recorded inline
            </span>
            <span>refunds-agent</span>
          </figcaption>
          <div className="v2-proof-question">Why did this refund get approved?</div>
          <ol className="v2-proof-trace">
            <li>
              <b>intent</b>
              <span>support.refund</span>
              <small>matched</small>
            </li>
            <li>
              <b>skill</b>
              <span>billing.refund</span>
              <small>activated</small>
            </li>
            <li className="is-cause">
              <b>context</b>
              <span>policy/refunds-v1</span>
              <small>suspect source</small>
            </li>
            <li className="is-wrong">
              <b>decision</b>
              <span>approve</span>
              <small>wrong output</small>
            </li>
          </ol>
          <div className="v2-proof-rerun">
            <span className="v2-proof-command">rerun − policy/refunds-v1</span>
            <span className="v2-proof-result">
              deny <b>✓</b>
            </span>
          </div>
          <p className="v2-proof-confirmed">
            <span>dependence confirmed</span> The decision changed when the source was removed.
          </p>
          <small className="v2-proof-limit">
            Counterfactual replay tests this recorded run; it does not reveal private model
            reasoning.
          </small>
        </figure>
      </section>

      <section className="v2-outcomes" aria-label="What changes with AgentFootprint">
        <article>
          <span>01 / working set</span>
          <h2>Expose less at each step.</h2>
          <p>The active skill carries the procedure and tool surface the current state needs.</p>
        </article>
        <article>
          <span>02 / failure analysis</span>
          <h2>Debug causes, not timelines.</h2>
          <p>Typed ancestry connects a bad output to the context and decisions that shaped it.</p>
        </article>
        <article>
          <span>03 / correction</span>
          <h2>Test the explanation.</h2>
          <p>
            A controlled rerun tells you whether removing the suspected source changes the result.
          </p>
        </article>
      </section>

      <EvolutionStory />

      <section className="v2-capabilities" id="system" aria-labelledby="v2-system-title">
        <header className="v2-section-head">
          <p className="v2-kicker">The runtime underneath the demo</p>
          <h2 id="v2-system-title">Four jobs a production agent cannot improvise.</h2>
          <p>
            Build the behavior, control the data path, diagnose the failure, and connect the
            infrastructure—without turning each concern into another framework.
          </p>
        </header>
        <div className="v2-capability-grid">
          {CAPABILITIES.map((capability) => (
            <article className="v2-capability" key={capability.number}>
              <div className="v2-capability-top">
                <span>{capability.number}</span>
                <small>{capability.label}</small>
              </div>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
              <Link href={capability.link}>{capability.action} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="v2-paths" id="paths" aria-labelledby="v2-paths-title">
        <header className="v2-section-head">
          <p className="v2-kicker">Choose your way in</p>
          <h2 id="v2-paths-title">Two readers. One operating model.</h2>
        </header>
        <div className="v2-path-grid">
          <article className="v2-path v2-path-product">
            <span className="v2-path-label">I own the product</span>
            <h3>Make reliability and model spend an architectural choice.</h3>
            <p>
              See how smaller tool surfaces, explicit procedures, and testable explanations change
              the economics of shipping an agent.
            </p>
            <ul>
              <li>Relevant tools instead of a flat catalog</li>
              <li>Procedures that survive across turns</li>
              <li>Failures your team can reproduce</li>
            </ul>
            <Link href="/features">Explore the product capabilities →</Link>
          </article>
          <article className="v2-path v2-path-developer">
            <span className="v2-path-label">I build the system</span>
            <h3>Start with a graph. Keep every boundary replaceable.</h3>
            <p>
              Build mock-first, attach skills and tools to state, then swap providers and adapters
              without rewriting the agent loop.
            </p>
            <pre className="v2-path-code" aria-label="AgentFootprint builder example">
              <code>{`Agent.create({ provider })
  .skill(billing)
  .build()`}</code>
            </pre>
            <Link href="/docs/build/skill-graph-quickstart">Open the developer quickstart →</Link>
          </article>
        </div>
      </section>

      <section className="v2-evidence" aria-labelledby="v2-evidence-title">
        <div>
          <p className="v2-kicker">The business case, stated honestly</p>
          <h2 id="v2-evidence-title">Structure, where a bigger model used to be.</h2>
        </div>
        <article className="v2-field-result">
          <p>
            In one anonymized customer implementation, replacing a flat ~40-tool surface with a
            dynamic SkillGraph enabled a lower-cost model to produce better evaluated responses.
          </p>
          <footer>
            Field result, not a benchmark. Validate it on your workload by holding tasks and scoring
            constant, then compare flat vs. SkillGraph tool exposure across models by cost per
            successful task.
          </footer>
          <Link href="/docs/debug/compare-strategies">See the controlled comparison tools →</Link>
        </article>
      </section>

      <section className="v2-close">
        <p className="v2-kicker">The next failed run can carry its own explanation.</p>
        <h2>Make agent behavior executable—and failure testable.</h2>
        <div className="v2-actions">
          <Link className="v2-button v2-button-primary" href="/docs">
            Start with the docs →
          </Link>
          <a
            className="v2-button v2-button-quiet"
            href={SITE.repo}
            target="_blank"
            rel="noreferrer"
          >
            Read the source ↗
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
