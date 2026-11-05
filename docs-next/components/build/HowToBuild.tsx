import { ShareWithAgent } from '@/components/site/ShareWithAgent';
import Link from 'next/link';
import { AdapterTable } from '@/components/features/AdapterTable';
import { PortsScene } from '@/components/home/v2/PortsScene';
import { ReferenceFlow } from '@/components/home/v2/ProductScenes';
import { SkillGraphScene } from '@/components/home/v2/SkillGraphScene';
import { StandNode } from '@/components/home/stand/StandNode';
import { StandStageBar, StandStages } from '@/components/home/stand/StandStages';
import { ReadingRow } from '@/components/site/ReadingRow';
import { SampleCode } from '@/components/site/SampleCode';
import { LENSES } from './lenses';

/** The libraries around this one, each with what it does for you. Published on npm, all of them. */
const FAMILY = [
  {
    group: 'Underneath it',
    name: 'footprintjs',
    what: 'The flow engine. It records each stage as the run happens.',
  },
  {
    group: 'Underneath it',
    name: 'foottrace',
    what: 'Reads a saved record: replay, time travel and attribution.',
  },
  {
    group: 'Underneath it',
    name: 'contextfootprint',
    what: 'Compares claims for conflicting values, for the context integrity checks.',
  },
  {
    group: 'To see a run',
    name: 'agentfootprint-lens',
    what: 'React components for inspecting a recorded agent run.',
  },
  {
    group: 'To see a run',
    name: 'footprint-explainable-ui',
    what: 'React components for a run’s stages, its state changes and time travel.',
  },
] as const;

