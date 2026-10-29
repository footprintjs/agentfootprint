/**
 * Compile-level completeness for EVERY registered event, then a canary in every
 * content leaf of every event whose content sits beside structure, run through
 * every exporter: the bounded audit chain carries none of it, and each other
 * exporter carries exactly what its own contract lets it.
 *
 * `EVENT_CONTENT` classifies every event type, exhaustive by type
 * (`{ [T in keyof AgentfootprintEventMap]-?: … }`): a new event does not
 * compile here (`npm run test:types`) until someone decides whether it
 * carries content and where the audit bounds it —
 *
 *   - `'shape'`     — content beside structure, bounded at each content leaf by
 *                     a whole-event shape (`auditBounding.ts` · `eventShapes`);
 *   - `'fields'`    — a content field replaced whole (`audit.ts` · `BOUND_FIELDS`
 *                     and its error-message rule; `turn_end` has its own pin,
 *                     `TurnEndContent.completeness`);
 *   - `'structure'` — ids, names, kinds, codes, counts, verdicts, the library's
 *                     own sentences and the words the app declared up front; no
 *                     field the run composed from what it read or produced.
 *
 * For each `'shape'` event, `CANARY_PAYLOAD` builds a payload with EVERY field
 * filled at every depth (`DeepRequired`: a field added to the payload type is a
 * compile error until the fixture fills it), a canary in every content leaf and
 * in no record leaf. The audit chain's record must then equal the payload with
 * every canary leaf replaced by its `'[N chars]'` marker, and each free-form
 * record by its `'[keys: …]'` marker — an oracle that never reads the
 * exporter's own shapes. A skill guard's `actualSummary` holds a canary too: it
 * is the engine's decision evidence, which the chain carries by contract, and
 * the audit's declared `carries` say so.
 */
import { describe, expect, it } from 'vitest';

import { auditExport } from '../../src/adapters/observability/audit';
import { eventShapes } from '../../src/adapters/observability/auditBounding';
import {
  otelObservability,
  type OtelAttributeValue,
  type OtelTracerLike,
} from '../../src/adapters/observability/otel';
import { xrayObservability } from '../../src/adapters/observability/xray';
import { agUiSerializer } from '../../src/ag-ui/serializer';
import { deriveTranscript } from '../../src/bug-report/transcript';
import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../src/events/registry';

type EventType = keyof AgentfootprintEventMap;
type PayloadOf<T extends EventType> = AgentfootprintEventMap[T]['payload'];

/** Every field at every depth, required. */
type DeepRequired<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
  ? readonly DeepRequired<E>[]
  : T extends object
  ? { readonly [K in keyof T]-?: DeepRequired<Exclude<T[K], undefined>> }
  : T;

export type EventContent = 'shape' | 'fields' | 'structure';

