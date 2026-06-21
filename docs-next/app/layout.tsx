import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: '%s · agentfootprint',
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  authors: [{ name: SITE.author, url: SITE.org }],
  creator: SITE.author,
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
  icons: {
    icon: '/footprint-logo.png',
    shortcut: '/footprint-logo.png',
    apple: '/mascot.png',
  },
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
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
