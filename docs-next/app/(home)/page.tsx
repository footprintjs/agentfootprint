import Link from 'next/link';
import type { Metadata } from 'next';
import { ReferenceFlow, RerunProof } from '@/components/home/v2/ProductScenes';
import { EvolutionStory } from '@/components/home/v2/EvolutionStory';
import { SkillGraphScene } from '@/components/home/v2/SkillGraphScene';
import { PhaseRail } from '@/components/home/v2/PhaseRail';
import { LensBand } from '@/components/home/v2/LensBand';
import { AnswerFaces } from '@/components/home/v2/AnswerFaces';
import { PortsScene } from '@/components/home/v2/PortsScene';
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import { SITE, asset } from '@/lib/site';
import './v2.css';

const HOME_TITLE = 'agentfootprint — Your agent decides what a person used to';
const HOME_DESC =
  'Open-source TypeScript runtime for SkillGraph applications. When an agent takes a decision a person used to make, the reasoning stops surviving — so every run records why it decided what it did, states what it could not check, and lets you confirm a cause by re-running without it.';

/** The three phases. Ids must match the section headings they open. */
const PHASES = [
  { id: 'build', step: '01', name: 'Build', what: 'Define the work as a skill graph. Route data by reference.' },
  { id: 'iterate', step: '02', name: 'Iterate', what: 'Open the recorded run. Fix the context, not the model.' },
  { id: 'production', step: '03', name: 'Run in production', what: 'Your models, your storage, your telemetry. Typed ports, no lock-in.' },
  { id: 'monitor', step: '04', name: 'Monitor', what: 'Query a month of runs without rebuilding the story first.' },
] as const;

/** Everything the runtime needs to actually run somewhere, as PORTS with the
 *  adapters that exist today. Ports are ours; adapters are theirs — so a new
 *  vendor is a new file, never a change to the agent you wrote. */
const INFRASTRUCTURE_ADAPTERS = [
  {
    port: 'Models',
    adapters: 'OpenAI · Anthropic · Bedrock · Gemini · Azure OpenAI · Foundry · Ollama',
  },
  {
    port: 'Memory + data',
    adapters: 'Redis · PostgreSQL · SQLite · S3 · Cloud Storage',
  },
  {
    port: 'Tools',
    adapters: 'your functions · MCP servers, local or remote',
  },
  {
    port: 'Identity + secrets',
    adapters: 'JWKS · Vault · Entra ID · declare-and-push credentials',
  },
  {
    port: 'Runtime + sessions',
    adapters: 'AgentCore · Vertex sessions · your own process',
  },
  {
    port: 'Observe',
    adapters: 'OpenTelemetry · CloudWatch · X-Ray · audit bundles',
  },
] as const;

/** Where the same agent runs, with the adapters you would actually use there.
 *  Verified against src/adapters before being written — an adapter appears here
 *  after it lands, never before. */
const CLOUDS = [
  { where: 'AWS', how: 'Bedrock models · AgentCore runtime · S3 · CloudWatch · X-Ray' },
  { where: 'Google Cloud', how: 'Gemini and Vertex models · Vertex sessions · Cloud Storage' },
  { where: 'Microsoft Foundry', how: 'Foundry hosting and models · Azure OpenAI · Entra ID' },
  { where: 'Your own hardware', how: 'Ollama · PostgreSQL · SQLite · your process · OpenTelemetry' },
] as const;

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

