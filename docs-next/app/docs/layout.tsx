import { source } from '@/lib/source';
// Notebook layout = full-width top nav (matching the homepage) + sidebar below it.
// It spreads the SAME baseOptions as the homepage, so the header is identical and
// the layout manages its own sticky offsets — no custom header or CSS overrides.
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';
import type { ReactNode } from 'react';
import { BookText, Braces } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      sidebar={{
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
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
