import Link from 'next/link';
import type { Metadata } from 'next';
import { ReadingRow } from '@/components/site/ReadingRow';
import { SampleCode } from '@/components/site/SampleCode';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '@/components/home/stand/stand.css';
import '@/components/site/reading.css';

const TITLE = 'Prompt, context, loop and harness engineering, with code — AgentFootprint';
const DESCRIPTION =
  'What prompt engineering, context engineering, loop engineering and harness engineering mean for an agent, with code for each in TypeScript.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/engineering/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/engineering/`,
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

/** The four names, inside out. How to build is ordered by when you do something, and this page by what you specialise in. */
export default function EngineeringPage() {
  return (
    <div className="pf">
      <header className="hs-hero">
        <p className="v2-kicker">For engineers</p>
        <h1>Prompt, context, loop, harness. The code for each.</h1>
        <p>Four names for four layers of the same work. Each one sits inside the next.</p>
      </header>

      <div className="eng-layers eng-harness">
        <a href="#harness">
          <strong>Harness engineering</strong> everything around the model
        </a>
        <div className="eng-layers eng-loop">
          <a href="#loop">
            <strong>Loop engineering</strong> what happens between model calls
          </a>
          <div className="eng-layers eng-context">
            <a href="#context">
              <strong>Context engineering</strong> what the model sees each time
            </a>
            <div className="eng-layers eng-prompt">
              <a href="#prompt">
                <strong>Prompt engineering</strong> the words it reads
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="rp-page">
        <ReadingRow
          id="prompt"
          kicker="Layer 1"
          title="Prompt engineering"
          more={{ href: '/docs/build/instructions', label: 'Instructions' }}
          aside={
            <SampleCode
              file="site-samples/eng-prompt.ts"
              marks={['activeWhen:', '.instruction(']}
            />
          }
        >
          <p>The words the model reads. Here they don’t have to be one long string.</p>
          <p>
            Each rule has a name, and it applies only when its condition holds. In this sample a
            calm message never carries the rule about tone, and an upset one does.
          </p>
        </ReadingRow>

        <ReadingRow
          id="context"
          kicker="Layer 2"
          title="Context engineering"
          more={{ href: '/docs/getting-started/key-concepts', label: 'Key concepts' }}
          aside={
            <SampleCode
              file="site-samples/eng-context.ts"
              marks={['.steering(', '.fact(', '.skill(', '.memory(', 'onEngineered(']}
            />
          }
        >
          <p>What the model gets to see, each time it’s called.</p>
          <p>
            Steering, facts, skills, memory and retrieved documents each land in the system prompt,
            the messages or the tools, at a moment you choose. The context is rebuilt on every
            iteration, and you can list what landed and where.
          </p>
        </ReadingRow>

        <ReadingRow
          id="loop"
          kicker="Layer 3"
          title="Loop engineering"
          more={{ href: '/docs/build/loop-moments', label: 'The moments of the loop' }}
          aside={
            <SampleCode
              file="site-samples/eng-loop.ts"
              marks={['.act({', 'input:', 'beforeTool:', 'afterTool:', 'window:', 'output:']}
            />
          }
        >
          <p>What happens between model calls.</p>
          <p>
            A turn has five moments where your rules can act. A rule can rewrite what passes through
            or refuse a call, and it can’t invent a tool’s result, so what the model reads is the
            real output or a refusal.
          </p>
        </ReadingRow>

        <ReadingRow
          title="Re-run it on a timer"
          more={{ href: '/docs/build/patterns', label: 'Compositions and patterns' }}
          aside={
            <SampleCode
              file="site-samples/eng-loop-timer.ts"
              marks={['Loop.create(', '.until(', 'onSchedule']}
            />
          }
        >
          <p>
            Some people use loop engineering for a system that prompts, checks, remembers and
            re-runs an agent on a timer.
            <code>Loop</code> does the re-running. The timer is yours, because the library doesn’t
            run a scheduler.
          </p>
        </ReadingRow>

        <ReadingRow
          id="harness"
          kicker="Layer 4"
          title="Harness engineering"
          more={{ href: '/how-to-build', label: 'How to build' }}
          aside={
            <SampleCode
              file="site-samples/eng-harness.ts"
              marks={[
                'withFallback(',
                'permissionChecker:',
                'redact:',
                '.act(',
                '.selfExplain()',
                'auditExport(',
              ]}
            />
          }
        >
          <p>
            Everything around the model. The shorthand is agent = model + harness: the loop, tools,
            context and controls.
          </p>
          <p>
            Here the harness is your code, not a product you log in to. So the prompt, the tools,
            the rules and the proof sit together in one place you can read and test.
          </p>
        </ReadingRow>
      </div>

      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/how-to-build" prefetch={false}>
            Build, debug, deploy, monitor <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/security" prefetch={false}>
            Security <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
