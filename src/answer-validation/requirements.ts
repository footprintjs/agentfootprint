/** Pure prerequisite checks over caller-authenticated producer reports. No IO or value comparison. */
import {
  readRequirementResults,
  REQUIREMENT_RESULT_LIMITS,
  type RequirementReason,
} from 'foottrace';
import { copyJson, ownData } from '../lib/boundedJson.js';
import type { AnswerCheck } from './types.js';

/** Host-authored obligations for one claim at one exact finding and window. */
export interface ClaimRequirementPolicy {
  /** Also the AnswerCheck id: at most 128 characters, with no whitespace. */
  readonly claimRef: string;
  readonly findingRef: string;
  readonly windowRef: string;
  /** Nonempty, distinct expected obligations; at most 16 opaque references. */
  readonly requirementRefs: readonly string[];
}

/** The check concerns prerequisites only; it does not establish a factual value's truth. */
export interface ClaimRequirementAssessment {
  readonly check: AnswerCheck;
  /** Matched RequirementResult.id selectors, NOT artifact refs or AnswerCheck.evidenceRefs. */
  readonly requirementResultRefs: readonly string[];
}

const POLICY_BYTES = 16 * 1024;
const CHECK_ID_CHARACTERS = 128;

function ref(value: unknown, maximum: number = REQUIREMENT_RESULT_LIMITS.name): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    /\s/u.test(value)
  )
    throw new Error('Invalid reference.');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) throw new Error('Invalid reference.');
  }
  return value;
}

/** Fixed diagnostics: never retain a hostile value or the exception raised while inspecting it. */
function readPolicy(value: ClaimRequirementPolicy): ClaimRequirementPolicy {
  try {
    const source = ownData(value, ['claimRef', 'findingRef', 'windowRef', 'requirementRefs']);
    if (!Array.isArray(source.requirementRefs)) throw new Error();
    const length = Object.getOwnPropertyDescriptor(source.requirementRefs, 'length')
      ?.value as unknown;
    if (typeof length !== 'number' || length < 1 || length > REQUIREMENT_RESULT_LIMITS.refs)
      throw new Error();
    const copied = ownData(copyJson(source, POLICY_BYTES, true));
    const requirementRefs = (copied.requirementRefs as unknown[]).map((item) => ref(item));
    if (new Set(requirementRefs).size !== requirementRefs.length) throw new Error();
    return Object.freeze({
      claimRef: ref(copied.claimRef, CHECK_ID_CHARACTERS),
      findingRef: ref(copied.findingRef),
      windowRef: ref(copied.windowRef),
      requirementRefs: Object.freeze(requirementRefs),
    });
  } catch {
    throw Object.assign(new TypeError('Invalid claim requirement policy.'), {
      code: 'ERR_CLAIM_REQUIREMENT_POLICY' as const,
    });
  }
}

function assessment(
  claimRef: string,
  resultRefs: readonly string[],
  reason?: RequirementReason,
): ClaimRequirementAssessment {
  return Object.freeze({
    check: Object.freeze({
      id: claimRef,
      disposition: reason === undefined ? 'checked-pass' : 'unreachable',
      ...(reason === undefined ? {} : { reason }),
    }),
    requirementResultRefs: Object.freeze([...resultRefs]),
  });
}

/**
 * Check every expected prerequisite for one exact claim/finding/window binding.
 * Any same-scope unresolved report affecting this claim denies it, including an
 * extra obligation; a satisfied report never overrides that denial. Missing
 * expected obligations are unreachable, not a successful empty check.
 *
 * The host must authenticate the producer and current query/run/scope, authorize
 * receipt access and establish domain validity BEFORE supplying results. The
 * public Foottrace reader admits structure only; neither it nor this helper
 * verifies provenance, freshness, a claim's value, or permission to disclose it.
 * Use the returned check only when the candidate actually asserts this claim.
 * Requirement result IDs are selectors, never artifact evidence references.
 *
 * A malformed host policy throws code ERR_CLAIM_REQUIREMENT_POLICY. Malformed
 * receipt sets produce unreachable/invalid-data without exposing parser errors.
 */
export function checkClaimRequirements(
  policy: ClaimRequirementPolicy,
  results: unknown,
): ClaimRequirementAssessment {
  const expected = readPolicy(policy);
  let admitted: ReturnType<typeof readRequirementResults>;
  try {
    admitted = readRequirementResults(results);
  } catch {
    return assessment(expected.claimRef, [], 'invalid-data');
  }
  const affected = admitted.filter((result) => result.affects.includes(expected.claimRef));
  const applicable = affected
    .filter(
      (result) =>
        result.findingRef === expected.findingRef && result.windowRef === expected.windowRef,
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const resultRefs = applicable.map((result) => result.id);
  const unresolved = applicable.find((result) => result.state === 'unresolved');
  if (unresolved?.state === 'unresolved')
    return assessment(expected.claimRef, resultRefs, unresolved.reason);
  for (const requirementRef of expected.requirementRefs) {
    if (!applicable.some((result) => result.requirementRef === requirementRef)) {
      const foreign = affected.some((result) => result.requirementRef === requirementRef);
      return assessment(expected.claimRef, resultRefs, foreign ? 'incompatible' : 'not-collected');
    }
  }
  return assessment(expected.claimRef, resultRefs);
}