export const EVENT_CONTENT = {
  // agent.*
  'agentfootprint.agent.budget_exhausted': 'structure',
  'agentfootprint.agent.evidence_checked': 'shape',
  'agentfootprint.agent.grounding_nudged': 'structure',
  'agentfootprint.agent.handoff': 'shape',
  'agentfootprint.agent.iteration_end': 'fields',
  'agentfootprint.agent.iteration_start': 'structure',
  'agentfootprint.agent.output_contract_unmet': 'fields',
  'agentfootprint.agent.output_schema_retry': 'fields',
  'agentfootprint.agent.output_schema_validation_failed': 'shape',
  // the library's fixed or composed rationale (a count, a skill's name)
  'agentfootprint.agent.route_decided': 'structure',
  'agentfootprint.agent.run_configured': 'structure',
  'agentfootprint.agent.thinking_omitted': 'structure',
  'agentfootprint.agent.thinking_parse_failed': 'fields',
  'agentfootprint.agent.turn_end': 'fields',
  'agentfootprint.agent.turn_start': 'fields',
  // answer.*
  'agentfootprint.answer.assessed': 'structure',
  // artifacts.*
  'agentfootprint.artifacts.expired': 'structure',
  'agentfootprint.artifacts.hand_over_failed': 'structure',
  'agentfootprint.artifacts.minted': 'shape',
  'agentfootprint.artifacts.presented': 'shape',
  'agentfootprint.artifacts.refused': 'shape',
  'agentfootprint.artifacts.resolved': 'structure',
  // checkin.*
  'agentfootprint.checkin.decision': 'shape',
  'agentfootprint.checkin.request': 'shape',
  // composition.*
  'agentfootprint.composition.branch_complete': 'structure',
  'agentfootprint.composition.enter': 'structure',
  'agentfootprint.composition.exit': 'structure',
  'agentfootprint.composition.fork_start': 'structure',
  'agentfootprint.composition.iteration_exit': 'structure',
  'agentfootprint.composition.iteration_start': 'structure',
  'agentfootprint.composition.merge_end': 'fields',
  'agentfootprint.composition.route_decided': 'shape',
  // context.*
  'agentfootprint.context.budget_pressure': 'structure',
  'agentfootprint.context.evaluated': 'shape',
  'agentfootprint.context.evicted': 'structure',
  'agentfootprint.context.injected': 'fields',
  'agentfootprint.context.slot_composed': 'fields',
  // cost.*
  'agentfootprint.cost.limit_hit': 'structure',
  'agentfootprint.cost.tick': 'structure',
  // credential.*
  // service and session ids, never a secret
  'agentfootprint.credential.acquired': 'structure',
  // service and session ids, never a secret
  'agentfootprint.credential.authorization_required': 'structure',
  'agentfootprint.credential.failed': 'shape',
  // service and session ids, never a secret
  'agentfootprint.credential.requested': 'structure',
  // embedding.*
  'agentfootprint.embedding.generated': 'structure',
  // error.*
  // the breaker's own words, never an error's message
  'agentfootprint.error.circuit_changed': 'structure',
  'agentfootprint.error.fatal': 'fields',
  'agentfootprint.error.recovered': 'structure',
  'agentfootprint.error.retried': 'fields',
  // eval.*
  'agentfootprint.eval.score': 'fields',
  'agentfootprint.eval.threshold_crossed': 'structure',
  // fallback.*
  'agentfootprint.fallback.triggered': 'shape',
  // findings.*
  'agentfootprint.findings.argument': 'structure',
  'agentfootprint.findings.contingent': 'structure',
  'agentfootprint.findings.declared': 'structure',
  'agentfootprint.findings.judge_failed': 'structure',
  'agentfootprint.findings.judged': 'structure',
  'agentfootprint.findings.negative_claim': 'structure',
  'agentfootprint.findings.period': 'structure',
  'agentfootprint.findings.standing': 'structure',
  // integrity.*
  'agentfootprint.integrity.context_error': 'shape',
  'agentfootprint.integrity.disposition': 'structure',
  'agentfootprint.integrity.external_ground_used': 'shape',
  // map.*
  'agentfootprint.map.engaged': 'shape',
  'agentfootprint.map.parked': 'shape',
  // memory.*
  'agentfootprint.memory.attached': 'fields',
  'agentfootprint.memory.detached': 'structure',
  'agentfootprint.memory.retrieved': 'shape',
  'agentfootprint.memory.strategy_applied': 'fields',
  'agentfootprint.memory.written': 'fields',
  // middleware.*
  'agentfootprint.middleware.decision': 'shape',
  // ontology.*
  'agentfootprint.ontology.served': 'structure',
  // pause.*
  'agentfootprint.pause.request': 'shape',
  'agentfootprint.pause.resume': 'fields',
  // permission.*
  'agentfootprint.permission.check': 'shape',
  // a reason word the app attaches to a lifecycle event it emits itself
  'agentfootprint.permission.gate_closed': 'structure',
  'agentfootprint.permission.gate_opened': 'structure',
  'agentfootprint.permission.halt': 'shape',
  // reliability.*
  'agentfootprint.reliability.fail_fast': 'shape',
  'agentfootprint.reliability.recovered': 'structure',
  'agentfootprint.reliability.retried': 'fields',
  // resilience.*
  'agentfootprint.resilience.output_canned_used': 'shape',
  'agentfootprint.resilience.output_fallback_triggered': 'shape',
  // skill.*
  'agentfootprint.skill.activated': 'structure',
  // a reason word the app attaches to a lifecycle event it emits itself
  'agentfootprint.skill.deactivated': 'structure',
  'agentfootprint.skill.escalated': 'structure',
  // the graph the app declared up front
  'agentfootprint.skill.graph_declared': 'structure',
  'agentfootprint.skill.rejected': 'structure',
  'agentfootprint.skill.reroute_superseded': 'structure',
  'agentfootprint.skill.route_conflict': 'structure',
  // the step note the app declared
  'agentfootprint.skill.step_advanced': 'structure',
  'agentfootprint.skill.step_skipped': 'shape',
  // the step notes the app declared
  'agentfootprint.skill.steps_unfinished': 'structure',
  'agentfootprint.skill.turn_routed': 'shape',
  // stream.*
  'agentfootprint.stream.llm_end': 'fields',
  'agentfootprint.stream.llm_start': 'shape',
  'agentfootprint.stream.thinking_delta': 'fields',
  'agentfootprint.stream.thinking_end': 'fields',
  'agentfootprint.stream.token': 'fields',
  'agentfootprint.stream.tool_end': 'fields',
  'agentfootprint.stream.tool_progress': 'shape',
  'agentfootprint.stream.tool_start': 'fields',
  // tool_choice.*
  'agentfootprint.tool_choice.failed': 'structure',
  'agentfootprint.tool_choice.outcome': 'structure',
  'agentfootprint.tool_choice.picked': 'structure',
  // tools.*
  'agentfootprint.tools.absent': 'shape',
  'agentfootprint.tools.activated': 'structure',
  'agentfootprint.tools.answered_off_wire': 'structure',
  'agentfootprint.tools.claim_swallowed': 'structure',
  'agentfootprint.tools.code_run': 'structure',
  'agentfootprint.tools.coverage_declared': 'shape',
  'agentfootprint.tools.deactivated': 'structure',
  'agentfootprint.tools.discovery_completed': 'structure',
  'agentfootprint.tools.discovery_failed': 'fields',
  'agentfootprint.tools.discovery_started': 'structure',
  'agentfootprint.tools.effect': 'shape',
  // a reason word the app attaches to a lifecycle event it emits itself
  'agentfootprint.tools.offered': 'structure',
  'agentfootprint.tools.repeated_call': 'structure',
  'agentfootprint.tools.request_attempts': 'structure',
  'agentfootprint.tools.result_refused': 'structure',
  'agentfootprint.tools.semantics_declared': 'shape',
  'agentfootprint.tools.session_close_failed': 'fields',
  // `label`: never user data, by its contract
  'agentfootprint.tools.session_closed': 'structure',
  // `label`: never user data, by its contract
  'agentfootprint.tools.session_reused': 'structure',
  // `label`: never user data, by its contract
  'agentfootprint.tools.session_started': 'structure',
  'agentfootprint.tools.shadowed': 'structure',
  // validation.*
  'agentfootprint.validation.args_invalid': 'shape',
} as const satisfies { readonly [T in EventType]-?: EventContent };

