'use client';

import { lazy, type ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';

// Defining the lazy boundary inside a client module is important. If a Server
// Component passes this reference to RootProvider, Next emits the search chunks
// as initial page scripts even though Fumadocs has `preload: false`.
const CompactSearchDialog = lazy(() => import('./CompactSearchDialog'));

export function SiteRootProvider({ children, searchApi }: { children: ReactNode; searchApi: string }) {
  return (
    <RootProvider
      search={{
        // The first click or Ctrl/Cmd+K activates the dialog; static.json is
        // fetched only after the reader starts a query.
        preload: false,
        SearchDialog: CompactSearchDialog,
        options: { type: 'static', api: searchApi },
      }}
    >
      {children}
    </RootProvider>
  );
}
