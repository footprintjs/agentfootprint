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
 * app declared up front) is `kept`. A container that can hold text is spelled
 * out field by field — `kept` never covers text
 * (`test/type-regressions/AuditBoundingDepth.test.ts`).
 */

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
  charsMarker,
  custom,
  keysMarker,
  kept,
  listOf,
  messagesMarker,
  nullOr,
  orList,
  recordOf,
  shapeOf,
  summariesMarker,
  typeMarker,
  type AnyKeyOf,
  type BoundRule,
} from './auditBounding.js';

/** `T`'s field `K`, present. */
type At<T, K extends keyof NonNullable<T>> = NonNullable<NonNullable<T>[K]>;

// ─── Shared pieces: coverage, periods, witnesses ─────────────────────

/** One coverage item: the tool author's prose (`what`, `why`, `short`), and its `kind`. */
const boundCoverageItem = shapeOf<CoverageItemPayload>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  kind: kept,
});

/** What a read found still running: the tool author's prose, and how many things it stands for. */
const boundInProgressItem = shapeOf<InProgressItemPayload & InProgressItem>({
  what: charsMarker,
  why: charsMarker,
  short: charsMarker,
  count: kept,
});

/** A declared window: both instants are the tool's own values. */
const boundInstants = shapeOf<{ readonly from: string; readonly to: string }>({
  from: charsMarker,
  to: charsMarker,
});

/** What the store holds — a window, or the library's word `'unknown'` (the tool
 *  said it cannot vouch for the store), which stays. */
const boundHeld = custom(
  "`'unknown'` is the library's word; a window holds the tool's instants",
  (value) => (value === 'unknown' ? value : boundInstants(value)),
);

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
  ageSeconds: kept,
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
  filter: kept,
  values: listOf(kept),
});
const boundBears = custom('a facet word, or a declared filter with its declared values', (value) =>
  typeof value === 'string' ? kept(value) : boundBearsFilter(value),
);

const boundComposition = shapeOf<CoverageCompositionPayload>({
  origin: kept,
  resultId: kept,
  complete: kept,
  facets: listOf(
    shapeOf<CoverageFacetReferencePayload>({
      facet: kept,
      from: kept,
      ref: shapeOf<CoverageFacetReferencePayload['ref']>({ resultId: kept, argument: kept }),
      any: kept,
    }),
  ),
  gaps: listOf(
    shapeOf<CoverageGapPayload>({
      kind: kept,
      what: kept,
      why: kept,
      bears: boundBears,
      argument: kept,
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
  from: kept,
  to: kept,
  toolName: kept,
  toolCallId: kept,
  verdict: kept,
  conditions: listOf(
    shapeOf<SkillGuardEvaluationRecord['conditions'][number]>({
      key: kept,
      op: kept,
      value: orList(kept),
      actualSummary: custom(
        "the engine's decision evidence: a summary of the value a guard read, kept by contract",
        kept,
      ),
      passed: kept,
    }),
  ),
});

/** What an integrity finding is about: a kind and an id. */
const boundSubject = shapeOf<Assertion['subject']>({ kind: kept, id: kept });

/** What a message said that won a routing match: the text is the person's; the
 *  keyword is the app's declared vocabulary. */
const boundWitness = shapeOf<{ readonly text: string; readonly keyword?: string }>({
  text: charsMarker,
  keyword: kept,
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
      toolName: kept,
      toolCallId: kept,
      queried: boundInstants,
      held: boundHeld,
      readAt: charsMarker,
    }),
  ),
  inProgress: listOf(
    shapeOf<NonNullable<TurnEndCoverage['inProgress']>[number] & AnswerInProgress>({
      toolName: kept,
      toolCallId: kept,
      items: listOf(boundInProgressItem),
    }),
  ),
  assumed: listOf(
    shapeOf<AssumedValue>({
      toolName: kept,
      argument: kept,
      value: charsMarker,
      hidden: kept,
    }),
  ),
});

/**
 * A typed answer's negatives: each statement and the population it is about
 * are markers; the answer field's declared name, the codes, verdicts, ids,
 * tool names and counts stay.
 */
