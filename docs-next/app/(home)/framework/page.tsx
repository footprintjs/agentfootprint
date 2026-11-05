import Link from 'next/link';
import type { Metadata } from 'next';
import { StandDetails } from '@/components/home/stand/StandDetails';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '../v2.css';
import '@/components/home/stand/stand.css';

const TITLE = 'The whole framework — AgentFootprint';
const DESCRIPTION =
  'Build, debug, run and monitor an agent in AgentFootprint: skills and scoped tools, recorded runs and lenses, your own stack through typed ports, and typed events you can export.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/framework/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/framework/`,
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

export default function FrameworkPage() {
  return (
    <div className="v2-home">
      <StandDetails />
      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link className="v2-button v2-button-primary" href="/docs/getting-started/quick-start" prefetch={false}>
            Build your first agent <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/features" prefetch={false}>
            Back to features <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
