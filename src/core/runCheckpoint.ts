/**
 * runCheckpoint — fault-tolerant resume primitives.
 *
 * Today's pause/resume only handles INTENTIONAL pauses (`askHuman`).
 * Errors mid-run (LLM 500s, vendor outages, tool throws, container
 * restarts) propagate all the way up and the consumer must restart
 * from scratch — losing the prior iterations' work.
 *
 * This module adds the third piece of the Reliability subsystem:
 *
 *   1. **`AgentRunCheckpoint`** — JSON-serializable snapshot of an
 *      agent run's progress. Captured automatically at each
 *      iteration boundary (the natural commit points). Survives
 *      process restart — persist to Redis / Postgres / S3 / queue.
 *
 *   2. **`RunCheckpointError`** — wraps the underlying error with
 *      the last-known-good checkpoint. Throwing this instead of the
 *      raw error lets consumers catch + persist + resume later
 *      without losing context.
 *
 *   3. **`agent.resumeOnError(checkpoint)`** — replays the agent run
 *      with the checkpointed conversation history restored. The
 *      next iteration retries the call that originally failed (with
 *      the latest provider state — circuit breaker may have closed,
 *      vendor may have recovered, etc.).
 *
 * Design tradeoff: we use a CONVERSATION-HISTORY checkpoint shape
 * rather than a full executor-state checkpoint (which would require
 * footprintjs API surface changes for mid-run snapshotting). The
 * tradeoff:
 *
 *   ✅ Survives process restart (JSON-serializable, tiny payload)
 *   ✅ Works with any LLM provider — replay starts from history
 *   ✅ No footprintjs core changes
 *   ⚠️  Loses mid-iteration partial state (acceptable — iterations
 *       are atomic; we resume from the last completed boundary)
 *   ⚠️  Tool calls inside the failed iteration re-execute (consumer
 *       must idempotency-key their tool implementations OR use
 *       v2.10.3+ tool-result dedup via toolCallId).
 *
 * Pattern: Memento (GoF) — snapshot of an object's internal state
 *          for later restoration. Same shape as `FlowchartCheckpoint`
 *          but at the agent layer (one logical iteration vs. one
 *          DFS stage).
 */

import type { LLMMessage } from '../adapters/types.js';

// ─── Public types ────────────────────────────────────────────────────

/**
 * JSON-serializable checkpoint of an in-progress agent run. Persist
 * to ANY durable store (Redis / Postgres / S3 / disk / queue) and
 * resume hours / days / deploys later via `agent.resumeOnError(...)`.
 *
 * **Stable shape** — the `version` field guards forward compat. v1
 * → v2 transitions will be supported via a migration helper.
 */
export interface AgentRunCheckpoint {
  /** Schema version. v1 = conversation-history-based. */
  readonly version: 1;
  /** Original `runId` from the failing run. Reused on resume so
   *  observability + cost tracking correlates the resumed iterations
   *  back to the original run. */
  readonly runId: string;
  /** Conversation history at the LAST completed iteration boundary
   *  (LLM messages). The next iteration retries from here. */
  readonly history: readonly LLMMessage[];
  /** Index of the last completed iteration (0-based). The resumed
   *  run starts at iteration `lastCompletedIteration + 1`. */
  readonly lastCompletedIteration: number;
  /** Original input message. Surfaces in observability + lets the
   *  consumer correlate checkpoint to the user's request. */
  readonly originalInput: { readonly message: string };
  /** Wall-clock when the checkpoint was captured. Diagnostic only. */
  readonly checkpointedAt: number;
  /** Where the failure happened. Diagnostic — surfaces in oncall
   *  triage so you can tell "LLM 500 mid-iteration" from "tool
   *  threw" from "validation kept failing". */
  readonly failurePoint?: {
    readonly iteration: number;
    readonly phase: 'iteration' | 'tool' | 'llm' | 'unknown';
  };
}

/**
 * Thrown by `agent.run()` when a fault occurs mid-run. Carries the
 * underlying error AND the last-known-good checkpoint. Catch this
 * specifically to engage the resume-on-error path; let other errors
 * propagate normally.
 *
 * @example
 * ```ts
 * import { Agent, RunCheckpointError } from 'agentfootprint';
 *
 * try {
 *   const result = await agent.run({ message: 'long task' });
 * } catch (err) {
 *   if (err instanceof RunCheckpointError) {
 *     await checkpointStore.put(sessionId, err.checkpoint);
 *     // hours / restart later:
 *     const checkpoint = await checkpointStore.get(sessionId);
 *     const result = await agent.resumeOnError(checkpoint);
 *   } else {
 *     throw err; // not a recoverable error — propagate
 *   }
 * }
 * ```
 */
