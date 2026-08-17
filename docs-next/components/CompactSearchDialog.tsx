'use client';

import { useMemo } from 'react';
import { useDocsSearch, type SearchClient } from 'fumadocs-core/search/client';
import { oramaStaticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search';
import type { DefaultSearchDialogProps } from 'fumadocs-ui/components/dialog/search-default';

/**
 * The compact index stores a guide's full searchable text in one body record.
 * Fumadocs returns that body hit together with its parent page; only the parent
 * is useful in the dialog. Filtering here keeps results concise without giving
 * up body-term matching.
 */
function createPageOnlyClient(from: string): SearchClient {
  const client = oramaStaticClient({ from });

  return {
    deps: client.deps,
    async search(query) {
      const results = await client.search(query);
      return results.filter((result) => result.type === 'page');
    },
  };
}

export default function CompactSearchDialog({
  open,
  onOpenChange,
  api = '/static.json',
  delayMs,
}: DefaultSearchDialogProps) {
  const client = useMemo(() => createPageOnlyClient(api), [api]);
  const { search, setSearch, query } = useDocsSearch({ client, delayMs });

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
