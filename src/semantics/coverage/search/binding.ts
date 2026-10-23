/**
 * search/binding — which `resolved` entity a population value may carry.
 *
 * Pattern: one pure rule (review item N4).
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * A tool's result may say what each population value resolved to —
 * `resolved: [{ argument, id, name?, aliases? }]`. Those words later bind a
 * claim's entity, so they may bind ONLY the entity the call was sent for:
 * an entry attaches to a sent value when its `argument` is that value's
 * argument AND the value is one of the entity's own names (`id`, `name` or an
 * alias). Store data cannot bind another entity's name: an entry for
 * `billing` never rides the item for `payments`.
 *
 * Names compare by the ONE case rule (`lib/normalize.ts` · `sameName`, the
 * claim comparator's own): a foldable word may differ in case; a short word,
 * a mixed-case one or anything with a digit keeps its case. Token shape
 * (plural, punctuation) decides nothing.
 */

import { sameName } from '../../../lib/normalize.js';
import type { ResolvedEntity } from '../composedCoverage.js';
import type { ResolvedDeclaration } from './resultFacts.js';

/**
 * The entity `value` (sent as `argument`) resolved to, or `undefined` when no
 * entry names it among its own names.
 */
export function resolvedFor(
  argument: string,
  value: unknown,
  resolved: readonly ResolvedDeclaration[] | undefined,
): ResolvedEntity | undefined {
  if (resolved === undefined) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const sent = String(value);
  const entry = resolved.find(
    (r) =>
      r.argument === argument &&
      [r.id, ...(r.name !== undefined ? [r.name] : []), ...(r.aliases ?? [])].some((n) =>
        sameName(n, sent),
      ),
  );
  if (entry === undefined) return undefined;
  return {
    id: entry.id,
    ...(entry.name !== undefined && { name: entry.name }),
    ...(entry.aliases !== undefined && { aliases: [...entry.aliases] }),
  };
}
