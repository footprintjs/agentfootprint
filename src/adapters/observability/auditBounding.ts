/**
 * auditBounding — what the audit chain's bounded mode keeps of an event.
 *
 * Pattern: small pure rules composed into shapes (`shapeOf`, `listOf`), one
 *          table of whole-event shapes (`eventShapes`).
 * Role:    the bounding layer `auditExport({ payloadMode: 'bounded' })` runs
 *          every payload through (`audit.ts`). No I/O, no clock.
 * Emits:   N/A.
 *
 * THE RULE, the one `otel.ts` maps spans by: **structure is kept, content is
 * a marker.**
 *
 *   - Content is every string or value the run composed from what it read or
 *     produced, whoever wrote it — a person, the model, a tool, the data, or
 *     the app's code at run time — and the messages built from it. It becomes
 *     `'[N chars]'` (a string), `'[type: …]'` (anything else) or
 *     `'[keys: …]'` (a free-form record: its key names, never its values).
 *   - Structure is ids, names, kinds, codes and telemetry tags, verdicts,
 *     counts, timestamps the library takes, the library's own sentences built
 *     from those, and the words the app declared up front (labels,
 *     descriptions, step notes, hints, display names, rule ids). It is kept,
 *     sanitized (`sanitizeJson`): strings capped at 256 characters, lists at
 *     32 items, cycles broken.
 *
 * A SHAPE rules every field of one payload type, exhaustive by type
 * (`{ [K in keyof T]-?: BoundRule }`), so a field added to the type does not
 * compile until someone decides which side it is on. It fails closed: a field
 * it does not name, or a value that is not the declared shape, is a marker.
 * A shape is typed against the payload type AND, where the runtime value
 * carries more than the type says, against the runtime type too.
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
  TryInsteadToolPayload,
} from '../../events/payloads.js';
import type { AgentfootprintEventMap } from '../../events/registry.js';
import type { Assertion } from '../../integrity/assertion/types.js';
import { isErrorValue, wireError } from '../../lib/wireJson.js';
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

// ─── JSON sanitization (both modes) ──────────────────────────────────

/** Caps mirror otel.ts's bounding discipline (defense-in-depth — the
 *  registry payloads are mostly bounded upstream). */
const MAX_STRING_CHARS = 256;
const MAX_LIST_ITEMS = 32;
const MAX_DEPTH = 8;

/**
 * Convert any value to a JSON-safe, size-bounded tree:
 * strings capped, arrays capped with an overflow marker, cycles
 * broken, depth capped, Date → ISO, bigint → string, non-finite →
 * null, functions/symbols/undefined dropped (objects) or null
 * (arrays). Output always canonicalizes without throwing.
 */
