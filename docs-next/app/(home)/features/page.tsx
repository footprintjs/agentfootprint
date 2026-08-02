import Link from 'next/link';
import type { Metadata } from 'next';
import { FeaturesHero } from '@/components/features/FeaturesHero';
import { FeatureBeats } from '@/components/features/FeatureBeats';
import { SiteFooter } from '@/components/SiteFooter';
import { FEATURE_BEATS, FEATURES_TAGLINE } from '@/lib/features/beats';
import { SITE } from '@/lib/site';
import { source } from '@/lib/source';
import './features.css';

/**
 * /features — the eight-verb scroll story: BUILD · TEACH · REMEMBER · SWAP · WATCH · ASK · WHY ·
 * SURVIVE. One verb per beat, each beat a sticky stage that composes itself as you scroll past.
 *
 * Layout comes from the route group `(home)`, so this page wears the SAME real header/footer as the
 * homepage (app/(home)/layout.tsx → HomeLayout + SiteHeader). Page-scoped styling lives in
 * ./features.css — plain CSS with custom properties, the convention in app/global.css; the page
 * adds no dependency and no Tailwind utilities.
 *
 * Server component: the hero, the close and every beat's copy are prerendered HTML (the static
 * export ships /features/index.html complete, indexable, and readable with JS off). Only the scroll
 * choreography and the two tab groups are client components.
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
    <main className="aff">
      <FeaturesHero />
      <FeatureBeats />

      <section className="aff-close">
        <div className="aff-install">
          <span className="pr" aria-hidden="true">
            $
          </span>
          npm install agentfootprint
          <span className="aff-caret" aria-hidden="true" />
        </div>
        <div className="aff-closelinks">
          <Link href="/docs">Read the docs →</Link>
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            Star on GitHub →
          </a>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

/**
 * ANTI-STALE GUARD for the eight "Read more" links.
 *
 * scripts/check-doc-links.mjs only scans .mdx sources, so a hand-written route in a .tsx page is
 * exactly the kind of link that rots silently. This resolves each beat's href against the SAME
 * Fumadocs page tree the site renders from, at BUILD time — so renaming or moving a doc fails
 * `next build` instead of shipping a 404 behind "Read more".
 */
const DOC_ROUTES = new Set(source.getPages().map((page) => page.url));
for (const beat of FEATURE_BEATS) {
  if (!DOC_ROUTES.has(beat.href)) {
    throw new Error(
      `features: beat "${beat.id}" links to ${beat.href}, which is not a page in content/docs. ` +
        `Fix lib/features/beats.ts.`,
    );
  }
}
