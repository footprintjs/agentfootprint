import { SITE, asset } from '@/lib/site';

/**
 * SiteFooter — one footer for the whole site, rendered on BOTH home and docs (docs had none).
 * Brand-first, person-last: the provenance line up top, the author credit folded into the quiet
 * legal line so it reads as a conventional OSS credit, never a vanity banner.
 *
 * The copyright names the real holder (matches LICENSE: "© 2024–present Sanjay Krishna
 * Anbalagan") — the site previously said "© footprintjs", under-crediting the author and
 * contradicting the license. "Created by Sanjay" links to the real profile with rel="author".
 */
export function SiteFooter() {
  return (
    <footer className="af-endcap af-endcap-slim">
      <a className="af-builton" href={SITE.core} target="_blank" rel="noreferrer">
        Built on
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset('/footprintjs-icon.png')} alt="" className="af-fpjs-icon" />
        <span className="af-fpjs-word">
          footprint<em>js</em>
        </span>
      </a>
      <div className="af-legal">
        <span>open source</span>
        <span className="af-dot">·</span>
        <a href={SITE.license} target="_blank" rel="noreferrer">
          MIT
        </a>
        <span className="af-dot">·</span>
        <span>© 2024–present {SITE.authorName}</span>
        <span className="af-dot">·</span>
        <span>
          Created by{' '}
          <a href={SITE.authorUrl} target="_blank" rel="author noreferrer">
            {SITE.author}
          </a>
        </span>
      </div>
    </footer>
  );
}