/** How to build an agent with this framework, in the order you would do it. */
export function HowToBuild() {
  return (
    <>
      <header className="v21-lifecycle-bridge" id="stages">
        <p className="v2-kicker">Demo to App</p>
        <h1>The same agent, from your laptop to production.</h1>
        <p>
          Write it against a scripted model, debug it from its own record, deploy it on your
          infrastructure one adapter at a time, and monitor what it does.
        </p>
        <div className="sc-links">
          <ShareWithAgent />
        </div>
      </header>

      <StandStages />

      <div className="ls-flow">
        <StandStageBar />

        <header className="v21-phase-head" id="build">
          <p className="v2-kicker">01 · Build</p>
          <h2>Start with a scripted model. Then bring the real one.</h2>
        </header>

        <ReadingRow
          title="Test the wiring for free"
          more={{ href: '/docs/debug/testing', label: 'Testing with mock()' }}
          aside={<SampleCode file="site-samples/build-mock.ts" marks={['mock({']} />}
        >
          <p>
            A scripted model is free, offline and the same every time. Use it to prove the tools,
            the context and the control flow work. Most bugs show up here.
          </p>
        </ReadingRow>

        <ReadingRow
          title="Bring the real model to tune its reasoning"
          more={{ href: '/docs/build/anthropic', label: 'Real providers' }}
          aside={<SampleCode file="site-samples/build-real.ts" marks={['anthropic(', 'model:']} />}
        >
          <p>
            A scripted model can’t tell you how a real one reasons. So change the provider and
            model, and leave the rest of the agent alone. A local model through{' '}
            <code>ollama()</code> works the same way.
          </p>
        </ReadingRow>

        <section className="v21-scene" id="skillgraph" aria-labelledby="v21-skillgraph-title">
          <header className="v21-scene-copy">
            <p className="v2-kicker">As it grows</p>
            <h2 id="v21-skillgraph-title">Turn the runbook into a path.</h2>
            <p>
              One state, one reachable skill. With tool scoping on, the selected skill brings its
              procedure, tools and model into the step. To run a written procedure as one tool, use{' '}
              <code>runbookAsTool</code>.
            </p>
            <Link href="/docs/build/skill-graph-quickstart">Build the graph →</Link>
            <Link href="/docs/build/runbook-as-tool">Runbook as tool →</Link>
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

        <ReadingRow
          id="know"
          kicker="What it knows"
          title="Give it a map of your data"
          more={{ href: '/docs/build/agent', label: 'The ontology' }}
          aside={
            <SampleCode
              file="site-samples/know-ontology.ts"
              marks={['defineOntology({', '.ontology(map)', 'via:']}
            />
          }
        >
          <p>
            When a result doesn’t hold what a question needs, the map tells the model what each term
            means, which source holds it and which tool reads it. So it can say where the answer
            would be, instead of guessing.
          </p>
          <p className="pf-limit">It’s a map, not a way to fetch. A tool still reads the data.</p>
        </ReadingRow>

        <ReadingRow
          title="Pass a ticket, not the rows"
          more={{ href: '/docs/build/artifacts', label: 'Artifacts' }}
          aside={<SampleCode file="site-samples/know-refs.ts" marks={['wants:', 'artifacts:']} />}
        >
          <p>
            Past a size you set, the store keeps a tool’s result and the model gets a short ticket.
            A tool that declares <code>wants</code> receives the data behind the ticket, so 48,000
            rows never enter the prompt.
          </p>
        </ReadingRow>

        <ReadingRow
          title="Give it a clock"
          more={{ href: '/docs/build/time', label: 'Time' }}
          aside={
            <SampleCode
              file="site-samples/know-time.ts"
              marks={['.time({', 'time: {', 'zoneSource']}
            />
          }
        >
          <p>
            “Errors since 8” means nothing without a clock: which day, which zone, which eight.
            Declare it for each run, and it goes on the record along with where it came from.
          </p>
        </ReadingRow>

        <header className="v21-phase-head" id="debug">
          <p className="v2-kicker">02 · Debug</p>
          <h2>Turn on the tools that read the run.</h2>
          <p className="rp-lede">
            This is what to switch on. For how the walk back from a wrong answer works, see{' '}
            <Link href="/how-we-debug" prefetch={false}>
              How we debug
            </Link>
            .
          </p>
        </header>

        <ReadingRow
          title="Let it read its own log"
          more={{ href: '/docs/debug/self-explain', label: 'Ask your agent why' }}
          aside={<SampleCode file="site-samples/debug-self.ts" marks={['.selfExplain()']} />}
        >
          <p>
            One line mounts a skill whose tools read the agent’s own record. They stay out of the
            tool list until someone asks why, and they read the previous turn’s evidence.
          </p>
        </ReadingRow>

        <ReadingRow
          title="Or point a second agent at a saved run"
          aside={<SampleCode file="site-samples/debug-trace.ts" marks={['traceDebugAgent({']} />}
        >
          <p>
            <code>traceDebugAgent()</code> works from a saved recording, so it can be a cheap model
            in its own session, long after the run has finished.
          </p>
        </ReadingRow>

        <ReadingRow
          title="See it in Lens"
          more={{
            href: 'https://github.com/footprintjs/agentfootprint-lens',
            label: 'Lens on GitHub',
          }}
          aside={
            <SampleCode
              file="site-samples/debug-lens.tsx"
              marks={['lensRecorder()', '<Lens ', 'recorder.observe']}
            />
          }
        >
          <p>
            Three lines of wiring give you a React view of the run. One recorded run, read five
            ways:
          </p>
          <ul className="rp-lenses">
            {LENSES.map((lens) => (
              <li key={lens.lens}>
                <strong>{lens.lens}</strong> {lens.question}
              </li>
            ))}
          </ul>
        </ReadingRow>

        <ReadingRow
          id="evals"
          title="Bring your own evals"
          more={{ href: '/docs/debug/compare-strategies', label: 'Compare two strategies' }}
          aside={<SampleCode file="site-samples/debug-evals.ts" marks={['eval.score']} />}
        >
          <p>
            The library ships no grader, so that part stays yours. It gives you the record to grade,
            a typed event to file the score, and a way to compare two versions under the same
            baseline.
          </p>
        </ReadingRow>

        <header className="v21-phase-head" id="deploy">
          <p className="v2-kicker">03 · Deploy</p>
          <h2>Your infrastructure, through adapters.</h2>
          <p className="rp-lede">
            Everything the agent touches is a port, and each adapter fills one port for one backend.
            It grows by adding adapters, and the agent you wrote doesn’t change. The library
            provisions nothing: you bring the runtime.
          </p>
        </header>

        <section className="v21-scene" id="ports" aria-labelledby="v21-ports-title">
          <header className="v21-scene-copy">
            <p className="v2-kicker">Bind</p>
            <h2 id="v21-ports-title">One graph. Your stack.</h2>
            <p>Pick the ground and the adapters resolve. The agent you wrote does not move.</p>
            <Link href="/docs/infrastructure">Ports and adapters →</Link>
          </header>
          <PortsScene />
        </section>

        <section className="rp-wide">
          <h3>Memory, sessions and runtime, on two clouds</h3>
          <p>
            The same three things change, and the agent’s shape doesn’t. Both samples are
            type-checked, not run, because they need a cloud account.
          </p>
          <div className="rp-pair">
            <SampleCode
              file="site-samples/deploy-aws.ts"
              title="AWS"
              marks={['store:', 'host:', 'sessions:', 'provider:']}
            />
            <SampleCode
              file="site-samples/deploy-google.ts"
              title="Google Cloud"
              marks={['store:', 'host:', 'sessions:', 'provider:']}
            />
          </div>
        </section>

        <section className="rp-wide" id="adapters">
          <h3>Where each port has an adapter today</h3>
          <AdapterTable />
        </section>

        <ReadingRow
          id="write-your-own"
          title="No adapter yet? Write one."
          more={{ href: '/docs/build/custom-provider', label: 'Custom provider' }}
          aside={
            <SampleCode file="site-samples/deploy-own.ts" marks={['const myModel', 'complete:']} />
          }
        >
          <p>
            New model, store or tracing backend next year? Write one adapter, and your agent code
            stays the same. This is a whole model adapter, and the record keeps working with it.
          </p>
          <p>
            Not every port is this small: <code>MemoryStore</code> has eleven required members. And
            something no port or moment covers would still need a change to the library.
          </p>
        </ReadingRow>

        <ReadingRow
          id="front-end"
          title="Connect your front end"
          more={{ href: '/docs/infrastructure/ag-ui', label: 'AG-UI frontends' }}
          aside={
            <SampleCode
              file="../examples/deploy/ag-ui.ts"
              region="serve"
              marks={['streamHandler({', 'agUi()', 'verifiedThreads']}
            />
          }
        >
          <p>
            AG-UI frontends such as CopilotKit POST one request and read one stream of typed events.
            One handler serves them, with a fresh agent per request, the conversation kept on the
            server, and threads keyed by the verified caller.
          </p>
        </ReadingRow>

        <header className="v21-phase-head" id="monitor">
          <p className="v2-kicker">04 · Monitor</p>
          <h2>Watch it, ship the events, and keep your own.</h2>
        </header>

        <ReadingRow
          title="Native events, OpenTelemetry and the rest"
          more={{ href: '/docs/monitor/exporters', label: 'Exporters' }}
          aside={
            <SampleCode
              file="site-samples/monitor-export.ts"
              marks={['.on(', 'otelObservability({', 'detach:']}
            />
          }
        >
          <p>
            Listen to typed events directly, or send the same stream to OpenTelemetry, CloudWatch,
            X-Ray or AgentCore. Detach delivery with a driver, and a sink’s work moves off the
            agent’s call path.
          </p>
        </ReadingRow>

        <ReadingRow
          id="recorders"
          title="Your own recorder, for anything specific to your product"
          more={{ href: '/docs/monitor/observability', label: 'Observability' }}
          aside={
            <SampleCode file="site-samples/monitor-custom.ts" marks={['onWrite:', '.emit(']} />
          }
        >
          <p>
            The built-in recorders work the same way. Yours sees every state write as the run
            happens, and your own events reach your listeners and exporters alongside the library’s.
          </p>
        </ReadingRow>

        <ReadingRow
          title="Keep the whole run"
          more={{ href: '/docs/monitor/recordings', label: 'Archive a run' }}
          aside={
            <ul className="rp-facts">
              <li>
                <code>recordRun()</code> captures state, events and structure together.
              </li>
              <li>
                <code>persistRecording()</code> writes the versioned envelope to your sink.
              </li>
              <li>
                <code>contextLedger()</code> adds up which skills, tools and injections earned their
                context.
              </li>
            </ul>
          }
        >
          <p>
            For proof that a record hasn’t changed since it was captured, see{' '}
            <Link href="/security#audit" prefetch={false}>
              auditing
            </Link>
            .
          </p>
        </ReadingRow>
      </div>

      <section className="rp-wide rp-family" id="family" aria-labelledby="rp-family-title">
        <p className="v2-kicker">The family</p>
        <h2 id="rp-family-title">The libraries around it.</h2>
        <ul>
          {FAMILY.map((item) => (
            <li key={item.name}>
              <small>{item.group}</small>
              <a
                href={`https://www.npmjs.com/package/${item.name}`}
                target="_blank"
                rel="noreferrer"
              >
                <code>{item.name}</code>
              </a>
              <span>{item.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <StandNode />
    </>
  );
}
