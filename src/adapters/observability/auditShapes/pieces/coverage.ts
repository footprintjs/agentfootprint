import type {
  AgentTurnEndPayload,
  AnswerNegativesPayload,
  CoverageCompositionPayload,
  CoverageFacetReferencePayload,
  CoverageGapPayload,
  CoverageItemPayload,
  DeliveredNegative,
  InProgressItemPayload,
  PeriodPayload,
  ProvenancePayload,
} from '../../../../events/payloads.js';
import type { AnswerCoverage, AnswerInProgress } from '../../../../semantics/coverage/answer.js';
import type { InProgressItem } from '../../../../semantics/coverage/types.js';
import type { RuntimeNegativeRow } from '../../../../core/agent/negativeClaims/delivery.js';
import {
  bool,
  charsMarker,
  either,
  listOf,
  num,
  oneOf,
  shapeOf,
  str,
} from '../../auditBounding.js';

// ─── Shared pieces: coverage, periods, witnesses ─────────────────────

/** One coverage item: the tool author's prose (`what`, `why`, `short`), and its `kind`. */
export const boundCoverageItem = shapeOf<CoverageItemPayload>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  kind: oneOf('existence', 'scope'),
});

/** What a read found still running: the tool author's prose, and how many things it stands for. */
export const boundInProgressItem = shapeOf<InProgressItemPayload & InProgressItem>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  count: num,
});

/** A declared window: both instants are the tool's own values. */
export const boundInstants = shapeOf<{ readonly from: string; readonly to: string }>({
  from: charsMarker,
  to: charsMarker,
});

/** What the store holds — a window, or the library's word `'unknown'` (the tool
 *  said it cannot vouch for the store), which stays. */
export const boundHeld = either(oneOf('unknown'), boundInstants);

/** A declared period: its instants are the tool's values. */
export const boundPeriod = shapeOf<PeriodPayload>({
  queried: boundInstants,
  held: boundHeld,
  readAt: charsMarker,
});

/** An absence's source and its clock, as the tool declared them. */
export const boundProvenance = shapeOf<ProvenancePayload>({
  measuredAt: charsMarker,
  source: charsMarker,
  ageSeconds: num,
  sourceExportDate: charsMarker,
});

/**
 * What the library composed for a `search` tool. Kept: facets ride BY
 * REFERENCE, and a gap's words name arguments and verdicts, never a value
 * (`CoverageGapPayload`'s contract) — a `'prose'` gap's words are the ones
 * the search declaration states up front.
 */
/** What a gap bears on: a facet word, or the filter and values the search declaration states. */
export const boundBearsFilter = shapeOf<Exclude<NonNullable<CoverageGapPayload['bears']>, string>>({
  filter: str,
  values: listOf(either(str, num, bool)),
});

export const boundBears = either(
  oneOf('completeness', 'period', 'population', 'source'),
  boundBearsFilter,
);

export const boundComposition = shapeOf<CoverageCompositionPayload>({
  origin: oneOf('local', 'remote'),
  resultId: str,
  complete: bool,
  facets: listOf(
    shapeOf<CoverageFacetReferencePayload>({
      facet: oneOf('filter', 'names', 'period', 'population', 'source', 'subject'),
      from: oneOf('call', 'default', 'host', 'result'),
      ref: shapeOf<CoverageFacetReferencePayload['ref']>({ resultId: str, argument: str }),
      any: bool,
    }),
  ),
  gaps: listOf(
    shapeOf<CoverageGapPayload>({
      kind: oneOf(
        'argument-unsent',
        'cap-reached',
        'credential-limited',
        'match',
        'paged',
        'partial',
        'period',
        'prose',
        'ranking',
        'scope',
      ),
      what: str,
      why: str,
      bears: boundBears,
      argument: str,
    }),
  ),
});

// ─── turn_end: a typed answer's limits and negatives ─────────────────

/** `turn_end.answerCoverage` — what the payload type declares, and what the runtime value carries. */
export type TurnEndCoverage = NonNullable<AgentTurnEndPayload['answerCoverage']> & AnswerCoverage;

export type CoveragePeriod = NonNullable<TurnEndCoverage['periods']>[number];

export type AssumedValue = NonNullable<TurnEndCoverage['assumed']>[number];

/** One negative check row — the payload's fields and the runtime row's. */
export type NegativeCheckRow = AnswerNegativesPayload['checks'][number] & RuntimeNegativeRow;

/**
 * A typed answer's limits: the three lists, the declared periods, what a read
 * found still running and the values an `assume` rule filled. Every sentence
 * and value is a marker; the tool and argument NAMES, the call ids, counts,
 * kinds and the library's `'unknown'` stay.
 */
export const boundAnswerCoverage = shapeOf<TurnEndCoverage>({
  checked: listOf(boundCoverageItem),
  notChecked: listOf(boundCoverageItem),
  cannotCover: listOf(boundCoverageItem),
  periods: listOf(
    shapeOf<CoveragePeriod>({
      toolName: str,
      toolCallId: str,
      queried: boundInstants,
      held: boundHeld,
      readAt: charsMarker,
    }),
  ),
  inProgress: listOf(
    shapeOf<NonNullable<TurnEndCoverage['inProgress']>[number] & AnswerInProgress>({
      toolName: str,
      toolCallId: str,
      items: listOf(boundInProgressItem),
    }),
  ),
  assumed: listOf(
    shapeOf<AssumedValue>({
      toolName: str,
      argument: str,
      value: charsMarker,
      hidden: bool,
    }),
  ),
});

/**
 * A typed answer's negatives: each statement and the population it is about
 * are markers; the answer field's declared name, the codes, verdicts, ids,
 * tool names and counts stay.
 */
export const boundAnswerNegatives = shapeOf<AnswerNegativesPayload>({
  field: str,
  version: str,
  delivery: oneOf('as-checked', 'fallback', 'recorded'),
  claims: listOf(
    shapeOf<DeliveredNegative>({
      kind: oneOf('complete', 'none', 'not-found', 'unknown'),
      about: charsMarker,
      restsOn: listOf(str),
      statement: charsMarker,
      delivery: oneOf('record-composed'),
      version: str,
    }),
  ),
  checks: listOf(
    shapeOf<NegativeCheckRow>({
      id: str,
      path: str,
      index: num,
      kind: oneOf('complete', 'none', 'not-found', 'unknown'),
      notes: listOf(oneOf('absence-kind-normalized')),
      // The payload declares any string: a checker's code.
      code: str,
      disposition: oneOf('checked-fail', 'not-applicable', 'unreachable'),
      tools: listOf(str),
      results: listOf(str),
      staleSince: shapeOf<NonNullable<NegativeCheckRow['staleSince']>>({
        turn: num,
        readAt: str,
      }),
    }),
  ),
  coverage: listOf(
    shapeOf<AnswerNegativesPayload['coverage'][number]>({ tool: str, checked: num }),
  ),
  actions: listOf(
    shapeOf<AnswerNegativesPayload['actions'][number]>({
      tool: str,
      outcome: oneOf('error', 'not-run', 'ok'),
    }),
  ),
});
