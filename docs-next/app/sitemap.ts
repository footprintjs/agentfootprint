import type { MetadataRoute } from 'next';
import { gitDatesFor } from '@/lib/git-dates';
import { source } from '@/lib/source';
import { SITE } from '@/lib/site';

// Static export: emit a full sitemap at build so every page is crawlable.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const home: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, changeFrequency: 'weekly', priority: 1 },
    // the marketing story page — ranks just under the homepage, above any single doc
    { url: `${SITE.url}/features/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/how-we-debug/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/how-it-stands/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/how-to-build/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/engineering/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/security/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/context-engineering/`, changeFrequency: 'monthly', priority: 0.8 },
  ];

  const dates = gitDatesFor('content/docs');
  const docs: MetadataRoute.Sitemap = source.getPages().map((page) => {
    const isApi = page.url.startsWith('/docs/api');
    const canonicalPath = page.url.endsWith('/') ? page.url : `${page.url}/`;
    return {
      url: `${SITE.url}${canonicalPath}`,
      lastModified: dates.get(`content/docs/${page.path}`),
      changeFrequency: isApi ? 'monthly' : 'weekly',
      // hand-written guides rank above the auto-generated API reference
      priority: page.url === '/docs' ? 0.9 : isApi ? 0.3 : 0.6,
    };
  });

  return [...home, ...docs];
}
