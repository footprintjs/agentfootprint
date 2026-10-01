/**
 * evidence/answerCarriers — which of THIS turn's tool results the answer's
 * names and numbers were read from.
 *
 * Pattern: one pure fold over two things the gate already holds — the
 *          values a tool result DID carry (`EvidenceVerdict.grounded`) and
 *          the corpus's carriers (`EvidenceCorpus.carriers`). No second walk,
 *          no second budget.
 * Role:    core/ layer leaf. Asked once per judged answer by
 *          `stages/route.ts · judgeEvidence`; its output rides
 *          `agentfootprint.agent.evidence_checked` as `carriedBy`.
 * Emits:   N/A.
 *
 * ## Why
 *
 * A turn can fetch a result and then answer from something else — an earlier
 * turn's data, a computation over it, a sibling call. A host that puts every
 * result the turn fetched under the answer ("here is the data") then shows a
 * dataset the answer never used as if the answer stood on it. The host cannot
 * work out which results the answer used: that needs the gate's extractor,
 * its spellings and its carriers, which are the library's. So the library
 * says it, as identities and counts — never a value.
 *
 * ## What it says, and what it does not
 *
 * One entry per result of THIS turn that carried at least one of the
 * answer's grounded values: how many (`values`), and how many of those no
 * other result of this turn carried (`only`). A result of this turn that is
 * NOT listed carried none of the names and numbers the answer states. That
 * is a fact about tokens, never about meaning: an answer that states no value
 * ("yes, the cluster is healthy") can rest on a result it cites nothing from,
 * so a reader says "cited nothing from it", never "did not use it".
 *
 * ## The whole list or none
 *
 * `undefined` when the corpus hit its token ceiling (`truncated`) or one
 * value's carrier list was cut at `MAX_CARRIERS`: a result past the cut is
 * invisible, and "not listed ⇒ cited nothing" read off a prefix would be a
 * false denial. The contingent check (`findings/contingent.ts`) keeps the
 * same law for the same reason.
 *
 * THIS TURN ONLY: the carriers are cleared at each user-turn boundary, so a
 * value an answer took from an earlier turn's result names no carrier here.
 */

import type { EvidenceCorpus } from './evidenceIndex.js';
import { canonicalForm } from './normalize.js';
import type { GroundedValue } from './types.js';

/** One result of this turn that carried at least one of the answer's values. */
export interface AnswerCarrier {
  /** The `toolCallId` of the `role: 'tool'` message that carried them. */
  readonly toolCallId: string;
  /** How many of the answer's distinct grounded values this result carried. */
  readonly values: number;
  /** How many of those values no other result of this turn carried. */
  readonly only: number;
}

/**
 * The results of this turn the answer's grounded values were read from, in
 * the order the corpus first lists them — or `undefined` when the corpus
 * cannot give the whole list (see the header). Two spellings of one value
 * share a canonical form and count once. Pure.
 */
export function answerCarriersOf(
  grounded: readonly GroundedValue[],
  corpus: Pick<EvidenceCorpus, 'carriers' | 'truncated'>,
): readonly AnswerCarrier[] | undefined {
  if (corpus.truncated) return undefined;
  // Insertion order of the Map IS the order the corpus first listed each result.
  const counts = new Map<string, { values: number; only: number }>();
  const seen = new Set<string>();
  for (const { value, forms } of grounded) {
    const canonical = canonicalForm(value);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const ids: string[] = [];
    for (const form of forms) {
      const entry = corpus.carriers.get(form);
      if (entry === undefined) continue;
      if (entry.truncated === true) return undefined;
      for (const id of entry.toolCallIds) if (!ids.includes(id)) ids.push(id);
    }
    for (const id of ids) {
      let held = counts.get(id);
      if (held === undefined) {
        held = { values: 0, only: 0 };
        counts.set(id, held);
      }
      held.values += 1;
      if (ids.length === 1) held.only += 1;
    }
  }
  return Object.freeze(
    [...counts].map(([toolCallId, held]) =>
      Object.freeze({ toolCallId, values: held.values, only: held.only }),
    ),
  );
}
