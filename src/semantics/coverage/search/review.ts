/**
 * search/review — what a person should LOOK AT in a `Tool.search`, never a
 * refusal.
 *
 * Pattern: one pure lister, two readers: the `check:semantics` gate (warnings,
 *          errors only under `--strict`) and `defineTool`'s dev-mode warning.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 *   • `source-said` — every word a claim may use to scope itself to the
 *     source. A word wider than the source ("the estate") would let a claim
 *     about everything read as a claim about this store, so a person reviews
 *     the list, like an `authoritative` use. No word ever removes a gap.
 *   • `said-overlap` — a `subject.said` word that repeats a qualifier: a
 *     filter value's word (a qualifier NOT in `fixed`), or a fixed
 *     qualifier's own word. The subject says WHAT was looked for and the
 *     qualifiers say WHICH; a subject word carrying a qualifier lets a claim
 *     match the subject without naming the qualifier the search applied.
 */

import type { SearchArgument, ToolSearch } from './types.js';

export type SearchReviewCode = 'source-said' | 'said-overlap';

/** One thing a reviewer should read. */
export interface SearchReviewItem {
  readonly code: SearchReviewCode;
  readonly field: string;
  readonly message: string;
}

/** The words of a phrase, for a phrase-in-phrase test — NFC, case-folded. */
function wordsOf(phrase: string): readonly string[] {
  return phrase
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}

/** Whether `inner`'s words appear, in order and adjacent, inside `outer`'s. */
function containsPhrase(outer: readonly string[], inner: readonly string[]): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i += 1) {
    if (inner.every((w, j) => outer[i + j] === w)) return true;
  }
  return false;
}

/** Every qualifier word the search declares, with where it came from. */
function qualifierWords(
  search: ToolSearch,
): readonly { readonly word: string; readonly from: string }[] {
  const out: { word: string; from: string }[] = [];
  for (const q of search.fixed ?? []) {
    for (const word of q.said) out.push({ word, from: `the fixed qualifier '${q.name}'` });
  }
  const filters = search.arguments.filter((a: SearchArgument) => a.role === 'filter');
  for (const a of filters) {
    for (const [value, words] of Object.entries(a.said ?? {})) {
      for (const word of [value, ...words]) {
        out.push({ word, from: `the filter '${a.name}' (not a fixed qualifier)` });
      }
    }
  }
  return out;
}

/**
 * The review items of one search — `[]` when there is nothing to look at.
 *
 * @example
 * ```ts
 * searchReviewItems(search).map((i) => i.code); // ['source-said']
 * ```
 */
export function searchReviewItems(search: ToolSearch): readonly SearchReviewItem[] {
  const items: SearchReviewItem[] = [
    {
      code: 'source-said',
      field: 'search.source.said',
      message:
        `a claim using one of these words is read as scoped to '${search.source.what}': ` +
        `${search.source.said.map((w) => `'${w}'`).join(', ')}. Check that each names this ` +
        'source and nothing wider — no word ever removes a gap.',
    },
  ];
  const qualifiers = qualifierWords(search);
  search.subject.said.forEach((subjectWord, i) => {
    const subject = wordsOf(subjectWord);
    const hit = qualifiers.find((q) => containsPhrase(subject, wordsOf(q.word)));
    if (hit === undefined) return;
    items.push({
      code: 'said-overlap',
      field: `search.subject.said[${i}]`,
      message:
        `'${subjectWord}' repeats '${hit.word}', a word of ${hit.from}. Keep the subject's ` +
        'words to what was looked for and the qualifiers in their own lists, or a claim can ' +
        'match the subject without naming a qualifier the search applied.',
    });
  });
  return items;
}