type ShapeEvent = {
  [T in EventType]: (typeof EVENT_CONTENT)[T] extends 'shape' ? T : never;
}[EventType];

/** One leaf's canary: the event's canary, then where the leaf sits. */
const leaf = (canary: string, at: string): string => `${canary}/${at}`;

/** A coverage item whose prose holds `canary`. */
const coverageItem = (canary: string, at: string) =>
  ({
    what: leaf(canary, `${at}[].what`),
    why: leaf(canary, `${at}[].why`),
    short: leaf(canary, `${at}[].short`),
    kind: 'scope',
  } as const);

/** A declared window whose instants hold `canary`. */
const window = (canary: string, at: string) => ({
  from: leaf(canary, `${at}.from`),
  to: leaf(canary, `${at}.to`),
});

/** What the library composed for a search tool: references and its own words — no canary. */
const COMPOSITION = {
  origin: 'local',
  resultId: 'claim-result/ns/run-1/1',
  complete: true,
  facets: [
    {
      facet: 'population',
      from: 'call',
      ref: { resultId: 'claim-result/ns/run-1/1', argument: 'region' },
      any: true,
    },
  ],
  gaps: [
    {
      kind: 'prose',
      what: 'orders placed by phone',
      why: 'the phone desk keeps its own book',
      bears: { filter: 'channel', values: ['phone'] },
      argument: 'channel',
    },
  ],
} as const;

/** A skill guard's evaluation: its declared conditions, and the engine's summary of
 *  the value it read (`actualSummary`, the canary — carried by contract). */
const guard = (canary: string, at: string) => ({
  from: 'triage',
  to: 'refunds',
  toolName: 'orders_search',
  toolCallId: 'call-1',
  verdict: true,
  conditions: [
    {
      key: 'status',
      op: 'eq',
      value: 'open',
      actualSummary: leaf(canary, `${at}.conditions[].actualSummary`),
      passed: true,
    },
  ],
});

