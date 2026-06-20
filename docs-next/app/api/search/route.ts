import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Fumadocs built-in search (Orama) over the doc tree.
export const { GET } = createFromSource(source, {
  language: 'english',
});
