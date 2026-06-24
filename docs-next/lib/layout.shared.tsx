import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { asset } from './site';

// Inline GitHub mark — lucide-react dropped brand icons, so we ship our own.
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

// Brand wordmark: the binary-footprint mark · "agent" muted · "footprint" bold.
// Rendered as the Fumadocs nav title, so it appears identically on every layout
// (homepage + docs) and Fumadocs wraps it in the home link automatically.
function Wordmark() {
  return (
    <span className="af-wordmark">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset('/footprint-logo.png')} alt="" className="af-wordmark-icon" aria-hidden="true" />
      {/* one word: "agent" + "footprint" sit flush (no gap) so it reads "agentfootprint" */}
      <span className="af-wordmark-text">
        <span className="lo">agent</span>
        <span className="hi">footprint</span>
      </span>
    </span>
  );
}

/**
 * Shared layout options — the single source of truth for the site header.
 * Both the homepage (HomeLayout) and the docs (notebook DocsLayout) spread
 * these, so the nav (wordmark, links, built-in search + theme toggle) is the
 * same everywhere. No custom header markup or Fumadocs-internal CSS overrides.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Wordmark />,
    },
    links: [
      {
        // explicit Home link so the homepage is reachable from the shared header on
        // BOTH layouts (the wordmark links home too, but a labeled link is discoverable).
        text: 'Home',
        url: '/',
        active: 'url',
        secondary: true,
      },
      {
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
        // secondary → right-aligned, so the link sits in the same place on both
        // the HomeLayout nav and the notebook docs nav.
        secondary: true,
      },
      {
        type: 'icon',
        icon: <GitHubIcon />,
        text: 'GitHub',
        url: 'https://github.com/footprintjs/agentfootprint',
        external: true,
      },
    ],
  };
}
