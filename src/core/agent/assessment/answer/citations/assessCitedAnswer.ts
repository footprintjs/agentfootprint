import { readEvidenceSnapshot } from '../../../../../integrity/claim-binding/admit.js';
import { BINDING_LIMITS, boundedResultId } from '../../../../../integrity/claim-binding/scope.js';
import type {
  ClaimBindingRule,
  EvidenceSnapshot,
} from '../../../../../integrity/claim-binding/types.js';
import { copyJson, ownData, readOwnList } from '../../../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import type { SubmittedCitationOffer } from '../../../../../provider-contract/citationResponse.js';
import {
  checkCitationClaim,
  type CitationClaim,
  type CitationClaimVerdict,
} from './check/checkClaim.js';
import { checkCitationColumn, type UngroundedCitationEntity } from './check/checkColumn.js';
import { compareCitationSources, type CitationComparisonGroup } from './check/compareSources.js';
import { citationClaimText, collectCitations } from './collect/collect.js';

interface AssessCitedAnswerInput {
  readonly answer: string;
  readonly offer?: SubmittedCitationOffer | undefined;
  readonly evidence?: EvidenceSnapshot | undefined;
  readonly rules?: readonly ClaimBindingRule[] | undefined;
  readonly comparisonGroups?: readonly CitationComparisonGroup[] | undefined;
  readonly extractClaim?: ((span: string) => CitationClaim | undefined) | undefined;
  readonly requestedColumn?: string | undefined;
  /** Runtime lookup of the complete authorized schema for this submitted body. */
  readonly visibleColumnsFor?: ((resultId: string) => readonly string[] | undefined) | undefined;
}

interface LocatedFinding {
  readonly start: number;
  readonly end: number;
  readonly slot?: number;
}

type CitationAssessmentFinding =
  | (LocatedFinding & { readonly kind: 'citation' } & CitationAssessmentVerdict)
  | (LocatedFinding & {
      readonly kind: 'column';
      readonly slot: number;
    } & UngroundedCitationEntity);

type CitationAssessmentVerdict =
  | Exclude<CitationClaimVerdict, { outcome: 'unverified' }>
  | {
      readonly outcome: 'unverified';
      readonly reason:
        | Extract<CitationClaimVerdict, { outcome: 'unverified' }>['reason']
        | 'evidence-unavailable';
    };

/** Read the submitted receipt's bounded own data. Transport supplies the proof, not this reader. */
function readableOffer(offer: SubmittedCitationOffer | undefined) {
  if (offer === undefined) return undefined;
  try {
    const data = ownData(offer, ['offer', 'results']);
    const list = readOwnList(data.results, BINDING_LIMITS.results);
    if (typeof data.offer !== 'string' || list === undefined || list.unread !== 0) return undefined;
    const bySlot = new Map<number, string>();
    const ids = new Set<string>();
    const occurrences = new Set<string>();
    for (const raw of list.entries) {
      const { slot, resultId, bodyDigest, occurrence } = ownData(raw, [
        'slot',
        'resultId',
        'bodyDigest',
        'occurrence',
      ]);
      const identity = readCallOccurrenceKey({ callOccurrenceKey: occurrence });
      if (
        typeof slot !== 'number' ||
        !Number.isSafeInteger(slot) ||
        slot < 1 ||
        slot > BINDING_LIMITS.results ||
        !boundedResultId(resultId) ||
        typeof bodyDigest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(bodyDigest) ||
        typeof identity !== 'string' ||
        bySlot.has(slot) ||
        ids.has(resultId) ||
        occurrences.has(identity)
      )
        return undefined;
      bySlot.set(slot, resultId);
      ids.add(resultId);
      occurrences.add(identity);
    }
    return { offer: data.offer, results: [...bySlot.keys()].map((slot) => ({ slot })), bySlot };
  } catch {
    return undefined;
  }
}