export class RunCheckpointError extends Error {
  readonly code = 'ERR_RUN_CHECKPOINT' as const;
  /** The error that triggered the checkpoint. Inspect for retry
   *  decisions ("if cause is CircuitOpenError, wait for cooldown
   *  before resuming"). */
  override readonly cause: Error;
  /** The last-known-good checkpoint. Persist + pass back to
   *  `agent.resumeOnError(checkpoint)` to continue from here. */
  readonly checkpoint: AgentRunCheckpoint;

  constructor(cause: Error, checkpoint: AgentRunCheckpoint) {
    const phase = checkpoint.failurePoint?.phase ?? 'unknown';
    super(
      `[agent run] failed at iteration ${checkpoint.failurePoint?.iteration ?? '?'} (${phase}). ` +
        `Last-good checkpoint captured at iteration ${checkpoint.lastCompletedIteration}. ` +
        `Pass to agent.resumeOnError(checkpoint) to continue. ` +
        `Underlying error: ${cause.message}`,
    );
    this.name = 'RunCheckpointError';
    this.cause = cause;
    this.checkpoint = checkpoint;
  }
}

// ─── Internal — captured per-run state ───────────────────────────────

/**
 * Mutable state the Agent maintains during a run for checkpoint
 * capture. Keyed by `runId` so multiple in-flight runs don't
 * collide. Cleared on `turn_end` (success path).
 *
 * @internal
 */
export interface RunCheckpointTracker {
  readonly runId: string;
  readonly originalInput: { readonly message: string };
  /** Updated on every `agentfootprint.agent.iteration_end`. */
  history: readonly LLMMessage[];
  /** Updated on every `agentfootprint.agent.iteration_end`. */
  lastCompletedIteration: number;
  /** Set when an iteration begins (used to attribute the failure
   *  phase if we throw before the next iteration_end). */
  inFlightIteration?: number;
}

/**
 * Build a JSON-serializable checkpoint from a tracker + failure
 * info. Pure function — no side effects.
 *
 * @internal
 */
export function buildCheckpoint(
  tracker: RunCheckpointTracker,
  failurePoint?: {
    iteration: number;
    phase: AgentRunCheckpoint['failurePoint'] extends infer F
      ? F extends { phase: infer P }
        ? P
        : never
      : never;
  },
): AgentRunCheckpoint {
  return {
    version: 1,
    runId: tracker.runId,
    history: tracker.history,
    lastCompletedIteration: tracker.lastCompletedIteration,
    originalInput: tracker.originalInput,
    checkpointedAt: Date.now(),
    ...(failurePoint && { failurePoint }),
  };
}

/**
 * Validate a checkpoint at deserialization time. Catches forward-
 * incompatible payloads (someone tries to resume a v3 checkpoint on
 * a v1 runtime, or a corrupted JSON blob).
 *
 * Returns the checkpoint typed-narrowed; throws TypeError on
 * unknown shape.
 */
export function validateCheckpoint(value: unknown): AgentRunCheckpoint {
  if (!value || typeof value !== 'object') {
    throw new TypeError('[resumeOnError] checkpoint is not an object.');
  }
  const c = value as Partial<AgentRunCheckpoint>;
  if (c.version !== 1) {
    throw new TypeError(
      `[resumeOnError] unsupported checkpoint version: ${c.version}. ` +
        `This runtime supports version 1; persisted checkpoints from a future ` +
        `agentfootprint version need a matching runtime to resume.`,
    );
  }
  if (typeof c.runId !== 'string' || !Array.isArray(c.history)) {
    throw new TypeError('[resumeOnError] checkpoint missing required fields (runId, history).');
  }
  if (typeof c.lastCompletedIteration !== 'number') {
    throw new TypeError(
      '[resumeOnError] checkpoint missing required field: lastCompletedIteration.',
    );
  }
  if (!c.originalInput || typeof c.originalInput.message !== 'string') {
    throw new TypeError(
      '[resumeOnError] checkpoint missing required field: originalInput.message.',
    );
  }
  return c as AgentRunCheckpoint;
}

/**
 * Classify a thrown error into one of the failure-point phase
 * buckets. Heuristic — uses error name / code / message inspection.
 * Fast path returns 'unknown' so unrecognized errors still produce
 * a checkpoint (the cause itself is preserved in
 * `RunCheckpointError.cause`).
 */
export function classifyFailurePhase(err: Error): 'iteration' | 'tool' | 'llm' | 'unknown' {
  const name = err.name;
  const code = (err as { code?: string }).code ?? '';
  const msg = err.message ?? '';
  // LLM provider failures: known codes + name patterns.
  if (
    code === 'ERR_CIRCUIT_OPEN' || // our own circuit breaker
    name === 'AnthropicError' ||
    name === 'OpenAIError' ||
    name === 'BedrockError' ||
    /\b(LLM|provider|anthropic|openai|bedrock)\b/i.test(msg)
  ) {
    return 'llm';
  }
  if (/\b(tool|tool_call)\b/i.test(name) || /\bTool\b/.test(msg)) {
    return 'tool';
  }
  if (/iteration/i.test(msg)) return 'iteration';
  return 'unknown';
}
