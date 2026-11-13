import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import {
  bool,
  charsMarker,
  listOf,
  messagesMarker,
  num,
  oneOf,
  recordOf,
  shapeOf,
  str,
} from '../../auditBounding.js';
import { boundAnswerAssessment } from '../pieces/decisions.js';
import { boundAnswerCoverage, boundAnswerNegatives } from '../pieces/coverage.js';
import { boundScripts } from '../pieces/scripts.js';
import { eventShape } from '../vocabulary.js';

export function lifecycleShapes() {
  return {
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

    'agentfootprint.agent.around_turn_failed':
      eventShape<'agentfootprint.agent.around_turn_failed'>({
        wrapper: str,
        errorClass: str,
      }),

    'agentfootprint.agent.budget_exhausted': eventShape<'agentfootprint.agent.budget_exhausted'>({
      reason: oneOf('cost-budget', 'max-iterations'),
      iteration: num,
      limit: num,
      pendingToolCalls: num,
      action: oneOf('cut-short', 'wrapped-up'),
    }),
  };
}
