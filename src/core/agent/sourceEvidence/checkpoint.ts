import { sourceEvidenceIndex } from '../../../artifacts/sourceEvidence/guards.js';
import type { SourceEvidenceIndex } from '../../../artifacts/sourceEvidence/types.js';

/** One bounded detached reader for both checkpoint writers and restoration doors. */
export function sourceEvidenceOf(state?: {
  readonly sourceEvidence?: SourceEvidenceIndex;
}): SourceEvidenceIndex | undefined {
  if (state === undefined) return undefined;
  const slot = Object.getOwnPropertyDescriptor(state, 'sourceEvidence');
  if (slot === undefined) return undefined;
  if (!slot.enumerable || !('value' in slot))
    throw new TypeError('Invalid native source evidence checkpoint carrier.');
  if (slot.value === undefined) return undefined;
  try {
    return sourceEvidenceIndex(slot.value);
  } catch {
    throw new TypeError('Invalid native source evidence checkpoint carrier.');
  }
}
