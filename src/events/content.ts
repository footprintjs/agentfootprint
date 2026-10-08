/**
 * content — what every typed event carries, declared ONCE per event type, from
 * the one event registry: which top-level payload fields are the record's
 * STRUCTURE, and which words it quotes under names of its own, with the values
 * those words come from.
 *
 * Pattern: a classification table, exhaustive by type over
 *          `AgentfootprintEventType` (the HOOKS-registry precedent): a new event
 *          type does not compile until it is classified here.
 * Role:    the data the served path reads (`redaction/served.ts`). It decides
 *          nothing about what is secret — footprintjs's rule does — it says
 *          what each event IS, so the served path can be DEFAULT-DENY:
 *
 *   - `structure` — the record's skeleton: ids, counts, sizes, timings, kinds
 *     and verdict words, the names code declared (a tool's, a skill's, a
 *     slot's), the library's own refs and configuration. Kept readable under
 *     any policy (footprintjs's by-name rule still applies inside them).
 *   - `words` — content carried under a name of its own, with the values it
 *     is derived from (a parser's message quotes the model's draft): kept out
 *     whenever the rule keeps out any part of one of them — under ANY policy.
 *   - every other top-level field — CONTENT BY DEFAULT: under a policy that
 *     keeps the conversation out (`conversationRedaction()` or more), served
 *     as the placeholder. A field nobody classified can never carry the
 *     conversation into a record.
 *
 * A field is declared structure only when it cannot carry what a person, the
 * model or a tool wrote: free text is never structure, however the library
 * composes it today. Checked against real runs: under the vocabulary no
 * canary of any feature reaches a record (`test/redaction/agent-redaction
 * .vocabulary.test.ts`), so a structure field that carried one fails there.
 */

import type { AgentfootprintEventMap, AgentfootprintEventType } from './registry.js';

/** Content an event carries under a name of its own, and the values it is derived from. */
export interface EventWords {
  /** Where it sits in the payload: dotted, `name[]` for each element of a list. */
  readonly paths: readonly string[];
  /** The names it is derived from: kept out whenever the rule keeps out any part of one. */
  readonly from: readonly string[];
  /**
   * A field beside the value that NAMES the argument it quotes (a validation
   * issue's `path`, `'customer.ssn'`): the value is kept out too when the rule
   * would keep out a value at that path of a call's arguments.
   */
  readonly namedBy?: string;
  /**
   * A path, from the payload's root, to the object the value was RENDERED from
   * (a check-in's `willDo` writes the call's arguments as `k=v` text): the
   * value is kept out too whenever the rule kept out anything inside it.
   */
  readonly namesAt?: string;
}

/** The payload of event type `K`. */
type PayloadOf<K extends AgentfootprintEventType> = AgentfootprintEventMap[K]['payload'];

/** One event type's classification — its structure names checked against its payload's own fields. */
export interface EventContent<K extends AgentfootprintEventType = AgentfootprintEventType> {
  /** Top-level payload fields that carry no content — every other field is content by default. */
  readonly structure: readonly (keyof PayloadOf<K> & string)[];
  /** Words carried under names of their own, kept out with what they come from. */
  readonly words?: readonly EventWords[];
}

/** The words a person or the model wrote, wherever the library quotes them. */
const CONVERSATION_TEXT = ['userMessage', 'message', 'history'] as const;
const MODEL_TEXT = ['llmLatestContent', 'finalContent', 'content'] as const;

/**
 * The words of a coverage declaration's lists at `at` (`''` = the payload's
 * root) — prose a tool composes at run time, often from its call's arguments
 * and its result. The lists, their length and each item's `kind` are structure.
 */
function coverageWords(at: string, lists: readonly string[]): readonly string[] {
  const prefix = at === '' ? '' : `${at}.`;
  return lists.flatMap((list) =>
    ['what', 'why', 'short'].map((field) => `${prefix}${list}[].${field}`),
  );
}

const COVERAGE_LISTS = ['checked', 'notChecked', 'cannotCover'] as const;

