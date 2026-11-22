import { lastResultRewriteIndex, readResultRewriteName } from '../../core/agent/recordedCalls.js';
import { isPlaceholder, servedUnderPolicy } from '../../redaction/marker.js';
import { boundedPreview, displayText, renderPreview } from '../bounded.js';
import { TOOL_RESULT_PREVIEW_CHARS } from './structuralLimits.js';

/** Names-only metadata from a positively bound occurrence; never opens result bytes. */
export function resultRewriteLine(
  facts: {
    readonly rows: readonly unknown[];
    readonly occurrenceKey?: string;
    readonly unboundRows: boolean;
  },
  snapshot: unknown,
): string | undefined {
  if (facts.unboundRows || facts.occurrenceKey === undefined) return undefined;
  const index = lastResultRewriteIndex(facts.rows);
  const row = index === undefined ? undefined : facts.rows[index];
  const name = readResultRewriteName(row);
  if (name === undefined || (servedUnderPolicy(snapshot) && isPlaceholder(name))) return undefined;
  return `rewritten by: ${displayText(
    renderPreview(boundedPreview(name, TOOL_RESULT_PREVIEW_CHARS)),
  )}`;
}
