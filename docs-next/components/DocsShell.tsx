// The docs chrome (sidebar, tabs, header) around one page. It lives here, not
// in app/docs/layout.tsx, because the tree it shows depends on the page: a
// layout cannot see the route, and one shared tree would serialize every API
// symbol into every page (lib/api-tree.mjs).
//
// Notebook layout = full-width top nav + sidebar below it. The header is OURS: SiteHeader,
// the same component the homepage renders, plugged in via nav.component. That makes the docs
// header identical to home by construction (one implementation, no scoped matching CSS).
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import type { ComponentProps, ReactNode } from 'react';
import { BookText, Braces } from 'lucide-react';
import { baseOptions } from '@/lib/layout.shared';
import { SiteHeader } from '@/components/SiteHeader';

type Tree = ComponentProps<typeof DocsLayout>['tree'];

export function DocsShell({ tree, children }: { tree: Tree; children: ReactNode }) {
  const base = baseOptions();
  return (
    <DocsLayout
      tree={tree}
      sidebar={{
        // collapsible:true keeps the MOBILE drawer working (our SiteHeader opens it via
        // <SidebarTrigger/>). On desktop the sidebar stays open because SiteHeader renders no
        // desktop collapse button — so it still reads as the clean always-open ExpoStarter look,
        // without the toggle clutter, while mobile navigation keeps working.
        collapsible: true,
        // The static export can otherwise prefetch every visible sidebar route,
        // downloading many RSC payloads before the reader expresses intent.
        prefetch: false,
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
  );
}
