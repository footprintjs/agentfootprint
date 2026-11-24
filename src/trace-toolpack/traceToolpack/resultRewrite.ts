import type { ResultRewriteIndex } from '../../core/agent/recordedCalls.js';
import { isPlaceholder, servedUnderPolicy } from '../../redaction/marker.js';
import { boundedPreview, displayText, renderPreview } from '../bounded.js';
import { TOOL_RESULT_PREVIEW_CHARS } from './structuralLimits.js';

/** Names-only metadata from a positively bound occurrence; never opens result bytes. */
export function resultRewriteLine(
  occurrenceKey: string | undefined,
  rewrites: ResultRewriteIndex,
  snapshot: unknown,
): string | undefined {
  if (occurrenceKey === undefined) return undefined;
  const owner = rewrites.get(occurrenceKey);
  const name = owner?.kind === 'rewritten' ? owner.name : undefined;
  if (name === undefined || (servedUnderPolicy(snapshot) && isPlaceholder(name))) return undefined;
  return `rewritten by: ${displayText(
    renderPreview(boundedPreview(name, TOOL_RESULT_PREVIEW_CHARS)),
  )}`;
}
