import Link from 'next/link';
import type { Metadata } from 'next';
import { FeatureScene } from '@/components/features/FeatureScene';
import { LazyUniverse } from '@/components/features/LazyUniverse';
import { SiteFooter } from '@/components/SiteFooter';
import { FEATURES_ALSO, FEATURES_TAGLINE, FEATURE_BEATS } from '@/lib/features/beats';
import { SITE } from '@/lib/site';
import '@/components/home/stand/stand.css';

/**
 * /features: eleven verbs, each with the names people already know it by and a small scene. The page
 * is prerendered, so the static export ships it complete and readable with JS off. The scenes are
 * the only client part, and each one loads as it nears the screen.
 */

const TITLE = 'Features — agentfootprint';
const DESC = `${FEATURES_TAGLINE} Build an agent from pieces, teach it skills, give it memory, swap the model, adapt it to your infrastructure, stream it to your front end, watch it think, have it check in before anything big, protect what it records, ask why when it's wrong, and keep running when a provider goes down.`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: `${SITE.url}/features/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/features/`,
    siteName: SITE.name,
    title: TITLE,
    description: DESC,
    images: [{ url: `${SITE.url}/opengraph-image`, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE.twitter,
    creator: SITE.twitter,
    title: TITLE,
    description: DESC,
    images: [`${SITE.url}/opengraph-image`],
  },
};

export default function FeaturesPage() {
  return (
    <div className="pf">
      {/* Tells the CSS a script ran, so a scene only takes up room when it can play. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script
        dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('sf-js')" }}
      />
      <header className="hs-hero">
        <p className="v2-kicker">What you get</p>
        <h1>{FEATURES_TAGLINE}</h1>
        <p>Eleven things it does, in eleven words.</p>
        <p className="hs-def">
          People now call this an agent harness: the loop, tools, context and controls around the
          model.{' '}
          <Link href="/engineering#harness" prefetch={false}>
            Harness engineering, with code
          </Link>
        </p>
      </header>
      <nav aria-label="The ten features">
        <ul className="pf-words">
          {FEATURE_BEATS.map((beat) => (
            <li key={beat.id}>
              <a href={`#${beat.id}`}>{beat.verb}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="pf-list">
        {FEATURE_BEATS.map((beat) => (
          <article className="pf-beat" id={beat.id} key={beat.id}>
            <div className="pf-copy">
              <h2>{beat.verb}</h2>
              <p className="pf-line">{beat.line}</p>
              <div className="pf-known">
                <span>You may know it as</span>
                <ul>
                  {beat.knownAs.map((tag) => (
                    <li key={tag.name}>
                      <Link href={tag.href} prefetch={false}>
                        {tag.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              {'limit' in beat ? <p className="pf-limit">{beat.limit}</p> : null}
              <Link
                className="pf-more"
                href={beat.href}
                prefetch={false}
                aria-label={beat.hrefLabel}
              >
                Read more <span aria-hidden="true">→</span>
              </Link>
            </div>
            <FeatureScene id={beat.id} />
          </article>
        ))}
      </div>
      <section className="sc hw-all" aria-labelledby="how-all-title">
        <header className="sc-head">
          <p className="v2-kicker">How it all fits together</p>
          <h2 id="how-all-title">
            Context goes in. An answer comes out. Every step leaves a note.
          </h2>
        </header>
        <LazyUniverse />
      </section>
      <section className="pf-also" aria-labelledby="pf-also-title">
        <h2 id="pf-also-title">Also in the library</h2>
        <ul>
          {FEATURES_ALSO.map((item) => (
            <li key={item.href}>
              <Link href={item.href} prefetch={false}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="sc pf-close" id="features-next" aria-label="Where to go next">
        <code className="sf-install">npm install agentfootprint</code>
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/how-to-build" prefetch={false}>
            How to build <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/engineering" prefetch={false}>
            The code by discipline <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/docs" prefetch={false}>
            Read the docs <span aria-hidden="true">→</span>
          </Link>
          <a
            className="v2-button v2-button-quiet"
            href={SITE.repo}
            target="_blank"
            rel="noreferrer"
          >
            Star on GitHub <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
