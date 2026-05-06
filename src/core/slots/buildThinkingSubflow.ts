/**
 * NormalizeThinking sub-subflow — wraps a consumer's `ThinkingHandler`
 * (function-pair contract) in a real footprintjs subflow at chart
 * build time. Mounted as a stage AFTER CallLLM inside `sf-call-llm`
 * when (and only when) a handler is configured.
 *
 * runtimeStageId format: `sf-call-llm/thinking-{handler.id}#N`
 *
 * Two-layer architecture (per Phase 1 panel decision):
 *   - CONSUMER-FACING:    `ThinkingHandler` — simple function-pair
 *                          (id, providerNames, normalize, parseChunk?)
 *   - FRAMEWORK-INTERNAL: this file wraps each handler in a real
 *                         footprintjs subflow with own runtimeStageId,
 *                         narrative entry, and InOutRecorder boundary.
 *
 * Failure isolation: handler `normalize()` throws are caught here.
 * Framework emits `agentfootprint.agent.thinking_parse_failed`, sets
 * `scope.thinkingBlocks` to empty, and the subflow exits cleanly. The
 * agent run continues; the assistant message simply has no thinking
 * blocks attached. Same graceful pattern as v2.11.6 `tools.discovery_failed`.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { ThinkingBlock, ThinkingHandler } from '../../thinking/types.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';

interface NormalizeThinkingState {
  rawThinking?: unknown;
  thinkingBlocks: readonly ThinkingBlock[];
  iteration: number;
  [k: string]: unknown;
}

/**
 * Build a thinking-normalization sub-subflow for a configured handler.
 * Mounted as a single-stage subflow inside `sf-call-llm` AFTER CallLLM.
 *
 * The subflow:
 *   1. Reads `scope.rawThinking` (set by CallLLM from `LLMResponse.rawThinking`)
 *   2. If rawThinking is undefined → write empty array, exit (early-return)
 *   3. Calls `handler.normalize(rawThinking)`
 *   4. On success: writes `scope.thinkingBlocks` + emits `stream.thinking_end`
 *   5. On throw: writes empty array + emits `agent.thinking_parse_failed`
 *
 * The result on `scope.thinkingBlocks` is read by toolCalls.ts and
 * prepareFinal.ts when constructing the assistant message for
 * `scope.history` — that's where the Anthropic signature round-trip
 * actually flows from.
 */
export function buildThinkingSubflow(handler: ThinkingHandler): FlowChart {
  const handlerId = handler.id;
  const providerName = handler.providerNames[0] ?? 'unknown';

  return flowChart<NormalizeThinkingState>(
    'Normalize',
    (scope: TypedScope<NormalizeThinkingState>) => {
      const raw = scope.$getValue('rawThinking');
      const iteration = (scope.$getValue('iteration') as number) ?? 0;

      // Early-return: no thinking content for this call (most calls).
      // Write empty array so toolCalls.ts / prepareFinal.ts have a
      // consistent read shape, even when no thinking is present.
      if (raw === undefined) {
        scope.$setValue('thinkingBlocks', []);
        return;
      }

      // Failure isolation — same pattern as v2.11.6 tools.discovery_failed.
      // Handler throws are caught + emitted as the typed event; agent
      // run continues with no thinking blocks attached.
      let blocks: readonly ThinkingBlock[];
      try {
        blocks = handler.normalize(raw);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errName = err instanceof Error ? err.name : 'Error';
        scope.$setValue('thinkingBlocks', []);
        typedEmit(scope, 'agentfootprint.agent.thinking_parse_failed', {
          providerName,
          subflowId: handlerId,
          error: errMsg,
          errorName: errName,
          iteration,
        });
        return;
      }

      // Strip providerMeta before persistence — type doc declares
      // it an "escape hatch" for handler-internal use, NOT the durable
      // record. Excluding it from scope.thinkingBlocks means it won't
      // leak into narrative entries (rawValue), scope.history, or
      // audit-log adapters that read from either.
      const persisted = blocks.some((b) => b.providerMeta !== undefined)
        ? blocks.map((b) => {
            if (b.providerMeta === undefined) return b;
            // Drop providerMeta — escape hatch is handler-internal, not
            // persisted. Strip via destructure-and-omit; the discarded
            // binding is intentionally ignored.
            const { providerMeta, ...rest } = b;
            void providerMeta;
            return rest;
          })
        : blocks;
      scope.$setValue('thinkingBlocks', persisted);

      // Per-call summary event. Carries METADATA only — full content
      // lives on LLMMessage.thinkingBlocks (the durable record).
      const totalChars = persisted.reduce((sum, b) => sum + b.content.length, 0);
      // v2.14.1 — embed the persisted blocks in the typed event so live
      // consumers can render per-iteration reasoning without
      // post-walking scope.history. The persisted blocks are already
      // providerMeta-stripped (Phase 6 invariant), so the event's
      // `blocks` matches the audit-log bytes exactly. Only included
      // when non-empty so consumers can branch on field presence.
      typedEmit(scope, 'agentfootprint.stream.thinking_end', {
        iteration,
        blockCount: persisted.length,
        totalChars,
        ...(persisted.length > 0 && { blocks: persisted }),
      });
    },
    `thinking-${handlerId}`,
    undefined,
    `Normalize ${handlerId} thinking blocks`,
  ).build();
}
