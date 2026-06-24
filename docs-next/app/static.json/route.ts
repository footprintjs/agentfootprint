import { source } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';
import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { CHAPTERS_META } from '@/lib/chapters';

// Static search index for the exported (GitHub Pages) site. Prerendered to a single
// /static.json file at build; the search dialog loads it client-side (Orama).
// `revalidate = false` + staticGET makes it a fully static asset (no server needed).
export const revalidate = false;

// The docs pages, indexed exactly as createFromSource would (advanced index keyed off the
// MDX structuredData so heading-level results still work).
const docsIndexes: AdvancedIndex[] = source.getPages().map((page) => ({
  id: page.url,
  title: page.data.title ?? '',
  description: page.data.description,
  url: page.url,
  structuredData: page.data.structuredData,
}));

// The 5 homepage chapters, derived from the SAME array that drives the sticky bars and the
// jump-rail (lib/chapters.ts) — so they can never drift. Each is a single page-level result
// linking to its #anchor; the concept text feeds the content so a search for "rewind",
// "replay", "cause", etc. surfaces the chapter that explains it. The homepage was a search
// dead-zone before this; now its core concepts are findable from the docs search box too.
const chapterIndexes: AdvancedIndex[] = CHAPTERS_META.map((c) => ({
  id: c.id,
  title: c.ti,
  description: c.sub,
  url: `/#${c.id}`,
  structuredData: {
    headings: [],
    contents: [{ heading: undefined, content: `${c.cat}. ${c.sub}` }],
  },
}));

export const { staticGET: GET } = createSearchAPI('advanced', {
  language: 'english',
  indexes: [...docsIndexes, ...chapterIndexes],
});
