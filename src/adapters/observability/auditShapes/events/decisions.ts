import type { Assertion } from '../../../../integrity/assertion/types.js';
import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import { FIXED_PAUSE_REASON, boundGuard, boundSubject, boundWitness } from '../pieces/decisions.js';
import {
  bool,
  charsMarker,
  either,
  keysMarker,
  listOf,
  num,
  oneOf,
  recordOf,
  shapeOf,
  str,
} from '../../auditBounding.js';
import { eventShape } from '../vocabulary.js';
import { policyReasonTag, routeEvidence } from '../../auditKeptByContract.js';

export function decisionsShapes() {
  return {
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
      // Argument NAMES the tool's view hid from the person — never values.
      hiddenArgs: listOf(str),
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

    // `reason` is `pauseData.reason`: the library's sentence stays, a pause's own is its data.
    'agentfootprint.pause.request': eventShape<'agentfootprint.pause.request'>({
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

    'agentfootprint.permission.halt': eventShape<'agentfootprint.permission.halt'>({
      checkerId: str,
      target: str,
      reason: policyReasonTag,
      tellLLM: charsMarker,
      iteration: num,
      sequenceLength: num,
      toolCallId: str,
    }),

    // A router's `{ reason }` is its model's words; `decide()` evidence is the engine's.
    'agentfootprint.composition.route_decided':
      eventShape<'agentfootprint.composition.route_decided'>({
        conditionalId: str,
        chosen: str,
        rationale: str,
        evidence: routeEvidence,
      }),
  };
}
