import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { SiteHeader } from '@/components/SiteHeader';
import type { ReactNode } from 'react';

// Home and docs render the SAME custom header (SiteHeader) via each layout's nav.component
// hook — one implementation, identical by construction (no per-page CSS matching). baseOptions
// is still spread for non-header layout config; nav.component fully replaces the built-in bar.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions()} nav={{ component: <SiteHeader /> }}>
      {children}
    </HomeLayout>
  );
}