/** Each `'shape'` event's payload: a canary in every content leaf, nowhere else. */
const CANARY_PAYLOAD: {
  readonly [T in ShapeEvent]-?: (canary: string) => DeepRequired<PayloadOf<T>>;
} = {
  'agentfootprint.agent.evidence_checked': (c) => ({
    iteration: 2,
    posture: 'guard',
    candidates: 4,
    lookedUp: 3,
    unsupported: [{ value: leaf(c, 'unsupported[].value'), shape: 'number' }],
    action: 'flagged',
    afterRevision: false,
    evidenceTruncated: false,
    carriedBy: [{ toolCallId: 'call-1', values: 2, only: 1 }],
    stagedRefs: [{ ref: 'artifact:rows-1', kind: 'dataset/rows' }],
    spenderTools: ['chart_rows'],
    computed: [
      {
        value: leaf(c, 'computed[].value'),
        shape: 'number',
        derivation: 'column-sum',
        from: leaf(c, 'computed[].from'),
      },
    ],
  }),
  'agentfootprint.agent.handoff': (c) => ({
    fromAgentId: 'triage',
    toAgentId: 'refunds',
    reason: leaf(c, 'reason'),
    viaProtocol: 'native',
  }),
  'agentfootprint.agent.output_schema_validation_failed': (c) => ({
    message: leaf(c, 'message'),
    stage: 'schema-validate',
    path: 'total',
    rawOutput: leaf(c, 'rawOutput'),
    draftWithheld: true,
    attempt: 1,
    cumulativeRetries: 1,
  }),
  'agentfootprint.artifacts.minted': (c) => ({
    ref: 'artifact:rows-1',
    kind: 'dataset/rows',
    mediaType: 'application/json',
    bytes: 512,
    label: leaf(c, 'label'),
    digest: 'sha-256:00ff',
    expiresAt: 1_700_000_000_000,
    origin: { runId: 'run-1', toolCallId: 'call-1' },
    parentRefs: ['artifact:rows-0'],
    timeAxis: {
      column: 'day',
      unit: 'iso',
      zone: 'Europe/London',
      interval: '1d',
      aggregate: 'raw',
    },
    tool: 'orders_search',
  }),
  'agentfootprint.artifacts.presented': (c) => ({
    ref: 'artifact:rows-1',
    as: 'table',
    snapshot: {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      bytes: 512,
      label: leaf(c, 'snapshot.label'),
    },
    toolCallId: 'call-1',
    iteration: 1,
  }),
  'agentfootprint.artifacts.refused': (c) => ({
    op: 'get',
    reason: 'missing-or-expired',
    ref: 'artifact:rows-9',
    detail: leaf(c, 'detail'),
    tool: 'chart_rows',
  }),
  'agentfootprint.checkin.decision': (c) => ({
    toolName: 'refund_order',
    toolCallId: 'call-2',
    iteration: 1,
    requestId: 'req-1',
    approved: true,
    by: 'approver-7',
    note: leaf(c, 'note'),
    componentId: 'approve-card',
  }),
  'agentfootprint.checkin.request': (c) => ({
    toolName: 'refund_order',
    toolCallId: 'call-2',
    iteration: 1,
    request: { question: leaf(c, 'request.question'), amount: leaf(c, 'request.amount') },
  }),
  'agentfootprint.composition.route_decided': (c) => ({
    conditionalId: 'router',
    chosen: 'refunds',
    rationale: "router chose 'refunds'",
    evidence: { reason: leaf(c, 'evidence.reason'), inRoster: true },
  }),
  'agentfootprint.context.evaluated': (c) => ({
    iteration: 1,
    activeCount: 1,
    skippedCount: 1,
    evaluatedTotal: 2,
    activeIds: ['refunds-skill'],
    skippedDetails: [
      { id: 'broken-rule', reason: 'predicate-threw', error: leaf(c, 'skippedDetails[].error') },
    ],
    triggerKindCounts: { rule: 1 },
    skillCatalog: [{ id: 'refunds', description: 'Refund an order.' }],
    routing: [
      {
        injectionId: 'refunds-skill',
        flavor: 'skill',
        via: 'route',
        path: [{ label: 'is a refund', branch: 'yes' }],
        label: 'refund route',
        from: 'triage',
        triggerKind: 'rule',
        tools: ['refund_order'],
      },
    ],
    cursorMove: {
      from: 'triage',
      to: 'refunds',
      by: 'entry',
      offered: ['refunds'],
      declinedOffer: false,
      witness: { text: leaf(c, 'cursorMove.witness.text'), keyword: 'refund' },
      guard: guard(c, 'cursorMove.guard'),
      guardsClosed: [guard(c, 'cursorMove.guardsClosed[]')],
      reachable: ['refunds'],
    },
    supersededIds: ['billing'],
  }),
  'agentfootprint.credential.failed': (c) => ({
    service: 'orders-api',
    reason: leaf(c, 'reason'),
    tool: 'orders_search',
    errorClass: 'TypeError',
    toolCallId: 'call-1',
    iteration: 1,
  }),
  'agentfootprint.fallback.triggered': (c) => ({
    kind: 'provider',
    primary: 'primary-llm',
    fallback: 'backup-llm',
    reason: leaf(c, 'reason'),
  }),
  'agentfootprint.integrity.context_error': (c) => ({
    kind: 'invariant-violation',
    seam: 'claim',
    subjects: [{ kind: 'tool', id: 'orders_search' }],
    witnesses: [
      {
        subject: { kind: 'tool', id: 'orders_search' },
        predicate: 'status',
        value: leaf(c, 'witnesses[].value'),
        epoch: 1,
        stratum: 'asserted',
        provenance: leaf(c, 'witnesses[].provenance'),
        runtimeStageId: 'stage#3',
        synthetic: true,
      },
    ],
    predicate: 'status',
    epoch: 1,
    synthetic: true,
    advisory: true,
    message: leaf(c, 'message'),
    iteration: 1,
  }),
  'agentfootprint.integrity.external_ground_used': (c) => ({
    toolName: 'orders_search',
    toolCallId: 'call-1',
    path: 'filters.region',
    value: leaf(c, 'value'),
    source: 'viewer-selection',
    iteration: 1,
  }),
  'agentfootprint.map.engaged': (c) => ({
    mapId: 'orders-map',
    iteration: 1,
    by: 'lexical',
    witness: leaf(c, 'witness'),
    reengaged: true,
    upgraded: true,
    foundedBy: 'lexical',
    tenantChanged: true,
    at: 'refunds',
  }),
  'agentfootprint.map.parked': (c) => ({
    mapId: 'orders-map',
    iteration: 3,
    by: 'lexical',
    idleCalls: 3,
    witness: leaf(c, 'witness'),
  }),
  'agentfootprint.memory.retrieved': (c) => ({
    strategy: 'top-k',
    queryHash: 'q-00ff',
    k: 3,
    threshold: 0.5,
    maxChars: 4_000,
    charsUsed: 1_200,
    embedderId: 'mock-embedder',
    dimensions: 8,
    consideredCount: 5,
    admittedCount: 3,
    rejectedCount: 2,
    candidates: [
      {
        id: 'doc-1#0',
        score: 0.9,
        rank: 1,
        admitted: false,
        reason: 'over-budget',
        docUri: 'kb://policies/refunds.md',
        page: 2,
        heading: leaf(c, 'candidates[].heading'),
      },
    ],
    candidatesComplete: true,
    candidatesOmittedReason: 'pool-limit',
    corpusEmpty: false,
    namespace: 'tenant-a',
  }),
  'agentfootprint.middleware.decision': (c) => ({
    middleware: 'pii-guard',
    moment: 'before-tool',
    at: 'tool',
    phase: 'input',
    toolName: 'refund_order',
    toolCallId: 'call-2',
    iteration: 1,
    outcome: 'ask',
    changed: false,
    why: leaf(c, 'why'),
    componentId: 'approve-card',
  }),
  'agentfootprint.pause.request': (c) => ({
    reason: leaf(c, 'reason'),
    questionPayload: { question: leaf(c, 'questionPayload.question') },
  }),
  'agentfootprint.permission.check': (c) => ({
    capability: 'tool_call',
    actor: 'agent',
    target: 'refund_order',
    result: 'deny',
    policyEngine: 'custom',
    policyRuleId: 'refund-limit',
    rationale: leaf(c, 'rationale'),
    reason: 'cost:refund-limit',
    toolCallId: 'call-2',
    iteration: 1,
  }),
  'agentfootprint.permission.halt': (c) => ({
    checkerId: 'sequence-guard',
    target: 'send_email',
    reason: 'security:exfiltration',
    tellLLM: leaf(c, 'tellLLM'),
    iteration: 2,
    sequenceLength: 2,
    toolCallId: 'call-3',
  }),
  'agentfootprint.reliability.fail_fast': (c) => ({
    phase: 'post-decide',
    kind: 'schema',
    attempt: 2,
    label: 'schema rule',
    reason: leaf(c, 'reason'),
    providerUsed: 'primary-llm',
    errorKind: 'schema',
    errorMessage: leaf(c, 'errorMessage'),
  }),
  'agentfootprint.resilience.output_canned_used': (c) => ({
    rawOutputPreview: leaf(c, 'rawOutputPreview'),
    fallbackErrorMessage: leaf(c, 'fallbackErrorMessage'),
    retriesSpent: 1,
  }),
  'agentfootprint.resilience.output_fallback_triggered': (c) => ({
    stage: 'json-parse',
    rawOutputPreview: leaf(c, 'rawOutputPreview'),
    primaryErrorMessage: leaf(c, 'primaryErrorMessage'),
    retriesSpent: 1,
  }),
  'agentfootprint.skill.step_skipped': (c) => ({
    skillId: 'refunds',
    step: { index: 1, total: 3, tool: 'refund_order', note: 'Refund the order.' },
    reason: leaf(c, 'reason'),
    policy: 'advance',
    iteration: 1,
    toolCallId: 'call-2',
  }),
  'agentfootprint.skill.turn_routed': (c) => ({
    by: 'entry',
    from: 'triage',
    to: 'refunds',
    scorer: 'keyword',
    scores: [{ id: 'refunds', score: 2, relevance: 0.8 }],
    runnerUp: { id: 'billing', gap: 0.4 },
    decisive: true,
    witness: { text: leaf(c, 'witness.text'), keyword: 'refund' },
    offered: ['refunds', 'billing'],
    stayOffered: false,
    policy: { nearTieMargin: 0.1, menuSize: 3, floor: 0.2 },
    window: 2,
    droppedResume: { id: 'old-skill', reason: 'unknown-skill' },
    decider: { provider: 'mock', model: 'mock-1', picked: 'refunds' },
  }),
  'agentfootprint.stream.llm_start': (c) => ({
    iteration: 1,
    provider: 'mock',
    model: 'mock-1',
    systemPromptChars: 120,
    systemPromptText: leaf(c, 'systemPromptText'),
    messagesCount: 2,
    toolsCount: 1,
    tools: [{ name: 'orders_search', description: 'Open orders for one region.' }],
    estimatedPromptTokens: 300,
    temperature: 0,
    providerRequestRef: 'req-00ff',
    brain: { via: 'skill', skillId: 'refunds' },
  }),
  'agentfootprint.stream.tool_progress': (c) => ({
    toolCallId: 'call-1',
    toolName: 'orders_search',
    iteration: 1,
    payload: { done: 3, note: leaf(c, 'payload.note') },
  }),
  'agentfootprint.tools.absent': (c) => ({
    toolName: 'orders_search',
    toolCallId: 'call-1',
    iteration: 1,
    lookedFor: leaf(c, 'lookedFor'),
    checked: [coverageItem(c, 'checked')],
    notChecked: [coverageItem(c, 'notChecked')],
    cannotCover: [coverageItem(c, 'cannotCover')],
    tryInstead: leaf(c, 'tryInstead'),
    // A tool this strategy never saw run: the name is the tool author's word.
    tryInsteadTool: { tool: leaf(c, 'tryInsteadTool.tool'), why: leaf(c, 'tryInsteadTool.why') },
    provenance: {
      measuredAt: leaf(c, 'provenance.measuredAt'),
      source: leaf(c, 'provenance.source'),
      ageSeconds: 30,
      sourceExportDate: leaf(c, 'provenance.sourceExportDate'),
    },
    period: {
      queried: window(c, 'period.queried'),
      held: window(c, 'period.held'),
      readAt: leaf(c, 'period.readAt'),
    },
    composition: COMPOSITION,
    lookedForRef: { resultId: 'claim-result/ns/run-1/1', field: 'lookedFor' },
  }),
  'agentfootprint.tools.coverage_declared': (c) => ({
    toolName: 'orders_search',
    toolCallId: 'call-1',
    iteration: 1,
    checked: [coverageItem(c, 'checked')],
    notChecked: [coverageItem(c, 'notChecked')],
    cannotCover: [coverageItem(c, 'cannotCover')],
    period: {
      queried: window(c, 'period.queried'),
      held: window(c, 'period.held'),
      readAt: leaf(c, 'period.readAt'),
    },
    inProgress: [
      {
        what: leaf(c, 'inProgress[].what'),
        why: leaf(c, 'inProgress[].why'),
        short: leaf(c, 'inProgress[].short'),
        count: 2,
      },
    ],
    composition: COMPOSITION,
  }),
  'agentfootprint.tools.effect': (c) => ({
    kind: 'propose-transition',
    outcome: 'refused',
    stay: true,
    toolName: 'orders_search',
    toolCallId: 'call-1',
    iteration: 1,
    targetSkillId: 'refunds',
    reason: leaf(c, 'reason'),
    instructionId: 'refund-policy',
    deliveryLease: 'next-call',
    refusalReason: "effect 1 (propose-transition → 'refunds') was refused.",
    supersededBy: 'earlier-proposal',
  }),
  'agentfootprint.tools.semantics_declared': (c) => ({
    toolName: 'orders_search',
    toolCallId: 'call-1',
    iteration: 1,
    semantics: {
      af_semantics: true,
      series: [
        {
          t: leaf(c, 'semantics.series[].t'),
          entity: leaf(c, 'semantics.series[].entity'),
          metric: 'open_orders',
          value: leaf(c, 'semantics.series[].value'),
        },
      ],
      facts: [
        {
          entity: leaf(c, 'semantics.facts[].entity'),
          region: leaf(c, 'semantics.facts[].region'),
        },
      ],
      edges: [
        {
          from: leaf(c, 'semantics.edges[].from'),
          to: leaf(c, 'semantics.edges[].to'),
          kind: 'ships_to',
          weight: leaf(c, 'semantics.edges[].weight'),
        },
      ],
      grain: {
        interval: '1h',
        aggregation: 'sum',
        is_counter: false,
        collapsed: leaf(c, 'semantics.grain.collapsed'),
      },
      provenance: {
        measured_at: leaf(c, 'semantics.provenance.measured_at'),
        age_seconds: 30,
        source: leaf(c, 'semantics.provenance.source'),
        source_export_date: leaf(c, 'semantics.provenance.source_export_date'),
      },
      period: {
        queried: window(c, 'semantics.period.queried'),
        held: window(c, 'semantics.period.held'),
        read_at: leaf(c, 'semantics.period.read_at'),
      },
      resolved: [
        {
          argument: 'customer',
          id: leaf(c, 'semantics.resolved[].id'),
          name: leaf(c, 'semantics.resolved[].name'),
          aliases: [leaf(c, 'semantics.resolved[].aliases[]')],
        },
      ],
      paging: { next: leaf(c, 'semantics.paging.next') },
      coverage: {
        checked: [coverageItem(c, 'semantics.coverage.checked')],
        not_checked: [coverageItem(c, 'semantics.coverage.not_checked')],
        cannot_cover: [coverageItem(c, 'semantics.coverage.cannot_cover')],
      },
      not_covered: [leaf(c, 'semantics.not_covered[]')],
      clarify: {
        question: leaf(c, 'semantics.clarify.question'),
        candidates: [leaf(c, 'semantics.clarify.candidates[]')],
      },
      render: {
        default: 'table',
        columns: ['region', 'open_orders'],
        sort: 'open_orders desc',
        filter_note: leaf(c, 'semantics.render.filter_note'),
        chart_hint: leaf(c, 'semantics.render.chart_hint'),
      },
      note: 'Values as the tool read them; nothing here was computed by the model.',
    },
  }),
  'agentfootprint.validation.args_invalid': (c) => ({
    toolName: 'orders_search',
    toolCallId: 'call-1',
    iteration: 1,
    issues: [
      {
        path: 'region',
        expected: 'string matching ^[A-Z]{2}$',
        got: 'string',
        value: leaf(c, 'issues[].value'),
        hint: 'Two-letter region code.',
      },
    ],
    enforced: true,
  }),
};