function extractAuthoredClaim(
  text: string | undefined,
  extract: AssessCitedAnswerInput['extractClaim'],
): CitationClaim | undefined {
  if (text === undefined || extract === undefined) return undefined;
  try {
    const claim = extract(text);
    if (claim instanceof Promise) {
      // A mistaken asynchronous author callback supplies no independently scoped claim.
      void Promise.prototype.then.call(claim, undefined, () => undefined);
      return undefined;
    }
    return claim === undefined
      ? undefined
      : (copyJson(claim, BINDING_LIMITS.scopeBytes * 2, true) as CitationClaim);
  } catch {
    return undefined;
  }
}

function readableEvidence(evidence: EvidenceSnapshot | undefined): EvidenceSnapshot | undefined {
  if (evidence === undefined) return undefined;
  try {
    return readEvidenceSnapshot(evidence);
  } catch {
    return undefined;
  }
}

function columnFinding(input: AssessCitedAnswerInput, resultId: string) {
  if (input.requestedColumn === undefined || input.visibleColumnsFor === undefined)
    return undefined;
  try {
    return checkCitationColumn(input.requestedColumn, input.visibleColumnsFor(resultId));
  } catch {
    return undefined;
  }
}

interface CitationAssessment {
  readonly complete: boolean;
  readonly findings: readonly CitationAssessmentFinding[];
  readonly comparisonComplete?: boolean;
  readonly conflicts?: readonly (readonly [number, number])[];
}

/** Assess only the final answer and its submitted results, emitting only public witnesses. */
export function assessCitedAnswer(input: AssessCitedAnswerInput): CitationAssessment {
  const offer = readableOffer(input.offer);
  const collected = collectCitations(input.answer, offer);
  const groups = input.comparisonGroups;
  const compare = groups !== undefined && groups.length > 0;
  const rules = input.rules ?? [];
  const comparison =
    compare && offer !== undefined && input.evidence !== undefined
      ? compareCitationSources({ slots: offer.bySlot, evidence: input.evidence, rules, groups })
      : undefined;
  const compared = compare
    ? { comparisonComplete: comparison?.complete === true, conflicts: comparison?.conflicts ?? [] }
    : {};
  if (!collected.complete) return { complete: false, findings: [], ...compared };

  const citedSlots = new Set<number>();
  const spans = collected.spans.map((span) => {
    let hasLink = false;
    for (const reference of span.references) {
      if (reference.resolvedSlot !== undefined) {
        citedSlots.add(reference.resolvedSlot);
        hasLink = true;
      }
    }
    const claim =
      hasLink && input.evidence !== undefined
        ? extractAuthoredClaim(citationClaimText(input.answer, span), input.extractClaim)
        : undefined;
    return { span, claim };
  });

  // A claim's scope is selected before the offered result's evidence can influence it.
  const evidence = spans.some(({ claim }) => claim !== undefined)
    ? readableEvidence(input.evidence)
    : undefined;
  let checkedColumn = false;
  const findings: CitationAssessmentFinding[] = [];
  for (const { span, claim } of spans) {
    const location = { start: span.start, end: span.end };
    for (const { resolvedSlot: slot } of span.references) {
      const resultId = slot === undefined ? undefined : offer?.bySlot.get(slot);
      if (slot === undefined || resultId === undefined) {
        findings.push({
          kind: 'citation',
          ...location,
          outcome: 'unverified',
          reason: 'offer-unavailable',
        });
        continue;
      }
      const verdict: CitationAssessmentVerdict =
        input.evidence === undefined || (claim !== undefined && evidence === undefined)
          ? { outcome: 'unverified', reason: 'evidence-unavailable' }
          : checkCitationClaim(
              claim,
              evidence === undefined ? undefined : { resultId, snapshot: evidence, rules },
            );
      findings.push({ kind: 'citation', ...location, slot, ...verdict });

      // One governing source is required. An absent field in one of several sources is ambiguous.
      if (citedSlots.size === 1 && !checkedColumn) {
        checkedColumn = true;
        const column = columnFinding(input, resultId);
        if (column !== undefined) findings.push({ kind: 'column', ...location, slot, ...column });
      }
    }
  }
  return { complete: true, findings, ...compared };
}
