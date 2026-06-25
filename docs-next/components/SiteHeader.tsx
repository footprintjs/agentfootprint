'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import { SidebarTrigger } from 'fumadocs-ui/components/sidebar/base';
import { asset } from '@/lib/site';

/**
 * SiteHeader — ONE header for the whole site.
 *
 * Fumadocs ships two different header components (HomeLayout's #nd-nav and the notebook
 * DocsLayout's #nd-subnav); we used to make them look alike with scoped CSS, but they were
 * still two implementations. This replaces BOTH via each layout's `nav.component` hook, so
 * home and docs render the exact same bar from one source — identical by construction, no
 * matching CSS. (codehike / expostarter do the same: own the header.)
 *
 * It composes Fumadocs' own primitives so search/theme/sidebar behave natively:
 *  - search  → useSearchContext().setOpenSearch (opens the ⌘K dialog)
 *  - theme   → <ThemeSwitch/> (the same toggle Fumadocs renders)
 *  - sidebar → <SidebarTrigger/> on mobile docs only (desktop sidebar is always open)
 *
 * Layout: wordmark pinned left, a flex-1 gap, then search · links · GitHub · theme pinned
 * right. Both edges are anchored and the gap absorbs any width difference, so it never shifts.
 */

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  const { setOpenSearch } = useSearchContext();
  const pathname = usePathname();
  const onDocs = pathname?.startsWith('/docs') ?? false;

  return (
    <header id="af-header" className="af-sh">
      <div className="af-sh-inner">
        <Link href="/" className="af-wordmark af-sh-brand" aria-label="agentfootprint — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/footprint-logo.png')} alt="" className="af-wordmark-icon" aria-hidden="true" />
          <span className="af-wordmark-text">
            <span className="lo">agent</span>
            <span className="hi">footprint</span>
          </span>
        </Link>

        <div className="af-sh-gap" />

        <button type="button" className="af-sh-search" onClick={() => setOpenSearch(true)} aria-label="Search">
          <SearchIcon />
          <span className="af-sh-search-text">Search</span>
          <span className="af-sh-kbd" aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>

        <nav className="af-sh-nav" aria-label="Primary">
          <Link href="/" className={`af-sh-link${!onDocs ? ' on' : ''}`} aria-current={!onDocs ? 'page' : undefined}>
            Home
          </Link>
          <Link href="/docs" className={`af-sh-link${onDocs ? ' on' : ''}`} aria-current={onDocs ? 'page' : undefined}>
            Docs
          </Link>
        </nav>

        <a
          className="af-sh-icon af-sh-gh"
          href="https://github.com/footprintjs/agentfootprint"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
        >
          <GitHubIcon />
        </a>

        <ThemeSwitch className="af-sh-theme" />

        {/* Mobile-only sidebar opener on docs (desktop docs sidebar is always open) */}
        {onDocs && (
          <SidebarTrigger className="af-sh-icon af-sh-sidebar" aria-label="Open sidebar">
            <MenuIcon />
          </SidebarTrigger>
        )}
      </div>
    </header>
  );
}
