/**
 * messageApiReceipt — the one mint the two message-API charts share, and the
 * one place that says when a chart may not mint at all.
 *
 * Role:  Lens. One pure function over what a `call-llm` stage already holds.
 *        It reads no scope, emits nothing and commits nothing — the caller
 *        commits what it returns, under `receipt.ts` · `RECEIPT_KEY`.
 * Reads: its arguments.
 * Emits: N/A.
 *
 * WHY THIS FILE EXISTS. `buildMessageApiChart` and `buildAgentMessageApiChart`
 * are deliberate twins — the second is the first plus tools, a router and a
 * loop — and a mint written out in both is two chances to disagree about what
 * the model was handed on charts whose whole job is to be the same shape. The
 * arguments differ per chart (one has tools, one does not); the RULE does not,
 * and the rule is what lives here.
 *
 * THE RULE: NO RUN ID, NO RECEIPT. Every hash a receipt carries is salted with
 * the run id (`receipt.ts`, the third law) so a short system prompt or a
 * two-word turn cannot be fingerprinted across runs, and a receipt is committed
 * state that travels inside recordings. These two charts are exported BUILDERS
 * handed to an executor the caller owns — nothing in a stage's scope carries
 * that executor's run id — so the salt has to be supplied, and when it is not
 * this returns `undefined` rather than minting with an empty one. `servedAt`
 * then declares the absence (`no-receipt-on-chart`, cause
 * `'no-receipt-committed'`) and rebuilds the view exactly as it always did: a
 * Lens may omit, never deny.
 */

import type { LLMMessage, LLMRequest, LLMToolSchema } from '../../adapters/types.js';
import {
  buildReceipt,
  receiptPieces,
  type Receipt,
  type SystemPieceRecord,
} from '../../lib/time-travel/receipt.js';

/** What a message-API chart's `call-llm` stage hands the mint. */
export interface MessageApiReceiptInput {
  /** The run this call belongs to, from the chart's `getRunId` dep. Absent or
   *  empty ⇒ no receipt — see the rule in this file's header. */
  readonly runId: string | undefined;
  /** The committed `iteration` at this call. */
  readonly epoch: number;
  readonly model: string;
  /** `LLMProvider.name` — the port the request went out through. */
  readonly provider: string;
  /** The joined system string, exactly as sent. */
  readonly systemText: string;
  /** The injection records it was joined from, in slot order. */
  readonly systemPieces: readonly SystemPieceRecord[];
  /** The conversation as sent, post-strip. */
  readonly messages: readonly LLMMessage[];
  /** The tool list as sent. Empty on a chart that serves none. */
  readonly tools: readonly LLMToolSchema[];
  /**
   * The request object the provider port is handed — the SAME object, not a
   * second literal built to describe it.
   *
   * It stands for both halves of the cache comparison because neither chart
   * runs a cache strategy: nothing rewrote the request between assembly and
   * the port, so `cache.transform` records `'unchanged'`. That is the verdict
   * an agent running a pass-through strategy records today, and it is true
   * here for the same reason — the request that went out is the request that
   * was assembled. `cache.strategy` records `null` beside it (9.93.0), which
   * is the half the verdict alone cannot say, and is what lets the served view
   * leave `cache-transform` off these charts.
   */
  readonly request: LLMRequest;
}

/**
 * Mint one message-API chart's receipt, or `undefined` when the chart was
 * given no run id to salt it with.
 *
 * @example
 * ```ts
 * const receipt = messageApiReceipt({
 *   runId: deps.getRunId?.(),
 *   epoch: 1,
 *   model,
 *   provider: provider.name,
 *   systemText: system,
 *   systemPieces: scope.systemPromptInjections ?? [],
 *   messages,
 *   tools: [],
 *   request,
 * });
 * if (receipt !== undefined) scope[RECEIPT_KEY] = receipt;
 * ```
 */
export function messageApiReceipt(input: MessageApiReceiptInput): Receipt | undefined {
  if (input.runId === undefined || input.runId.length === 0) return undefined;
  return buildReceipt({
    runId: input.runId,
    epoch: input.epoch,
    model: input.model,
    provider: input.provider,
    systemText: input.systemText,
    systemPieces: receiptPieces(input.systemPieces),
    messages: input.messages,
    // Neither chart composes a line that exists on the request only, forces an
    // answer tool, or withholds the tool list for a wrap-up. Three facts about
    // these charts, written as the values they are rather than left for a
    // reader to infer from an absence.
    requestOnly: [],
    tools: input.tools,
    forced: null,
    withheld: null,
    baseRequest: input.request,
    preparedRequest: input.request,
    strategy: null,
  });
}
