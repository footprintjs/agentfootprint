import { source } from '@/lib/source';
// Notebook layout = full-width top nav + sidebar below it. The header is OURS: SiteHeader,
// the same component the homepage renders, plugged in via nav.component. That makes the docs
// header identical to home by construction (one implementation, no scoped matching CSS).
// sidebar.collapsible:false keeps the sidebar always open on desktop (no collapse button in
// the bar); SiteHeader renders the mobile sidebar opener itself via <SidebarTrigger/>.
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { siteJsonLd } from '@/lib/jsonld';
import type { ReactNode } from 'react';
import { BookText, Braces } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
  const base = baseOptions();
  return (
    <>
      {/* author/org/software graph on EVERY docs page (not just home) so "Sanjay = creator" is
          asserted on every indexed URL. eslint-disable-next-line react/no-danger — static data. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />
      <DocsLayout
      tree={source.getPageTree()}
      sidebar={{
        // collapsible:true keeps the MOBILE drawer working (our SiteHeader opens it via
        // <SidebarTrigger/>). On desktop the sidebar stays open because SiteHeader renders no
        // desktop collapse button — so it still reads as the clean always-open ExpoStarter look,
        // without the toggle clutter, while mobile navigation keeps working.
        collapsible: true,
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
      // mode:'top' makes the notebook grid reserve a FULL-WIDTH header row (". header header
      // header ."); without it the header is placed in the columns right of the sidebar. Our
      // SiteHeader claims that row via `grid-area: header` (set in global.css).
      nav={{ component: <SiteHeader />, mode: 'top' }}
    >
      {children}
    </DocsLayout>
      {/* shared site footer (same component as home) — docs had none. Full-width below the grid. */}
      <SiteFooter />
    </>
  );
}
