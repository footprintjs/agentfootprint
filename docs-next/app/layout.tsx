import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SITE, asset } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: '%s · agentfootprint',
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  // the author points at the real person (personal GitHub), not the org — so the page-level
  // author signal corroborates the JSON-LD Person/sameAs for entity reconciliation.
  authors: [{ name: SITE.authorName, url: SITE.authorUrl }],
  creator: SITE.authorName,
  publisher: SITE.publisher,
  category: 'technology',
  alternates: { canonical: `${SITE.url}/` },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/`,
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: 'en_US',
    images: [{ url: `${SITE.url}/opengraph-image`, width: 1200, height: 630, alt: SITE.title }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE.title,
    description: SITE.description,
    images: [`${SITE.url}/opengraph-image`],
  },
  // Favicon / apple-icon come from the file convention (app/icon.png, app/apple-icon.png) —
  // small, optimized versions of the yellow footprint mark. Next emits the <link> with the
  // correct basePath automatically, so no asset() wrangling and no 726KB tab icon.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* Static (client-side Orama) search over the prerendered /static.json index.
            `from` is basePath-aware: the static client uses a raw fetch() that Next does
            NOT prefix, so we build the URL via asset() for the GitHub-Pages sub-path. */}
        <RootProvider search={{ options: { type: 'static', api: asset('/static.json') } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
