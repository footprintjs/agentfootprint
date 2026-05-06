/**
 * PolicyHaltError — typed error thrown by `Agent.run()` when a
 * `PermissionChecker.check()` returns `{ result: 'halt', ... }`.
 *
 * Pattern: Typed Error (parallel to `ReliabilityFailFastError`).
 * Role:    Surface layer for sequence governance / security halts —
 *          terminates the run cleanly with full forensic context so
 *          callers can route alerts (PagerDuty / Slack / dashboard)
 *          based on the rule that fired.
 * Emits:   N/A (this file DEFINES the error class; the corresponding
 *          observability event `agentfootprint.permission.halt` fires
 *          from the toolCalls handler at the moment the halt resolves).
 *
 * Strict ordering on halt — the framework guarantees:
 *   1. Synthetic `tool_result` (with `tellLLM` content) appended to
 *      `scope.history` so the Anthropic / OpenAI tool_use ↔ tool_result
 *      pairing protocol is satisfied.
 *   2. `agentfootprint.permission.halt` event emitted.
 *   3. Stage commits (commitLog has the entry; runtimeStageId is
 *      complete).
 *   4. THEN this error is thrown by `Agent.run()`.
 *
 * @example
 *   try {
 *     await agent.run({ message: 'help me with order #42' });
 *   } catch (e) {
 *     if (e instanceof PolicyHaltError) {
 *       console.log(`HALT: rule='${e.reason}' iteration=${e.iteration}`);
 *       console.log(`Sequence: ${e.sequence.map(c => c.name).join(' → ')}`);
 *       if (e.reason.startsWith('security:')) {
 *         await pagerDuty.notify(e);
 *       }
 *     } else {
 *       throw e;
 *     }
 *   }
 */

import type { LLMMessage, ToolCallEntry, ToolResultContent } from '../adapters/types.js';

export interface PolicyHaltContext {
  /** Telemetry tag from the matched rule. Stable across versions. */
  readonly reason: string;
  /** Content delivered to the LLM as the synthetic tool_result. */
  readonly tellLLM?: ToolResultContent;
  /** Sequence of tool calls dispatched this run, including the proposed
   *  call that triggered the halt (which did NOT execute). */
  readonly sequence: readonly ToolCallEntry[];
  /** ReAct iteration the halt fired on. */
  readonly iteration: number;
  /** Conversation history at halt time, including the synthetic tool_result. */
  readonly history: readonly LLMMessage[];
  /** The proposed tool call that triggered the halt (not executed). */
  readonly proposed: { readonly name: string; readonly args: unknown };
  /** Identifier of the PermissionChecker that returned `'halt'`. */
  readonly checkerId?: string;
}

export class PolicyHaltError extends Error {
  readonly code = 'ERR_POLICY_HALT' as const;
  readonly reason: string;
  readonly tellLLM?: ToolResultContent;
  readonly sequence: readonly ToolCallEntry[];
  readonly iteration: number;
  readonly history: readonly LLMMessage[];
  readonly proposed: { readonly name: string; readonly args: unknown };
  readonly checkerId?: string;

  constructor(ctx: PolicyHaltContext) {
    super(`Policy halt: ${ctx.reason} (tool='${ctx.proposed.name}', iteration=${ctx.iteration})`);
    this.name = 'PolicyHaltError';
    this.reason = ctx.reason;
    if (ctx.tellLLM !== undefined) this.tellLLM = ctx.tellLLM;
    this.sequence = ctx.sequence;
    this.iteration = ctx.iteration;
    this.history = ctx.history;
    this.proposed = ctx.proposed;
    if (ctx.checkerId !== undefined) this.checkerId = ctx.checkerId;
  }
}
