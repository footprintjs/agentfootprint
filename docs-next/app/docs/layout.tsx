import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
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
