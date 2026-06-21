import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import type { ReactNode } from 'react';

// The marketing homepage shares the SAME header/footer/theme as the docs
// (Fumadocs HomeLayout + baseOptions). Clicking "Docs" routes to /docs under
// the same shell — one unified site.
export default function Layout({ children }: { children: ReactNode }) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
