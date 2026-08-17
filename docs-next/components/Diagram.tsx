import { asset } from '@/lib/site';
import styles from './Diagram.module.css';

/**
 * Light/dark diagram from public/assets/<name>-{light,dark}.svg, centered.
 *
 * The site theme is explicit (`.dark` on <html>), so the diagram follows that
 * class as well. A prefers-color-scheme <picture> would instead follow the OS
 * after a reader manually switches the site to the opposite theme.
 *
 * Uses asset() so each src carries the deploy basePath (raw <img> URLs are NOT
 * prefixed by Next) — correct in both local dev and the GitHub Pages build.
 */
export function Diagram({ name, alt }: { name: string; alt: string }) {
  return (
    <figure style={{ margin: '1.5rem 0', textAlign: 'center' }}>
      {/* Both variants stay in the static HTML; CSS selects the one matching the
          actual site theme and switching theme never needs a client component. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        src={asset(`/assets/${name}-light.svg`)}
        className={`${styles.image} ${styles.light}`}
        loading="lazy"
        decoding="async"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        src={asset(`/assets/${name}-dark.svg`)}
        className={`${styles.image} ${styles.dark}`}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}