export function sanitizeJson(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS - 1)}…` : value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  const obj = value as object;
  if (obj instanceof Date) return obj.toISOString();
  // The wire rule (`lib/wireJson.ts`): name, message, code, cause — never an
  // Error's custom properties (an axios error's request headers).
  if (isErrorValue(obj)) return sanitizeJson(wireError(obj), depth, seen);
  if (depth >= MAX_DEPTH) return '[truncated: depth]';
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const capped = obj.slice(0, MAX_LIST_ITEMS).map((item) => {
        const sanitized = sanitizeJson(item, depth + 1, seen);
        return sanitized === undefined ? null : sanitized;
      });
      if (obj.length > MAX_LIST_ITEMS) capped.push(`…+${obj.length - MAX_LIST_ITEMS} more`);
      return capped;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(obj)) {
      const sanitized = sanitizeJson(entry, depth + 1, seen);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

// ─── Markers ─────────────────────────────────────────────────────────

/** `'[23 chars]'` — length evidence without content. */
export function charsMarker(value: unknown): string {
  return typeof value === 'string' ? `[${value.length} chars]` : `[type: ${typeofOf(value)}]`;
}

/** `'[keys: a, b, c]'` — shape evidence for free-form Records. */
export function keysMarker(value: unknown): string {
  if (value === null || typeof value !== 'object') return `[type: ${typeofOf(value)}]`;
  const keys = Object.keys(value as object).slice(0, MAX_LIST_ITEMS);
  return `[keys: ${keys.join(', ')}]`;
}

export function typeofOf(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

// ─── Shapes: the record's own words beside content ───────────────────

/** How the bounded mode writes one value. */
export type BoundRule = (value: unknown) => unknown;

/** The record's own words (ids, names, counts, kinds, codes): kept, sanitized. */
const kept: BoundRule = (value) => sanitizeJson(value);

/** `null` stays `null` (a declared "none"); anything else by `rule`. */
const nullOr =
  (rule: BoundRule): BoundRule =>
  (value) =>
    value === null ? null : rule(value);

/**
 * An object of a known shape, every field ruled (exhaustive by type, so a field
 * added to `T` does not compile until it is). A field the rules do not name is
 * a marker: whatever the shape gains at runtime is bounded until someone decides
 * it is the record's own words. Anything but an object is a marker too.
 */
function shapeOf<T>(rules: { readonly [K in keyof T]-?: BoundRule }): BoundRule {
  const byField = rules as Readonly<Record<string, BoundRule>>;
  return (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return charsMarker(value);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue; // absent, as JSON has it
      const rule = Object.hasOwn(byField, key) ? byField[key] : undefined;
      const bounded = (rule ?? charsMarker)(entry);
      if (bounded !== undefined) out[key] = bounded;
    }
    return out;
  };
}

/** A list of one shape: each entry by `rule`, capped like every list (`sanitizeJson`). */
function listOf(rule: BoundRule): BoundRule {
  return (value) => {
    if (!Array.isArray(value)) return charsMarker(value);
    const out: unknown[] = [];
    for (let i = 0; i < Math.min(value.length, MAX_LIST_ITEMS); i++) {
      out.push(rule(value[i]) ?? null);
    }
    if (value.length > MAX_LIST_ITEMS) out.push(`…+${value.length - MAX_LIST_ITEMS} more`);
    return out;
  };
}

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
const boundHeld: BoundRule = (value) => (value === 'unknown' ? value : boundInstants(value));

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
const boundComposition = shapeOf<CoverageCompositionPayload>({
  origin: kept,
  resultId: kept,
  complete: kept,
  facets: listOf(
    shapeOf<CoverageFacetReferencePayload>({ facet: kept, from: kept, ref: kept, any: kept }),
  ),
  gaps: listOf(
    shapeOf<CoverageGapPayload>({ kind: kept, what: kept, why: kept, bears: kept, argument: kept }),
  ),
});

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
      restsOn: kept,
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
      tools: kept,
      results: kept,
      staleSince: kept,
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
  readonly [K in keyof PayloadOf<T>]-?: BoundRule;
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
    columns: kept,
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
export function eventShapes(
  toolRan: (name: string) => boolean,
): Readonly<Record<string, BoundRule>> {
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
        tool: (value) =>
          typeof value === 'string' && toolRan(value) ? kept(value) : charsMarker(value),
        why: charsMarker,
      }),
      provenance: boundProvenance,
      period: boundPeriod,
      composition: boundComposition,
      lookedForRef: kept,
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
      carriedBy: kept,
      stagedRefs: kept,
      spenderTools: kept,
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
      scores: kept,
      runnerUp: kept,
      decisive: kept,
      witness: boundWitness,
      offered: kept,
      stayOffered: kept,
      policy: kept,
      window: kept,
      droppedResume: kept,
      decider: kept,
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
      activeIds: kept,
      skippedDetails: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.context.evaluated'>['skippedDetails']>>({
          id: kept,
          reason: kept,
          error: charsMarker,
        }),
      ),
      triggerKindCounts: kept,
      skillCatalog: kept,
      routing: kept,
      cursorMove: shapeOf<NonNullable<PayloadOf<'agentfootprint.context.evaluated'>['cursorMove']>>(
        {
          from: kept,
          to: kept,
          by: kept,
          offered: kept,
          declinedOffer: kept,
          witness: boundWitness,
          guard: kept,
          guardsClosed: kept,
          reachable: kept,
        },
      ),
      supersededIds: kept,
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
      step: kept,
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
      tools: kept,
      estimatedPromptTokens: kept,
      temperature: kept,
      providerRequestRef: kept,
      brain: kept,
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
      subjects: kept,
      witnesses: listOf(
        shapeOf<Assertion>({
          subject: kept,
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
      reason: (value) => (value === FIXED_PAUSE_REASON ? value : charsMarker(value)),
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
      origin: kept,
      parentRefs: kept,
      timeAxis: kept,
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
        evidence: (value) => (isDecideEvidence(value) ? kept(value) : keysMarker(value)),
      }),
  };
}

// ─── The tools this strategy has seen run ────────────────────────────

/** Names kept, and calls awaiting their end — each bounded, names and ids only. */
const MAX_TOOL_NAMES = 1024;
const MAX_OPEN_CALLS = 1024;

/**
 * Tool names this strategy has seen RUN — a `stream.tool_end` without `error`,
 * `notExecuted` or `notDispatched`, matched to its `tool_start` by
 * `toolCallId` — so a tool this agent holds, by construction. What a
 * `tryInsteadTool` name is recognized against (`otel.ts` keeps the same set).
 */
export function createToolRunTracker(): {
  observe(type: string, payload: unknown): void;
  ran(name: string): boolean;
} {
  const open = new Map<string, string>();
  const ran = new Set<string>();
  return {
    observe(type, payload) {
      if (payload === null || typeof payload !== 'object') return;
      const p = payload as {
        toolCallId?: unknown;
        toolName?: unknown;
        error?: unknown;
        notExecuted?: unknown;
        notDispatched?: unknown;
      };
      if (typeof p.toolCallId !== 'string' || p.notDispatched !== undefined) return;
      if (type === 'agentfootprint.stream.tool_start' && typeof p.toolName === 'string') {
        if (open.size >= MAX_OPEN_CALLS) {
          const [oldest] = open.keys();
          if (oldest !== undefined) open.delete(oldest);
        }
        open.set(p.toolCallId, p.toolName);
        return;
      }
      if (type !== 'agentfootprint.stream.tool_end') return;
      const name = open.get(p.toolCallId);
      open.delete(p.toolCallId);
      const failed = p.error !== undefined && p.error !== false;
      if (name === undefined || failed || p.notExecuted === true) return;
      if (ran.size < MAX_TOOL_NAMES || ran.has(name)) ran.add(name);
    },
    ran: (name) => ran.has(name),
  };
}
