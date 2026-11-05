import Link from 'next/link';
import type { Metadata } from 'next';
import { StandGrid } from '@/components/home/stand/StandGrid';
import { StandHonesty } from '@/components/home/stand/StandHonesty';
import { StandPlaces } from '@/components/home/stand/StandPlaces';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '../v2.css';
import '@/components/home/stand/stand.css';

const TITLE = 'How an answer stands — AgentFootprint';
const DESCRIPTION =
  'How AgentFootprint holds an agent’s claims to a record it did not write: what is checked when the model calls a tool, reads a result and gives its answer, who decides, and what cannot be shown.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/how-it-stands/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/how-it-stands/`,
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

export default function HowItStandsPage() {
  return (
    <div className="v2-home hs">
      <header className="hs-hero">
        <p className="v2-kicker">How it stands</p>
        <h1>How an answer is held to the record.</h1>
        <p>
          The model can say anything. This page shows where its claims get compared, who decides, what happens next, and
          what we cannot show.
        </p>
        <p className="hs-def">
          Honest, here, means a claim stays within its evidence. It does not mean the claim is true.
        </p>
      </header>
      <StandPlaces />
      <StandGrid />
      <StandHonesty />
      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/how-we-debug" prefetch={false}>
            When an answer is wrong: how we debug <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/docs/getting-started/quick-start" prefetch={false}>
            Build your first agent <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