const SHAPE_EVENTS = Object.keys(CANARY_PAYLOAD) as ShapeEvent[];
const canaryOf = (type: EventType): string => `CANARY-${type.slice('agentfootprint.'.length)}-7f3a`;

/** The guard summaries: the engine's decision evidence, carried by contract. */
const GUARD_EVIDENCE = [
  leaf(canaryOf('agentfootprint.context.evaluated'), 'cursorMove.guard.conditions[].actualSummary'),
  leaf(
    canaryOf('agentfootprint.context.evaluated'),
    'cursorMove.guardsClosed[].conditions[].actualSummary',
  ),
];

/** The fields each shape writes as `'[keys: …]'` — a free-form record: its key names, never its values. */
const RECORD_FIELDS: Partial<Readonly<Record<ShapeEvent, readonly string[]>>> = {
  'agentfootprint.stream.tool_progress': ['payload'],
  'agentfootprint.checkin.request': ['request'],
  'agentfootprint.pause.request': ['questionPayload'],
  'agentfootprint.composition.route_decided': ['evidence'],
};

/** Every leaf canary in `value`. */
function leavesOf(value: unknown): string[] {
  return [...new Set(JSON.stringify(value).match(/CANARY-[a-z_.]+-7f3a\/[^"]*/g) ?? [])];
}

/** The oracle: `payload` with every canary leaf its `'[N chars]'` marker, every free-form record its `'[keys: …]'`. */
function expectedBounded(type: ShapeEvent, payload: Record<string, unknown>): unknown {
  const mark = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.includes('-7f3a/') && !GUARD_EVIDENCE.includes(value)
        ? `[${value.length} chars]`
        : value;
    if (Array.isArray(value)) return value.map(mark);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mark(v)]));
    }
    return value;
  };
  const records = new Set(RECORD_FIELDS[type] ?? []);
  return Object.fromEntries(
    Object.entries(payload).map(([field, value]) => [
      field,
      records.has(field) ? `[keys: ${Object.keys(value as object).join(', ')}]` : mark(value),
    ]),
  );
}

