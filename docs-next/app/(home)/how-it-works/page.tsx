import Link from 'next/link';
import type { Metadata } from 'next';
import { HowStory } from '@/components/home/how/HowStory';
import { StandUniverse } from '@/components/home/stand/StandUniverse';
import { StandViewProvider } from '@/components/home/stand/StandView';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '../v2.css';
import '@/components/home/stand/stand.css';

const TITLE = 'How AgentFootprint works — trace a wrong answer to its cause';
const DESCRIPTION =
  'Follow one agent run from a wrong answer through context provenance, backward slicing, and controlled replay.';

const CODE = `import { localizeContextBug, rerunWithoutSources, embeddingCache } from 'agentfootprint/observe';

// Point it at the step that went wrong. It ranks the suspects.
const report = await localizeContextBug({
  artifacts, // { snapshot, events } from the recorded run
  embedder: embeddingCache(embedder),
  atStep: answerStep,
});

// Remove one source and run the case again.
const again = await rerunWithoutSources({
  report,
  ignore: ['refund-policy'],
  runner,
  originalAnswer,
  embedder: embeddingCache(embedder),
  answerChanged: (a, b) => a.includes('APPROVED') !== b.includes('APPROVED'),
});`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/how-it-works/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/how-it-works/`,
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

export default function HowItWorksPage() {
  return (
    <div className="v2-home">
      {/* Tells the CSS a script ran, so a scene only takes up room when it can play. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('sf-js')" }} />
      <StandViewProvider>
        <HowStory />
      </StandViewProvider>

      <section className="sc" id="how-next" aria-labelledby="how-code-title">
        <header className="sc-head">
          <p className="v2-kicker">What you run</p>
          <h2 id="how-code-title">Rank the suspects. Then test one.</h2>
          <p>
            Both ship today and carry a beta marker. Scores from an embedding are proxies, so the rerun is what tests a
            source, and only for this case.
          </p>
        </header>
        <pre className="sc-code" tabIndex={0}>
          <code>
            {CODE.split('\n').map((line, i) => (
              <span className="sc-line" key={i}>
                {line || ' '}
              </span>
            ))}
          </code>
        </pre>
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/docs/debug/localize-context-bug" prefetch={false}>
            Read the debugging guide <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/how-it-works/walkthrough" prefetch={false}>
            The full walkthrough <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/how-it-stands" prefetch={false}>
            Before it answers: how it stands <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="sc hw-all" aria-labelledby="how-all-title">
        <header className="sc-head">
          <p className="v2-kicker">How it all fits together</p>
          <h2 id="how-all-title">Context goes in. An answer comes out. Every step leaves a note.</h2>
        </header>
        <StandUniverse />
      </section>

      <SiteFooter />
    </div>
  );
}
