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

import type { Disposition } from '../disposition/types.js';
import { judgeCitation } from './citation.js';
import { composeStatement } from './statement.js';
import type { TurnRecord, TypedJudgement, TypedVerdict } from './types.js';

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
}

/** Judge every citation of the field. No field, or an empty list, is no claim. */
export function judgeTypedNegatives(input: TypedCheckInput): TypedJudgement[] {
  const { field, negatives, record, citable } = input;
  if (negatives === undefined || negatives === null) return [];
  const entries = Array.isArray(negatives) ? negatives : [negatives];
  return entries.map((entry, index) => {
    const verdict = Array.isArray(negatives)
      ? judgeCitation(entry, record, citable)
      : judgeCitation(undefined, record, citable);
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
      call.row === undefined ? [] : [{ call, row: call.row }],
    );
    return { row, statement: composeStatement(verdict.kind, reads, record.clock) };
  });
}
