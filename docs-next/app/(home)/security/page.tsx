import Link from 'next/link';
import type { Metadata } from 'next';
import { ReadingRow } from '@/components/site/ReadingRow';
import { SampleCode } from '@/components/site/SampleCode';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '@/components/home/stand/stand.css';
import '@/components/site/page-shell.css';
import '@/components/site/reading.css';

const TITLE = 'AI agent security, with code — AgentFootprint';
const DESCRIPTION =
  'Permissions, data privacy, tenant isolation, secrets, human approval and tamper-evident audit for AI agents, what the library catches from the model and from tools, and code to add the rest.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/security/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/security/`,
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: `${SITE.url}/opengraph-image`, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE.twitter,
    creator: SITE.twitter,
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE.url}/opengraph-image`],
  },
};

const JUMPS = [
  ['permissions', 'Permissions'],
  ['privacy', 'Data privacy'],
  ['tenants', 'Tenants'],
  ['secrets', 'Secrets'],
  ['approval', 'Approval'],
  ['catches', 'What it catches'],
  ['injection', 'Prompt injection'],
  ['chains', 'Tool chains'],
  ['audit', 'Audit'],
  ['add', 'What to add'],
] as const;

/* Each row is run by scripts/test/site-samples.test.mts, except the MCP one, which comes from the docs. */
const CATCHES = [
  [
    'The model',
    'Arguments of the wrong shape',
    'inputSchema',
    'The tool doesn’t run, and the model is told',
  ],
  [
    'The model',
    'A tool input no earlier result gave',
    'argumentsFrom',
    'On the record, and the tool still runs',
  ],
  [
    'The model',
    'A name or number no tool returned',
    '.namesAndNumbersFromEvidence()',
    'Flagged, and it can re-ask',
  ],
  [
    'The model',
    'A claim that contradicts a tool’s facts',
    '.claims()',
    'On the record, and it can withhold the answer',
  ],
  [
    'The provider',
    'A refusal or content filter',
    'stopReason',
    'On the record, and your code decides',
  ],
  ['A tool', 'Rows that break their declared columns', 'resultColumns', 'On the record'],
  ['A tool', 'A lookup that comes back empty', 'noticeEmptyLookups', 'An advisory on the record'],
  ['An MCP tool', 'A result that breaks its schema', 'outputSchema', 'Refused'],
] as const;

const CONTAINS = [
  ['Visibility', 'gatedTools hides tools from the model, recomputed every iteration.'],
  [
    'A gate at execution',
    'A permission checker runs before every tool call, with its arguments, history and caller.',
  ],
  [
    'Argument validation',
    'What the model produces is checked against the tool’s schema before it runs.',
  ],
  ['Credential scoping', 'A hijacked call to one tool can’t read another tool’s credential.'],
  ['Evidence', 'Each layer fires typed events, and they can go into an audit bundle.'],
] as const;

const ADD = [
  ['Detect injected instructions', '#injection', 'A guard on what the model is about to read'],
  ['Stop a dangerous chain of tools', '#chains', 'A checker that sees the calls so far'],
  ['Keep data away from the model', '#scrub', 'Rewrite the message and each tool result'],
  ['Keep data out of a memory store', '#memory', 'A small store subclass that filters every write'],
  [
    'Keep the final answer out of a saved recording',
    '#recording',
    'Replace it before you store the recording',
  ],
] as const;

/** What it protects, what it catches, and how to add the rest. Every sample here is run by the tests. */
export default function SecurityPage() {
  return (
    <div className="pf">
      <header className="hs-hero">
        <p className="v2-kicker">Security &amp; Trustworthy AI</p>
        <h1>What it protects, what it catches, and how to add the rest.</h1>
        <p>
          An agent reads untrusted text and can act on it. So the questions are what it can do, what
          it keeps, whose data it touches, and what you can prove afterwards. Every sample here runs
          in our tests, so copy it or hand it to your coding agent.
        </p>
      </header>
      <nav aria-label="On this page">
        <ul className="hw-jump rp-jump">
          {JUMPS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="rp-page">
        <ReadingRow
          id="permissions"
          kicker="What it can do"
          title="Decide who can call what"
          more={{
            href: '/docs/infrastructure/governance-and-policy',
            label: 'Governance and policy',
          }}
          aside={
            <SampleCode
              file="site-samples/security-permissions.ts"
              marks={['fromRoles(', 'permissionChecker:', 'gatedTools(']}
            />
          }
        >
          <p>
            One role map decides which tools the model can see and which calls can run. A refused
            call never reaches the tool, and the refusal goes on the record.
          </p>
          <p className="pf-limit">
            It decides which tools the model may use, not why the model called them.
          </p>
        </ReadingRow>

        <ReadingRow
          id="privacy"
          kicker="What it keeps"
          title="Keep what you name out of the record"
          more={{ href: '/docs/monitor/security', label: 'Keep personal data out of the record' }}
          aside={
            <SampleCode
              file="site-samples/security-record.ts"
              marks={['redact:', 'toRecording()']}
            />
          }
        >
          <p>
            Redaction is opt-in. Turn it on and the conversation, plus the fields you name, stay out
            of every record the library keeps or serves about the run.
          </p>
        </ReadingRow>

        <section className="rp-wide">
          <table className="hs-table rp-kept">
            <thead>
              <tr>
                <th scope="col">Kept out</th>
                <th scope="col">Still the real values, and how to change that</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-label="Kept out">The snapshot, the commit log and the narrative</td>
                <td data-label="Still real">
                  What the model is sent, and what your tools receive:{' '}
                  <a href="#scrub">clean what the model reads</a>
                </td>
              </tr>
              <tr>
                <td data-label="Kept out">
                  Every typed event, including what attached recorders and exporters get
                </td>
                <td data-label="Still real">
                  The answer <code>run()</code> returns, and a host’s streamed reply, which your app
                  needs
                </td>
              </tr>
              <tr>
                <td data-label="Kept out">Recordings, bug reports and answer accounts</td>
                <td data-label="Still real">
                  The final answer inside a saved recording:{' '}
                  <a href="#recording">remove it before storing</a>
                </td>
              </tr>
              <tr>
                <td data-label="Kept out">The self-explain tools</td>
                <td data-label="Still real">
                  What a memory store keeps for later runs:{' '}
                  <a href="#memory">filter what goes in</a>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <ReadingRow
          id="scrub"
          title="Clean what the model reads"
          more={{ href: '/docs/build/middleware', label: 'Middleware' }}
          aside={
            <SampleCode
              file="site-samples/security-scrub.ts"
              marks={['input:', 'onMessage:', 'onToolResult:']}
            />
          }
        >
          <p>
            Redaction leaves what the model receives alone. To change that, rewrite the message
            before the run commits it, and each tool result before the model reads it.
          </p>
        </ReadingRow>

        <ReadingRow
          id="memory"
          title="Keep data out of a memory store"
          more={{ href: '/docs/infrastructure/memory-and-stores', label: 'Memory and stores' }}
          aside={
            <SampleCode
              file="site-samples/security-memory.ts"
              marks={[
                'class ScrubbingStore',
                'put:',
                'putMany:',
                'putIfVersion:',
                'recordSignature:',
              ]}
            />
          }
        >
          <p>
            Redaction doesn’t reach a memory store, because memory is what the next run recalls. So
            filter what goes in. A small subclass does it.
          </p>
        </ReadingRow>

        <ReadingRow
          id="recording"
          title="Keep the final answer out of a saved recording"
          more={{ href: '/docs/monitor/recordings', label: 'Archive a run' }}
          aside={
            <SampleCode
              file="site-samples/security-recording.ts"
              marks={['const keepOut', 'keepOut(recorder', 'throw new Error']}
            />
          }
        >
          <p>
            A saved recording carries the final answer, even under redaction. Replace it before you
            store the recording.
          </p>
        </ReadingRow>

        <ReadingRow
          id="tenants"
          kicker="Whose data"
          title="Keep each customer’s data apart"
          more={{ href: '/docs/build/memory', label: 'Multi-tenant memory' }}
          aside={
            <SampleCode file="site-samples/security-tenants.ts" marks={['tenant:', 'forget(']} />
          }
        >
          <p>
            Pass an identity on every run. Every memory store call is scoped by it, so another
            tenant’s data reads as nothing, and <code>forget()</code> removes everything for one
            identity.
          </p>
          <p className="pf-limit">
            Leave the identity out and everything shares one default, which is fine for a prototype
            and dangerous in production.
          </p>
        </ReadingRow>

        <ReadingRow
          id="secrets"
          kicker="What it holds"
          title="Keep secrets away from the model"
          more={{
            href: '/docs/infrastructure/identity-and-credentials',
            label: 'Identity and credentials',
          }}
          aside={
            <SampleCode
              file="site-samples/security-secrets.ts"
              marks={['needs:', 'ctx.credential', 'credentials:']}
            />
          }
        >
          <p>
            A tool declares what it needs. The credential is resolved when that tool runs and handed
            to that tool alone, so it never passes through the prompt or the record.
          </p>
        </ReadingRow>

        <ReadingRow
          id="approval"
          kicker="Who decides"
          title="Have a person approve the big ones"
          more={{ href: '/docs/monitor/checkin', label: 'Check in with the receipts' }}
          aside={
            <SampleCode
              file="site-samples/security-approve.ts"
              marks={['checkIn:', 'isCheckInPause(', 'checkInApproved(']}
            />
          }
        >
          <p>
            A tool can require a check-in. The run pauses before the tool executes, and the person
            sees what it will do, what it read and what drove the choice. Their decision goes on the
            record.
          </p>
        </ReadingRow>

        <section className="rp-wide" id="catches" aria-labelledby="rp-catches-title">
          <p className="v2-kicker">What it catches</p>
          <h3 id="rp-catches-title">It checks the model, the provider and the tools</h3>
          <p>
            Each check compares what happened against the record or your declaration.{' '}
            <Link href="/how-it-stands" prefetch={false}>
              How it stands
            </Link>{' '}
            explains who decides each one.
          </p>
          <table className="hs-table rp-catches">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">What it catches</th>
                <th scope="col">Turn it on with</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              {CATCHES.map(([from, what, api, then]) => (
                <tr key={api}>
                  <td data-label="From">{from}</td>
                  <td data-label="Catches">{what}</td>
                  <td data-label="Turn it on with">
                    <code>{api}</code>
                  </td>
                  <td data-label="What happens">{then}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <ReadingRow
          title="Most of them are one line"
          more={{ href: '/docs/monitor/context-integrity', label: 'Context Integrity' }}
          aside={
            <SampleCode
              file="site-samples/security-catches.ts"
              marks={[
                'argumentsFrom:',
                'resultColumns:',
                'namesAndNumbersFromEvidence()',
                'context_error',
                'stopReason',
              ]}
            />
          }
        >
          <p>Three more protections are always on:</p>
          <ul className="rp-facts">
            <li>
              Text a tool returns can’t steer the run. Control goes through a typed result, not a
              string like ROUTE:billing.
            </li>
            <li>
              Memory and parallel-branch text is escaped, so it can’t break out of its own block.
            </li>
            <li>
              A rejected draft comes back to the model marked as quoted data, not as instructions.
            </li>
          </ul>
        </ReadingRow>

        <ReadingRow
          id="injection"
          kicker="Prompt injection"
          title="Add your own check for injected instructions"
          more={{ href: '/docs/monitor/security', label: 'Prompt injection in the docs' }}
          aside={
            <SampleCode
              file="site-samples/security-guard.ts"
              marks={['quarantine', 'afterTool:']}
            />
          }
        >
          <p>
            The library has no classifier for injected instructions, and a steered model can still
            use any tool it’s allowed. So plug yours in at the moment untrusted text arrives, as in
            this sample. Here’s what limits the damage either way:
          </p>
          <ul className="rp-facts">
            {CONTAINS.map(([name, what]) => (
              <li key={name}>
                <strong>{name}.</strong> {what}
              </li>
            ))}
          </ul>
        </ReadingRow>

        <ReadingRow
          id="chains"
          title="Stop a dangerous chain of tools"
          more={{ href: '/docs/build/sequence-governance', label: 'Sequence governance' }}
          aside={
            <SampleCode
              file="site-samples/security-sequence.ts"
              marks={['sequence?.some', 'halt']}
            />
          }
        >
          <p>
            Each call can be fine while the chain isn’t: read a customer file, then email it out. A
            checker sees the calls made so far and can end the run.
          </p>
        </ReadingRow>

        <ReadingRow
          id="audit"
          kicker="What you can prove"
          title="Show the record hasn’t changed"
          more={{ href: '/docs/monitor/exporters', label: 'Exporters' }}
          aside={
            <SampleCode
              file="site-samples/security-audit.ts"
              marks={['auditExport(', 'verifyAuditBundle(']}
            />
          }
        >
          <p>
            <code>auditExport()</code> hash-chains every typed event into a plain JSON bundle.{' '}
            <code>verifyAuditBundle()</code> checks it offline, with no agent, and names the record
            a change broke.
          </p>
          <p>
            Payloads stay bounded by default: structure is kept, and prompts and answers become
            markers.
          </p>
        </ReadingRow>

        <section className="rp-wide" id="add" aria-labelledby="rp-add-title">
          <h3 id="rp-add-title">Not built in, and how to add it</h3>
          <table className="hs-table rp-kept">
            <thead>
              <tr>
                <th scope="col">What you need</th>
                <th scope="col">What to copy</th>
              </tr>
            </thead>
            <tbody>
              {ADD.map(([need, href, how]) => (
                <tr key={href}>
                  <td data-label="You need">{need}</td>
                  <td data-label="Copy">
                    <a href={href}>{how}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            The library isn’t a compliance certification. It gives you controls and evidence for
            your own review.
          </p>
        </section>
      </div>

      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/how-it-stands" prefetch={false}>
            How an answer is held to the record <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/how-to-build" prefetch={false}>
            Demo to App <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
