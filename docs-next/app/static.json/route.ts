import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static search index for the exported (GitHub Pages) site. Prerendered to a single
// /static.json file at build; the search dialog loads it client-side (Orama).
// `revalidate = false` + staticGET makes it a fully static asset (no server needed).
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
});