let clock = 1_000;
function event(type: string, payload: unknown): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: clock++,
      runOffsetMs: 0,
      runtimeStageId: 'stage#1',
      subflowPath: [],
      compositionPath: [],
      runId: 'run-events-1',
    },
  } as unknown as AgentfootprintEvent;
}

/** One turn carrying every `'shape'` event, each with its own canary. */
function oneTurn(): readonly AgentfootprintEvent[] {
  return [
    event('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'orders?' }),
    event('agentfootprint.stream.tool_start', {
      toolName: 'orders_search',
      toolCallId: 'call-1',
      args: {},
    }),
    ...SHAPE_EVENTS.map((type) => event(type, CANARY_PAYLOAD[type](canaryOf(type)))),
    event('agentfootprint.stream.tool_end', { toolCallId: 'call-1', result: 'done' }),
    event('agentfootprint.agent.turn_end', {
      turnIndex: 0,
      finalContent: 'done',
      totalInputTokens: 1,
      totalOutputTokens: 1,
      iterationCount: 1,
      durationMs: 1,
    }),
  ];
}

function tracer(spans: unknown[]): OtelTracerLike {
  return {
    startSpan(name, options) {
      const span = {
        name,
        attributes: { ...(options?.attributes ?? {}) } as Record<string, OtelAttributeValue>,
        events: [] as unknown[],
      };
      spans.push(span);
      return {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
          return undefined;
        },
        setStatus: () => undefined,
        end: () => undefined,
        spanContext: () => ({ traceId: 't', spanId: `s${spans.length}`, traceFlags: 1 }),
        addEvent: (eventName, attributes) => {
          span.events.push({ name: eventName, attributes });
          return undefined;
        },
      };
    },
  };
}

