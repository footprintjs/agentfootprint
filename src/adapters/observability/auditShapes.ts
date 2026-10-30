/**
 * auditShapes — WHAT the audit chain's bounded mode keeps of each event: one
 * shape per registered event type, every field of its payload ruled.
 *
 * Pattern: a declarative table, total over the registry
 *          (`{ [T in keyof AgentfootprintEventMap]-?: BoundRule }`), built from
 *          the combinators in `auditBounding.ts`.
 * Role:    the bounding layer's data. `audit.ts` asks it for every event in
 *          `payloadMode: 'bounded'`; an event type it does not know is
 *          `unknownEventShape` — every field a marker.
 * Emits:   N/A.
 *
 * A new event type, or a new field on a payload, does not compile until it is
 * classified here. Content (what a person, the model, a tool or the data
 * wrote, or a message composed from it) is a marker; structure (ids, names,
 * kinds, codes, verdicts, counts, the library's own sentences, the words the
 * app declared up front) is kept — and every kept value is CHECKED at runtime
 * as the kind its type declares: `num`, `bool`, `str` (an open string: an id,
 * a name, a label), `oneOf` (a closed union: exactly its words). No container
 * is kept whole; each is spelled out field by field, so a child its type does
 * not declare is a marker. The type walker
 * (`test/type-regressions/AuditBoundingDepth.test.ts`) holds every rule here
 * to the type beneath it; the runtime sweep
 * (`test/observability-providers/audit-bounded-sweep.test.ts`) hands every rule
 * what its kind forbids.
 *
 * The positions a record keeps although their value may come from the run —
 * meta's who, decision evidence, a policy's tag, an app's reason word, a seen
 * tool's name — are the rules `auditKeptByContract.ts` names, placed here.
 *
 * `audit.ts` looks an event's shape up in `eventShapeTable` — a `Map`, so an
 * event NAME is never a key into a plain object (`constructor`, `__proto__`).
 */

import type {
  ScriptBlockVerdict,
  ScriptsVerdict,
  ShownScript,
  TurnEndScripts,
} from '../../lib/scriptRecord.js';
import type { RuntimeNegativeRow } from '../../core/agent/negativeClaims/delivery.js';
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
  SkillGuardEvaluationRecord,
  TryInsteadToolPayload,
} from '../../events/payloads.js';
import type { AgentfootprintEventMap } from '../../events/registry.js';
import type { EventMeta, EventSourcePosition } from '../../events/types.js';
import type { Assertion } from '../../integrity/assertion/types.js';
import type { AnswerCoverage, AnswerInProgress } from '../../semantics/coverage/answer.js';
import type { PeriodOnWire } from '../../semantics/coverage/period.js';
import type {
  PagingDeclaration,
  ResolvedDeclaration,
} from '../../semantics/coverage/search/resultFacts.js';
import type { InProgressItem } from '../../semantics/coverage/types.js';
import type {
  SemanticClarify,
  SemanticCoverage,
  SemanticEdge,
  SemanticFact,
  SemanticGrain,
  SemanticProvenance,
  SemanticRender,
  SemanticSeriesPoint,
  ToolSemantics,
} from '../../semantics/types.js';
import {
  blocksMarker,
  bool,
  charsMarker,
  either,
  keysMarker,
  listOf,
  messagesMarker,
  nullOr,
  num,
  oneOf,
  orList,
  recordOf,
  shapeOf,
  str,
  summariesMarker,
  typeMarker,
  type AnyKeyOf,
  type BoundRule,
} from './auditBounding.js';
import {
  appReasonWord,
  decisionSummary,
  declaredValue,
  metaIdentity,
  policyReasonTag,
  routeEvidence,
  seenToolName,
} from './auditKeptByContract.js';

/** `T`'s field `K`, present. */
type At<T, K extends keyof NonNullable<T>> = NonNullable<NonNullable<T>[K]>;

const SCRIPT_LABELS = [
  'submitted',
  'returned',
  'reported-success',
  'reported-failure',
  'completed',
  'completed-with-failure',
  'outcome-unknown',
] as const;

/** A submitted program's attached record: only its text is content. */
const boundShownScript = shapeOf<ShownScript>({
  toolCallId: str,
  dispatch: num,
  tool: str,
  language: str,
  label: oneOf(...SCRIPT_LABELS),
  exitCode: num,
  resultWithheld: oneOf('over-ceiling'),
  rewritten: oneOf(true),
  bytes: num,
  lines: num,
  truncated: shapeOf<NonNullable<ShownScript['truncated']>>({ shownBytes: num }),
  text: charsMarker,
});

/** Attachment summary: preserve every declared field, check every runtime child. */
export const boundScripts = shapeOf<TurnEndScripts>({
  shown: listOf(boundShownScript),
  omitted: num,
  closedFence: shapeOf<NonNullable<TurnEndScripts['closedFence']>>({
    char: oneOf('backtick', 'tilde'),
    length: num,
  }),
  withheldFromText: oneOf(true),
});

/** Match verdicts contain labels and references, never the program. */
const boundScriptsVerdict = shapeOf<ScriptsVerdict>({
  blocks: listOf(
    shapeOf<ScriptBlockVerdict>({
      block: num,
      label: oneOf(...SCRIPT_LABELS, 'unmatched'),
      exitCode: num,
      toolCallId: str,
      tool: str,
      dispatch: num,
      alsoMatches: num,
      reason: oneOf('no-submission-this-turn', 'over-size', 'kept-out'),
    }),
  ),
  earlierTurnRows: num,
  regionsDropped: num,
  scriptsDropped: num,
});

// ─── Shared pieces: coverage, periods, witnesses ─────────────────────

/** One coverage item: the tool author's prose (`what`, `why`, `short`), and its `kind`. */
const boundCoverageItem = shapeOf<CoverageItemPayload>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  kind: oneOf('existence', 'scope'),
});

/** What a read found still running: the tool author's prose, and how many things it stands for. */
const boundInProgressItem = shapeOf<InProgressItemPayload & InProgressItem>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  count: num,
});

/** A declared window: both instants are the tool's own values. */
const boundInstants = shapeOf<{ readonly from: string; readonly to: string }>({
  from: charsMarker,
  to: charsMarker,
});

/** What the store holds — a window, or the library's word `'unknown'` (the tool
 *  said it cannot vouch for the store), which stays. */
const boundHeld = either(oneOf('unknown'), boundInstants);

/** A declared period: its instants are the tool's values. */
const boundPeriod = shapeOf<PeriodPayload>({
  queried: boundInstants,
  held: boundHeld,
  readAt: charsMarker,
});