/** A check-in's evidence pack (`core/checkin.ts` · `CheckInRequest`) at `at` in a payload. */
function checkInPack(at: string): readonly EventWords[] {
  return [
    { paths: [`${at}.intent`], from: MODEL_TEXT },
    { paths: [`${at}.evidence.willDo`], from: ['args'], namesAt: `${at}.args` },
    {
      paths: [`${at}.evidence.read[].summary`, `${at}.evidence.drivers[].text`],
      from: [...CONVERSATION_TEXT, 'result'],
    },
  ];
}

/** A tool call's identity, as most tool events carry it. */
const CALL = ['toolName', 'toolCallId', 'iteration'] as const;
/** A tool session's base fields (`ToolSessionPayloadBase`). */
const SESSION = ['tool', 'scope', 'keyHash', 'runnerId'] as const;

/**
 * Every event type, classified. `Object.freeze`d data, read by the served path
 * only — never a registry of runs, values or listeners.
 */
export const EVENT_CONTENT: { readonly [K in AgentfootprintEventType]: EventContent<K> } = {
  // ── composition ────────────────────────────────────────────────────────
  'agentfootprint.composition.enter': { structure: ['kind', 'id', 'name', 'childCount'] },
  'agentfootprint.composition.exit': {
    structure: ['kind', 'id', 'name', 'status', 'durationMs'],
  },
  'agentfootprint.composition.fork_start': { structure: ['parentId', 'branches'] },
  'agentfootprint.composition.branch_complete': {
    structure: ['parentId', 'branchId', 'status', 'durationMs'],
  },
  'agentfootprint.composition.merge_end': {
    structure: ['parentId', 'strategy', 'mergedBranchCount', 'totalBranchCount'],
  },
  'agentfootprint.composition.route_decided': { structure: ['conditionalId', 'chosen'] },
  'agentfootprint.composition.iteration_start': { structure: ['loopId', 'iteration'] },
  'agentfootprint.composition.iteration_exit': { structure: ['loopId', 'iteration', 'reason'] },

  // ── agent ──────────────────────────────────────────────────────────────
  'agentfootprint.agent.turn_start': { structure: ['turnIndex'] },
  'agentfootprint.agent.turn_end': {
    structure: [
      'turnIndex',
      'totalInputTokens',
      'totalOutputTokens',
      'iterationCount',
      'durationMs',
      'stoppedEarly',
      'answerAssessment',
      'refused',
    ],
    words: [
      { paths: ['answerCoverage.assumed[].value'], from: ['args'], namedBy: 'argument' },
      { paths: coverageWords('answerCoverage', COVERAGE_LISTS), from: ['args', 'result'] },
    ],
  },
  'agentfootprint.agent.iteration_start': { structure: ['turnIndex', 'iterIndex'] },
  'agentfootprint.agent.iteration_end': { structure: ['turnIndex', 'iterIndex', 'toolCallCount'] },
  'agentfootprint.agent.route_decided': { structure: ['turnIndex', 'iterIndex', 'chosen'] },
  'agentfootprint.agent.handoff': { structure: ['fromAgentId', 'toAgentId', 'viaProtocol'] },
  'agentfootprint.agent.output_schema_validation_failed': {
    structure: ['stage', 'path', 'draftWithheld', 'attempt', 'cumulativeRetries'],
    words: [{ paths: ['message'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.output_contract_unmet': {
    structure: ['stage', 'path', 'attempts', 'retriesSpent', 'fallbackConfigured', 'iteration'],
    words: [{ paths: ['error'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.output_schema_retry': {
    structure: [
      'attempt',
      'retriesRemaining',
      'iteration',
      'stage',
      'path',
      'correctiveMessageHash',
    ],
    words: [{ paths: ['error'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.evidence_checked': {
    structure: [
      'iteration',
      'posture',
      'candidates',
      'lookedUp',
      'action',
      'afterRevision',
      'evidenceTruncated',
      'carriedBy',
      'stagedRefs',
      'spenderTools',
      'computed',
    ],
    words: [{ paths: ['computed[].value', 'computed[].from'], from: [...MODEL_TEXT, 'result'] }],
  },
  'agentfootprint.agent.grounding_nudged': {
    structure: ['iteration', 'refs', 'refsOmitted', 'tools'],
  },
  'agentfootprint.agent.run_configured': {
    structure: [
      'agentId',
      'llm',
      'reactMode',
      'memories',
      'window',
      'skillGraph',
      'evidenceGate',
      'artifacts',
      'recipes',
    ],
  },
  'agentfootprint.agent.thinking_parse_failed': {
    structure: ['providerName', 'subflowId', 'errorName', 'iteration'],
  },
  'agentfootprint.agent.budget_exhausted': {
    structure: ['reason', 'iteration', 'limit', 'pendingToolCalls', 'action'],
  },

  // ── stream ─────────────────────────────────────────────────────────────
  'agentfootprint.stream.llm_start': {
    structure: [
      'iteration',
      'provider',
      'model',
      'systemPromptChars',
      'messagesCount',
      'toolsCount',
      'tools',
      'estimatedPromptTokens',
      'temperature',
      'providerRequestRef',
      'brain',
    ],
  },
  'agentfootprint.stream.llm_end': {
    structure: [
      'iteration',
      'contentWithheld',
      'toolCallCount',
      'usage',
      'stopReason',
      'durationMs',
      'providerResponseRef',
    ],
  },
  'agentfootprint.stream.token': { structure: ['iteration', 'tokenIndex'] },
  'agentfootprint.stream.tool_start': {
    structure: ['toolName', 'toolCallId', 'parallelCount', 'protocol', 'notDispatched'],
  },
  'agentfootprint.stream.tool_progress': {
    structure: [...CALL],
    words: [{ paths: ['payload'], from: ['result'] }],
  },
  'agentfootprint.stream.tool_end': {
    structure: [
      'toolCallId',
      'error',
      'durationMs',
      'status',
      'notDispatched',
      'changedArgKeys',
      'notExecuted',
    ],
  },
  'agentfootprint.stream.thinking_delta': { structure: ['iteration', 'tokenIndex'] },
  'agentfootprint.stream.thinking_end': {
    structure: ['iteration', 'blockCount', 'totalChars', 'tokens'],
  },

  // ── context ────────────────────────────────────────────────────────────
  'agentfootprint.context.injected': {
    structure: [
      'contentHash',
      'slot',
      'asRole',
      'asRecency',
      'position',
      'sectionTag',
      'source',
      'sourceId',
      'upstreamRef',
      'retrievalScore',
      'rankPosition',
      'threshold',
      'budgetSpent',
      'expiresAfter',
    ],
  },
  'agentfootprint.context.evicted': {
    structure: ['slot', 'contentHash', 'reason', 'survivalMs'],
  },
  'agentfootprint.context.slot_composed': {
    structure: [
      'slot',
      'iteration',
      'budget',
      'sourceBreakdown',
      'orderingStrategy',
      'droppedCount',
    ],
  },
  'agentfootprint.context.budget_pressure': {
    structure: ['slot', 'overflowBy', 'planAction', 'unit', 'cap', 'projected'],
  },
  'agentfootprint.context.evaluated': {
    structure: [
      'iteration',
      'activeCount',
      'skippedCount',
      'evaluatedTotal',
      'activeIds',
      'skippedDetails',
      'triggerKindCounts',
      'skillCatalog',
      'routing',
      'cursorMove',
      'supersededIds',
    ],
    words: [
      { paths: ['cursorMove.witness.text'], from: CONVERSATION_TEXT },
      {
        paths: [
          'cursorMove.guard.conditions[].actualSummary',
          'cursorMove.guardsClosed[].conditions[].actualSummary',
        ],
        from: ['result'],
      },
    ],
  },

  // ── memory ─────────────────────────────────────────────────────────────
  'agentfootprint.memory.strategy_applied': {
    structure: [
      'strategyId',
      'strategyKind',
      'inputMemoryCount',
      'outputMemoryCount',
      'droppedIds',
      'addedIds',
    ],
  },
  'agentfootprint.memory.attached': {
    structure: ['memoryId', 'score', 'rank', 'source', 'retriever'],
  },
  'agentfootprint.memory.retrieved': {
    structure: [
      'strategy',
      'queryHash',
      'k',
      'threshold',
      'maxChars',
      'charsUsed',
      'embedderId',
      'dimensions',
      'consideredCount',
      'admittedCount',
      'rejectedCount',
      'candidates',
      'candidatesComplete',
      'corpusEmpty',
    ],
    words: [{ paths: ['candidates[].heading'], from: ['retrieved'] }],
  },
  'agentfootprint.memory.detached': { structure: ['memoryId', 'reason'] },
  'agentfootprint.memory.written': { structure: ['memoryId', 'source'] },

  // ── tools ──────────────────────────────────────────────────────────────
  'agentfootprint.tools.offered': { structure: ['availableIds', 'withheldIds', 'withheldReasons'] },
  'agentfootprint.tools.activated': { structure: ['toolId', 'reason', 'source'] },
  'agentfootprint.tools.deactivated': { structure: ['toolId', 'reason'] },
  'agentfootprint.tools.discovery_started': { structure: ['providerId', 'iteration'] },
  'agentfootprint.tools.discovery_completed': {
    structure: ['providerId', 'iteration', 'durationMs', 'toolCount'],
  },
  'agentfootprint.tools.discovery_failed': {
    structure: ['providerId', 'errorName', 'iteration', 'durationMs'],
  },
  'agentfootprint.tools.shadowed': {
    structure: [
      'toolName',
      'iteration',
      'schemaFrom',
      'schemaFromId',
      'dispatchTo',
      'dispatchToId',
    ],
  },
  'agentfootprint.tools.claim_swallowed': {
    structure: ['toolName', 'iteration', 'lostBy', 'lostById', 'wonBy', 'wonById'],
  },
  'agentfootprint.tools.answered_off_wire': {
    structure: [...CALL, 'answeredBy', 'answeredById'],
  },
  'agentfootprint.tools.session_started': { structure: [...SESSION] },
  'agentfootprint.tools.session_reused': { structure: [...SESSION, 'calls'] },
  'agentfootprint.tools.session_closed': { structure: [...SESSION, 'reason', 'durationMs'] },
  'agentfootprint.tools.session_close_failed': {
    structure: [...SESSION, 'reason', 'durationMs', 'errorClass'],
  },
  'agentfootprint.tools.effect': {
    structure: [
      'kind',
      'outcome',
      'stay',
      ...CALL,
      'targetSkillId',
      'instructionId',
      'deliveryLease',
      'supersededBy',
    ],
    words: [{ paths: ['reason', 'refusalReason'], from: ['args', 'result'] }],
  },
  'agentfootprint.tools.result_refused': {
    structure: [...CALL, 'sizeChars', 'maxChars', 'narrowBy', 'declaredStatus'],
  },
  'agentfootprint.tools.repeated_call': {
    structure: [...CALL, 'occurrences', 'argsFingerprint', 'resultFingerprint', 'mode'],
  },
  'agentfootprint.tools.absent': {
    structure: [...CALL, ...COVERAGE_LISTS, 'tryInsteadTool', 'provenance', 'period'],
    words: [
      {
        paths: [
          'lookedFor',
          'tryInstead',
          'tryInsteadTool.why',
          ...coverageWords('', COVERAGE_LISTS),
        ],
        from: ['args', 'result'],
      },
    ],
  },
  'agentfootprint.tools.code_run': {
    structure: ['tool', 'language', 'stagedInputs', 'outputChars', 'truncated', 'ok', 'shapeHash'],
  },
  'agentfootprint.tools.coverage_declared': {
    structure: [...CALL, ...COVERAGE_LISTS, 'period', 'inProgress'],
    words: [
      { paths: coverageWords('', [...COVERAGE_LISTS, 'inProgress']), from: ['args', 'result'] },
    ],
  },
  'agentfootprint.tools.semantics_declared': {
    structure: [...CALL, 'semantics'],
    words: [
      {
        paths: [
          'semantics.facts',
          'semantics.series',
          'semantics.edges',
          'semantics.clarify.candidates',
        ],
        from: ['result'],
      },
      {
        paths: [
          'semantics.clarify.question',
          'semantics.not_covered',
          ...coverageWords('semantics.coverage', ['checked', 'not_checked', 'cannot_cover']),
          'semantics.render.filter_note',
          'semantics.render.chart_hint',
          'semantics.render.columns',
          'semantics.render.sort',
          'semantics.grain.collapsed',
        ],
        from: ['args', 'result'],
      },
    ],
  },

  // ── skill ──────────────────────────────────────────────────────────────
  'agentfootprint.skill.activated': {
    structure: ['skillId', 'reason', 'injectedTools', 'injectedSystemPromptChars'],
  },
  'agentfootprint.skill.graph_declared': { structure: ['nodes', 'edges'] },
  'agentfootprint.skill.deactivated': { structure: ['skillId'] },
  'agentfootprint.skill.rejected': {
    structure: ['requestedId', 'currentSkillId', 'allowed', 'iteration', 'posture', 'reason'],
  },
  'agentfootprint.skill.reroute_superseded': {
    structure: ['volunteeredId', 'wonId', 'fromSkillId', 'iteration', 'source'],
  },
  'agentfootprint.skill.route_conflict': {
    structure: ['iteration', 'fromSkillId', 'winner', 'losers', 'source'],
  },
  'agentfootprint.skill.turn_routed': {
    structure: [
      'by',
      'from',
      'to',
      'scorer',
      'scores',
      'runnerUp',
      'decisive',
      'witness',
      'offered',
      'stayOffered',
      'policy',
      'window',
      'droppedResume',
      'decider',
    ],
    words: [{ paths: ['witness.text'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.skill.step_advanced': {
    structure: ['skillId', 'step', 'iteration', 'toolCallId', 'completed'],
  },
  'agentfootprint.skill.step_skipped': {
    structure: ['skillId', 'step', 'policy', 'iteration', 'toolCallId'],
    words: [{ paths: ['reason'], from: ['args'] }],
  },
  'agentfootprint.skill.steps_unfinished': {
    structure: ['skillId', 'remaining', 'total', 'action', 'iteration'],
  },
  'agentfootprint.skill.escalated': {
    structure: ['iteration', 'afterRefusals', 'refusals', 'from', 'to'],
  },

  // ── governance ─────────────────────────────────────────────────────────
  'agentfootprint.validation.args_invalid': {
    structure: [...CALL, 'issues', 'enforced'],
    words: [{ paths: ['issues[].value'], from: ['args'], namedBy: 'path' }],
  },
  'agentfootprint.permission.check': {
    structure: ['capability', 'target', 'policyEngine', 'policyRuleId'],
    words: [{ paths: ['rationale', 'reason'], from: ['args', 'result', ...CONVERSATION_TEXT] }],
  },
  'agentfootprint.permission.gate_opened': { structure: ['gateId', 'expiresAt'] },
  'agentfootprint.permission.gate_closed': { structure: ['gateId'] },
  'agentfootprint.permission.halt': {
    structure: ['checkerId', 'target', 'iteration', 'sequenceLength'],
  },
  'agentfootprint.credential.requested': { structure: ['service', 'mode'] },
  'agentfootprint.credential.acquired': { structure: ['service', 'kind', 'expiresAt'] },
  'agentfootprint.credential.authorization_required': { structure: ['service', 'sessionId'] },
  'agentfootprint.credential.failed': { structure: ['service', 'tool', 'errorClass'] },
  'agentfootprint.risk.flagged': { structure: ['severity', 'category', 'detector', 'action'] },
  'agentfootprint.fallback.triggered': { structure: ['kind', 'primary', 'fallback'] },

  // ── cost, eval, errors ─────────────────────────────────────────────────
  'agentfootprint.cost.tick': {
    structure: [
      'scope',
      'model',
      'provider',
      'tokensInput',
      'tokensOutput',
      'estimatedUsd',
      'cumulative',
    ],
  },
  'agentfootprint.cost.limit_hit': { structure: ['kind', 'limit', 'actual', 'action'] },
  'agentfootprint.eval.score': {
    structure: ['metricId', 'value', 'threshold', 'target', 'targetRef', 'evaluator'],
  },
  'agentfootprint.eval.threshold_crossed': {
    structure: ['metricId', 'direction', 'value', 'threshold'],
  },
  'agentfootprint.error.retried': {
    structure: ['attempt', 'maxAttempts', 'backoffMs', 'statedWaitMs'],
  },
  'agentfootprint.error.recovered': { structure: ['attempt', 'totalDurationMs'] },
  'agentfootprint.error.fatal': { structure: ['stage', 'scope'] },
  'agentfootprint.error.circuit_changed': { structure: ['state', 'providerName'] },
  'agentfootprint.reliability.fail_fast': {
    structure: ['phase', 'kind', 'attempt', 'providerUsed', 'errorKind'],
    words: [{ paths: ['errorMessage'], from: ['rawOutput'] }],
  },
  'agentfootprint.reliability.retried': {
    structure: ['attempt', 'action', 'errorKind', 'fromProvider', 'toProvider'],
  },
  'agentfootprint.reliability.recovered': {
    structure: ['attempt', 'recoveredVia', 'priorFailures', 'errorKind'],
  },
  'agentfootprint.resilience.output_fallback_triggered': {
    structure: ['stage', 'retriesSpent'],
    words: [{ paths: ['primaryErrorMessage'], from: ['rawOutput'] }],
  },
  'agentfootprint.resilience.output_canned_used': {
    structure: ['retriesSpent'],
    words: [{ paths: ['fallbackErrorMessage'], from: ['rawOutput'] }],
  },

  // ── pause, check-in, middleware ────────────────────────────────────────
  'agentfootprint.pause.request': {
    structure: [],
    words: [
      ...checkInPack('questionPayload.checkIn'),
      // The library's own copy of the pause payload's reason (`RunnerBase · emitPauseRequest`).
      { paths: ['reason'], from: ['questionPayload'] },
    ],
  },
  'agentfootprint.pause.resume': { structure: ['pausedDurationMs', 'componentId'] },
  'agentfootprint.checkin.request': {
    structure: [...CALL],
    words: checkInPack('request'),
  },
  'agentfootprint.checkin.decision': {
    structure: [...CALL, 'approved', 'componentId'],
    words: [{ paths: ['note'], from: ['resumeInput'] }],
  },
  'agentfootprint.middleware.decision': {
    structure: [
      'middleware',
      'moment',
      'at',
      'phase',
      ...CALL,
      'outcome',
      'changed',
      'componentId',
    ],
    words: [{ paths: ['why'], from: ['args', 'result', ...CONVERSATION_TEXT] }],
  },

  // ── findings, honesty, tool choice ─────────────────────────────────────
  'agentfootprint.findings.declared': {
    structure: [...CALL, 'basis', 'expect', 'hasProposition', 'malformed'],
  },
  'agentfootprint.findings.standing': {
    structure: [
      ...CALL,
      'standing',
      'declaredOn',
      'assertionCount',
      'conflictKeys',
      'unknownId',
      'agrees',
    ],
  },
  'agentfootprint.findings.judged': {
    structure: [
      ...CALL,
      'against',
      'standing',
      'confidence',
      'latencyMs',
      'inputTokens',
      'outputTokens',
    ],
  },
  'agentfootprint.findings.judge_failed': { structure: [...CALL, 'status', 'latencyMs'] },
  'agentfootprint.findings.contingent': {
    structure: ['iteration', 'declaredOn', 'toolCallId', 'carriers', 'standings', 'valueChars'],
  },
  'agentfootprint.findings.argument': {
    structure: [
      ...CALL,
      'turn',
      'argument',
      'rule',
      'period',
      'source',
      'asked',
      'claimed',
      'matched',
      'reading',
      'earlier',
      'setAside',
      'argumentsFrom',
      'coincides',
      'free',
      'failed',
      'malformed',
      'valueChars',
    ],
  },
  'agentfootprint.findings.period': {
    structure: [...CALL, 'turn', 'verdict', 'timeChecks'],
  },
  'agentfootprint.tool_choice.picked': {
    structure: [
      'iteration',
      'chosen',
      'confidence',
      'offered',
      'served',
      'narrowed',
      'narrowedSkipped',
      'latencyMs',
      'inputTokens',
      'outputTokens',
    ],
  },
  'agentfootprint.tool_choice.outcome': {
    structure: ['iteration', 'called', 'firstAgrees', 'missed'],
  },
  'agentfootprint.tool_choice.failed': { structure: ['iteration', 'status', 'latencyMs'] },
  'agentfootprint.ontology.served': {
    structure: ['iteration', 'id', 'version', 'hash', 'nodes', 'sources', 'edges'],
  },
  'agentfootprint.answer.assessed': {
    structure: ['assessment', 'standing', 'reasons', 'checked', 'turn', 'iteration'],
  },
  'agentfootprint.embedding.generated': {
    structure: [
      'model',
      'provider',
      'inputKind',
      'dimension',
      'count',
      'durationMs',
      'tokensSpent',
    ],
  },

  // ── artifacts, maps, integrity ─────────────────────────────────────────
  'agentfootprint.artifacts.minted': {
    structure: [
      'ref',
      'kind',
      'mediaType',
      'bytes',
      'digest',
      'expiresAt',
      'origin',
      'parentRefs',
      'timeAxis',
      'tool',
    ],
  },
  'agentfootprint.artifacts.resolved': { structure: ['ref', 'via', 'kind', 'bytes', 'tool'] },
  'agentfootprint.artifacts.expired': { structure: ['ref', 'reason', 'kind', 'bytes', 'tool'] },
  'agentfootprint.artifacts.refused': {
    structure: ['op', 'reason', 'tool'],
    words: [{ paths: ['ref', 'detail'], from: ['args', 'result'] }],
  },
  'agentfootprint.artifacts.presented': {
    structure: ['ref', 'as', 'snapshot', 'toolCallId', 'iteration'],
    words: [{ paths: ['snapshot.label'], from: ['args', 'result'] }],
  },
  'agentfootprint.artifacts.hand_over_failed': {
    structure: ['cause', 'op', 'errorClass', 'errorCode'],
  },
  'agentfootprint.map.engaged': {
    structure: [
      'mapId',
      'iteration',
      'by',
      'reengaged',
      'upgraded',
      'foundedBy',
      'tenantChanged',
      'at',
    ],
    words: [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.map.parked': {
    structure: ['mapId', 'iteration', 'by', 'idleCalls'],
    words: [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.integrity.context_error': {
    structure: ['kind', 'seam', 'epoch', 'synthetic', 'iteration'],
  },
  'agentfootprint.integrity.disposition': { structure: ['posture', 'workExisted', 'rows'] },
  'agentfootprint.integrity.external_ground_used': {
    structure: [...CALL, 'path', 'source'],
    words: [{ paths: ['value'], from: ['args'], namedBy: 'path' }],
  },
};

/** Frozen to the last list: what the served path reads cannot be edited at run time. */
for (const content of Object.values(EVENT_CONTENT) as EventContent[]) {
  Object.freeze(content.structure);
  for (const row of content.words ?? []) {
    Object.freeze(row.paths);
    Object.freeze(row.from);
    Object.freeze(row);
  }
  if (content.words !== undefined) Object.freeze(content.words);
  Object.freeze(content);
}
Object.freeze(EVENT_CONTENT);
