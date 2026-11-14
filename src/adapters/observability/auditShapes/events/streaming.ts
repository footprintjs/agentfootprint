import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import {
  blocksMarker,
  bool,
  charsMarker,
  keysMarker,
  listOf,
  num,
  oneOf,
  shapeOf,
  str,
  summariesMarker,
  typeMarker,
} from '../../auditBounding.js';
import { boundSourceBreakdown } from '../pieces/decisions.js';
import { eventShape } from '../vocabulary.js';

export function streamingShapes() {
  return {
    'agentfootprint.context.recorded': eventShape<'agentfootprint.context.recorded'>({
      iteration: num,
      omission: oneOf('not-json'),
      pieces: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.context.recorded'>['pieces']>>({
          source: str,
          sourceId: str,
          rawContent: charsMarker,
          schema: typeMarker,
        }),
      ),
    }),
    'agentfootprint.stream.llm_end': eventShape<'agentfootprint.stream.llm_end'>({
      iteration: num,
      content: charsMarker,
      contentWithheld: bool,
      toolCallCount: num,
      // A provider's counts. A child the type does not declare is a marker.
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
  };
}