/** An absence's source and its clock, as the tool declared them. */
const boundProvenance = shapeOf<ProvenancePayload>({
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
const boundBearsFilter = shapeOf<Exclude<NonNullable<CoverageGapPayload['bears']>, string>>({
  filter: str,
  values: listOf(either(str, num, bool)),
});
const boundBears = either(
  oneOf('completeness', 'period', 'population', 'source'),
  boundBearsFilter,
);

const boundComposition = shapeOf<CoverageCompositionPayload>({
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

/**
 * A skill guard's evaluation: the edge, the call, the verdict, and per
 * condition the key, operator and value the app DECLARED — and the engine's
 * summary of the value it read (`actualSummary`), the decision evidence the
 * chain keeps by contract (redaction-aware).
 */
const boundGuard = shapeOf<SkillGuardEvaluationRecord>({
  from: str,
  to: str,
  toolName: str,
  toolCallId: str,
  verdict: bool,
  conditions: listOf(
    shapeOf<SkillGuardEvaluationRecord['conditions'][number]>({
      key: str,
      op: str,
      value: orList(declaredValue),
      // The engine's decision evidence: a summary of the value a guard read.
      actualSummary: decisionSummary,
      passed: bool,
    }),
  ),
});

/** What an integrity finding is about: a kind and an id. */
const boundSubject = shapeOf<Assertion['subject']>({ kind: str, id: str });

/** What a message said that won a routing match: the text is the person's; the
 *  keyword is the app's declared vocabulary. */
const boundWitness = shapeOf<{ readonly text: string; readonly keyword?: string }>({
  text: charsMarker,
  keyword: str,
});

// ─── turn_end: a typed answer's limits and negatives ─────────────────

/** `turn_end.answerCoverage` — what the payload type declares, and what the runtime value carries. */
type TurnEndCoverage = NonNullable<AgentTurnEndPayload['answerCoverage']> & AnswerCoverage;
type CoveragePeriod = NonNullable<TurnEndCoverage['periods']>[number];
type AssumedValue = NonNullable<TurnEndCoverage['assumed']>[number];
/** One negative check row — the payload's fields and the runtime row's. */
type NegativeCheckRow = AnswerNegativesPayload['checks'][number] & RuntimeNegativeRow;

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

// ─── Whole events whose content sits beside structure ─────────────────

type EventType = keyof AgentfootprintEventMap;
type PayloadOf<T extends EventType> = AgentfootprintEventMap[T]['payload'];
type ItemOf<T> = T extends readonly (infer E)[] ? E : never;

/** A shape for one event's whole payload, exhaustive over that event's payload type. */
const eventShape = <T extends EventType>(rules: {
  readonly [K in AnyKeyOf<PayloadOf<T>>]-?: BoundRule;
}): BoundRule => shapeOf<PayloadOf<T>>(rules);

/** The pause reason the library writes itself — its own words, kept. */
const FIXED_PAUSE_REASON = 'stage requested pause';

/** Why a turn's answer stands where it does — the assessment's own words. */
const boundAssessmentReasons = listOf(
  oneOf(
    'answer-check-failed',
    'argument-asked',
    'argument-assumed',
    'argument-read',
    'argument-unverified',
    'asked',
    'check-unreachable',
    'claim-exceeds-search',
    'coverage-gap',
    'declaration-overclaimed',
    'declared-absent',
    'derived-from-reading',
    'empty-undeclared',
    'negative-prose-unverified',
    'period-beyond-retention',
    'period-differs-from-asked',
    'period-not-held',
    'period-partly-held',
    'period-undeclared',
    'period-unknown',
    'script-unmatched',
    'sources-conflict',
    'steps-unfinished',
    'stopped-early',
    'value-contingent',
    'value-survived-revision',
    'value-unsupported',
  ),
);

/** Which honesty checks ran, and over how much. */
const boundAssessmentChecks = listOf(
  shapeOf<ItemOf<PayloadOf<'agentfootprint.answer.assessed'>['checked']>>({
    layer: oneOf(1, 2, 3, 4),
    check: oneOf(
      'answer-checks',
      'argument-rules',
      'argument-sources',
      'names-and-numbers',
      'result-period',
      'result-shape',
      'script-match',
      'tool-coverage',
    ),
    ran: num,
    of: num,
  }),
);

/** A turn's answer assessment: verdict words, reason codes and check counts. */
const boundAnswerAssessment = shapeOf<
  At<PayloadOf<'agentfootprint.agent.turn_end'>, 'answerAssessment'>
>({
  assessment: oneOf('known', 'not-applicable', 'unknown', 'unrefuted'),
  standing: oneOf('ask', 'consistent', 'known', 'not-assessed', 'not-sure'),
  reasons: boundAssessmentReasons,
  checked: boundAssessmentChecks,
});

/** One context source's share of a slot: characters and pieces. */
const boundSourceShare = shapeOf<
  NonNullable<PayloadOf<'agentfootprint.context.slot_composed'>['sourceBreakdown']['rag']>
>({ chars: num, count: num });

/** A slot's share by context source — every source the library declares, by name. */
const boundSourceBreakdown = shapeOf<
  PayloadOf<'agentfootprint.context.slot_composed'>['sourceBreakdown']
>({
  assistant: boundSourceShare,
  base: boundSourceShare,
  custom: boundSourceShare,
  'evidence-recovery': boundSourceShare,
  fact: boundSourceShare,
  findings: boundSourceShare,
  instructions: boundSourceShare,
  memory: boundSourceShare,
  ontology: boundSourceShare,
  rag: boundSourceShare,
  registry: boundSourceShare,
  skill: boundSourceShare,
  steering: boundSourceShare,
  'tool-result': boundSourceShare,
  user: boundSourceShare,
});

type RequestAttempt = ItemOf<PayloadOf<'agentfootprint.tools.request_attempts'>['attempts']>;
type RequestEnd = PayloadOf<'agentfootprint.tools.request_attempts'>['end'];

const requestReason = oneOf(
  'answered',
  'cancelled',
  'changes-without-key',
  'exhausted',
  'no-time-left',
  'not-permitted',
  'not-replayable',
  'not-retryable',
  'retryable',
  'wait-limit',
);
const requestFailure = oneOf(
  'auth',
  'network',
  'permanent',
  'rate-limited',
  'server',
  'timeout',
  'unknown',
);
const requestRefusalKind = oneOf('session-busy', 'throttle');
const requestEffect = oneOf('applied', 'none', 'unknown');
/** A request's error: one of the library's two fixed sentences, and a category — never the error itself. */
const requestError = shapeOf<NonNullable<RequestEnd['error']>>({
  message: oneOf(
    'The call ran out of time before an answer arrived.',
    'The request failed before an answer arrived. Its error is not kept.',
  ),
  code: requestFailure,
});

/** One try of a tool's request: outcome, reason, timing and the library's categories. */
const boundRequestAttempt = shapeOf<RequestAttempt>({
  attempt: num,
  outcome: oneOf('answered', 'cut', 'failed', 'refused', 'timed-out'),
  reason: requestReason,
  status: num,
  kind: requestRefusalKind,
  failure: requestFailure,
  waitMs: num,
  retryAfterMs: num,
  error: requestError,
  remote: oneOf('unknown'),
  effect: requestEffect,
  permission: shapeOf<NonNullable<RequestAttempt['permission']>>({
    by: oneOf('adapter', 'compatibility', 'declaration'),
    on: oneOf('network', 'throttle'),
    assumes: oneOf('refused-before-execution'),
    deduplicated: bool,
  }),
  durationMs: num,
});

/** How a tool's request ended. */
const boundRequestEnd = shapeOf<RequestEnd>({
  outcome: oneOf('answered', 'cancelled', 'cut', 'failed', 'refused', 'timed-out'),
  reason: requestReason,
  status: num,
  kind: requestRefusalKind,
  failure: requestFailure,
  during: oneOf('request', 'wait'),
  error: requestError,
  remote: oneOf('unknown'),
  attempts: num,
  effect: requestEffect,
  mayHaveRun: bool,
});

/**
 * Each record's meta: the run and stage ids, paths, indices and engine
 * coordinates the dispatcher stamps — and the who the caller named
 * (`sessionId`, `principal`, `tenant`), kept by contract. A field `EventMeta`
 * does not declare, or a value of another kind, is a marker. (`wallClockMs` is
 * the record's `timestamp`; `runId` its run anchor — `audit.ts` lifts both.)
 */
export const boundMeta: BoundRule = shapeOf<EventMeta>({
  wallClockMs: num,
  runOffsetMs: num,
  sourcePosition: shapeOf<EventSourcePosition>({
    engineRunId: str,
    logRunId: str,
    drillPath: listOf(str),
    committedThroughIdx: num,
  }),
  runtimeStageId: str,
  subflowPath: listOf(str),
  compositionPath: listOf(str),
  turnIndex: num,
  iterIndex: num,
  traceId: str,
  spanId: str,
  correlationId: str,
  runId: str,
  sessionId: metaIdentity,
  principal: metaIdentity,
  tenant: metaIdentity,
});

/** What a tool returned, as `describedResult()` declared it: the data is content;
 *  its kinds, field and column names, counts and the library's static note stay. */
const boundSemantics = shapeOf<ToolSemantics>({
  af_semantics: bool,
  series: listOf(
    shapeOf<SemanticSeriesPoint>({
      t: charsMarker,
      entity: charsMarker,
      metric: str,
      value: charsMarker,
    }),
  ),
  // An open record: `entity` and every other value is the data; the keys stay.
  facts: listOf(shapeOf<SemanticFact>({ entity: charsMarker })),
  edges: listOf(shapeOf<SemanticEdge>({ from: charsMarker, to: charsMarker, kind: str })),
  grain: shapeOf<SemanticGrain>({
    interval: str,
    aggregation: str,
    is_counter: bool,
    collapsed: charsMarker,
  }),
  provenance: shapeOf<SemanticProvenance>({
    measured_at: charsMarker,
    age_seconds: num,
    source: charsMarker,
    source_export_date: charsMarker,
  }),
  period: shapeOf<PeriodOnWire>({ queried: boundInstants, held: boundHeld, read_at: charsMarker }),
  resolved: listOf(
    shapeOf<ResolvedDeclaration>({
      argument: str,
      id: charsMarker,
      name: charsMarker,
      aliases: listOf(charsMarker),
    }),
  ),
  // `null` says there is no next page; a cursor or page number is a value.
  paging: shapeOf<PagingDeclaration>({ next: nullOr(charsMarker) }),
  coverage: shapeOf<SemanticCoverage>({
    checked: listOf(boundCoverageItem),
    not_checked: listOf(boundCoverageItem),
    cannot_cover: listOf(boundCoverageItem),
  }),
  not_covered: listOf(charsMarker),
  clarify: nullOr(
    shapeOf<SemanticClarify>({ question: charsMarker, candidates: listOf(charsMarker) }),
  ),
  render: shapeOf<SemanticRender>({
    default: str,
    columns: listOf(str),
    sort: str,
    filter_note: charsMarker,
    chart_hint: charsMarker,
  }),
  // "The static sentence. Never interpolated."
  note: str,
});

/**
 * The whole-event shapes as a `Map`, by event type — what `audit.ts` looks an
 * event up in. An event's name is the emitter's to choose (`agent.emit()`
 * takes any string), so it is never a key into a plain object: a name
 * `Object.prototype` holds (`constructor`, `toString`, `__proto__`) finds no
 * shape here, and that event is bounded as unknown — every field a marker.
 */
export function eventShapeTable(
  toolRan: (name: string) => boolean,
): ReadonlyMap<string, BoundRule> {
  return new Map<string, BoundRule>(Object.entries(eventShapes(toolRan)));
}

/**
 * The whole-event shapes, by event type. `toolRan` answers whether this
 * strategy has seen a tool of that name run (`createToolRunTracker`): a
 * `tryInsteadTool` names another tool, and that name is kept only then —
 * otherwise it is the tool author's word for a tool this agent may not hold
 * (`otel.ts` · `coverageAttrs`, the same rule).
 */
export function eventShapes(toolRan: (name: string) => boolean): {
  readonly [T in EventType]-?: BoundRule;
} {
  return {
    // ── The seven a tool, the model or the person writes into ──────────
    'agentfootprint.tools.absent': eventShape<'agentfootprint.tools.absent'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      lookedFor: charsMarker,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      tryInstead: charsMarker,
      tryInsteadTool: shapeOf<TryInsteadToolPayload>({
        tool: seenToolName(toolRan),
        why: charsMarker,
      }),
      provenance: boundProvenance,
      period: boundPeriod,
      composition: boundComposition,
      lookedForRef: shapeOf<At<PayloadOf<'agentfootprint.tools.absent'>, 'lookedForRef'>>({
        resultId: str,
        field: oneOf('lookedFor'),
      }),
    }),
    'agentfootprint.tools.coverage_declared': eventShape<'agentfootprint.tools.coverage_declared'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      period: boundPeriod,
      inProgress: listOf(boundInProgressItem),
      composition: boundComposition,
    }),
    'agentfootprint.tools.semantics_declared':
      eventShape<'agentfootprint.tools.semantics_declared'>({
        toolName: str,
        toolCallId: str,
        iteration: num,
        semantics: boundSemantics,
      }),
    'agentfootprint.agent.evidence_checked': eventShape<'agentfootprint.agent.evidence_checked'>({
      iteration: num,
      posture: oneOf('assist', 'guard', 'rails'),
      candidates: num,
      lookedUp: num,
      unsupported: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.agent.evidence_checked'>['unsupported']>>({
          value: charsMarker,
          shape: str,
          region: oneOf('prose', 'code'),
        }),
      ),
      action: oneOf('flagged', 'grounded', 'refused', 'revision-asked'),
      afterRevision: bool,
      evidenceTruncated: bool,
      carriedBy: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'carriedBy'>>>({
          toolCallId: str,
          values: num,
          only: num,
        }),
      ),
      stagedRefs: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'stagedRefs'>>>({
          ref: str,
          kind: str,
        }),
      ),
      spenderTools: listOf(str),
      // `from` names the operands — and a unit-scaled figure's source value.
      computed: listOf(
        shapeOf<
          ItemOf<NonNullable<PayloadOf<'agentfootprint.agent.evidence_checked'>['computed']>>
        >({
          value: charsMarker,
          shape: str,
          derivation: str,
          from: charsMarker,
        }),
      ),
      scripts: boundScriptsVerdict,
    }),
    'agentfootprint.integrity.external_ground_used':
      eventShape<'agentfootprint.integrity.external_ground_used'>({
        toolName: str,
        toolCallId: str,
        path: str,
        value: charsMarker,
        source: str,
        iteration: num,
      }),
    'agentfootprint.map.engaged': eventShape<'agentfootprint.map.engaged'>({
      mapId: str,
      iteration: num,
      by: oneOf('assumed', 'explicit', 'lexical', 'semantic', 'structural'),
      witness: charsMarker,
      reengaged: bool,
      upgraded: bool,
      foundedBy: oneOf('assumed', 'explicit', 'lexical', 'semantic', 'structural'),
      tenantChanged: bool,
      at: str,
    }),
    'agentfootprint.skill.turn_routed': eventShape<'agentfootprint.skill.turn_routed'>({
      by: oneOf('continuity', 'decider', 'entry', 'intent', 'menu', 'none'),
      from: str,
      to: str,
      scorer: str,
      scores: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'scores'>>>({
          id: str,
          score: num,
          relevance: num,
        }),
      ),
      runnerUp: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'runnerUp'>>({
        id: str,
        gap: num,
      }),
      decisive: bool,
      witness: boundWitness,
      offered: listOf(str),
      stayOffered: bool,
      policy: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'policy'>>({
        nearTieMargin: num,
        menuSize: num,
        floor: num,
      }),
      window: num,
      droppedResume: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'droppedResume'>>({
        id: str,
        reason: oneOf('unknown-skill'),
      }),
      decider: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'decider'>>({
        provider: str,
        model: str,
        picked: str,
      }),
    }),

    // ── The same rule, everywhere else the run's words ride ────────────
    'agentfootprint.map.parked': eventShape<'agentfootprint.map.parked'>({
      mapId: str,
      iteration: num,
      by: oneOf('assumed', 'explicit', 'lexical', 'semantic', 'structural'),
      idleCalls: num,
      witness: charsMarker,
    }),
    // A guard's conditions are the engine's decision evidence (kept, see audit.ts).
    'agentfootprint.context.evaluated': eventShape<'agentfootprint.context.evaluated'>({
      iteration: num,
      activeCount: num,
      skippedCount: num,
      evaluatedTotal: num,
      activeIds: listOf(str),
      skippedDetails: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.context.evaluated'>['skippedDetails']>>({
          id: str,
          reason: oneOf(
            'hidden',
            'parked',
            'predicate-threw',
            'unknown-fact',
            'unknown-trigger-kind',
          ),
          error: charsMarker,
        }),
      ),
      triggerKindCounts: recordOf(num),
      // The catalog and the routing provenance are what the app declared.
      skillCatalog: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'skillCatalog'>>>({
          id: str,
          description: str,
        }),
      ),
      routing: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'routing'>>>({
          injectionId: str,
          flavor: str,
          via: str,
          path: listOf(
            shapeOf<
              ItemOf<
                At<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'routing'>>, 'path'>
              >
            >({ label: str, branch: str }),
          ),
          label: str,
          from: str,
          triggerKind: str,
          tools: listOf(str),
        }),
      ),
      cursorMove: shapeOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'cursorMove'>>({
        from: str,
        to: str,
        by: str,
        offered: listOf(str),
        declinedOffer: bool,
        witness: boundWitness,
        guard: boundGuard,
        guardsClosed: listOf(boundGuard),
        reachable: listOf(str),
      }),
      supersededIds: listOf(str),
    }),
    'agentfootprint.validation.args_invalid': eventShape<'agentfootprint.validation.args_invalid'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      issues: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.validation.args_invalid'>['issues']>>({
          path: str,
          expected: str,
          got: str,
          value: charsMarker,
          hint: str,
        }),
      ),
      enforced: bool,
    }),
    'agentfootprint.agent.output_schema_validation_failed':
      eventShape<'agentfootprint.agent.output_schema_validation_failed'>({
        message: charsMarker,
        stage: oneOf('json-parse', 'schema-validate'),
        path: str,
        rawOutput: charsMarker,
        draftWithheld: bool,
        attempt: num,
        cumulativeRetries: num,
      }),
    'agentfootprint.resilience.output_fallback_triggered':
      eventShape<'agentfootprint.resilience.output_fallback_triggered'>({
        stage: oneOf('json-parse', 'schema-validate'),
        rawOutputPreview: charsMarker,
        primaryErrorMessage: charsMarker,
        retriesSpent: num,
      }),
    'agentfootprint.resilience.output_canned_used':
      eventShape<'agentfootprint.resilience.output_canned_used'>({
        rawOutputPreview: charsMarker,
        fallbackErrorMessage: charsMarker,
        retriesSpent: num,
      }),
    'agentfootprint.stream.tool_progress': eventShape<'agentfootprint.stream.tool_progress'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      payload: keysMarker,
    }),
    'agentfootprint.checkin.request': eventShape<'agentfootprint.checkin.request'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      request: keysMarker,
    }),
    'agentfootprint.checkin.decision': eventShape<'agentfootprint.checkin.decision'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      requestId: str,
      approved: bool,
      by: str,
      note: charsMarker,
      componentId: str,
    }),
    'agentfootprint.middleware.decision': eventShape<'agentfootprint.middleware.decision'>({
      middleware: str,
      moment: oneOf('after-tool', 'before-tool', 'input', 'output', 'window'),
      at: oneOf('message', 'tool'),
      phase: oneOf('input', 'output'),
      toolName: str,
      toolCallId: str,
      iteration: num,
      outcome: oneOf('allow', 'ask', 'deny'),
      changed: bool,
      why: charsMarker,
      componentId: str,
    }),
    'agentfootprint.skill.step_skipped': eventShape<'agentfootprint.skill.step_skipped'>({
      skillId: str,
      // The step the app declared — its tool and note.
      step: shapeOf<At<PayloadOf<'agentfootprint.skill.step_skipped'>, 'step'>>({
        index: num,
        total: num,
        tool: str,
        note: str,
      }),
      reason: charsMarker,
      policy: oneOf('advance', 'hold'),
      iteration: num,
      toolCallId: str,
    }),
    'agentfootprint.stream.llm_start': eventShape<'agentfootprint.stream.llm_start'>({
      iteration: num,
      provider: str,
      model: str,
      systemPromptChars: num,
      systemPromptText: charsMarker,
      messagesCount: num,
      toolsCount: num,
      // The catalog the model saw: names and the descriptions the tools declared.
      tools: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.stream.llm_start'>, 'tools'>>>({
          name: str,
          description: str,
        }),
      ),
      estimatedPromptTokens: num,
      temperature: num,
      providerRequestRef: str,
      brain: shapeOf<At<PayloadOf<'agentfootprint.stream.llm_start'>, 'brain'>>({
        via: oneOf('escalation', 'skill'),
        skillId: str,
      }),
    }),
    'agentfootprint.credential.failed': eventShape<'agentfootprint.credential.failed'>({
      service: str,
      reason: charsMarker,
      tool: str,
      errorClass: str,
      toolCallId: str,
      iteration: num,
    }),
    'agentfootprint.fallback.triggered': eventShape<'agentfootprint.fallback.triggered'>({
      kind: oneOf('provider', 'skill', 'tool'),
      primary: str,
      fallback: str,
      reason: charsMarker,
    }),
    'agentfootprint.memory.retrieved': eventShape<'agentfootprint.memory.retrieved'>({
      strategy: str,
      queryHash: str,
      k: num,
      threshold: num,
      maxChars: num,
      charsUsed: num,
      embedderId: str,
      dimensions: num,
      consideredCount: num,
      admittedCount: num,
      rejectedCount: num,
      candidates: listOf(
        shapeOf<ItemOf<NonNullable<PayloadOf<'agentfootprint.memory.retrieved'>['candidates']>>>({
          id: str,
          score: num,
          rank: num,
          admitted: bool,
          reason: oneOf('below-threshold', 'over-budget', 'over-char-budget', 'over-max-entries'),
          docUri: str,
          page: num,
          heading: charsMarker,
        }),
      ),
      candidatesComplete: bool,
      candidatesOmittedReason: str,
      corpusEmpty: bool,
      namespace: str,
    }),
    'agentfootprint.integrity.context_error': eventShape<'agentfootprint.integrity.context_error'>({
      kind: oneOf(
        'column-type-mismatch',
        'dangling-reference',
        'duplicate-execution',
        'empty-lookup',
        'invariant-violation',
        'missing-column',
        'prior-turn-evidence',
        'unsupported-argument',
        'unsupported-claim',
      ),
      seam: oneOf('choice', 'claim', 'compose', 'wire', 'write'),
      subjects: listOf(boundSubject),
      witnesses: listOf(
        shapeOf<Assertion>({
          subject: boundSubject,
          predicate: str,
          value: charsMarker,
          epoch: num,
          stratum: oneOf('asserted', 'quoted'),
          provenance: charsMarker,
          runtimeStageId: str,
          synthetic: bool,
        }),
      ),
      predicate: str,
      epoch: num,
      synthetic: bool,
      advisory: bool,
      message: charsMarker,
      iteration: num,
    }),
    'agentfootprint.tools.effect': eventShape<'agentfootprint.tools.effect'>({
      kind: oneOf('propose-transition', 'require-instruction'),
      outcome: oneOf('accepted', 'refused', 'superseded'),
      stay: bool,
      toolName: str,
      toolCallId: str,
      iteration: num,
      targetSkillId: str,
      reason: charsMarker,
      instructionId: str,
      deliveryLease: oneOf('next-call', 'until-skill-exit'),
      refusalReason: str,
      supersededBy: oneOf('earlier-proposal'),
    }),
    // `reason` is `pauseData.reason` — the same words `questionPayload` hides.
    'agentfootprint.pause.request': eventShape<'agentfootprint.pause.request'>({
      // The library's own pause sentence stays; a pause's own reason is its data.
      reason: oneOf(FIXED_PAUSE_REASON),
      questionPayload: keysMarker,
    }),
    'agentfootprint.artifacts.minted': eventShape<'agentfootprint.artifacts.minted'>({
      ref: str,
      kind: str,
      mediaType: str,
      bytes: num,
      label: charsMarker,
      digest: str,
      expiresAt: num,
      origin: shapeOf<At<PayloadOf<'agentfootprint.artifacts.minted'>, 'origin'>>({
        runId: str,
        toolCallId: str,
      }),
      parentRefs: listOf(str),
      // The column, zone and interval the rows declare.
      timeAxis: shapeOf<At<PayloadOf<'agentfootprint.artifacts.minted'>, 'timeAxis'>>({
        column: str,
        unit: oneOf('epoch-ms', 'epoch-s', 'iso'),
        zone: str,
        interval: str,
        // One aggregate for every column, or one per column.
        aggregate: either(
          oneOf('avg', 'count', 'last', 'max', 'min', 'raw', 'sum'),
          recordOf(oneOf('avg', 'count', 'last', 'max', 'min', 'sum')),
        ),
      }),
      tool: str,
    }),
    'agentfootprint.artifacts.presented': eventShape<'agentfootprint.artifacts.presented'>({
      ref: str,
      as: str,
      snapshot: shapeOf<PayloadOf<'agentfootprint.artifacts.presented'>['snapshot']>({
        kind: str,
        mediaType: str,
        bytes: num,
        label: charsMarker,
      }),
      toolCallId: str,
      iteration: num,
    }),
    'agentfootprint.artifacts.refused': eventShape<'agentfootprint.artifacts.refused'>({
      op: oneOf('delete', 'dispatch', 'get', 'head', 'list', 'put'),
      reason: oneOf(
        'digest-mismatch',
        'invalid-input',
        'kind-mismatch',
        'missing-or-expired',
        'no-store',
        'unknown-parent',
      ),
      ref: str,
      detail: charsMarker,
      tool: str,
    }),
    'agentfootprint.reliability.fail_fast': eventShape<'agentfootprint.reliability.fail_fast'>({
      phase: oneOf('post-decide', 'pre-check'),
      kind: str,
      attempt: num,
      label: str,
      reason: charsMarker,
      providerUsed: str,
      errorKind: str,
      errorMessage: charsMarker,
    }),
    'agentfootprint.agent.handoff': eventShape<'agentfootprint.agent.handoff'>({
      fromAgentId: str,
      toAgentId: str,
      reason: charsMarker,
      viaProtocol: oneOf('http', 'mcp', 'native'),
    }),
    // A policy's `reason` is its telemetry tag; its `rationale` is prose per decision.
    'agentfootprint.permission.check': eventShape<'agentfootprint.permission.check'>({
      capability: oneOf(
        'external_net',
        'memory_read',
        'memory_write',
        'skill_read',
        'tool_call',
        'user_data',
      ),
      actor: str,
      target: str,
      result: oneOf('allow', 'deny', 'gate_open', 'halt'),
      policyEngine: oneOf('cerbos', 'custom', 'opa'),
      policyRuleId: str,
      rationale: charsMarker,
      reason: policyReasonTag,
      toolCallId: str,
      iteration: num,
    }),
    // `tellLLM` is the tool result the model read in place of the call.
    'agentfootprint.permission.halt': eventShape<'agentfootprint.permission.halt'>({
      checkerId: str,
      target: str,
      reason: policyReasonTag,
      tellLLM: charsMarker,
      iteration: num,
      sequenceLength: num,
      toolCallId: str,
    }),
    // A router's `{ reason }` is the routing model's own words; `decide()`
    // evidence is the engine's, kept (see audit.ts).
    'agentfootprint.composition.route_decided':
      eventShape<'agentfootprint.composition.route_decided'>({
        conditionalId: str,
        chosen: str,
        rationale: str,
        evidence: routeEvidence,
      }),

    // ── Every other event: structure, and the fields bounded whole ─────
    'agentfootprint.composition.enter': eventShape<'agentfootprint.composition.enter'>({
      kind: oneOf('Conditional', 'Loop', 'Parallel', 'Sequence'),
      id: str,
      name: str,
      childCount: num,
    }),
    'agentfootprint.composition.exit': eventShape<'agentfootprint.composition.exit'>({
      kind: oneOf('Conditional', 'Loop', 'Parallel', 'Sequence'),
      id: str,
      name: str,
      status: oneOf('break', 'budget_exhausted', 'err', 'ok'),
      durationMs: num,
    }),
    'agentfootprint.composition.fork_start': eventShape<'agentfootprint.composition.fork_start'>({
      parentId: str,
      branches: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.composition.fork_start'>, 'branches'>>>({
          id: str,
          name: str,
        }),
      ),
    }),
    'agentfootprint.composition.branch_complete':
      eventShape<'agentfootprint.composition.branch_complete'>({
        parentId: str,
        branchId: str,
        status: oneOf('err', 'ok'),
        durationMs: num,
      }),
    'agentfootprint.composition.merge_end': eventShape<'agentfootprint.composition.merge_end'>({
      parentId: str,
      strategy: oneOf('fn', 'llm', 'outcomes-fn'),
      resultSummary: charsMarker,
      mergedBranchCount: num,
      totalBranchCount: num,
    }),
    'agentfootprint.composition.iteration_start':
      eventShape<'agentfootprint.composition.iteration_start'>({
        loopId: str,
        iteration: num,
      }),
    'agentfootprint.composition.iteration_exit':
      eventShape<'agentfootprint.composition.iteration_exit'>({
        loopId: str,
        iteration: num,
        reason: oneOf('body_complete', 'break', 'budget', 'guard_false'),
      }),
    'agentfootprint.agent.turn_start': eventShape<'agentfootprint.agent.turn_start'>({
      turnIndex: num,
      userPrompt: charsMarker,
    }),
    'agentfootprint.agent.turn_end': eventShape<'agentfootprint.agent.turn_end'>({
      turnIndex: num,
      finalContent: charsMarker,
      totalInputTokens: num,
      totalOutputTokens: num,
      iterationCount: num,
      durationMs: num,
      stoppedEarly: shapeOf<At<PayloadOf<'agentfootprint.agent.turn_end'>, 'stoppedEarly'>>({
        reason: oneOf('cost-budget', 'max-iterations'),
        iteration: num,
        pendingToolCalls: num,
        wrappedUp: bool,
      }),
      answerCoverage: boundAnswerCoverage,
      answerAssessment: boundAnswerAssessment,
      standingLineNames: recordOf(str),
      answerNegatives: boundAnswerNegatives,
      scripts: boundScripts,
      refused: shapeOf<At<PayloadOf<'agentfootprint.agent.turn_end'>, 'refused'>>({
        by: oneOf('evidence-rails'),
      }),
    }),
    'agentfootprint.agent.iteration_start': eventShape<'agentfootprint.agent.iteration_start'>({
      turnIndex: num,
      iterIndex: num,
    }),
    'agentfootprint.agent.iteration_end': eventShape<'agentfootprint.agent.iteration_end'>({
      turnIndex: num,
      iterIndex: num,
      toolCallCount: num,
      history: messagesMarker,
    }),
    'agentfootprint.agent.route_decided': eventShape<'agentfootprint.agent.route_decided'>({
      turnIndex: num,
      iterIndex: num,
      chosen: oneOf(
        'evidence-recheck',
        'final',
        'negative-recheck',
        'output-retry',
        'step-nudge',
        'tool-calls',
        'wrap-up',
      ),
      // A fixed sentence, or one the library composes (a count, a skill's name).
      rationale: str,
    }),
    'agentfootprint.agent.output_contract_unmet':
      eventShape<'agentfootprint.agent.output_contract_unmet'>({
        stage: oneOf('json-parse', 'schema-validate'),
        error: charsMarker,
        path: str,
        attempts: num,
        retriesSpent: num,
        fallbackConfigured: bool,
        iteration: num,
        brokenBy: str,
      }),
    'agentfootprint.agent.output_schema_retry':
      eventShape<'agentfootprint.agent.output_schema_retry'>({
        attempt: num,
        retriesRemaining: num,
        iteration: num,
        stage: oneOf('json-parse', 'schema-validate'),
        error: charsMarker,
        path: str,
        correctiveMessageHash: str,
      }),
    'agentfootprint.agent.grounding_nudged': eventShape<'agentfootprint.agent.grounding_nudged'>({
      iteration: num,
      refs: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.grounding_nudged'>, 'refs'>>>({
          ref: str,
          kind: str,
        }),
      ),
      refsOmitted: num,
      tools: listOf(str),
    }),
    'agentfootprint.agent.run_configured': eventShape<'agentfootprint.agent.run_configured'>({
      agentId: str,
      llm: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'llm'>>({
        provider: str,
        model: str,
        modelOverrides: listOf(oneOf('configure', 'skill-brains')),
      }),
      cache: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'cache'>>({
        requested: oneOf('default', 'explicit'),
        strategy: oneOf('none'),
        status: oneOf('not-applicable'),
      }),
      reactMode: oneOf('classic', 'dynamic', 'dynamic-grouped'),
      memories: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'memories'>>>({
          id: str,
          type: oneOf('causal', 'episodic', 'narrative', 'semantic'),
          strategy: oneOf('budget', 'decay', 'extract', 'hybrid', 'summarize', 'topK', 'window'),
          retrieval: str,
          embedderId: str,
          flavor: oneOf('memory', 'rag'),
        }),
      ),
      window: str,
      skillGraph: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'skillGraph'>>({
        routing: oneOf('assist', 'guard', 'rails'),
        continuity: oneOf('conversation', 'turn'),
        scorer: str,
      }),
      evidenceGate: oneOf('assist', 'guard', 'rails'),
      artifacts: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'artifacts'>>({
        placement: bool,
        recordings: bool,
      }),
      recipes: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'recipes'>>>({
          id: str,
          version: str,
        }),
      ),
    }),
    'agentfootprint.agent.thinking_parse_failed':
      eventShape<'agentfootprint.agent.thinking_parse_failed'>({
        providerName: str,
        subflowId: str,
        error: charsMarker,
        errorName: str,
        iteration: num,
      }),
    'agentfootprint.agent.thinking_omitted': eventShape<'agentfootprint.agent.thinking_omitted'>({
      providerName: str,
      model: str,
      messageIndex: num,
      blockIndex: num,
      reason: oneOf(
        'content-changed',
        'missing-signature',
        'prefix-changed',
        'sequence-changed',
        'thinking-retired',
      ),
      phase: oneOf('prepared'),
    }),
    'agentfootprint.agent.budget_exhausted': eventShape<'agentfootprint.agent.budget_exhausted'>({
      reason: oneOf('cost-budget', 'max-iterations'),
      iteration: num,
      limit: num,
      pendingToolCalls: num,
      action: oneOf('cut-short', 'wrapped-up'),
    }),
    'agentfootprint.stream.llm_end': eventShape<'agentfootprint.stream.llm_end'>({
      iteration: num,
      content: charsMarker,
      contentWithheld: bool,
      toolCallCount: num,
      // A provider's counts. Its usage object can carry more than these (structural
      // typing lets it): a child the type does not declare is a marker.
      usage: shapeOf<PayloadOf<'agentfootprint.stream.llm_end'>['usage']>({
        input: num,
        output: num,
        cacheRead: num,
        cacheWrite: num,
        thinking: num,
      }),
      stopReason: str,
      durationMs: num,
      providerResponseRef: str,
    }),
    'agentfootprint.stream.token': eventShape<'agentfootprint.stream.token'>({
      iteration: num,
      tokenIndex: num,
      content: charsMarker,
    }),
    'agentfootprint.stream.tool_start': eventShape<'agentfootprint.stream.tool_start'>({
      toolName: str,
      toolCallId: str,
      args: keysMarker,
      parallelCount: num,
      protocol: oneOf('http', 'mcp', 'native', 'python-fn'),
      notDispatched: shapeOf<At<PayloadOf<'agentfootprint.stream.tool_start'>, 'notDispatched'>>({
        pausedCall: shapeOf<
          At<At<PayloadOf<'agentfootprint.stream.tool_start'>, 'notDispatched'>, 'pausedCall'>
        >({
          toolCallId: str,
          toolName: str,
        }),
      }),
    }),
    'agentfootprint.stream.tool_end': eventShape<'agentfootprint.stream.tool_end'>({
      toolCallId: str,
      result: typeMarker,
      error: bool,
      durationMs: num,
      status: oneOf('absent', 'denied', 'failure', 'invalid', 'partial', 'pending', 'success'),
      notDispatched: shapeOf<At<PayloadOf<'agentfootprint.stream.tool_end'>, 'notDispatched'>>({
        pausedCall: shapeOf<
          At<At<PayloadOf<'agentfootprint.stream.tool_end'>, 'notDispatched'>, 'pausedCall'>
        >({
          toolCallId: str,
          toolName: str,
        }),
      }),
      modelResult: typeMarker,
      changedArgKeys: listOf(str),
      notExecuted: bool,
    }),
    'agentfootprint.stream.thinking_delta': eventShape<'agentfootprint.stream.thinking_delta'>({
      iteration: num,
      tokenIndex: num,
      content: charsMarker,
    }),
    'agentfootprint.stream.thinking_end': eventShape<'agentfootprint.stream.thinking_end'>({
      iteration: num,
      blockCount: num,
      totalChars: num,
      tokens: num,
      blocks: blocksMarker,
    }),
    'agentfootprint.context.injected': eventShape<'agentfootprint.context.injected'>({
      contentSummary: charsMarker,
      contentHash: str,
      rawContent: charsMarker,
      slot: oneOf('messages', 'system-prompt', 'tools'),
      asRole: oneOf('assistant', 'system', 'tool', 'user'),
      asRecency: oneOf('earlier', 'latest'),
      position: num,
      sectionTag: str,
      source: oneOf(
        'assistant',
        'base',
        'custom',
        'evidence-recovery',
        'fact',
        'findings',
        'instructions',
        'memory',
        'ontology',
        'rag',
        'registry',
        'skill',
        'steering',
        'tool-result',
        'user',
      ),
      sourceId: str,
      upstreamRef: str,
      reason: str,
      retrievalScore: num,
      rankPosition: num,
      threshold: num,
      budgetSpent: shapeOf<At<PayloadOf<'agentfootprint.context.injected'>, 'budgetSpent'>>({
        tokens: num,
        fractionOfCap: num,
      }),
      expiresAfter: oneOf('iteration', 'persistent', 'run', 'turn'),
    }),
    'agentfootprint.context.evicted': eventShape<'agentfootprint.context.evicted'>({
      slot: oneOf('messages', 'system-prompt', 'tools'),
      contentHash: str,
      reason: oneOf('budget', 'low_score', 'policy', 'stale', 'user_revoked'),
      survivalMs: num,
    }),
    'agentfootprint.context.slot_composed': eventShape<'agentfootprint.context.slot_composed'>({
      slot: oneOf('messages', 'system-prompt', 'tools'),
      iteration: num,
      budget: shapeOf<PayloadOf<'agentfootprint.context.slot_composed'>['budget']>({
        cap: num,
        used: num,
        headroomChars: num,
      }),
      sourceBreakdown: boundSourceBreakdown,
      orderingStrategy: str,
      droppedCount: num,
      droppedSummaries: summariesMarker,
    }),
    'agentfootprint.context.budget_pressure': eventShape<'agentfootprint.context.budget_pressure'>({
      slot: oneOf('messages', 'system-prompt', 'tools'),
      overflowBy: num,
      planAction: oneOf('abort', 'evict', 'none', 'summarize'),
      unit: oneOf('chars', 'tokens'),
      cap: num,
      projected: num,
    }),
    'agentfootprint.memory.strategy_applied': eventShape<'agentfootprint.memory.strategy_applied'>({
      strategyId: str,
      strategyKind: oneOf('fact-extraction', 'hybrid', 'semantic', 'sliding-window', 'summarizing'),
      reason: str,
      scoreEvidence: keysMarker,
      inputMemoryCount: num,
      outputMemoryCount: num,
      droppedIds: listOf(str),
      addedIds: listOf(str),
    }),
    'agentfootprint.memory.attached': eventShape<'agentfootprint.memory.attached'>({
      memoryId: str,
      contentSummary: charsMarker,
      score: num,
      rank: num,
      source: oneOf('auto-extract', 'manual', 'store'),
      retriever: oneOf('chroma', 'custom', 'pinecone', 'qdrant', 'weaviate'),
    }),
    'agentfootprint.memory.detached': eventShape<'agentfootprint.memory.detached'>({
      memoryId: str,
      reason: oneOf('budget', 'policy', 'score_low', 'stale'),
    }),
    'agentfootprint.memory.written': eventShape<'agentfootprint.memory.written'>({
      memoryId: str,
      contentSummary: charsMarker,
      source: oneOf('auto', 'manual'),
      actor: str,
    }),
    'agentfootprint.tools.offered': eventShape<'agentfootprint.tools.offered'>({
      availableIds: listOf(str),
      withheldIds: listOf(str),
      withheldReasons: recordOf(oneOf('cost_guard', 'gated', 'permission', 'skill_inactive')),
      reason: appReasonWord,
    }),
    'agentfootprint.tools.activated': eventShape<'agentfootprint.tools.activated'>({
      toolId: str,
      reason: oneOf('autoActivate', 'permission_granted', 'skill_activated'),
      source: str,
    }),
    'agentfootprint.tools.deactivated': eventShape<'agentfootprint.tools.deactivated'>({
      toolId: str,
      reason: oneOf('permission_revoked', 'skill_deactivated'),
    }),
    'agentfootprint.tools.discovery_started': eventShape<'agentfootprint.tools.discovery_started'>({
      providerId: str,
      iteration: num,
    }),
    'agentfootprint.tools.discovery_completed':
      eventShape<'agentfootprint.tools.discovery_completed'>({
        providerId: str,
        iteration: num,
        durationMs: num,
        toolCount: num,
      }),
    'agentfootprint.tools.discovery_failed': eventShape<'agentfootprint.tools.discovery_failed'>({
      providerId: str,
      error: charsMarker,
      errorName: str,
      iteration: num,
      durationMs: num,
    }),
    'agentfootprint.tools.shadowed': eventShape<'agentfootprint.tools.shadowed'>({
      toolName: str,
      iteration: num,
      schemaFrom: oneOf('framework', 'provider', 'registry', 'skill'),
      schemaFromId: str,
      dispatchTo: oneOf('framework', 'provider', 'registry', 'skill'),
      dispatchToId: str,
    }),
    'agentfootprint.tools.claim_swallowed': eventShape<'agentfootprint.tools.claim_swallowed'>({
      toolName: str,
      iteration: num,
      lostBy: oneOf('framework', 'provider', 'registry', 'skill'),
      lostById: str,
      wonBy: oneOf('framework', 'provider', 'registry', 'skill'),
      wonById: str,
    }),
    'agentfootprint.tools.answered_off_wire': eventShape<'agentfootprint.tools.answered_off_wire'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      answeredBy: oneOf('framework', 'provider', 'registry', 'skill'),
      answeredById: str,
    }),
    'agentfootprint.tools.session_started': eventShape<'agentfootprint.tools.session_started'>({
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),
    'agentfootprint.tools.session_reused': eventShape<'agentfootprint.tools.session_reused'>({
      calls: num,
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),
    'agentfootprint.tools.session_closed': eventShape<'agentfootprint.tools.session_closed'>({
      reason: oneOf('call-end', 'evicted', 'idle', 'run-end', 'session-end', 'shutdown'),
      durationMs: num,
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),
    'agentfootprint.tools.result_refused': eventShape<'agentfootprint.tools.result_refused'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      sizeChars: num,
      maxChars: num,
      narrowBy: listOf(str),
      declaredStatus: oneOf(
        'absent',
        'denied',
        'failure',
        'invalid',
        'partial',
        'pending',
        'success',
      ),
    }),
    'agentfootprint.tools.repeated_call': eventShape<'agentfootprint.tools.repeated_call'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      occurrences: num,
      argsFingerprint: str,
      resultFingerprint: str,
      mode: oneOf('arguments'),
    }),
    'agentfootprint.tools.code_run': eventShape<'agentfootprint.tools.code_run'>({
      tool: str,
      language: str,
      stagedInputs: num,
      outputChars: num,
      truncated: bool,
      ok: bool,
      exitCode: num,
      serviceError: bool,
      terminatedBy: str,
      shapeHash: str,
    }),
    // One use of an MCP client pool: "ids, digests, evidence and outcomes only" —
    // never an identity value, a session handle, an argument, a result or a server's text.
    'agentfootprint.tools.mcp_client': eventShape<'agentfootprint.tools.mcp_client'>({
      server: str,
      at: oneOf('call', 'list'),
      toolCallId: str,
      keyHash: str,
      clientId: str,
      generation: num,
      client: oneOf(
        'expired',
        'handle-lost',
        'joined',
        'not-needed',
        'opened',
        'refused',
        'reused',
      ),
      previous: oneOf('evicted', 'expired', 'handle-lost', 'idle', 'terminated'),
      evidence: oneOf('server-404', 'transport-forgot-handle'),
      refusal: oneOf(
        'binding-changed',
        'closed',
        'ending-full',
        'identity-mismatch',
        'incomplete-identity',
        'init-failed',
        'init-timeout',
        'lease-expired',
        'no-identity',
        'operations-full',
        'pool-full',
        'principal-full',
        'request-unmatched',
        'stale-tools',
      ),
      initMs: num,
      definitions: oneOf('listed', 'shared'),
      definitionsAgeMs: num,
      revalidated: oneOf('kept', 'refused'),
    }),
    'agentfootprint.tools.request_attempts': eventShape<'agentfootprint.tools.request_attempts'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      endpoint: str,
      origin: str,
      attempts: listOf(boundRequestAttempt),
      omitted: num,
      end: boundRequestEnd,
    }),
    'agentfootprint.tools.session_close_failed':
      eventShape<'agentfootprint.tools.session_close_failed'>({
        reason: oneOf('call-end', 'evicted', 'idle', 'run-end', 'session-end', 'shutdown'),
        durationMs: num,
        error: charsMarker,
        errorClass: str,
        tool: str,
        scope: oneOf('call', 'run', 'session', 'shutdown'),
        keyHash: str,
        runnerId: str,
        label: str,
      }),
    'agentfootprint.skill.activated': eventShape<'agentfootprint.skill.activated'>({
      skillId: str,
      reason: oneOf('autoActivate', 'manual', 'read_skill_result'),
      injectedTools: listOf(str),
      injectedSystemPromptChars: num,
    }),
    'agentfootprint.skill.graph_declared': eventShape<'agentfootprint.skill.graph_declared'>({
      nodes: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'nodes'>>>({
          id: str,
          kind: str,
          description: str,
          label: str,
          title: str,
        }),
      ),
      edges: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>>({
          from: nullOr(str),
          to: str,
          kind: str,
          label: str,
          guard: shapeOf<
            At<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>, 'guard'>
          >({
            conditions: listOf(
              shapeOf<
                ItemOf<
                  At<
                    At<
                      ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>,
                      'guard'
                    >,
                    'conditions'
                  >
                >
              >({
                key: str,
                op: str,
                // The value the app declared to compare against: one, or a list.
                value: orList(declaredValue),
              }),
            ),
          }),
        }),
      ),
    }),
    'agentfootprint.skill.deactivated': eventShape<'agentfootprint.skill.deactivated'>({
      skillId: str,
      reason: appReasonWord,
    }),
    'agentfootprint.skill.rejected': eventShape<'agentfootprint.skill.rejected'>({
      requestedId: str,
      currentSkillId: str,
      allowed: listOf(str),
      iteration: num,
      posture: oneOf('guard', 'rails'),
      reason: oneOf('posture', 'self-call', 'unreachable'),
    }),
    'agentfootprint.skill.reroute_superseded':
      eventShape<'agentfootprint.skill.reroute_superseded'>({
        volunteeredId: str,
        wonId: str,
        fromSkillId: str,
        iteration: num,
        source: oneOf('tool-proposal'),
      }),
    'agentfootprint.skill.route_conflict': eventShape<'agentfootprint.skill.route_conflict'>({
      iteration: num,
      fromSkillId: str,
      winner: shapeOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'winner'>>({
        toolCallId: str,
        toolName: str,
        target: str,
      }),
      losers: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'losers'>>>({
          toolCallId: str,
          toolName: str,
          target: str,
        }),
      ),
      source: oneOf('tool-proposal'),
    }),
    'agentfootprint.skill.step_advanced': eventShape<'agentfootprint.skill.step_advanced'>({
      skillId: str,
      step: shapeOf<At<PayloadOf<'agentfootprint.skill.step_advanced'>, 'step'>>({
        index: num,
        total: num,
        tool: str,
        note: str,
      }),
      iteration: num,
      toolCallId: str,
      completed: bool,
    }),
    'agentfootprint.skill.steps_unfinished': eventShape<'agentfootprint.skill.steps_unfinished'>({
      skillId: str,
      remaining: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.steps_unfinished'>, 'remaining'>>>({
          index: num,
          tool: str,
          note: str,
        }),
      ),
      total: num,
      action: oneOf('accepted', 'cut-short', 'nudged'),
      iteration: num,
    }),
    'agentfootprint.skill.escalated': eventShape<'agentfootprint.skill.escalated'>({
      iteration: num,
      afterRefusals: num,
      refusals: num,
      from: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'from'>>({
        provider: str,
        model: str,
      }),
      to: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'to'>>({
        provider: str,
        model: str,
      }),
    }),
    'agentfootprint.permission.gate_opened': eventShape<'agentfootprint.permission.gate_opened'>({
      gateId: str,
      openedBy: str,
      expiresAt: num,
    }),
    'agentfootprint.permission.gate_closed': eventShape<'agentfootprint.permission.gate_closed'>({
      gateId: str,
      reason: appReasonWord,
    }),
    'agentfootprint.credential.requested': eventShape<'agentfootprint.credential.requested'>({
      service: str,
      mode: oneOf('machine', 'user'),
      toolCallId: str,
      iteration: num,
    }),
    'agentfootprint.credential.acquired': eventShape<'agentfootprint.credential.acquired'>({
      service: str,
      kind: str,
      expiresAt: num,
      toolCallId: str,
      iteration: num,
    }),
    'agentfootprint.credential.authorization_required':
      eventShape<'agentfootprint.credential.authorization_required'>({
        service: str,
        sessionId: str,
        toolCallId: str,
        iteration: num,
      }),
    'agentfootprint.cost.tick': eventShape<'agentfootprint.cost.tick'>({
      scope: oneOf('iteration', 'run', 'turn'),
      model: str,
      provider: str,
      tokensInput: num,
      tokensOutput: num,
      estimatedUsd: num,
      cumulative: shapeOf<PayloadOf<'agentfootprint.cost.tick'>['cumulative']>({
        tokensInput: num,
        tokensOutput: num,
        estimatedUsd: num,
      }),
    }),
    'agentfootprint.cost.limit_hit': eventShape<'agentfootprint.cost.limit_hit'>({
      kind: oneOf('max_cost', 'max_iterations', 'max_tokens', 'max_wallclock'),
      limit: num,
      actual: num,
      action: oneOf('abort', 'degrade', 'warn'),
    }),
    'agentfootprint.eval.score': eventShape<'agentfootprint.eval.score'>({
      metricId: str,
      value: num,
      threshold: num,
      target: oneOf('iteration', 'run', 'toolCall', 'turn'),
      targetRef: str,
      evaluator: oneOf('fn', 'heuristic', 'llm'),
      evidence: keysMarker,
      label: str,
      explanation: charsMarker,
    }),
    'agentfootprint.eval.threshold_crossed': eventShape<'agentfootprint.eval.threshold_crossed'>({
      metricId: str,
      direction: oneOf('above', 'below'),
      value: num,
      threshold: num,
      actionTaken: str,
    }),
    'agentfootprint.error.retried': eventShape<'agentfootprint.error.retried'>({
      attempt: num,
      maxAttempts: num,
      lastError: charsMarker,
      backoffMs: num,
      reason: str,
      statedWaitMs: num,
    }),
    'agentfootprint.error.recovered': eventShape<'agentfootprint.error.recovered'>({
      attempt: num,
      totalDurationMs: num,
    }),
    'agentfootprint.error.fatal': eventShape<'agentfootprint.error.fatal'>({
      error: charsMarker,
      stage: str,
      scope: str,
    }),
    'agentfootprint.error.circuit_changed': eventShape<'agentfootprint.error.circuit_changed'>({
      state: oneOf('closed', 'half-open', 'open'),
      reason: str,
      providerName: str,
    }),
    'agentfootprint.reliability.retried': eventShape<'agentfootprint.reliability.retried'>({
      attempt: num,
      action: oneOf('retry', 'retry-other'),
      errorKind: str,
      errorMessage: charsMarker,
      fromProvider: str,
      toProvider: str,
    }),
    'agentfootprint.reliability.recovered': eventShape<'agentfootprint.reliability.recovered'>({
      attempt: num,
      recoveredVia: oneOf('fallback', 'retry', 'retry-other'),
      priorFailures: num,
      errorKind: str,
    }),
    'agentfootprint.pause.resume': eventShape<'agentfootprint.pause.resume'>({
      resumeInput: keysMarker,
      pausedDurationMs: num,
      componentId: str,
    }),
    'agentfootprint.findings.declared': eventShape<'agentfootprint.findings.declared'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      basis: oneOf('direct', 'exploratory'),
      expect: oneOf('high', 'low', 'medium'),
      hasProposition: bool,
      malformed: num,
    }),
    'agentfootprint.findings.standing': eventShape<'agentfootprint.findings.standing'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      standing: oneOf('fact', 'noise', 'open', 'ruled-out'),
      declaredOn: oneOf('answer', 'tool-call'),
      assertionCount: num,
      conflictKeys: listOf(str),
      unknownId: bool,
      agrees: bool,
    }),
    'agentfootprint.findings.judged': eventShape<'agentfootprint.findings.judged'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      against: oneOf('proposition', 'question'),
      standing: oneOf('fact', 'noise', 'open', 'ruled-out'),
      confidence: num,
      latencyMs: num,
      inputTokens: num,
      outputTokens: num,
    }),
    'agentfootprint.findings.judge_failed': eventShape<'agentfootprint.findings.judge_failed'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      status: num,
      latencyMs: num,
    }),
    'agentfootprint.findings.contingent': eventShape<'agentfootprint.findings.contingent'>({
      iteration: num,
      declaredOn: oneOf('answer', 'tool-call'),
      toolCallId: str,
      carriers: num,
      standings: listOf(oneOf('fact', 'noise', 'open', 'ruled-out')),
      valueChars: num,
    }),
    'agentfootprint.findings.argument': eventShape<'agentfootprint.findings.argument'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      turn: num,
      argument: str,
      rule: oneOf('ask', 'assume'),
      period: bool,
      source: oneOf('answered', 'app', 'default', 'model', 'result', 'said'),
      asked: oneOf('invalid-answer', 'missing', 'unverified'),
      claimed: oneOf('app', 'assumed', 'none', 'result', 'turn', 'user'),
      matched: oneOf('mention', 'phrase', 'quote', 'spelling'),
      reading: bool,
      earlier: bool,
      setAside: oneOf('noise', 'open', 'ruled-out'),
      argumentsFrom: oneOf('listed', 'unlisted'),
      coincides: oneOf('app', 'person', 'result'),
      free: bool,
      failed: oneOf(
        'composed-message',
        'no-earlier-turn',
        'not-in-app-text',
        'not-in-earlier-turns',
        'not-in-result',
        'only-in-model-answer',
        'placed-result',
        'quote-not-found',
        'uncheckable',
        'unknown-result',
      ),
      malformed: num,
      valueChars: num,
    }),
    'agentfootprint.findings.period': eventShape<'agentfootprint.findings.period'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      turn: num,
      verdict: oneOf('covered', 'not-held', 'partly-held', 'undeclared', 'unknown'),
      timeChecks: listOf(
        oneOf(
          'partly-beyond-retention',
          'period-beyond-retention',
          'period-differs-from-asked',
          'period-shifted',
        ),
      ),
    }),
    'agentfootprint.findings.negative_claim': eventShape<'agentfootprint.findings.negative_claim'>({
      iteration: num,
      turn: num,
      field: str,
      span: shapeOf<PayloadOf<'agentfootprint.findings.negative_claim'>['span']>({
        start: num,
        end: num,
      }),
      packVersion: str,
      phraseId: str,
      truncated: bool,
      kind: oneOf('negative-claim', 'negative-claim-note'),
      // A claim row's checker codes and native result ids; a note row's code.
      claim: oneOf('complete', 'none'),
      notes: listOf(str),
      results: listOf(str),
      code: str,
    }),
    'agentfootprint.tool_choice.picked': eventShape<'agentfootprint.tool_choice.picked'>({
      iteration: num,
      chosen: str,
      confidence: num,
      offered: num,
      served: num,
      narrowed: bool,
      narrowedSkipped: oneOf(
        'after-miss',
        'evidence-revision',
        'too-few',
        'unavailable',
        'wrap-up',
      ),
      latencyMs: num,
      inputTokens: num,
      outputTokens: num,
    }),
    'agentfootprint.tool_choice.outcome': eventShape<'agentfootprint.tool_choice.outcome'>({
      iteration: num,
      called: listOf(str),
      firstAgrees: bool,
      missed: listOf(str),
    }),
    'agentfootprint.tool_choice.failed': eventShape<'agentfootprint.tool_choice.failed'>({
      iteration: num,
      status: num,
      latencyMs: num,
    }),
    'agentfootprint.ontology.served': eventShape<'agentfootprint.ontology.served'>({
      iteration: num,
      id: str,
      version: str,
      hash: str,
      nodes: num,
      sources: num,
      edges: num,
    }),
    'agentfootprint.answer.assessed': eventShape<'agentfootprint.answer.assessed'>({
      turn: num,
      iteration: num,
      assessment: oneOf('known', 'not-applicable', 'unknown', 'unrefuted'),
      standing: oneOf('ask', 'consistent', 'known', 'not-assessed', 'not-sure'),
      reasons: boundAssessmentReasons,
      checked: boundAssessmentChecks,
    }),
    'agentfootprint.embedding.generated': eventShape<'agentfootprint.embedding.generated'>({
      model: str,
      provider: oneOf('cohere', 'custom', 'local', 'openai', 'voyage'),
      inputKind: oneOf('document', 'query'),
      dimension: num,
      count: num,
      durationMs: num,
      tokensSpent: num,
    }),
    'agentfootprint.artifacts.resolved': eventShape<'agentfootprint.artifacts.resolved'>({
      ref: str,
      via: oneOf('get', 'head'),
      kind: str,
      bytes: num,
      tool: str,
    }),
    'agentfootprint.artifacts.expired': eventShape<'agentfootprint.artifacts.expired'>({
      ref: str,
      reason: oneOf('max-bytes', 'max-count', 'ttl'),
      kind: str,
      bytes: num,
      tool: str,
    }),
    'agentfootprint.artifacts.hand_over_failed':
      eventShape<'agentfootprint.artifacts.hand_over_failed'>({
        cause: oneOf('abort', 'expired', 'hook', 'operation', 'timeout'),
        op: oneOf('delete', 'dispatch', 'get', 'head', 'list', 'put'),
        errorClass: str,
        errorCode: str,
      }),
    'agentfootprint.integrity.disposition': eventShape<'agentfootprint.integrity.disposition'>({
      posture: oneOf('dev', 'observe'),
      workExisted: bool,
      rows: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.integrity.disposition'>, 'rows'>>>({
          check: str,
          seam: oneOf('choice', 'claim', 'compose', 'wire', 'write'),
          checked: num,
          findings: num,
          notApplicable: num,
          unreachable: num,
          lastFiredAt: num,
          synthetic: num,
        }),
      ),
    }),
  };
}