export default function HomePage() {
  return (
    <div className="v2-home">
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />

      <section className="v21-hero" id="overview">
          <p className="v2-kicker">
            <span /> Open-source TypeScript agent framework
          </p>
          <h1>
            Your agent decides what a person used to. <em>Only one of them leaves a reason.</em>
          </h1>
          {/* Developer proof, not logos. Every figure here is real and checkable:
              downloads from the npm registry API, the licence from the repo, the
              telemetry claim verified against the source (no analytics endpoint
              and no URL the library chooses for itself). Star count is
              deliberately absent — omitting a number is honest, inflating one is
              not, and a low count next to "Star on GitHub" argues against us. */}
          <ul className="v21-proof">
            <li>
              <strong>21,800+</strong>
              <small>npm installs a month</small>
            </li>
            <li>
              <strong>MIT</strong>
              <small>open source, no seat fees</small>
            </li>
            <li>
              <strong>No telemetry</strong>
              <small>it never phones home</small>
            </li>
            <li>
              <strong>9,800+</strong>
              <small>tests on every release</small>
            </li>
          </ul>

        <div className="v21-hero-row">
          <div className="v21-hero-say">
          <ul className="v21-lede-points">
            <li>
              <strong>Builds and runs agents</strong> the way you expect — skills, tools, a loop.
            </li>
            <li>
              <strong>Keeps the evidence</strong> — every decision, and what it rests on.
            </li>
            <li>
              <strong>Says what it could not check</strong> — the boundary travels with the answer.
            </li>
            <li>
              <strong>Refuses instead of guessing</strong> — when the evidence is not there.
            </li>
          </ul>
          <div className="v2-actions">
            <Link className="v2-button v2-button-primary" href="/docs/build/skill-graph-quickstart">
              Build your agent with a skill graph <span aria-hidden="true">→</span>
            </Link>
            <Link className="v2-button v2-button-quiet" href="#rerun">
              Inspect a recorded run <span aria-hidden="true">↓</span>
            </Link>
          </div>
          </div>
          <AnswerFaces />
        </div>
      </section>

      <PhaseRail phases={PHASES} />

      <EvolutionStory />

      <header className="v21-phase-head" id="build">
        <p className="v2-kicker">01 · Build</p>
        <h2>Define the work. The agent runs it.</h2>
      </header>

      <section className="v21-scene" id="skillgraph" aria-labelledby="v21-skillgraph-title">
        <header className="v21-scene-copy">
          <p className="v2-kicker">Scope</p>
          <h2 id="v21-skillgraph-title">One state. One reachable skill.</h2>
          <p>Only its procedure, tools, and model enter the step.</p>
          <Link href="/docs/build/skill-graph-quickstart">Build the graph →</Link>
        </header>
        <SkillGraphScene />
      </section>

      <section
        className="v21-scene v21-scene-reverse"
        id="references"
        aria-labelledby="v21-reference-title"
      >
        <header className="v21-scene-copy">
          <p className="v2-kicker">Route</p>
          <h2 id="v21-reference-title">Keep the payload out of the prompt.</h2>
          <p>For stored results, the model gets a ticket. Your product redeems the real data.</p>
          <Link href="/docs/build/artifacts">Follow the two lanes →</Link>
        </header>
        <ReferenceFlow />
      </section>

      <header className="v21-phase-head" id="iterate">
        <p className="v2-kicker">02 · Iterate</p>
        <h2>The run already recorded why. Go and read it.</h2>
      </header>

      <section className="v21-scene" id="rerun" aria-labelledby="v21-rerun-title">
        <header className="v21-scene-copy">
          <p className="v2-kicker">Prove</p>
          <h2 id="v21-rerun-title">Remove the source. Rerun the case.</h2>
          <p>Changed output confirms dependence in this recorded run—not hidden reasoning.</p>
          <Link href="/docs/debug/rerun-without-sources">Test a source →</Link>
        </header>
        <RerunProof />
      </section>

      <section className="v21-production" id="lenses" aria-labelledby="v21-iterate-title">
        <header className="v21-production-head">
          <p className="v2-kicker">The lenses</p>
          <h2 id="v21-iterate-title">Open the run the way you open devtools.</h2>
        </header>

        <LensBand />

        <nav className="v21-paths" aria-label="Iterate on a recorded run">
          <Link href="/how-it-works">
            <span>See one failed run</span>
            <strong>Five layers of evidence</strong>
            <i aria-hidden="true">→</i>
          </Link>
          <Link href="/docs/debug/rerun-without-sources">
            <span>Confirm the cause</span>
            <strong>Re-run without it</strong>
            <i aria-hidden="true">→</i>
          </Link>
        </nav>
      </section>

      <header className="v21-phase-head" id="production">
        <p className="v2-kicker">03 · Run in production</p>
        <h2>Change the cloud. Keep the agent.</h2>
      </header>

      <section className="v21-scene" id="ports" aria-labelledby="v21-ports-title">
        <header className="v21-scene-copy">
          <p className="v2-kicker">Bind</p>
          <h2 id="v21-ports-title">One graph. Your stack.</h2>
          <p>
            Every backend is a typed port; every vendor is an adapter behind it. Pick the ground and
            the adapters resolve — the agent you wrote does not move.
          </p>
          <Link href="/docs">Wire your first port →</Link>
        </header>
        <PortsScene />
      </section>

      <section className="v21-production" aria-labelledby="v21-production-title">
        <h2 id="v21-production-title" className="v21-visually-hidden">
          Infrastructure detail
        </h2>

        <div className="v21-production-grid">
          <figure className="v21-runtime" aria-label="AgentFootprint connects to replaceable ports">
            <span className="v21-port is-provider">Models</span>
            <span className="v21-port is-memory">Memory</span>
            <strong>AF<small>runtime</small></strong>
            <span className="v21-port is-storage">Storage</span>
            <span className="v21-port is-telemetry">Telemetry</span>
            <figcaption>Keep the graph. Swap the edges.</figcaption>
          </figure>

          <article className="v21-field-result">
            <p className="v2-kicker">One customer implementation</p>
            <div className="v21-result-line">
              <span>~40 tools</span>
              <i aria-hidden="true">→</i>
              <strong>focused surface</strong>
            </div>
            <p>Better evaluated responses with a lower-cost model.</p>
            <small>Field result, not a benchmark. Reproduce it on your workload.</small>
            <Link href="/docs/debug/compare-strategies">See the comparison method →</Link>
          </article>
        </div>

        <section className="v21-adapters" aria-labelledby="v21-adapters-title">
          <header>
            <strong id="v21-adapters-title">
              Bring your infrastructure — AWS, Google Cloud, Microsoft Foundry, or your own
              hardware
            </strong>
            <span>
              The runtime is the whole ecosystem: models, memory, tools, identity, sessions and
              telemetry. Provision with your CDK or SDK and connect through typed ports — detach
              telemetry when export must not gate the run. Nothing about the agent you wrote
              changes when the cloud does.
            </span>
          </header>
          <ul>
            {INFRASTRUCTURE_ADAPTERS.map((group) => (
              <li key={group.port}>
                <strong>{group.port}</strong>
                <small>{group.adapters}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="v21-adapters v21-clouds" aria-labelledby="v21-clouds-title">
          <header>
            <strong id="v21-clouds-title">The same agent, on four grounds</strong>
            <span>
              agentfootprint provisions nothing and wants none of your credentials — it connects to
              what you already run. Changing ground changes which adapters you construct at the
              edge, which is the only place a vendor name should appear in your codebase.
            </span>
          </header>
          <ul>
            {CLOUDS.map((entry) => (
              <li key={entry.where}>
                <strong>{entry.where}</strong>
                <small>{entry.how}</small>
              </li>
            ))}
          </ul>
        </section>

        <nav className="v21-paths" aria-label="Choose your AgentFootprint path">
          <Link href="/features">
            <span>For product teams</span>
            <strong>See the impact</strong>
            <i aria-hidden="true">→</i>
          </Link>
          <Link href="/docs/build/skill-graph-quickstart">
            <span>For developers</span>
            <strong>Build in five minutes</strong>
            <i aria-hidden="true">→</i>
          </Link>
        </nav>
      </section>

      <section className="v21-production" id="monitor" aria-labelledby="v21-monitor-title">
        <header className="v21-production-head">
          <p className="v2-kicker">04 · Monitor · in progress</p>
          <h2 id="v21-monitor-title">Most of what you pay to understand agents is reassembly.</h2>
        </header>

        <section className="v21-adapters" aria-labelledby="v21-monitor-why">
          <header>
            <strong id="v21-monitor-why">Nothing to stitch back together</strong>
            <span>
              Everywhere else, runs are stored as fragments and the story is rebuilt later —
              correlate the ids, infer the causality, decide which line belonged to which
              decision. You pay for that twice: once for the pipeline that does it, and again in
              the confidence it never quite gives you, because a plausible reconstruction looks
              exactly like a correct one. A footprint run arrives already joined: the key tying a
              tool call to the evidence under it is written when the call happens, not derived
              afterwards.
            </span>
          </header>
          <ul>
            <li>
              <strong>The question no one else can ask</strong>
              <small>
                Every run states what it could NOT check. Aggregate that across a month and you
                are looking at where your data coverage actually fails — a pattern nobody can
                compute from logs, because nobody else writes it down.
              </small>
            </li>
            <li>
              <strong>Cost, from the other direction</strong>
              <small>
                No reassembly pipeline to run, and context scoped per step rather than a flat
                tool surface — the same reason one team reached better evaluated answers on a
                cheaper model.
              </small>
            </li>
            <li>
              <strong>What is true today</strong>
              <small>
                The recording contract this reads is shipping now, and every run already carries
                it. The library that queries across sessions is under construction — so this
                section describes where it is going, not what you can install this afternoon.
              </small>
            </li>
          </ul>
        </section>
      </section>

      {/* The closing invitation. One analogy, not four — a reader carries exactly
          one comparison out of a page, and DevTools is the one that is universally
          understood AND loved rather than merely tolerated. */}
      <section className="v21-try" aria-labelledby="v21-try-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/mascot-400.webp')}
          srcSet={`${asset('/mascot-200.webp')} 200w, ${asset('/mascot-400.webp')} 400w`}
          sizes="140px"
          width={400}
          height={400}
          alt=""
          className="v21-try-mascot"
          loading="lazy"
          decoding="async"
        />
        <h2 id="v21-try-title">Try agentfootprint</h2>
        <p>
          A front-end developer would never debug blind — <em>they open DevTools.</em> Your agents
          deserve the same.
        </p>
        <div className="v21-try-actions">
          <code>npm i agentfootprint</code>
          <Link className="v2-button v2-button-primary" href="/docs/build/skill-graph-quickstart">
            Build your first agent <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="https://github.com/footprintjs/agentfootprint">
            Star on GitHub
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
