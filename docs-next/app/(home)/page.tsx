import type { Metadata } from 'next';
import { AnswerCheckDemo } from '@/components/home/v2/AnswerCheckDemo';
import { StandCode } from '@/components/home/stand/StandCode';
import { StandFilm } from '@/components/home/stand/StandFilm';
import { StandPosition } from '@/components/home/stand/StandPosition';
import { StandQuestions } from '@/components/home/stand/StandQuestions';
import { StandViewProvider } from '@/components/home/stand/StandView';
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import { SITE } from '@/lib/site';
import './v2.css';
import '@/components/home/stand/stand.css';

const HOME_TITLE = SITE.title;
const HOME_DESC = SITE.description;

export const metadata: Metadata = {
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
    site: SITE.twitter,
    creator: SITE.twitter,
    title: HOME_TITLE,
    description: HOME_DESC,
    images: [`${SITE.url}/opengraph-image`],
  },
};

export default function HomePage() {
  return (
    <div className="v2-home">
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />

      {/* Tells the CSS a script ran, so the hero holds its place until the film boots. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('sf-js')" }} />
      <StandViewProvider>
        <StandFilm />
        <StandCode />
        <AnswerCheckDemo />
      </StandViewProvider>

      <StandPosition />

      <StandQuestions />

      <SiteFooter />
    </div>
  );
}
