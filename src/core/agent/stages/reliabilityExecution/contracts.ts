import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../../provider-contract/types.js';

/** A single-shot LLM call function. Built once by `callLLM/executeCall.ts` and
 *  passed into this helper; we invoke it once per loop iteration. */
export type LLMCallFn = (
  request: LLMRequest,
  hooks: {
    /** The actual selected transport; omitted on the direct, non-reliability path. */
    provider?: LLMProvider;
    /** Index in an explicit provider list, for response-side thinking dispatch. */
    providerIndex?: number;
    /** The per-call persistence/report channel, retained across attempts. */
    providerHooks?: LLMCallHooks;
    /** Called the first time a streaming chunk yields content. After
     *  this fires, mid-stream errors will escalate retry/fallback to
     *  fail-fast. */
    onFirstChunk?: () => void;
  },
) => Promise<LLMResponse>;

/**
 * v2.13 — Output-schema validation hook. Called by the reliability loop
 * AFTER a successful LLM response, BEFORE the response is committed.
 * Throw to signal validation failure — the gate treats the throw as a
 * `'schema-fail'` errorKind and routes via PostDecide rules (which can
 * `retry` with `feedbackForLLM` for Instructor-style schema retry).
 *
 * Sentinel error type — the loop unwraps `ValidationFailure` instances
 * to extract `message` / `path` / `rawOutput` for the
 * `agentfootprint.agent.output_schema_validation_failed` event payload.
 *
 * MUST-FIX #1 from the v2.13 7-panel review: the hook fires ONLY when
 * `response.toolCalls.length === 0` (final-answer turn). Tool-call
 * turns aren't terminal output and validation would be premature.
 * Caller is responsible for the guard; this helper just runs whatever
 * the caller passes.
 */
export type OutputSchemaValidator = (response: LLMResponse) => void;

/**
 * Sentinel error class thrown by an `OutputSchemaValidator` to signal
 * a validation failure. Distinct subclass so the reliability loop can
 * `instanceof` check and route to the schema-fail branch instead of
 * treating it as a generic provider error.
 */
export class ValidationFailure extends Error {
  readonly stage: 'json-parse' | 'schema-validate';
  readonly path?: string;
  readonly rawOutput?: string;
  constructor(opts: {
    message: string;
    stage: 'json-parse' | 'schema-validate';
    path?: string;
    rawOutput?: string;
  }) {
    super(opts.message);
    this.name = 'ValidationFailure';
    this.stage = opts.stage;
    if (opts.path !== undefined) this.path = opts.path;
    if (opts.rawOutput !== undefined) this.rawOutput = opts.rawOutput;
  }
}

/** Sentinel kind written to scope on a mid-stream failure that the
 *  rules wanted to retry. Surfaces in `ReliabilityFailFastError.kind`. */
export const MID_STREAM_KIND = 'mid-stream-not-retryable';
