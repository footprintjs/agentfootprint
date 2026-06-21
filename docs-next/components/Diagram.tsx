import { asset } from '@/lib/site';

/**
 * Light/dark diagram from public/assets/<name>-{light,dark}.svg, centered.
 * Uses asset() so the src carries the deploy basePath (raw <img>/<source srcset>
 * are NOT prefixed by Next) — correct in both local dev and the GitHub-Pages build.
 */
export function Diagram({ name, alt }: { name: string; alt: string }) {
  return (
    <figure style={{ margin: '1.5rem 0', textAlign: 'center' }}>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={asset(`/assets/${name}-dark.svg`)} />
        <source media="(prefers-color-scheme: light)" srcSet={asset(`/assets/${name}-light.svg`)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={alt} src={asset(`/assets/${name}-light.svg`)} style={{ width: '100%', maxWidth: '100%' }} />
      </picture>
    </figure>
  );
}
