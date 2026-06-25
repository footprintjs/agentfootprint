import type { MetadataRoute } from 'next';
import { SITE, asset } from '@/lib/site';

// Web app manifest (PWA "add to home screen" + a small SEO/identity signal). Static-exported.
// Icon src + start_url must carry the GitHub-Pages base path themselves — manifest URLs are raw
// (Next does not rewrite them), so we build them with asset().
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: asset('/'),
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffc700',
    icons: [
      { src: asset('/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: asset('/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
  };
}
