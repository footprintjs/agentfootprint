import Link from 'next/link';
import type { Metadata } from 'next';
import { ReadingRow } from '@/components/site/ReadingRow';
import { SampleCode } from '@/components/site/SampleCode';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '@/components/home/stand/stand.css';
import '@/components/site/reading.css';

const TITLE = 'AI agent security, with code — AgentFootprint';
const DESCRIPTION =
  'Permissions, data privacy, tenant isolation, secrets, human approval and tamper-evident audit for AI agents, with code for each, and a plain statement of what the library does not do.';

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
  ['audit', 'Audit'],
  ['injection', 'Prompt injection'],
  ['limits', 'What’s not included'],
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

/** What it protects, with the code, and what it does not. Every sample here is run by the tests. */
export default function SecurityPage() {
  return (
    <div className="pf">
      <header className="hs-hero">
        <p className="v2-kicker">AI security</p>
        <h1>What it protects, with the code. And what it doesn’t.</h1>
        <p>
          An agent reads untrusted text and can act on it. So the questions are what it can do, what
          it keeps, whose data it touches, and what you can prove afterwards.
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
                <th scope="col">Still the real values</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-label="Kept out">The snapshot, the commit log and the narrative</td>
                <td data-label="Still real">What the model is sent, and what your tools receive</td>
              </tr>
              <tr>
                <td data-label="Kept out">
                  Every typed event, including what attached recorders and exporters get
                </td>
                <td data-label="Still real">
                  The answer <code>run()</code> returns, and a host’s streamed reply
                </td>
              </tr>
              <tr>
                <td data-label="Kept out">Recordings, bug reports and answer accounts</td>
                <td data-label="Still real">The final answer inside a saved recording</td>
              </tr>
              <tr>
                <td data-label="Kept out">The self-explain tools</td>
                <td data-label="Still real">What a memory store keeps for later runs</td>
              </tr>
            </tbody>
          </table>
        </section>

        <ReadingRow
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
            Redaction doesn’t change what the model receives. To do that, rewrite the message before
            the run commits it, and each tool result before the model reads it.
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

        <ReadingRow
          id="injection"
          kicker="What it does not do"
          title="It doesn’t detect prompt injection"
          more={{ href: '/docs/monitor/security', label: 'Prompt injection in the docs' }}
          aside={
            <SampleCode
              file="site-samples/security-guard.ts"
              marks={['quarantine', 'afterTool:']}
            />
          }
        >
          <p>
            There’s no input classifier, tool-output scanner or guard model in the library. If you
            need detection, plug yours in at the right moment, as in this sample. Here is what
            limits the damage:
          </p>
          <ul className="rp-facts">
            {CONTAINS.map(([name, what]) => (
              <li key={name}>
                <strong>{name}.</strong> {what}
              </li>
            ))}
          </ul>
        </ReadingRow>

        <section className="rp-wide rp-limits" id="limits">
          <h3>What’s not included</h3>
          <ul>
            <li>Prompt-injection detection of any kind.</li>
            <li>
              Redaction of what the model or your tools receive, or of the final answer in a saved
              recording.
            </li>
            <li>
              Scrubbing what a memory store keeps, so filter what you write before it’s stored.
            </li>
            <li>
              A compliance certification. These are controls and evidence for your own review, and
              they don’t replace it.
            </li>
          </ul>
        </section>
      </div>

      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/how-it-stands" prefetch={false}>
            How an answer is held to the record <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/how-to-build" prefetch={false}>
            How to build <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
