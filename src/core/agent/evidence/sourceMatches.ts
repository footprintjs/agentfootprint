import { MAX_CARRIERS } from './carriers.js';
import type { EvidenceCorpus } from './evidenceIndex.js';

export type CheckSourceMatch = (
  span: readonly [number, number],
  matches: { readonly occurrences: readonly string[]; readonly bounded: boolean },
) => void;

/** Take sources from the same spellings and turn that the existing gate checked. */
export function sourceMatches(
  evidence: EvidenceCorpus,
  forms: readonly string[],
  turn: number,
): { occurrences: readonly string[]; bounded: boolean } {
  const occurrences = new Set<string>();
  let bounded = evidence.truncated;
  for (const form of forms) {
    const carrier = evidence.occurrences?.get(form);
    if (carrier?.turn !== turn) continue;
    bounded ||= carrier.truncated === true;
    for (const occurrence of carrier.occurrences) {
      if (occurrences.has(occurrence)) continue;
      if (occurrences.size < MAX_CARRIERS) occurrences.add(occurrence);
      else bounded = true;
    }
  }
  return { occurrences: [...occurrences], bounded };
}
