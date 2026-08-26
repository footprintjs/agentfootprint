/**
 * artifacts/placement — the placement threshold (Phase 2, Leg 3).
 *
 * An OPTIONAL operator dial on the agent's artifacts wiring:
 * `Agent.create({ artifacts: { store, placement: { maxInlineChars: N } } })`.
 * A tool result whose finalized text exceeds the threshold is checked into
 * the store (kind `tool-result/<toolName>`, or the tool's declared
 * `resultKind` — see `placedResultKind`) and the model receives the claim
 * ticket instead — a SHORT substitute naming ref + meta + how to consume it.
 * The whole 879,073-token failure class, retired by configuration.
 *
 * PRECEDENCE with the other two ceilings, stated once and owned here:
 *   1. the tool's own `resultCeiling` (the AUTHOR's refusal) is judged FIRST,
 *      at the execute boundary — a refused result is a short teaching
 *      sentence, so placement never sees the payload at all;
 *   2. placement (the OPERATOR's ref-ing) is judged next, on what the
 *      after-tool governance chain let through — a rule that already
 *      summarized a huge result is measured on what it produced;
 *   3. the agent-level `maxToolResultChars` truncation net runs LAST — with
 *      placement on it measures the ticket, so it should now rarely fire.
 *
 * A placed result is a TICKET, not a refusal: declared effects are still
 * judged and procedure steps advance normally — the result ARRIVED; it just
 * travels by reference. The decision is never silent: the mint lands as
 * `agentfootprint.artifacts.minted` (origin joining it to the tool call) and
 * the substitution states itself in the result the model reads.
 *
 * This module is the PURE half — the dial shape, its build-time refusals,
 * the measure rule (shared with both ceilings: strings as-is, everything
 * else `safeStringify`d by the caller), and the substitute composer. The
 * dispatch layer owns the mint and the events.
 */

import type { ArtifactMeta } from './types.js';

/** The dial. One field today; a plain object so field number two (a
 *  per-kind override, say) can arrive additively. */
export interface ArtifactPlacement {
  /**
   * The threshold, in characters of the finalized result text. Over it, the
   * result is checked into the store and the model reads the claim ticket.
   * Positive whole number; anything else is refused at build.
   *
   * **It moves what routing predicates read.** The substitute replaces the
   * result string everywhere downstream — history, `lastToolResult`,
   * `toolResults` — which is where skill-graph `when` edges and `rule`
   * triggers look. Turning placement on, or changing this number, can
   * therefore change which edge fires for a graph that matches on result
   * TEXT. That is the layering (routing judges what the model was told, not a
   * string the conversation never contained), stated here because it is not
   * guessable from a number: an edge that must survive the dial should key on
   * the tool name (`onToolReturn`) or a declared `status` (`onToolStatus`).
   */
  readonly maxInlineChars: number;
}

/**
 * Refuse a placement dial this library cannot honor, where it is configured
 * — never at the first oversized result of the first run.
 */
export function assertArtifactPlacement(
  site: string,
  placement: ArtifactPlacement | undefined,
): void {
  if (placement === undefined) return;
  const value = placement.maxInlineChars;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${site}: artifacts.placement.maxInlineChars must be a positive whole number of ` +
        `characters, and ${String(value)} is not one. It is the threshold over which a tool ` +
        `result is checked into the artifact store and the model reads the claim ticket ` +
        `instead. To turn placement OFF, omit \`placement\` — absent means results are never ` +
        `measured and never placed, exactly as before.`,
    );
  }
}

/**
 * The kind vocabulary a placement mint declares — THE one decision, and the
 * only place it is made.
 *
 * Default: `tool-result/<toolName>`. Honest — it says exactly what the payload
 * is and which tool produced it — and it is what a `wants` declaration or a
 * `present` call names to consume the placed result.
 *
 * `declared` is the tool's own `Tool.resultKind` (9.70.0), and when a tool
 * declares one it WINS. The reason is the exact-match law on the consuming
 * end: `wants` matches kinds by exact string equality — no wildcards, no
 * hierarchy — so the framework's default vocabulary is a ticket a
 * `wants: { dataset: 'dataset/rows' }` argument must refuse. Rather than
 * loosen the matcher (a ticket would stop being a promise) or make consumers
 * re-mint at the seam (the framework declining to carry its own ref), the
 * MINT speaks the author's vocabulary. Absent → today's bytes exactly.
 */
export function placedResultKind(toolName: string, declared?: string): string {
  return declared ?? `tool-result/${toolName}`;
}

/**
 * The substitute the model reads in place of the payload — ONE shape, always
 * the object (the `TruncatedToolResult` law: a consumer branches on
 * `.placed` without parsing prose, and the model reads it as JSON on the
 * `role: 'tool'` message).
 */
export interface PlacedToolResult {
  /** Always `true`. The field a consumer branches on. */
  readonly placed: true;
  readonly ref: string;
  /** The minted kind — what a consumer names to want it. The tool's declared
   *  `Tool.resultKind` when it has one, `tool-result/<toolName>` otherwise. */
  readonly kind: string;
  readonly mediaType: string;
  /** The stored payload's true size — the chars the window did NOT pay. */
  readonly bytes: number;
  /** What happened and what to do next: route the ref, never retype. */
  readonly reason: string;
}

/** Type guard for consumers reading `tool_end.result` or a tool message. */
export function isPlacedToolResult(value: unknown): value is PlacedToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { placed?: unknown }).placed === true &&
    typeof (value as { ref?: unknown }).ref === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/** Compose the ticket from the mint the dispatch layer performed. */
export function placedToolResult(
  toolName: string,
  meta: ArtifactMeta,
  sizeChars: number,
  maxInlineChars: number,
): PlacedToolResult {
  return {
    placed: true,
    ref: meta.ref,
    kind: meta.kind,
    mediaType: meta.mediaType,
    bytes: meta.bytes,
    reason:
      `${toolName} returned ${sizeChars} chars, over the ${maxInlineChars}-char placement ` +
      `threshold, so the full result was stored as artifact '${meta.ref}' ` +
      `(${meta.kind}) instead of entering this conversation. Route the ref: pass the ` +
      `string '${meta.ref}' to a tool whose argument wants '${meta.kind}', or call ` +
      `present({ ref: '${meta.ref}', as: … }) to hand it to the screen. Do not retype or ` +
      `summarize content you have not read.`,
  };
}
