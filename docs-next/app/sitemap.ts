import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { SITE } from '@/lib/site';

// Static export: emit a full sitemap at build so every page is crawlable.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const home: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, changeFrequency: 'weekly', priority: 1 },
    // the marketing story page — ranks just under the homepage, above any single doc
    { url: `${SITE.url}/features/`, changeFrequency: 'monthly', priority: 0.9 },
    // the indexable product walkthrough is a first-class marketing route too
    { url: `${SITE.url}/how-it-works/`, changeFrequency: 'monthly', priority: 0.9 },
  ];

  const docs: MetadataRoute.Sitemap = source.getPages().map((page) => {
    const isApi = page.url.startsWith('/docs/api');
    const canonicalPath = page.url.endsWith('/') ? page.url : `${page.url}/`;
    return {
      url: `${SITE.url}${canonicalPath}`,
      changeFrequency: isApi ? 'monthly' : 'weekly',
      // hand-written guides rank above the auto-generated API reference
      priority: page.url === '/docs' ? 0.9 : isApi ? 0.3 : 0.6,
    };
  });

  return [...home, ...docs];
}
