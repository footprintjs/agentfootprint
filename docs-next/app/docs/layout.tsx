import { source } from '@/lib/source';
// Notebook layout = full-width top nav (matching the homepage) + sidebar below it.
// It spreads the SAME baseOptions as the homepage so the header reads as one bar across
// the site. The notebook's default nav.mode 'auto' hides the wordmark and balloons the
// search into a big centered box; HomeLayout has no such mode and always renders a compact
// right-aligned search. We converge on the HOME look (the correct product-header standard,
// per the UX panel) by setting nav.mode 'top' here — it shrinks + right-shifts the docs
// search and shows the wordmark full-width. We MERGE onto baseOptions().nav (rather than
// passing a bare nav) so the Wordmark title is preserved. No custom header / CSS overrides.
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';
import type { ReactNode } from 'react';
import { BookText, Braces } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
  const base = baseOptions();
  return (
    <DocsLayout
      tree={source.getPageTree()}
      sidebar={{
        // Keep the sidebar always open (ExpoStarter's clean-header recipe): no collapse button
        // cluttering the top bar, and nothing to position. The mobile drawer trigger is separate
        // and unaffected. This is what lets the docs header read as the same clean bar as home.
        collapsible: false,
        // The Docs | API Reference switcher at the top of the sidebar.
        tabs: [
          {
            title: 'Docs',
            description: 'Guides & concepts',
            url: '/docs',
            icon: <BookText className="size-4" />,
          },
          {
            title: 'API Reference',
            description: 'Auto-generated from source',
            url: '/docs/api',
            icon: <Braces className="size-4" />,
          },
        ],
      }}
      {...base}
      nav={{ ...base.nav, mode: 'top' }}
    >
      {children}
    </DocsLayout>
  );
}
