import Link from 'next/link';
import type { Metadata } from 'next';
import { PosterFilm } from '@/components/features/PosterFilm';
import { SiteFooter } from '@/components/SiteFooter';
import { FEATURES_TAGLINE } from '@/lib/features/beats';
import { SITE } from '@/lib/site';
import '@/components/home/stand/stand.css';

/**
 * /features: eight verbs, eight posters. The hero and every caption are prerendered, so the
 * static export ships the page complete and readable with JS off. The film is the only client part.
 */

const TITLE = 'Features — agentfootprint';
const DESC = `${FEATURES_TAGLINE} Build an agent from pieces, teach it skills, give it memory, swap the model, watch it think, have it check in before anything big, ask why when it's wrong, and keep running when a provider goes down.`;

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
      {/* Tells the CSS a script ran, so the hero holds its place until the film boots. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('sf-js')" }} />
      <PosterFilm />
      <section className="sc pf-close" id="features-next" aria-label="Where to go next">
        <code className="sf-install">npm install agentfootprint</code>
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/framework" prefetch={false}>
            The whole framework, stage by stage <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/docs" prefetch={false}>
            Read the docs <span aria-hidden="true">→</span>
          </Link>
          <a className="v2-button v2-button-quiet" href={SITE.repo} target="_blank" rel="noreferrer">
            Star on GitHub <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
