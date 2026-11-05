import Link from 'next/link';
import { EvolutionStory } from '@/components/home/v2/EvolutionStory';
import { LensBand } from '@/components/home/v2/LensBand';
import { PortsScene } from '@/components/home/v2/PortsScene';
import { ReferenceFlow, RerunProof } from '@/components/home/v2/ProductScenes';
import { SkillGraphScene } from '@/components/home/v2/SkillGraphScene';
import { StandNode } from './StandNode';
import { StandStageBar, StandStages } from './StandStages';

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
  {
    port: 'Reliability',
    adapters: 'withRetry · withFallback · withCircuitBreaker · retry and fail-fast rules',
  },
] as const;

/** Where the same agent runs, with the adapters you would actually use there.
 *  Verified against src/adapters before being written — an adapter appears here
 *  after it lands, never before. */
const CLOUDS = [
  { where: 'AWS', how: 'Bedrock models · AgentCore runtime · S3 · CloudWatch · X-Ray' },
  { where: 'Google Cloud', how: 'Gemini and Vertex models · Vertex sessions · Cloud Storage' },
  { where: 'Microsoft Foundry', how: 'Foundry hosting and models · Azure OpenAI · Entra ID' },
  {
    where: 'Your own hardware',
    how: 'Ollama · PostgreSQL · SQLite · your process · OpenTelemetry',
  },
] as const;

/** The framework beyond the answer check: why Node.js, the four stages, and each stage in turn. */
export function StandDetails() {
  return (
    <>
      <header className="v21-lifecycle-bridge" id="stages">
        <p className="v2-kicker">The whole framework</p>
        <h1>A full agent framework, built around that record.</h1>
        <p>
          You build in it, debug from the recorded run, serve it on your stack, and monitor its
          events.
        </p>
      </header>

      <StandStages />

      <div className="ls-flow">
        <StandStageBar />

        <header className="v21-phase-head" id="build">
          <p className="v2-kicker">01 · Build</p>
          <h2>Turn the runbook into a path the agent can walk.</h2>
        </header>

        <section className="v21-scene" id="skillgraph" aria-labelledby="v21-skillgraph-title">
          <header className="v21-scene-copy">
            <p className="v2-kicker">Scope</p>
            <h2 id="v21-skillgraph-title">One state. One reachable skill.</h2>
            <p>
              With tool scoping enabled, the selected skill brings its procedure, tools and model into
              the step.
            </p>
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

        <header className="v21-phase-head" id="debug">
          <p className="v2-kicker">02 · Debug</p>
          <h2>Walk back from an answer to the notes behind it.</h2>
        </header>

        <section className="v21-production" id="lenses" aria-labelledby="v21-debug-title">
          <header className="v21-production-head">
            <p className="v2-kicker">View · five lenses</p>
            <h2 id="v21-debug-title">One recorded run. Five ways to inspect it.</h2>
          </header>

          <LensBand />

          <nav className="v21-paths" aria-label="Debug a recorded run">
            <Link href="/how-it-works">
              <span>See one failed run</span>
              <strong>Five layers of evidence</strong>
              <i aria-hidden="true">→</i>
            </Link>
            <Link href="/docs/debug/rerun-without-sources">
              <span>Test dependence</span>
              <strong>Rerun without a source</strong>
              <i aria-hidden="true">→</i>
            </Link>
            <Link href="/docs/debug/offline-replay">
              <span>Open it again later</span>
              <strong>Replay a saved run</strong>
              <i aria-hidden="true">→</i>
            </Link>
          </nav>
        </section>

        <section className="v21-scene" id="rerun" aria-labelledby="v21-rerun-title">
          <header className="v21-scene-copy">
            <p className="v2-kicker">Test</p>
            <h2 id="v21-rerun-title">Remove one source. Rerun the case.</h2>
            <p>
              If the output changes under the same baseline, you have evidence of dependence in this
              case—not hidden reasoning.
            </p>
            <Link href="/docs/debug/rerun-without-sources">Test a source →</Link>
          </header>
          <RerunProof />
        </section>

        <header className="v21-phase-head" id="production">
          <p className="v2-kicker">03 · Run in production</p>
          <h2>Serve on your stack. Keep the graph.</h2>
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
              <strong>
                AF<small>runtime</small>
              </strong>
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
                Bring your infrastructure — AWS, Google Cloud, Microsoft Foundry, or your own hardware
              </strong>
              <span>
                The runtime is the whole ecosystem: models, memory, tools, identity, sessions and
                telemetry. Provision with your CDK or SDK and connect through typed ports — detach
                telemetry when export must not gate the run. Nothing about the agent you wrote changes
                when the cloud does.
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
            <p className="v2-kicker">04 · Monitor</p>
            <h2 id="v21-monitor-title">
              Watch, export, archive, and learn from the same event stream.
            </h2>
          </header>

          <section className="v21-adapters" aria-labelledby="v21-monitor-why">
            <header>
              <strong id="v21-monitor-why">The monitoring foundation ships today</strong>
              <span>
                Subscribe to typed events while the agent runs, send them to your existing backend, or
                persist the complete recording. The joins are written during traversal, so each
                downstream tool starts from the same connected run.
              </span>
            </header>
            <ul>
              <li>
                <strong>Watch and export</strong>
                <small>
                  Use <code>.on()</code> for typed decisions, tools, cost, errors, and coverage; mount{' '}
                  <code>.enable.observability()</code> to send the same stream to OTel, CloudWatch,
                  NDJSON, or an audit bundle.
                </small>
              </li>
              <li>
                <strong>Archive the joined run</strong>
                <small>
                  <code>recordRun()</code> captures state, events, and structure together;{' '}
                  <code>persistRecording()</code> writes the versioned envelope to your sink.
                </small>
              </li>
              <li>
                <strong>Learn across runs</strong>
                <small>
                  <code>contextLedger()</code> already aggregates which skills, tools, and injections
                  earned their context. Dedicated cross-session coverage-gap queries are in progress;
                  today, aggregate the typed absence and coverage events in your sink.
                </small>
              </li>
            </ul>
          </section>
        </section>
      </div>

      <EvolutionStory />

      <StandNode />
    </>
  );
}
