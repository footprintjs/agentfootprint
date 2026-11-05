import { source } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';
import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { SITE_NAV, isNavGroup } from '@/lib/site-nav';
import { orderSearchIndexes } from '@/lib/search-index-order.mjs';

// Static search index for the exported (GitHub Pages) site. Prerendered to a single
// /static.json file at build; the search dialog loads it client-side (Orama).
// `revalidate = false` + staticGET makes it a fully static asset (no server needed).
export const revalidate = false;

const EMPTY_STRUCTURED_DATA: AdvancedIndex['structuredData'] = {
  headings: [],
  contents: [],
};

/**
 * Fumadocs' default advanced index emits a record for every heading and content
 * fragment. That is useful for a small handbook, but our generated TypeDoc API
 * turns it into tens of thousands of browser-side records.
 *
 * Keep one searchable body record per hand-written guide instead. Search still
 * matches every guide heading and body term, while the client presents the page
 * result rather than thousands of paragraph-level results.
 */
function compactGuideBody(data: AdvancedIndex['structuredData']): string {
  return [
    ...data.headings.map((heading) => heading.content),
    ...data.contents.map((entry) => entry.content),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function isGeneratedAPIPage(url: string): boolean {
  // `/docs/api` is a hand-written landing page; descendants are generated
  // symbol pages and only need title-level discovery in the global search.
  return url.startsWith('/docs/api/');
}

const docsIndexes: AdvancedIndex[] = source.getPages().map((page) => {
  const generatedAPI = isGeneratedAPIPage(page.url);
  const body = generatedAPI ? '' : compactGuideBody(page.data.structuredData);

  return {
    id: page.url,
    title: page.data.title ?? '',
    description: generatedAPI ? undefined : page.data.description,
    url: page.url,
    structuredData:
      body.length > 0
        ? {
            headings: [],
            contents: [{ heading: undefined, content: body }],
          }
        : EMPTY_STRUCTURED_DATA,
  };
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
