import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { SITE } from '@/lib/site';

// Static export: emit a full sitemap at build so every page is crawlable.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const home: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, changeFrequency: 'weekly', priority: 1 },
  ];

  const docs: MetadataRoute.Sitemap = source.getPages().map((page) => {
    const isApi = page.url.startsWith('/docs/api');
    return {
      url: `${SITE.url}${page.url}`,
      changeFrequency: isApi ? 'monthly' : 'weekly',
      // hand-written guides rank above the auto-generated API reference
      priority: page.url === '/docs' ? 0.9 : isApi ? 0.3 : 0.6,
    };
  });

  return [...home, ...docs];
}
