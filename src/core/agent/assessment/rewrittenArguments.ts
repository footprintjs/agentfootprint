import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { argumentRewritesOf, type ArgumentRewrite } from '../middleware/rewrites.js';
import type { historyCallResolver } from '../recordedCalls.js';
import { str } from './recordValues.js';

/** Admit decisions by occurrence and retain the original middleware witness indexes. */
export function rewritesByOccurrence(
  decisions: unknown,
  resolve: ReturnType<typeof historyCallResolver>,
): ReadonlyMap<number, ReadonlyMap<string, ArgumentRewrite>> {
  return argumentRewritesOf(decisions, (row) => {
    const resolved = resolve(str(row.toolCallId), str(row.toolName), readCallOccurrenceKey(row));
    return resolved.kind === 'matched' ? resolved.call.index : undefined;
  });
}
