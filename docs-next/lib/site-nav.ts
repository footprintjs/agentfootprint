/**
 * The site's menu, as data: each page and the one question it answers. The header and the phone
 * drawer both read this, so they can't drift apart.
 */
export interface NavPage {
  readonly label: string;
  readonly href: string;
  readonly question: string;
}

export interface NavGroup {
  readonly label: string;
  readonly children: readonly NavPage[];
}

export const SITE_NAV: readonly (NavPage | NavGroup)[] = [
  { label: 'Home', href: '/', question: 'Why should I care?' },
  {
    label: 'Internals',
    children: [
      { label: 'How it stands', href: '/how-it-stands', question: 'Can I trust this answer?' },
      { label: 'How we debug', href: '/how-we-debug', question: 'Why did it answer wrong?' },
    ],
  },
  { label: 'Features', href: '/features', question: 'What can it do?' },
  { label: 'Demo to App', href: '/how-to-build', question: 'How do I ship an app?' },
  {
    label: 'Prompt to Harness',
    href: '/engineering',
    question: 'What does each layer look like in code?',
  },
  {
    label: 'Security & Trustworthy AI',
    href: '/security',
    question: 'What does it protect, and what do I add?',
  },
  { label: 'Docs', href: '/docs', question: 'What’s the exact API?' },
];

export const isNavGroup = (item: NavPage | NavGroup): item is NavGroup => 'children' in item;

/** Only the root is Home, so a new route can't light up its link. */
export const isCurrent = (href: string, pathname: string | null) =>
  href === '/' ? pathname === '/' : pathname?.startsWith(href) ?? false;