export const boundAnswerNegatives = shapeOf<AnswerNegativesPayload>({
  field: kept,
  version: kept,
  delivery: kept,
  claims: listOf(
    shapeOf<DeliveredNegative>({
      kind: kept,
      about: charsMarker,
      restsOn: listOf(kept),
      statement: charsMarker,
      delivery: kept,
      version: kept,
    }),
  ),
  checks: listOf(
    shapeOf<NegativeCheckRow>({
      id: kept,
      path: kept,
      index: kept,
      kind: kept,
      notes: kept,
      code: kept,
      disposition: kept,
      tools: listOf(kept),
      results: listOf(kept),
      staleSince: shapeOf<NonNullable<NegativeCheckRow['staleSince']>>({
        turn: kept,
        readAt: kept,
      }),
    }),
  ),
  coverage: listOf(
    shapeOf<AnswerNegativesPayload['coverage'][number]>({ tool: kept, checked: kept }),
  ),
  actions: listOf(
    shapeOf<AnswerNegativesPayload['actions'][number]>({ tool: kept, outcome: kept }),
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

/** `decide()` evidence (the engine's): it carries a `rules` list — `otel.ts`'s test too. */
const isDecideEvidence = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { rules?: unknown }).rules);

/** What a tool returned, as `describedResult()` declared it: the data is content;
 *  its kinds, field and column names, counts and the library's static note stay. */
const boundSemantics = shapeOf<ToolSemantics>({
  af_semantics: kept,
  series: listOf(
    shapeOf<SemanticSeriesPoint>({
      t: charsMarker,
      entity: charsMarker,
      metric: kept,
      value: charsMarker,
    }),
  ),
  // An open record: `entity` and every other value is the data; the keys stay.
  facts: listOf(shapeOf<SemanticFact>({ entity: charsMarker })),
  edges: listOf(shapeOf<SemanticEdge>({ from: charsMarker, to: charsMarker, kind: kept })),
  grain: shapeOf<SemanticGrain>({
    interval: kept,
    aggregation: kept,
    is_counter: kept,
    collapsed: charsMarker,
  }),
  provenance: shapeOf<SemanticProvenance>({
    measured_at: charsMarker,
    age_seconds: kept,
    source: charsMarker,
    source_export_date: charsMarker,
  }),
  period: shapeOf<PeriodOnWire>({ queried: boundInstants, held: boundHeld, read_at: charsMarker }),
  resolved: listOf(
    shapeOf<ResolvedDeclaration>({
      argument: kept,
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
    default: kept,
    columns: listOf(kept),
    sort: kept,
    filter_note: charsMarker,
    chart_hint: charsMarker,
  }),
  // "The static sentence. Never interpolated."
  note: kept,
});

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
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      lookedFor: charsMarker,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      tryInstead: charsMarker,
      tryInsteadTool: shapeOf<TryInsteadToolPayload>({
        tool: custom('a name this strategy has seen run is a tool the agent holds', (value) =>
          typeof value === 'string' && toolRan(value) ? kept(value) : charsMarker(value),
        ),
        why: charsMarker,
      }),
      provenance: boundProvenance,
      period: boundPeriod,
      composition: boundComposition,
      lookedForRef: shapeOf<At<PayloadOf<'agentfootprint.tools.absent'>, 'lookedForRef'>>({
        resultId: kept,
        field: kept,
      }),
    }),
    'agentfootprint.tools.coverage_declared': eventShape<'agentfootprint.tools.coverage_declared'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      period: boundPeriod,
      inProgress: listOf(boundInProgressItem),
      composition: boundComposition,
    }),
    'agentfootprint.tools.semantics_declared':
      eventShape<'agentfootprint.tools.semantics_declared'>({
        toolName: kept,
        toolCallId: kept,
        iteration: kept,
        semantics: boundSemantics,
      }),
    'agentfootprint.agent.evidence_checked': eventShape<'agentfootprint.agent.evidence_checked'>({
      iteration: kept,
      posture: kept,
      candidates: kept,
      lookedUp: kept,
      unsupported: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.agent.evidence_checked'>['unsupported']>>({
          value: charsMarker,
          shape: kept,
        }),
      ),
      action: kept,
      afterRevision: kept,
      evidenceTruncated: kept,
      carriedBy: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'carriedBy'>>>({
          toolCallId: kept,
          values: kept,
          only: kept,
        }),
      ),
      stagedRefs: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'stagedRefs'>>>({
          ref: kept,
          kind: kept,
        }),
      ),
      spenderTools: listOf(kept),
      // `from` names the operands — and a unit-scaled figure's source value.
      computed: listOf(
        shapeOf<
          ItemOf<NonNullable<PayloadOf<'agentfootprint.agent.evidence_checked'>['computed']>>
        >({
          value: charsMarker,
          shape: kept,
          derivation: kept,
          from: charsMarker,
        }),
      ),
    }),
    'agentfootprint.integrity.external_ground_used':
      eventShape<'agentfootprint.integrity.external_ground_used'>({
        toolName: kept,
        toolCallId: kept,
        path: kept,
        value: charsMarker,
        source: kept,
        iteration: kept,
      }),
    'agentfootprint.map.engaged': eventShape<'agentfootprint.map.engaged'>({
      mapId: kept,
      iteration: kept,
      by: kept,
      witness: charsMarker,
      reengaged: kept,
      upgraded: kept,
      foundedBy: kept,
      tenantChanged: kept,
      at: kept,
    }),
    'agentfootprint.skill.turn_routed': eventShape<'agentfootprint.skill.turn_routed'>({
      by: kept,
      from: kept,
      to: kept,
      scorer: kept,
      scores: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'scores'>>>({
          id: kept,
          score: kept,
          relevance: kept,
        }),
      ),
      runnerUp: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'runnerUp'>>({
        id: kept,
        gap: kept,
      }),
      decisive: kept,
      witness: boundWitness,
      offered: listOf(kept),
      stayOffered: kept,
      policy: kept,
      window: kept,
      droppedResume: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'droppedResume'>>({
        id: kept,
        reason: kept,
      }),
      decider: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'decider'>>({
        provider: kept,
        model: kept,
        picked: kept,
      }),
    }),

    // ── The same rule, everywhere else the run's words ride ────────────
    'agentfootprint.map.parked': eventShape<'agentfootprint.map.parked'>({
      mapId: kept,
      iteration: kept,
      by: kept,
      idleCalls: kept,
      witness: charsMarker,
    }),
    // A guard's conditions are the engine's decision evidence (kept, see audit.ts).
    'agentfootprint.context.evaluated': eventShape<'agentfootprint.context.evaluated'>({
      iteration: kept,
      activeCount: kept,
      skippedCount: kept,
      evaluatedTotal: kept,
      activeIds: listOf(kept),
      skippedDetails: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.context.evaluated'>['skippedDetails']>>({
          id: kept,
          reason: kept,
          error: charsMarker,
        }),
      ),
      triggerKindCounts: kept,
      // The catalog and the routing provenance are what the app declared.
      skillCatalog: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'skillCatalog'>>>({
          id: kept,
          description: kept,
        }),
      ),
      routing: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'routing'>>>({
          injectionId: kept,
          flavor: kept,
          via: kept,
          path: listOf(
            shapeOf<
              ItemOf<
                At<ItemOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'routing'>>, 'path'>
              >
            >({ label: kept, branch: kept }),
          ),
          label: kept,
          from: kept,
          triggerKind: kept,
          tools: listOf(kept),
        }),
      ),
      cursorMove: shapeOf<At<PayloadOf<'agentfootprint.context.evaluated'>, 'cursorMove'>>({
        from: kept,
        to: kept,
        by: kept,
        offered: listOf(kept),
        declinedOffer: kept,
        witness: boundWitness,
        guard: boundGuard,
        guardsClosed: listOf(boundGuard),
        reachable: listOf(kept),
      }),
      supersededIds: listOf(kept),
    }),
    'agentfootprint.validation.args_invalid': eventShape<'agentfootprint.validation.args_invalid'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      issues: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.validation.args_invalid'>['issues']>>({
          path: kept,
          expected: kept,
          got: kept,
          value: charsMarker,
          hint: kept,
        }),
      ),
      enforced: kept,
    }),
    'agentfootprint.agent.output_schema_validation_failed':
      eventShape<'agentfootprint.agent.output_schema_validation_failed'>({
        message: charsMarker,
        stage: kept,
        path: kept,
        rawOutput: charsMarker,
        draftWithheld: kept,
        attempt: kept,
        cumulativeRetries: kept,
      }),
    'agentfootprint.resilience.output_fallback_triggered':
      eventShape<'agentfootprint.resilience.output_fallback_triggered'>({
        stage: kept,
        rawOutputPreview: charsMarker,
        primaryErrorMessage: charsMarker,
        retriesSpent: kept,
      }),
    'agentfootprint.resilience.output_canned_used':
      eventShape<'agentfootprint.resilience.output_canned_used'>({
        rawOutputPreview: charsMarker,
        fallbackErrorMessage: charsMarker,
        retriesSpent: kept,
      }),
    'agentfootprint.stream.tool_progress': eventShape<'agentfootprint.stream.tool_progress'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      payload: keysMarker,
    }),
    'agentfootprint.checkin.request': eventShape<'agentfootprint.checkin.request'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      request: keysMarker,
    }),
    'agentfootprint.checkin.decision': eventShape<'agentfootprint.checkin.decision'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      requestId: kept,
      approved: kept,
      by: kept,
      note: charsMarker,
      componentId: kept,
    }),
    'agentfootprint.middleware.decision': eventShape<'agentfootprint.middleware.decision'>({
      middleware: kept,
      moment: kept,
      at: kept,
      phase: kept,
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      outcome: kept,
      changed: kept,
      why: charsMarker,
      componentId: kept,
    }),
    'agentfootprint.skill.step_skipped': eventShape<'agentfootprint.skill.step_skipped'>({
      skillId: kept,
      // The step the app declared — its tool and note.
      step: shapeOf<At<PayloadOf<'agentfootprint.skill.step_skipped'>, 'step'>>({
        index: kept,
        total: kept,
        tool: kept,
        note: kept,
      }),
      reason: charsMarker,
      policy: kept,
      iteration: kept,
      toolCallId: kept,
    }),
    'agentfootprint.stream.llm_start': eventShape<'agentfootprint.stream.llm_start'>({
      iteration: kept,
      provider: kept,
      model: kept,
      systemPromptChars: kept,
      systemPromptText: charsMarker,
      messagesCount: kept,
      toolsCount: kept,
      // The catalog the model saw: names and the descriptions the tools declared.
      tools: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.stream.llm_start'>, 'tools'>>>({
          name: kept,
          description: kept,
        }),
      ),
      estimatedPromptTokens: kept,
      temperature: kept,
      providerRequestRef: kept,
      brain: shapeOf<At<PayloadOf<'agentfootprint.stream.llm_start'>, 'brain'>>({
        via: kept,
        skillId: kept,
      }),
    }),
    'agentfootprint.credential.failed': eventShape<'agentfootprint.credential.failed'>({
      service: kept,
      reason: charsMarker,
      tool: kept,
      errorClass: kept,
      toolCallId: kept,
      iteration: kept,
    }),
    'agentfootprint.fallback.triggered': eventShape<'agentfootprint.fallback.triggered'>({
      kind: kept,
      primary: kept,
      fallback: kept,
      reason: charsMarker,
    }),
    'agentfootprint.memory.retrieved': eventShape<'agentfootprint.memory.retrieved'>({
      strategy: kept,
      queryHash: kept,
      k: kept,
      threshold: kept,
      maxChars: kept,
      charsUsed: kept,
      embedderId: kept,
      dimensions: kept,
      consideredCount: kept,
      admittedCount: kept,
      rejectedCount: kept,
      candidates: listOf(
        shapeOf<ItemOf<NonNullable<PayloadOf<'agentfootprint.memory.retrieved'>['candidates']>>>({
          id: kept,
          score: kept,
          rank: kept,
          admitted: kept,
          reason: kept,
          docUri: kept,
          page: kept,
          heading: charsMarker,
        }),
      ),
      candidatesComplete: kept,
      candidatesOmittedReason: kept,
      corpusEmpty: kept,
      namespace: kept,
    }),
    'agentfootprint.integrity.context_error': eventShape<'agentfootprint.integrity.context_error'>({
      kind: kept,
      seam: kept,
      subjects: listOf(boundSubject),
      witnesses: listOf(
        shapeOf<Assertion>({
          subject: boundSubject,
          predicate: kept,
          value: charsMarker,
          epoch: kept,
          stratum: kept,
          provenance: charsMarker,
          runtimeStageId: kept,
          synthetic: kept,
        }),
      ),
      predicate: kept,
      epoch: kept,
      synthetic: kept,
      advisory: kept,
      message: charsMarker,
      iteration: kept,
    }),
    'agentfootprint.tools.effect': eventShape<'agentfootprint.tools.effect'>({
      kind: kept,
      outcome: kept,
      stay: kept,
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      targetSkillId: kept,
      reason: charsMarker,
      instructionId: kept,
      deliveryLease: kept,
      refusalReason: kept,
      supersededBy: kept,
    }),
    // `reason` is `pauseData.reason` — the same words `questionPayload` hides.
    'agentfootprint.pause.request': eventShape<'agentfootprint.pause.request'>({
      reason: custom(
        "the library's own pause sentence stays; a pause's own reason is its data",
        (value) => (value === FIXED_PAUSE_REASON ? value : charsMarker(value)),
      ),
      questionPayload: keysMarker,
    }),
    'agentfootprint.artifacts.minted': eventShape<'agentfootprint.artifacts.minted'>({
      ref: kept,
      kind: kept,
      mediaType: kept,
      bytes: kept,
      label: charsMarker,
      digest: kept,
      expiresAt: kept,
      origin: shapeOf<At<PayloadOf<'agentfootprint.artifacts.minted'>, 'origin'>>({
        runId: kept,
        toolCallId: kept,
      }),
      parentRefs: listOf(kept),
      // The column, zone and interval the rows declare.
      timeAxis: shapeOf<At<PayloadOf<'agentfootprint.artifacts.minted'>, 'timeAxis'>>({
        column: kept,
        unit: kept,
        zone: kept,
        interval: kept,
        aggregate: kept,
      }),
      tool: kept,
    }),
    'agentfootprint.artifacts.presented': eventShape<'agentfootprint.artifacts.presented'>({
      ref: kept,
      as: kept,
      snapshot: shapeOf<PayloadOf<'agentfootprint.artifacts.presented'>['snapshot']>({
        kind: kept,
        mediaType: kept,
        bytes: kept,
        label: charsMarker,
      }),
      toolCallId: kept,
      iteration: kept,
    }),
    'agentfootprint.artifacts.refused': eventShape<'agentfootprint.artifacts.refused'>({
      op: kept,
      reason: kept,
      ref: kept,
      detail: charsMarker,
      tool: kept,
    }),
    'agentfootprint.reliability.fail_fast': eventShape<'agentfootprint.reliability.fail_fast'>({
      phase: kept,
      kind: kept,
      attempt: kept,
      label: kept,
      reason: charsMarker,
      providerUsed: kept,
      errorKind: kept,
      errorMessage: charsMarker,
    }),
    'agentfootprint.agent.handoff': eventShape<'agentfootprint.agent.handoff'>({
      fromAgentId: kept,
      toAgentId: kept,
      reason: charsMarker,
      viaProtocol: kept,
    }),
    // A policy's `reason` is its telemetry tag; its `rationale` is prose per decision.
    'agentfootprint.permission.check': eventShape<'agentfootprint.permission.check'>({
      capability: kept,
      actor: kept,
      target: kept,
      result: kept,
      policyEngine: kept,
      policyRuleId: kept,
      rationale: charsMarker,
      reason: kept,
      toolCallId: kept,
      iteration: kept,
    }),
    // `tellLLM` is the tool result the model read in place of the call.
    'agentfootprint.permission.halt': eventShape<'agentfootprint.permission.halt'>({
      checkerId: kept,
      target: kept,
      reason: kept,
      tellLLM: charsMarker,
      iteration: kept,
      sequenceLength: kept,
      toolCallId: kept,
    }),
    // A router's `{ reason }` is the routing model's own words; `decide()`
    // evidence is the engine's, kept (see audit.ts).
    'agentfootprint.composition.route_decided':
      eventShape<'agentfootprint.composition.route_decided'>({
        conditionalId: kept,
        chosen: kept,
        rationale: kept,
        evidence: custom(
          "decide() evidence is the engine's, kept by contract; any other is a record",
          (value) => (isDecideEvidence(value) ? kept(value) : keysMarker(value)),
        ),
      }),

    // ── Every other event: structure, and the fields bounded whole ─────
    'agentfootprint.composition.enter': eventShape<'agentfootprint.composition.enter'>({
      kind: kept,
      id: kept,
      name: kept,
      childCount: kept,
    }),
    'agentfootprint.composition.exit': eventShape<'agentfootprint.composition.exit'>({
      kind: kept,
      id: kept,
      name: kept,
      status: kept,
      durationMs: kept,
    }),
    'agentfootprint.composition.fork_start': eventShape<'agentfootprint.composition.fork_start'>({
      parentId: kept,
      branches: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.composition.fork_start'>, 'branches'>>>({
          id: kept,
          name: kept,
        }),
      ),
    }),
    'agentfootprint.composition.branch_complete':
      eventShape<'agentfootprint.composition.branch_complete'>({
        parentId: kept,
        branchId: kept,
        status: kept,
        durationMs: kept,
      }),
    'agentfootprint.composition.merge_end': eventShape<'agentfootprint.composition.merge_end'>({
      parentId: kept,
      strategy: kept,
      resultSummary: charsMarker,
      mergedBranchCount: kept,
      totalBranchCount: kept,
    }),
    'agentfootprint.composition.iteration_start':
      eventShape<'agentfootprint.composition.iteration_start'>({
        loopId: kept,
        iteration: kept,
      }),
    'agentfootprint.composition.iteration_exit':
      eventShape<'agentfootprint.composition.iteration_exit'>({
        loopId: kept,
        iteration: kept,
        reason: kept,
      }),
    'agentfootprint.agent.turn_start': eventShape<'agentfootprint.agent.turn_start'>({
      turnIndex: kept,
      userPrompt: charsMarker,
    }),
    'agentfootprint.agent.turn_end': eventShape<'agentfootprint.agent.turn_end'>({
      turnIndex: kept,
      finalContent: charsMarker,
      totalInputTokens: kept,
      totalOutputTokens: kept,
      iterationCount: kept,
      durationMs: kept,
      stoppedEarly: kept,
      answerCoverage: boundAnswerCoverage,
      answerAssessment: kept,
      standingLineNames: recordOf(kept),
      answerNegatives: boundAnswerNegatives,
      refused: kept,
    }),
    'agentfootprint.agent.iteration_start': eventShape<'agentfootprint.agent.iteration_start'>({
      turnIndex: kept,
      iterIndex: kept,
    }),
    'agentfootprint.agent.iteration_end': eventShape<'agentfootprint.agent.iteration_end'>({
      turnIndex: kept,
      iterIndex: kept,
      toolCallCount: kept,
      history: messagesMarker,
    }),
    'agentfootprint.agent.route_decided': eventShape<'agentfootprint.agent.route_decided'>({
      turnIndex: kept,
      iterIndex: kept,
      chosen: kept,
      // A fixed sentence, or one the library composes (a count, a skill's name).
      rationale: kept,
    }),
    'agentfootprint.agent.output_contract_unmet':
      eventShape<'agentfootprint.agent.output_contract_unmet'>({
        stage: kept,
        error: charsMarker,
        path: kept,
        attempts: kept,
        retriesSpent: kept,
        fallbackConfigured: kept,
        iteration: kept,
        brokenBy: kept,
      }),
    'agentfootprint.agent.output_schema_retry':
      eventShape<'agentfootprint.agent.output_schema_retry'>({
        attempt: kept,
        retriesRemaining: kept,
        iteration: kept,
        stage: kept,
        error: charsMarker,
        path: kept,
        correctiveMessageHash: kept,
      }),
    'agentfootprint.agent.grounding_nudged': eventShape<'agentfootprint.agent.grounding_nudged'>({
      iteration: kept,
      refs: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.grounding_nudged'>, 'refs'>>>({
          ref: kept,
          kind: kept,
        }),
      ),
      refsOmitted: kept,
      tools: listOf(kept),
    }),
    'agentfootprint.agent.run_configured': eventShape<'agentfootprint.agent.run_configured'>({
      agentId: kept,
      llm: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'llm'>>({
        provider: kept,
        model: kept,
        modelOverrides: kept,
      }),
      cache: kept,
      reactMode: kept,
      memories: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'memories'>>>({
          id: kept,
          type: kept,
          strategy: kept,
          retrieval: kept,
          embedderId: kept,
          flavor: kept,
        }),
      ),
      window: kept,
      skillGraph: shapeOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'skillGraph'>>({
        routing: kept,
        continuity: kept,
        scorer: kept,
      }),
      evidenceGate: kept,
      artifacts: kept,
      recipes: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.run_configured'>, 'recipes'>>>({
          id: kept,
          version: kept,
        }),
      ),
    }),
    'agentfootprint.agent.thinking_parse_failed':
      eventShape<'agentfootprint.agent.thinking_parse_failed'>({
        providerName: kept,
        subflowId: kept,
        error: charsMarker,
        errorName: kept,
        iteration: kept,
      }),
    'agentfootprint.agent.thinking_omitted': eventShape<'agentfootprint.agent.thinking_omitted'>({
      providerName: kept,
      model: kept,
      messageIndex: kept,
      blockIndex: kept,
      reason: kept,
      phase: kept,
    }),
    'agentfootprint.agent.budget_exhausted': eventShape<'agentfootprint.agent.budget_exhausted'>({
      reason: kept,
      iteration: kept,
      limit: kept,
      pendingToolCalls: kept,
      action: kept,
    }),
    'agentfootprint.stream.llm_end': eventShape<'agentfootprint.stream.llm_end'>({
      iteration: kept,
      content: charsMarker,
      contentWithheld: kept,
      toolCallCount: kept,
      usage: kept,
      stopReason: kept,
      durationMs: kept,
      providerResponseRef: kept,
    }),
    'agentfootprint.stream.token': eventShape<'agentfootprint.stream.token'>({
      iteration: kept,
      tokenIndex: kept,
      content: charsMarker,
    }),
    'agentfootprint.stream.tool_start': eventShape<'agentfootprint.stream.tool_start'>({
      toolName: kept,
      toolCallId: kept,
      args: keysMarker,
      parallelCount: kept,
      protocol: kept,
      notDispatched: shapeOf<At<PayloadOf<'agentfootprint.stream.tool_start'>, 'notDispatched'>>({
        pausedCall: shapeOf<
          At<At<PayloadOf<'agentfootprint.stream.tool_start'>, 'notDispatched'>, 'pausedCall'>
        >({
          toolCallId: kept,
          toolName: kept,
        }),
      }),
    }),
    'agentfootprint.stream.tool_end': eventShape<'agentfootprint.stream.tool_end'>({
      toolCallId: kept,
      result: typeMarker,
      error: kept,
      durationMs: kept,
      status: kept,
      notDispatched: shapeOf<At<PayloadOf<'agentfootprint.stream.tool_end'>, 'notDispatched'>>({
        pausedCall: shapeOf<
          At<At<PayloadOf<'agentfootprint.stream.tool_end'>, 'notDispatched'>, 'pausedCall'>
        >({
          toolCallId: kept,
          toolName: kept,
        }),
      }),
      modelResult: typeMarker,
      changedArgKeys: listOf(kept),
      notExecuted: kept,
    }),
    'agentfootprint.stream.thinking_delta': eventShape<'agentfootprint.stream.thinking_delta'>({
      iteration: kept,
      tokenIndex: kept,
      content: charsMarker,
    }),
    'agentfootprint.stream.thinking_end': eventShape<'agentfootprint.stream.thinking_end'>({
      iteration: kept,
      blockCount: kept,
      totalChars: kept,
      tokens: kept,
      blocks: blocksMarker,
    }),
    'agentfootprint.context.injected': eventShape<'agentfootprint.context.injected'>({
      contentSummary: charsMarker,
      contentHash: kept,
      rawContent: charsMarker,
      slot: kept,
      asRole: kept,
      asRecency: kept,
      position: kept,
      sectionTag: kept,
      source: kept,
      sourceId: kept,
      upstreamRef: kept,
      reason: kept,
      retrievalScore: kept,
      rankPosition: kept,
      threshold: kept,
      budgetSpent: kept,
      expiresAfter: kept,
    }),
    'agentfootprint.context.evicted': eventShape<'agentfootprint.context.evicted'>({
      slot: kept,
      contentHash: kept,
      reason: kept,
      survivalMs: kept,
    }),
    'agentfootprint.context.slot_composed': eventShape<'agentfootprint.context.slot_composed'>({
      slot: kept,
      iteration: kept,
      budget: kept,
      sourceBreakdown: kept,
      orderingStrategy: kept,
      droppedCount: kept,
      droppedSummaries: summariesMarker,
    }),
    'agentfootprint.context.budget_pressure': eventShape<'agentfootprint.context.budget_pressure'>({
      slot: kept,
      overflowBy: kept,
      planAction: kept,
      unit: kept,
      cap: kept,
      projected: kept,
    }),
    'agentfootprint.memory.strategy_applied': eventShape<'agentfootprint.memory.strategy_applied'>({
      strategyId: kept,
      strategyKind: kept,
      reason: kept,
      scoreEvidence: keysMarker,
      inputMemoryCount: kept,
      outputMemoryCount: kept,
      droppedIds: listOf(kept),
      addedIds: listOf(kept),
    }),
    'agentfootprint.memory.attached': eventShape<'agentfootprint.memory.attached'>({
      memoryId: kept,
      contentSummary: charsMarker,
      score: kept,
      rank: kept,
      source: kept,
      retriever: kept,
    }),
    'agentfootprint.memory.detached': eventShape<'agentfootprint.memory.detached'>({
      memoryId: kept,
      reason: kept,
    }),
    'agentfootprint.memory.written': eventShape<'agentfootprint.memory.written'>({
      memoryId: kept,
      contentSummary: charsMarker,
      source: kept,
      actor: kept,
    }),
    'agentfootprint.tools.offered': eventShape<'agentfootprint.tools.offered'>({
      availableIds: listOf(kept),
      withheldIds: listOf(kept),
      withheldReasons: kept,
      reason: kept,
    }),
    'agentfootprint.tools.activated': eventShape<'agentfootprint.tools.activated'>({
      toolId: kept,
      reason: kept,
      source: kept,
    }),
    'agentfootprint.tools.deactivated': eventShape<'agentfootprint.tools.deactivated'>({
      toolId: kept,
      reason: kept,
    }),
    'agentfootprint.tools.discovery_started': eventShape<'agentfootprint.tools.discovery_started'>({
      providerId: kept,
      iteration: kept,
    }),
    'agentfootprint.tools.discovery_completed':
      eventShape<'agentfootprint.tools.discovery_completed'>({
        providerId: kept,
        iteration: kept,
        durationMs: kept,
        toolCount: kept,
      }),
    'agentfootprint.tools.discovery_failed': eventShape<'agentfootprint.tools.discovery_failed'>({
      providerId: kept,
      error: charsMarker,
      errorName: kept,
      iteration: kept,
      durationMs: kept,
    }),
    'agentfootprint.tools.shadowed': eventShape<'agentfootprint.tools.shadowed'>({
      toolName: kept,
      iteration: kept,
      schemaFrom: kept,
      schemaFromId: kept,
      dispatchTo: kept,
      dispatchToId: kept,
    }),
    'agentfootprint.tools.claim_swallowed': eventShape<'agentfootprint.tools.claim_swallowed'>({
      toolName: kept,
      iteration: kept,
      lostBy: kept,
      lostById: kept,
      wonBy: kept,
      wonById: kept,
    }),
    'agentfootprint.tools.answered_off_wire': eventShape<'agentfootprint.tools.answered_off_wire'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      answeredBy: kept,
      answeredById: kept,
    }),
    'agentfootprint.tools.session_started': eventShape<'agentfootprint.tools.session_started'>({
      tool: kept,
      scope: kept,
      keyHash: kept,
      runnerId: kept,
      label: kept,
    }),
    'agentfootprint.tools.session_reused': eventShape<'agentfootprint.tools.session_reused'>({
      calls: kept,
      tool: kept,
      scope: kept,
      keyHash: kept,
      runnerId: kept,
      label: kept,
    }),
    'agentfootprint.tools.session_closed': eventShape<'agentfootprint.tools.session_closed'>({
      reason: kept,
      durationMs: kept,
      tool: kept,
      scope: kept,
      keyHash: kept,
      runnerId: kept,
      label: kept,
    }),
    'agentfootprint.tools.result_refused': eventShape<'agentfootprint.tools.result_refused'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      sizeChars: kept,
      maxChars: kept,
      narrowBy: listOf(kept),
      declaredStatus: kept,
    }),
    'agentfootprint.tools.repeated_call': eventShape<'agentfootprint.tools.repeated_call'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      occurrences: kept,
      argsFingerprint: kept,
      resultFingerprint: kept,
      mode: kept,
    }),
    'agentfootprint.tools.code_run': eventShape<'agentfootprint.tools.code_run'>({
      tool: kept,
      language: kept,
      stagedInputs: kept,
      outputChars: kept,
      truncated: kept,
      ok: kept,
      exitCode: kept,
      serviceError: kept,
      terminatedBy: kept,
      shapeHash: kept,
    }),
    // One use of an MCP client pool: "ids, digests, evidence and outcomes only" —
    // never an identity value, a session handle, an argument, a result or a server's text.
    'agentfootprint.tools.mcp_client': eventShape<'agentfootprint.tools.mcp_client'>({
      server: kept,
      at: kept,
      toolCallId: kept,
      keyHash: kept,
      clientId: kept,
      generation: kept,
      client: kept,
      previous: kept,
      evidence: kept,
      refusal: kept,
      initMs: kept,
      definitions: kept,
      definitionsAgeMs: kept,
      revalidated: kept,
    }),
    'agentfootprint.tools.request_attempts': eventShape<'agentfootprint.tools.request_attempts'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      endpoint: kept,
      origin: kept,
      attempts: kept,
      omitted: kept,
      end: kept,
    }),
    'agentfootprint.tools.session_close_failed':
      eventShape<'agentfootprint.tools.session_close_failed'>({
        reason: kept,
        durationMs: kept,
        error: charsMarker,
        errorClass: kept,
        tool: kept,
        scope: kept,
        keyHash: kept,
        runnerId: kept,
        label: kept,
      }),
    'agentfootprint.skill.activated': eventShape<'agentfootprint.skill.activated'>({
      skillId: kept,
      reason: kept,
      injectedTools: listOf(kept),
      injectedSystemPromptChars: kept,
    }),
    'agentfootprint.skill.graph_declared': eventShape<'agentfootprint.skill.graph_declared'>({
      nodes: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'nodes'>>>({
          id: kept,
          kind: kept,
          description: kept,
          label: kept,
          title: kept,
        }),
      ),
      edges: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>>({
          from: kept,
          to: kept,
          kind: kept,
          label: kept,
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
                key: kept,
                op: kept,
                // The value the app declared to compare against: one, or a list.
                value: orList(kept),
              }),
            ),
          }),
        }),
      ),
    }),
    'agentfootprint.skill.deactivated': eventShape<'agentfootprint.skill.deactivated'>({
      skillId: kept,
      reason: kept,
    }),
    'agentfootprint.skill.rejected': eventShape<'agentfootprint.skill.rejected'>({
      requestedId: kept,
      currentSkillId: kept,
      allowed: listOf(kept),
      iteration: kept,
      posture: kept,
      reason: kept,
    }),
    'agentfootprint.skill.reroute_superseded':
      eventShape<'agentfootprint.skill.reroute_superseded'>({
        volunteeredId: kept,
        wonId: kept,
        fromSkillId: kept,
        iteration: kept,
        source: kept,
      }),
    'agentfootprint.skill.route_conflict': eventShape<'agentfootprint.skill.route_conflict'>({
      iteration: kept,
      fromSkillId: kept,
      winner: shapeOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'winner'>>({
        toolCallId: kept,
        toolName: kept,
        target: kept,
      }),
      losers: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'losers'>>>({
          toolCallId: kept,
          toolName: kept,
          target: kept,
        }),
      ),
      source: kept,
    }),
    'agentfootprint.skill.step_advanced': eventShape<'agentfootprint.skill.step_advanced'>({
      skillId: kept,
      step: shapeOf<At<PayloadOf<'agentfootprint.skill.step_advanced'>, 'step'>>({
        index: kept,
        total: kept,
        tool: kept,
        note: kept,
      }),
      iteration: kept,
      toolCallId: kept,
      completed: kept,
    }),
    'agentfootprint.skill.steps_unfinished': eventShape<'agentfootprint.skill.steps_unfinished'>({
      skillId: kept,
      remaining: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.steps_unfinished'>, 'remaining'>>>({
          index: kept,
          tool: kept,
          note: kept,
        }),
      ),
      total: kept,
      action: kept,
      iteration: kept,
    }),
    'agentfootprint.skill.escalated': eventShape<'agentfootprint.skill.escalated'>({
      iteration: kept,
      afterRefusals: kept,
      refusals: kept,
      from: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'from'>>({
        provider: kept,
        model: kept,
      }),
      to: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'to'>>({
        provider: kept,
        model: kept,
      }),
    }),
    'agentfootprint.permission.gate_opened': eventShape<'agentfootprint.permission.gate_opened'>({
      gateId: kept,
      openedBy: kept,
      expiresAt: kept,
    }),
    'agentfootprint.permission.gate_closed': eventShape<'agentfootprint.permission.gate_closed'>({
      gateId: kept,
      reason: kept,
    }),
    'agentfootprint.credential.requested': eventShape<'agentfootprint.credential.requested'>({
      service: kept,
      mode: kept,
      toolCallId: kept,
      iteration: kept,
    }),
    'agentfootprint.credential.acquired': eventShape<'agentfootprint.credential.acquired'>({
      service: kept,
      kind: kept,
      expiresAt: kept,
      toolCallId: kept,
      iteration: kept,
    }),
    'agentfootprint.credential.authorization_required':
      eventShape<'agentfootprint.credential.authorization_required'>({
        service: kept,
        sessionId: kept,
        toolCallId: kept,
        iteration: kept,
      }),
    'agentfootprint.cost.tick': eventShape<'agentfootprint.cost.tick'>({
      scope: kept,
      model: kept,
      provider: kept,
      tokensInput: kept,
      tokensOutput: kept,
      estimatedUsd: kept,
      cumulative: kept,
    }),
    'agentfootprint.cost.limit_hit': eventShape<'agentfootprint.cost.limit_hit'>({
      kind: kept,
      limit: kept,
      actual: kept,
      action: kept,
    }),
    'agentfootprint.eval.score': eventShape<'agentfootprint.eval.score'>({
      metricId: kept,
      value: kept,
      threshold: kept,
      target: kept,
      targetRef: kept,
      evaluator: kept,
      evidence: keysMarker,
      label: kept,
      explanation: charsMarker,
    }),
    'agentfootprint.eval.threshold_crossed': eventShape<'agentfootprint.eval.threshold_crossed'>({
      metricId: kept,
      direction: kept,
      value: kept,
      threshold: kept,
      actionTaken: kept,
    }),
    'agentfootprint.error.retried': eventShape<'agentfootprint.error.retried'>({
      attempt: kept,
      maxAttempts: kept,
      lastError: charsMarker,
      backoffMs: kept,
      reason: kept,
      statedWaitMs: kept,
    }),
    'agentfootprint.error.recovered': eventShape<'agentfootprint.error.recovered'>({
      attempt: kept,
      totalDurationMs: kept,
    }),
    'agentfootprint.error.fatal': eventShape<'agentfootprint.error.fatal'>({
      error: charsMarker,
      stage: kept,
      scope: kept,
    }),
    'agentfootprint.error.circuit_changed': eventShape<'agentfootprint.error.circuit_changed'>({
      state: kept,
      reason: kept,
      providerName: kept,
    }),
    'agentfootprint.reliability.retried': eventShape<'agentfootprint.reliability.retried'>({
      attempt: kept,
      action: kept,
      errorKind: kept,
      errorMessage: charsMarker,
      fromProvider: kept,
      toProvider: kept,
    }),
    'agentfootprint.reliability.recovered': eventShape<'agentfootprint.reliability.recovered'>({
      attempt: kept,
      recoveredVia: kept,
      priorFailures: kept,
      errorKind: kept,
    }),
    'agentfootprint.pause.resume': eventShape<'agentfootprint.pause.resume'>({
      resumeInput: keysMarker,
      pausedDurationMs: kept,
      componentId: kept,
    }),
    'agentfootprint.findings.declared': eventShape<'agentfootprint.findings.declared'>({
      toolName: kept,
      toolCallId: kept,
      iteration: kept,
      basis: kept,
      expect: kept,
      hasProposition: kept,
      malformed: kept,
    }),
    'agentfootprint.findings.standing': eventShape<'agentfootprint.findings.standing'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      standing: kept,
      declaredOn: kept,
      assertionCount: kept,
      conflictKeys: listOf(kept),
      unknownId: kept,
      agrees: kept,
    }),
    'agentfootprint.findings.judged': eventShape<'agentfootprint.findings.judged'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      against: kept,
      standing: kept,
      confidence: kept,
      latencyMs: kept,
      inputTokens: kept,
      outputTokens: kept,
    }),
    'agentfootprint.findings.judge_failed': eventShape<'agentfootprint.findings.judge_failed'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      status: kept,
      latencyMs: kept,
    }),
    'agentfootprint.findings.contingent': eventShape<'agentfootprint.findings.contingent'>({
      iteration: kept,
      declaredOn: kept,
      toolCallId: kept,
      carriers: kept,
      standings: kept,
      valueChars: kept,
    }),
    'agentfootprint.findings.argument': eventShape<'agentfootprint.findings.argument'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      turn: kept,
      argument: kept,
      rule: kept,
      period: kept,
      source: kept,
      asked: kept,
      claimed: kept,
      matched: kept,
      reading: kept,
      earlier: kept,
      setAside: kept,
      argumentsFrom: kept,
      coincides: kept,
      free: kept,
      failed: kept,
      malformed: kept,
      valueChars: kept,
    }),
    'agentfootprint.findings.period': eventShape<'agentfootprint.findings.period'>({
      toolCallId: kept,
      toolName: kept,
      iteration: kept,
      turn: kept,
      verdict: kept,
      timeChecks: kept,
    }),
    'agentfootprint.findings.negative_claim': eventShape<'agentfootprint.findings.negative_claim'>({
      iteration: kept,
      turn: kept,
      field: kept,
      span: kept,
      packVersion: kept,
      phraseId: kept,
      truncated: kept,
      kind: kept,
      // A claim row's checker codes and native result ids; a note row's code.
      claim: kept,
      notes: listOf(kept),
      results: listOf(kept),
      code: kept,
    }),
    'agentfootprint.tool_choice.picked': eventShape<'agentfootprint.tool_choice.picked'>({
      iteration: kept,
      chosen: kept,
      confidence: kept,
      offered: kept,
      served: kept,
      narrowed: kept,
      narrowedSkipped: kept,
      latencyMs: kept,
      inputTokens: kept,
      outputTokens: kept,
    }),
    'agentfootprint.tool_choice.outcome': eventShape<'agentfootprint.tool_choice.outcome'>({
      iteration: kept,
      called: listOf(kept),
      firstAgrees: kept,
      missed: listOf(kept),
    }),
    'agentfootprint.tool_choice.failed': eventShape<'agentfootprint.tool_choice.failed'>({
      iteration: kept,
      status: kept,
      latencyMs: kept,
    }),
    'agentfootprint.ontology.served': eventShape<'agentfootprint.ontology.served'>({
      iteration: kept,
      id: kept,
      version: kept,
      hash: kept,
      nodes: kept,
      sources: kept,
      edges: kept,
    }),
    'agentfootprint.answer.assessed': eventShape<'agentfootprint.answer.assessed'>({
      turn: kept,
      iteration: kept,
      assessment: kept,
      standing: kept,
      reasons: kept,
      checked: kept,
    }),
    'agentfootprint.embedding.generated': eventShape<'agentfootprint.embedding.generated'>({
      model: kept,
      provider: kept,
      inputKind: kept,
      dimension: kept,
      count: kept,
      durationMs: kept,
      tokensSpent: kept,
    }),
    'agentfootprint.artifacts.resolved': eventShape<'agentfootprint.artifacts.resolved'>({
      ref: kept,
      via: kept,
      kind: kept,
      bytes: kept,
      tool: kept,
    }),
    'agentfootprint.artifacts.expired': eventShape<'agentfootprint.artifacts.expired'>({
      ref: kept,
      reason: kept,
      kind: kept,
      bytes: kept,
      tool: kept,
    }),
    'agentfootprint.artifacts.hand_over_failed':
      eventShape<'agentfootprint.artifacts.hand_over_failed'>({
        cause: kept,
        op: kept,
        errorClass: kept,
        errorCode: kept,
      }),
    'agentfootprint.integrity.disposition': eventShape<'agentfootprint.integrity.disposition'>({
      posture: kept,
      workExisted: kept,
      rows: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.integrity.disposition'>, 'rows'>>>({
          check: kept,
          seam: kept,
          checked: kept,
          findings: kept,
          notApplicable: kept,
          unreachable: kept,
          lastFiredAt: kept,
          synthetic: kept,
        }),
      ),
    }),
  };
}