/**
 * OpenTelemetry's own mapping exports a permission check's `rationale` and a
 * credential failure's `reason` by default (`otel.ts` · the `permission.check`
 * and `credential.*` cases). The audit chain bounds both as content; the span
 * exporter is unchanged here, and the difference is named for its own review.
 */
const OTEL_DEFAULT_CARRIES: readonly string[] = [
  leaf(canaryOf('agentfootprint.permission.check'), 'rationale'),
  leaf(canaryOf('agentfootprint.credential.failed'), 'reason'),
];
/** `captureContent` adds the evidence gate's unsupported values — its documented content. */
const OTEL_CONTENT_CARRIES: readonly string[] = [
  ...OTEL_DEFAULT_CARRIES,
  leaf(canaryOf('agentfootprint.agent.evidence_checked'), 'unsupported[].value'),
];

interface Exporter {
  readonly name: string;
  /** The content leaves its output carries — each with the contract that lets it. */
  readonly carries: readonly string[];
  /** Everything it wrote for the turn, as one string. */
  readonly output: (events: readonly AgentfootprintEvent[]) => Promise<string>;
}

const EXPORTERS: readonly Exporter[] = [
  {
    name: 'audit chain (bounded)',
    // A skill guard's conditions are decision evidence, which the chain keeps
    // as the engine summarized it (audit.ts module doc).
    carries: GUARD_EVIDENCE,
    output: async (events) => {
      const audit = auditExport();
      for (const e of events) audit.exportEvent(e);
      return JSON.stringify(audit.bundle());
    },
  },
  {
    name: 'OpenTelemetry',
    carries: OTEL_DEFAULT_CARRIES,
    output: async (events) => {
      const spans: unknown[] = [];
      const strategy = otelObservability({ serviceName: 'svc', tracer: tracer(spans) });
      for (const e of events) strategy.exportEvent(e);
      return JSON.stringify(spans);
    },
  },
  {
    name: 'OpenTelemetry (captureContent)',
    carries: OTEL_CONTENT_CARRIES,
    output: async (events) => {
      const spans: unknown[] = [];
      const strategy = otelObservability({
        serviceName: 'svc',
        tracer: tracer(spans),
        captureContent: true,
      });
      for (const e of events) strategy.exportEvent(e);
      return JSON.stringify(spans);
    },
  },
  {
    name: 'X-Ray',
    carries: [],
    output: async (events) => {
      const documents: string[] = [];
      const strategy = xrayObservability({
        serviceName: 'svc',
        flushIntervalMs: 0,
        _client: {
          putTraceSegments: async (input) => {
            documents.push(...(input as { TraceSegmentDocuments: string[] }).TraceSegmentDocuments);
          },
        },
      });
      for (const e of events) strategy.exportEvent(e);
      await strategy.flush?.();
      return documents.join('\n');
    },
  },
  {
    name: 'AG-UI serializer',
    // None of these events is on the default CUSTOM allow-list.
    carries: [],
    output: async (events) => {
      const serializer = agUiSerializer({ threadId: 'thread-1', runId: 'ag-run' });
      const out = events.flatMap((e) => serializer.event(e));
      return JSON.stringify([...out, ...serializer.settle({ kind: 'finished' })]);
    },
  },
  {
    name: 'bug-report transcript',
    carries: [],
    output: async (events) => JSON.stringify(deriveTranscript(events) ?? null),
  },
];

