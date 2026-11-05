import Link from 'next/link';
import type { Metadata } from 'next';
import { HowToBuild } from '@/components/build/HowToBuild';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';
import '../v2.css';
import '@/components/home/stand/stand.css';
import '@/components/site/page-shell.css';
import '@/components/site/reading.css';

const TITLE = 'Demo to App: how to build an agent — AgentFootprint';
const DESCRIPTION =
  'Build an agent against a scripted model, debug it from its own record, deploy it on AWS, Google Cloud, Azure or your own machines through adapters, and monitor it with OpenTelemetry or your own recorder.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/how-to-build/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/how-to-build/`,
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

export default function HowToBuildPage() {
  return (
    <div className="v2-home">
      <HowToBuild />
      <nav className="hs-next" aria-label="Where to go next">
        <div className="sc-links">
          <Link
            className="v2-button v2-button-primary"
            href="/docs/getting-started/quick-start"
            prefetch={false}
          >
            Build your first agent <span aria-hidden="true">→</span>
          </Link>
          <Link className="v2-button v2-button-quiet" href="/engineering" prefetch={false}>
            Prompt to Harness <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <SiteFooter />
    </div>
  );
}
