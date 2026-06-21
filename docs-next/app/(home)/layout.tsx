import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import type { ReactNode } from 'react';

// Homepage shares the SAME nav (baseOptions) as the docs — one wordmark, one set
// of links, Fumadocs' built-in search + theme toggle. Clicking "Docs" keeps the
// identical top bar across the site.
export default function Layout({ children }: { children: ReactNode }) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
