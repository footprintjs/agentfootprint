/**
 * judge — the typed door's rows: one row per entry of the app's negatives field, its verdict
 * mapped to the disposition the validation door already reads (design § 5.4), and the
 * library's statement beside an established one.
 *
 * Pattern: `citation.ts` decides; this file names the row (`agent:negative-claims:<field>#<n>`),
 *          maps the verdict to a disposition and composes the statement (`statement.ts`). An
 *          established claim CLEARS the claim (`not-applicable`) — it never verifies the answer,
 *          so no row is `checked-pass`.
 * Role:    integrity/ layer (L3). Not wired: PR 4 mounts it behind `.negativeClaims()` and
 *          `agentChecks: ['negative-claims']`.
 *
 * A row carries identities, tool names and codes — never a value and never a sentence; the
 * statement travels beside it.
 */

import { stableJson } from '../../lib/stableJson.js';
import type { Disposition } from '../disposition/types.js';
import { judgeCitation, MAX_CITED_READS, type CitationVerdict } from './citation.js';
import { MAX_NEGATIVE_CLAIMS } from './limits.js';
import { composeStatement } from './statement.js';
import type { CitationInterpretation, TurnRecord, TypedJudgement, TypedVerdict } from './types.js';

export { MAX_CITED_READS };
export { MAX_NEGATIVE_CLAIMS };

const TOO_MANY: CitationVerdict = Object.freeze({
  kind: 'unknown',
  code: 'too-many-claims',
  results: [],
  tools: [],
  reads: [],
});

const CHECKED_FAIL: ReadonlySet<TypedVerdict> = new Set([
  'contradicted-by-rows',
  'wider-search-has-rows',
  'search-incomplete',
  'superseded-by-write',
  'later-read-failed',
]);

/** The disposition a typed verdict files (§ 5.4). */
export function dispositionOf(code: TypedVerdict): Disposition {
  if (code === 'established') return 'not-applicable';
  return CHECKED_FAIL.has(code) ? 'checked-fail' : 'unreachable';
}

export interface TypedCheckInput {
  /** The answer field that holds the citations — names the rows. */
  readonly field: string;
  /** The field's value as the model filled it — untrusted. */
  readonly negatives: unknown;
  readonly record: TurnRecord;
  /** The tools the app lets a claim cite (`.negativeClaims({ tools })`). */
  readonly citable?: readonly string[];
  /** Internal staged comparison: corrected kind only, then the recorded-subject label check.
   * Omitted retains the historical explicit-kind/exact-about pure interpretation. */
  readonly interpretation?: CitationInterpretation;
}

/** A repeated claim is judged once (its stable JSON is the key); a key that cannot be made, every time. */
function judgeOnce(
  cache: Map<string, CitationVerdict>,
  entry: unknown,
  judge: (entry: unknown) => CitationVerdict,
): CitationVerdict {
  let key: string | undefined;
  try {
    key = stableJson(entry);
  } catch {
    key = undefined;
  }
  if (key === undefined) return judge(entry);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const verdict = judge(entry);
  cache.set(key, verdict);
  return verdict;
}

/**
 * Judge every citation of the field. No field, or an empty list, is no claim. A field that is
 * not a list is one unresolved citation; a field of more than {@link MAX_NEGATIVE_CLAIMS}
 * claims withholds every one of them (`too-many-claims`).
 */
export function judgeTypedNegatives(input: TypedCheckInput): TypedJudgement[] {
  const { field, negatives, record, citable, interpretation } = input;
  if (negatives === undefined || negatives === null) return [];
  const entries = Array.isArray(negatives) ? negatives : [negatives];
  const tooMany = entries.length > MAX_NEGATIVE_CLAIMS;
  const cache = new Map<string, CitationVerdict>();
  return entries.map((entry, index) => {
    const verdict = tooMany
      ? TOO_MANY
      : Array.isArray(negatives)
      ? judgeOnce(cache, entry, (e) => judgeCitation(e, record, citable, interpretation))
      : judgeCitation(undefined, record, citable, interpretation);
    const row = {
      id: `agent:negative-claims:${field}#${index}`,
      path: `${field}[${index}]`,
      index,
      kind: verdict.kind,
      code: verdict.code,
      disposition: dispositionOf(verdict.code),
      tools: verdict.tools,
      results: verdict.results,
      ...(verdict.staleSince === undefined ? {} : { staleSince: verdict.staleSince }),
    };
    if (verdict.code !== 'established' || verdict.kind === 'unknown') return { row };
    const reads = verdict.reads.flatMap((call) =>
      call.row === undefined ? [] : [{ call, row: call.row, tool: record.tools[call.toolName] }],
    );
    return { row, statement: composeStatement(verdict.kind, reads, record.clock) };
  });
}
