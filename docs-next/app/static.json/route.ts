import { source } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';
import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { SITE_NAV, isNavGroup } from '@/lib/site-nav';
import { compactGuideIndex } from '@/lib/search-index-content.mjs';
import { orderSearchIndexes } from '@/lib/search-index-order.mjs';

// Static search index for the exported (GitHub Pages) site. Prerendered to a single
// /static.json file at build; the search dialog loads it client-side (Orama).
// `revalidate = false` + staticGET makes it a fully static asset (no server needed).
export const revalidate = false;

const EMPTY_STRUCTURED_DATA: AdvancedIndex['structuredData'] = {
  headings: [],
  contents: [],
};

function isGeneratedAPIPage(url: string): boolean {
  // `/docs/api` is a hand-written landing page; descendants are generated
  // symbol pages and only need title-level discovery in the global search.
  return url.startsWith('/docs/api/');
}

const docsIndexes: AdvancedIndex[] = source.getPages().map(({ url, data }) => {
  const page = { id: url, title: data.title ?? '', url };
  if (isGeneratedAPIPage(url)) return { ...page, structuredData: EMPTY_STRUCTURED_DATA };
  return compactGuideIndex({
    ...page,
    description: data.description,
    structuredData: data.structuredData,
  });
});

// The site's own pages, from the same list that drives the menu, so search and the menu can never drift.
// Each is one page-level result, found by its name or the question it answers.
const pageIndexes: AdvancedIndex[] = SITE_NAV.flatMap((item) => (isNavGroup(item) ? item.children : [item]))
  .filter((page) => page.href !== '/docs')
  .map((page) => ({
    id: `page:${page.href}`,
    title: page.label,
    description: page.question,
    url: page.href,
    structuredData: {
      headings: [],
      contents: [{ heading: undefined, content: page.question }],
    },
  }));

export const { staticGET: GET } = createSearchAPI('advanced', {
  language: 'english',
  indexes: orderSearchIndexes([...docsIndexes, ...pageIndexes]),
});