describe('every event is classified, and its content reaches an exporter only where declared', () => {
  it('the shapes the audit chain bounds are exactly the events classified as shape', () => {
    expect(Object.keys(eventShapes(() => false)).sort()).toEqual(
      Object.entries(EVENT_CONTENT)
        .filter(([, kind]) => kind === 'shape')
        .map(([type]) => type)
        .sort(),
    );
  });

  it.each(SHAPE_EVENTS.map((type) => [type] as const))(
    '%s: the canary fills its content leaves',
    (type) => {
      // The fixture really carries content: at least one leaf canary.
      expect(leavesOf(CANARY_PAYLOAD[type](canaryOf(type))).length).toBeGreaterThan(0);
    },
  );

  it.each(EXPORTERS.map((exporter) => [exporter.name, exporter] as const))(
    '%s',
    async (_name, exporter) => {
      const output = await exporter.output(oneTurn());
      expect(output.length).toBeGreaterThan(20);
      const all = SHAPE_EVENTS.flatMap((type) => leavesOf(CANARY_PAYLOAD[type](canaryOf(type))));
      const carried = all.filter((canary) => output.includes(canary));
      expect(carried.sort()).toEqual([...exporter.carries].sort());
    },
  );

  it.each(SHAPE_EVENTS.map((type) => [type] as const))(
    '%s: the audit chain keeps every record leaf and bounds every content leaf',
    (type) => {
      const audit = auditExport();
      const payload = CANARY_PAYLOAD[type](canaryOf(type)) as Record<string, unknown>;
      audit.exportEvent(event(type, payload));
      const record = audit.bundle().records.find((r) => r.eventType === type);
      expect(record?.payload).toEqual(expectedBounded(type, payload));
    },
  );

  it('a tryInsteadTool name rides only once this strategy has seen that tool run', () => {
    const audit = auditExport();
    const absent = (toolCallId: string) =>
      event('agentfootprint.tools.absent', {
        toolName: 'orders_search',
        toolCallId,
        iteration: 1,
        checked: [{ what: 'every open order' }],
        tryInsteadTool: { tool: 'archive_search' },
      });
    /** One `archive_search` call: its start, then its end as `end` says. */
    const call = (toolCallId: string, end: Record<string, unknown>, start = {}) => [
      event('agentfootprint.stream.tool_start', {
        toolName: 'archive_search',
        toolCallId,
        args: {},
        ...start,
      }),
      event('agentfootprint.stream.tool_end', { toolCallId, result: 'rows', ...end }),
    ];
    const settled = {
      notDispatched: { pausedCall: { toolCallId: 'p', toolName: 'archive_search' } },
    };
    for (const e of [
      absent('a1'), // never seen
      ...call('c1', { error: 'EDGE-FAILED' }), // failed: not a tool it holds
      absent('a2'),
      ...call('c2', { notExecuted: true }), // refused before it ran
      absent('a3'),
      ...call('c3', settled, settled), // a paused batch never dispatched it
      absent('a4'),
      ...call('c4', {}), // ran and returned
      absent('a5'),
    ])
      audit.exportEvent(e);
    const suggested = audit
      .bundle()
      .records.filter((r) => r.eventType === 'agentfootprint.tools.absent')
      .map((r) => (r.payload as { tryInsteadTool?: { tool?: unknown } }).tryInsteadTool?.tool);
    expect(suggested).toEqual([
      '[14 chars]',
      '[14 chars]',
      '[14 chars]',
      '[14 chars]',
      'archive_search',
    ]);
  });
});
