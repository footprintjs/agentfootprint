import Link from 'next/link';
import type { Metadata } from 'next';
import { Chapters } from '@/components/home/Chapters';
import { ChapterRail } from '@/components/home/ChapterRail';
import { HeroTrace } from '@/components/home/HeroTrace';
import { SITE, asset } from '@/lib/site';

const HOME_TITLE = 'agentfootprint — Find the context that made your agent answer wrong';
const HOME_DESC =
  'The explainable agent framework. Every run records its own causal trace, so when the answer is wrong you backtrack to the exact context that caused it — confirmed by re-running without it. Why is a query, not a guess.';

export const metadata: Metadata = {
  // `absolute` bypasses the layout's "%s · agentfootprint" template — the home title
  // already leads with the brand, so we don't want it appended twice.
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
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [`${SITE.url}/opengraph-image`],
  },
};

// Structured data — helps search engines associate the "agentfootprint" entity with the
// footprintjs org, the author, the GitHub repos and the npm package (the user's queries:
// "agentfootprint github / sanjay / footprintjs"). Rendered as JSON-LD in <head>.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE.url}/#website`,
      url: `${SITE.url}/`,
      name: SITE.name,
      description: SITE.description,
      publisher: { '@id': `${SITE.url}/#org` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE.url}/#org`,
      name: SITE.publisher,
      url: SITE.org,
      sameAs: [SITE.org, SITE.repo, SITE.core, SITE.npm],
    },
    {
      '@type': 'Person',
      '@id': `${SITE.url}/#author`,
      name: SITE.author,
      url: SITE.org,
    },
    {
      '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
      '@id': `${SITE.url}/#software`,
      name: SITE.name,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js, browser',
      programmingLanguage: 'TypeScript',
      description: SITE.description,
      url: `${SITE.url}/`,
      codeRepository: SITE.repo,
      author: { '@id': `${SITE.url}/#author` },
      publisher: { '@id': `${SITE.url}/#org` },
      sameAs: [SITE.repo, SITE.npm],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://opensource.org/licenses/MIT',
    },
  ],
};

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="af-home">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* hero — mascot centered on top, then two columns: the claim (left) + live trace (right) */}
      <section className="af-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/mascot.png')}
          alt="agentfootprint mascot — it pulls scattered context in and hands back clean, traceable slots"
          className="af-hero-mascot"
        />
        <div className="af-hero-grid">
          <div className="af-hero-text">
            <span className="af-pill">
              <span className="af-pill-dot" /> open source · MIT · mock-first
            </span>
            <h1>
              Find the context that made your agent <em>answer wrong.</em>
            </h1>
            <p className="lede">
              Debug why your AI agent gave the wrong answer — and prove the fix by re-running
              without the cause.
            </p>
            <p className="tagline">
              <em>Why</em> is a query, not a guess.
            </p>
            <div className="af-hero-cta">
              <Link className="af-cta" href="/docs">
                Get started →
              </Link>
              <Link className="af-cta-ghost" href="https://github.com/footprintjs/agentfootprint">
                <GitHubMark /> Star on GitHub
              </Link>
            </div>
          </div>
          <div className="af-hero-visual">
            <HeroTrace />
            <div className="af-codepeek" aria-hidden="true">
              <div className="af-codepeek-install">
                <span className="pr">$</span> npm i agentfootprint
              </div>
              <div className="af-codepeek-code">
                <div className="af-cp-line"><span className="k">const</span> agent = Agent.<span className="m">create</span>(<span className="s2">{'{ provider, model }'}</span>)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">system</span>(<span className="s">{`'You are a refunds agent.'`}</span>)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">skill</span>(billing)</div>
                <div className="af-cp-line af-cp-i">.<span className="m">build</span>();</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* value band — the outcome props, full-width below the hero */}
      <section className="af-valueband">
        <p className="af-value-tag">
          Inject less. <em>Trace more.</em>
        </p>
        <div className="af-valuestrip">
          <div className="af-vs">
            <b>Faster debugging</b>
            <span>trace any answer to its exact cause</span>
          </div>
          <div className="af-vs">
            <b>Provable cause</b>
            <span>proven by replay, not guessed</span>
          </div>
          <div className="af-vs">
            <b>Lower token cost</b>
            <span>context shrinks to what the step needs</span>
          </div>
        </div>
      </section>

      <div className="af-scrollcue-wrap">
        <p className="af-bridge-line">
          Don&apos;t take the claim on faith. Scroll the story — a wrong answer{' '}
          <b>traced to its cause</b>, <b>the context</b> that built it, and{' '}
          <b>the engine</b> that recorded it all.
        </p>
        <div className="af-scrollcue" aria-hidden="true">
          scroll the story
          <svg className="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* home-only sticky jump-nav, then the storyboard — 01 problem · 02 solution · 03 benefits · 04 how · 05 payoff */}
      <ChapterRail />
      <Chapters />

      {/* attribution footer — the recap + CTA now live in chapter 05 (SummaryChapter) */}
      <footer className="af-endcap af-endcap-slim">
        <a
          className="af-builton"
          href="https://github.com/footprintjs/footprintjs"
          target="_blank"
          rel="noreferrer"
        >
          Built on
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/footprintjs-icon.png')} alt="" className="af-fpjs-icon" />
          <span className="af-fpjs-word">
            footprint<em>js</em>
          </span>
        </a>
        <div className="af-legal">open source · MIT · © 2026 footprintjs</div>
      </footer>
    </main>
  );
}
