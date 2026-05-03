/**
 * outputFallback — 3-tier degradation for structured-output validation
 * failures.
 *
 * Pairs with `outputSchema(parser)`. When the LLM's final answer
 * fails schema validation (after the agent loop has done what it
 * could), instead of throwing `OutputSchemaError` to the caller,
 * the agent falls through:
 *
 *   1. **Primary** — LLM emitted schema-valid JSON. Caller gets the
 *      parsed value.
 *   2. **Fallback** — `OutputSchemaError` thrown by the parser. The
 *      consumer-supplied async `fallback(error, raw)` runs; its
 *      return value is parsed against the same schema. If valid →
 *      caller gets it. If `fallback` itself throws OR its return
 *      value fails schema → tier 3.
 *   3. **Canned** — static `canned` value (validated against the
 *      schema at builder time so it's guaranteed to satisfy). The
 *      agent NEVER throws when `canned` is set.
 *
 * Pattern: chain-of-responsibility (GoF) over typed degradation tiers.
 *          Same shape as `withRetry` / `withFallback` for LLM
 *          providers, but at the SCHEMA layer instead of the network
 *          layer.
 *
 * Role:    Layer-6 (Agent) — terminal contract failure handler.
 *          Composable with `outputSchema` (which it supplements;
 *          one without the other is incoherent).
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 *
 * const Refund = z.object({
 *   amount: z.number().nonnegative(),
 *   reason: z.string().min(1),
 * });
 *
 * const agent = Agent.create({...})
 *   .system('You decide refund amounts.')
 *   .outputSchema(Refund)
 *   .outputFallback({
 *     // Tier 2: try a more permissive prompt; if it also fails,
 *     //         escalate to a human.
 *     fallback: async (err, raw) => ({
 *       amount: 0,
 *       reason: `manual review required (LLM output: ${raw.slice(0, 200)})`,
 *     }),
 *     // Tier 3: guaranteed-valid safety net.
 *     canned: { amount: 0, reason: 'unable to process — please retry' },
 *   })
 *   .build();
 *
 * // Caller never sees OutputSchemaError; gets a typed Refund either way.
 * const refund = await agent.runTyped({ message: '...' });
 * ```
 *
 * Why this matters in production:
 *   - LLMs occasionally emit prose despite the system prompt asking
 *     for JSON ("Sure! Here's your refund: {...}").
 *   - Schema-violating outputs are bursty under model load (vendor
 *     A/B tests, model rollouts, content-filter trips).
 *   - A B2C agent that THROWS on every malformed output cascades
 *     into 5xx for the end user; the FAIL-OPEN pattern degrades
 *     gracefully and lets you triage offline.
 *
 * Two typed events fire so observability backends can alert on
 * degradation:
 *   - `agentfootprint.resilience.output_fallback_triggered`
 *     (tier 2 fired)
 *   - `agentfootprint.resilience.output_canned_used`
 *     (tier 3 fired — fallback also failed; safety net engaged)
 */

import type { OutputSchemaError, OutputSchemaParser } from './outputSchema.js';

// ─── Public types ────────────────────────────────────────────────────

/**
 * Tier-2 fallback function. Receives the original validation error +
 * the raw LLM output; returns a value that the agent will then try
 * to validate against the same schema.
 *
 * If this function throws, OR its return value fails schema, the
 * agent falls through to the `canned` value (tier 3).
 */
export type OutputFallbackFn<T> = (error: OutputSchemaError, rawOutput: string) => Promise<T> | T;

export interface OutputFallbackOptions<T> {
  /** Tier 2 — async function that produces a candidate value. May
   *  throw or return invalid data; the agent will fall through to
   *  `canned` if so. */
  readonly fallback: OutputFallbackFn<T>;
  /** Tier 3 — guaranteed-valid safety net. Validated against the
   *  schema at builder time (throws on mismatch — fail-fast on
   *  misconfig). When set, the agent NEVER throws on output-schema
   *  failure.
   *
   *  When omitted, `fallback`-thrown errors propagate to the caller
   *  (consumer chooses fail-open vs fail-closed). */
  readonly canned?: T;
}

