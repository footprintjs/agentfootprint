// The docs chrome (sidebar, tabs, header) is rendered per page by
// components/DocsShell.tsx, which picks the page's navigation tree
// (lib/api-tree.mjs). This layout keeps what is the same on every docs page.
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* author/org/software graph on EVERY docs page (not just home) so "Sanjay = creator" is
          asserted on every indexed URL. eslint-disable-next-line react/no-danger — static data. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />
      {children}
      {/* shared site footer (same component as home) — docs had none. Full-width below the grid. */}
      <SiteFooter />
    </>
  );
}
