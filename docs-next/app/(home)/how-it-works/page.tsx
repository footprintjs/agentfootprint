import Link from 'next/link';
import type { Metadata } from 'next';
import { ChapterRail } from '@/components/home/ChapterRail';
import { Chapters } from '@/components/home/Chapters';
import { HomeViewProvider, HomeViewSwitcher } from '@/components/home/HomeView';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '../home.css';
import './how-it-works.css';

const TITLE = 'How AgentFootprint works — trace a wrong answer to its cause';
const DESCRIPTION =
  'Follow one agent run from a wrong answer through context provenance, backward slicing, and controlled replay.';

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
    <HomeViewProvider>
      <div className="af-home af-how-page">
        <HomeViewSwitcher label="Choose walkthrough view" />
        <section className="af-how-intro">
          <span className="af-pill">
            <span className="af-pill-dot" /> interactive walkthrough
          </span>
          <p className="af-how-overline">One failed run. Five layers of evidence.</p>
          <h1>Follow a wrong answer all the way back to its cause.</h1>
          <p>
            The homepage gives you the map. This is the full traversal: inspect the answer, rewind
            through its context, isolate the suspect source, and prove the correction by rerunning
            without it.
          </p>
          <div className="af-how-actions">
            <a className="af-cta" href="#af-ch-problem">
              Start the walkthrough ↓
            </a>
            <Link className="af-cta-ghost" href="/docs/debug/localize-context-bug">
              Read the debugging guide →
            </Link>
          </div>
        </section>
        <ChapterRail />
        <Chapters />
        <SiteFooter />
      </div>
    </HomeViewProvider>
  );
}