/**
 * Internal — the resolved fallback config stored on the Agent.
 * Identical to public `OutputFallbackOptions` but with the parser
 * + canned-validation results pre-computed.
 *
 * @internal
 */
export interface ResolvedOutputFallback<T> {
  readonly fallback: OutputFallbackFn<T>;
  readonly canned?: T;
  /** True when `canned` was provided. Used by `apply…` to decide
   *  whether tier 3 exists at all. */
  readonly hasCanned: boolean;
}

// ─── Builder-time validation ─────────────────────────────────────────

/**
 * Validate the consumer-supplied `canned` value against the schema
 * at builder time. Fail-fast on misconfig — a `canned` value that
 * doesn't satisfy the schema would cascade into runtime errors
 * AFTER the agent loop has already failed, which defeats the
 * fail-open guarantee.
 *
 * Throws `TypeError` with a hint if validation fails.
 */
export function validateCannedAgainstSchema<T>(canned: T, parser: OutputSchemaParser<T>): void {
  try {
    parser.parse(canned);
  } catch (cause) {
    throw new TypeError(
      `[outputFallback] canned value does not satisfy outputSchema. ` +
        `The canned value is the safety net — it must always validate. ` +
        `Underlying error: ${(cause as { message?: string })?.message ?? String(cause)}`,
    );
  }
}

// ─── Runtime application ─────────────────────────────────────────────

/**
 * The 3-tier resolver. Called by `agent.parseOutput()` /
 * `agent.runTyped()` when an `outputFallback` is configured. Replaces
 * the bare-throw behavior of `applyOutputSchema()`.
 *
 * Returns the typed value from whichever tier wins. Emits typed
 * events at every tier transition so observability backends can
 * alert on degradation.
 *
 * @param raw          — the LLM's original final-answer string
 * @param parser       — the outputSchema parser
 * @param fallbackCfg  — the resolved fallback configuration
 * @param emit         — agentfootprint dispatcher's `dispatch()` entry
 *                       (typed via the runner; we accept a thin
 *                       function so this module stays import-free of
 *                       the dispatcher).
 */
export async function applyOutputFallback<T>(
  raw: string,
  parser: OutputSchemaParser<T>,
  fallbackCfg: ResolvedOutputFallback<T>,
  emit: (eventType: string, payload: Record<string, unknown>) => void,
  primaryError: OutputSchemaError,
): Promise<T> {
  // Tier 2 — fallback function.
  emit('agentfootprint.resilience.output_fallback_triggered', {
    stage: primaryError.stage,
    rawOutputPreview: raw.slice(0, 200),
    primaryErrorMessage: primaryError.message,
  });

  let tier2Value: unknown;
  try {
    tier2Value = await fallbackCfg.fallback(primaryError, raw);
  } catch (fallbackError) {
    return cannedOrRethrow(parser, fallbackCfg, emit, fallbackError, raw);
  }

  // Validate tier 2's output against the schema.
  try {
    return parser.parse(tier2Value);
  } catch (validationError) {
    return cannedOrRethrow(parser, fallbackCfg, emit, validationError, raw);
  }
}

function cannedOrRethrow<T>(
  parser: OutputSchemaParser<T>,
  fallbackCfg: ResolvedOutputFallback<T>,
  emit: (eventType: string, payload: Record<string, unknown>) => void,
  failureCause: unknown,
  raw: string,
): T {
  if (!fallbackCfg.hasCanned) {
    // No safety net — propagate. Consumer chose fail-closed by
    // omitting `canned`.
    if (failureCause instanceof Error) throw failureCause;
    throw new Error(String(failureCause));
  }
  emit('agentfootprint.resilience.output_canned_used', {
    rawOutputPreview: raw.slice(0, 200),
    fallbackErrorMessage:
      failureCause instanceof Error ? failureCause.message : String(failureCause),
  });
  // Re-validate canned defensively. Builder-time validation already
  // ran, but if a consumer mutates the canned object after build,
  // we'd rather throw than corrupt the contract.
  return parser.parse(fallbackCfg.canned);
}
