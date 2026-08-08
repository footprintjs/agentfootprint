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
 *   ⚠️  TOOL RE-EXECUTION (idempotency requirement): anything the
 *       failed iteration did after the last completed boundary —
 *       including tool side effects — is NOT in the checkpoint. On
 *       resume the model re-decides from the restored history and may
 *       re-issue those tool calls; they WILL execute again. There is
 *       NO built-in toolCallId-based dedup. Mutating tools (payments,
 *       emails, DB writes) must be idempotent — derive an idempotency
 *       key from stable call content, not from `ctx.toolCallId` (fresh
 *       per issued call, so a re-issued call gets a NEW id). Note the
 *       same requirement exists WITHOUT resume: a tool that performs
 *       its side effect and then throws reports the error message back
 *       to the model as the tool result, and the model typically
 *       retries the call on the next iteration.
 *
 * Pattern: Memento (GoF) — snapshot of an object's internal state
 *          for later restoration. Same shape as `FlowchartCheckpoint`
 *          but at the agent layer (one logical iteration vs. one
 *          DFS stage).
 */

import type { LLMMessage } from '../adapters/types.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { FoldedSpan } from './agent/window/types.js';

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
  /** `runId` of the FAILING run — lets the consumer correlate a
   *  persisted checkpoint back to the original run's observability.
   *  NOT reused on resume: `resumeOnError` starts a fresh run with a
   *  fresh `runId` (only the conversation history is restored). */
  readonly runId: string;
  /** Conversation history at the LAST completed iteration boundary
   *  (LLM messages). The next iteration retries from here. */
  readonly history: readonly LLMMessage[];
  /** Index of the last completed iteration in the FAILING run
   *  (diagnostic — not consumed on resume). The resumed run restores
   *  this history but re-seeds its own iteration counter at 1 with a
   *  full `maxIterations` budget. */
  readonly lastCompletedIteration: number;
  /** Original input message. Surfaces in observability + lets the
   *  consumer correlate checkpoint to the user's request. */
  readonly originalInput: { readonly message: string };
  /** Wall-clock when the checkpoint was captured. Diagnostic only. */
  readonly checkpointedAt: number;
  /**
   * Every span this conversation folded into a summary, oldest first — what
   * makes a compacted conversation still a provable one after the process
   * that compacted it is gone.
   *
   * Written by `.compaction()`; absent on a conversation that never folded,
   * and absent on one stored by a runtime older than 8.2. Under the default
   * `retain: 'conversation'` each span carries the folded messages verbatim;
   * under `retain: 'discard'` the span is still here, naming what left, and
   * only `messages` is absent.
   *
   * Join a summary in {@link history} to its span with `foldedSpanFor(...)` —
   * by content fingerprint, never by index, because a later fold moves every
   * index after it.
   *
   * **Version 1 still, deliberately.** An optional field is not a format
   * change: a runtime that has never heard of `folded` reads this checkpoint,
   * ignores it, and continues the conversation correctly — the summary is an
   * ordinary message in `history` either way. Bumping the version would make
   * an older deployment REFUSE a session it can serve perfectly well, which is
   * the opposite of what the version field is for.
   */
  readonly folded?: readonly FoldedSpan[];
  /**
   * WHO this conversation belongs to — the `identity` the stored run was
   * given, carried so that continuing it lands in the same namespace it
   * started in (9.2.0).
   *
   * Before this field, continuing a conversation re-seeded identity from the
   * resuming run's own id: every continued turn wrote its memory under a
   * FRESH `conversationId`, so turn two's facts were stored somewhere turn
   * three could not read them. Nothing threw, and the only symptom was an
   * agent that kept forgetting — the same class of failure as a store that
   * silently forgot everything looking exactly like a new user.
   *
   * Absent on a conversation stored before 9.2.0, and absent when the run
   * never got an explicit identity (the default is derived from a runId, and
   * carrying THAT forward would pin a whole conversation to one run's id).
   * An explicit `identity` on the continuing call always wins.
   *
   * **Version 1 still**, on the same reasoning as {@link folded}: an optional
   * field is not a format change, and a runtime that has never heard of it
   * continues the conversation correctly.
   */
  readonly identity?: MemoryIdentity;
  /**
   * WHICH agent recorded this conversation — present only when that agent was
   * given an explicit `Agent.create({ id })` (9.2.0).
   *
   * A conversation is a transcript, and a transcript can be replayed on any
   * agent. Usually that is the point: a deploy that adds a tool or edits a
   * prompt must still be able to continue yesterday's conversations, so the
   * runtime cannot refuse on "the agent changed". But replaying the BILLING
   * agent's conversation on the SUPPORT agent is a different mistake, and it
   * used to be accepted in silence.
   *
   * The rule is the one the embedder fingerprint already uses: **ids decide
   * only when BOTH sides named themselves.** A default id (`'agent'`) is not
   * naming yourself, so the majority of callers — who never pass one — are
   * never refused. Two sides that both chose a name and chose different ones
   * are refused, by name.
   *
   * Version 1 still, for the same reason as the two fields above.
   */
  readonly agent?: { readonly id: string };
  /** Where the failure happened. Diagnostic — surfaces in oncall
   *  triage so you can tell "LLM 500 mid-iteration" from "tool
   *  threw" from "validation kept failing". */
  readonly failurePoint?: {
    readonly iteration: number;
    readonly phase: 'iteration' | 'tool' | 'llm' | 'unknown';
    /**
     * What was OPEN when it threw — `'call-llm'` for the model call, or the
     * declared name of the tool that was running (8.14.0).
     *
     * Absent when nothing was open (a failure between brackets), which is the
     * honest answer rather than a guess.
     *
     * **Never a URL, never a credential, never request or response content.**
     * Only the literal string `'call-llm'` or a tool name the app itself
     * declared. A checkpoint is persisted to Redis / Postgres / S3 and read by
     * whoever is on call; nothing that could carry a secret goes in it. Do not
     * "improve" this field into carrying the endpoint.
     */
    readonly stage?: string;
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
    super(
      `[agent run] failed at iteration ${checkpoint.failurePoint?.iteration ?? '?'} ` +
        `${describeFailurePoint(checkpoint.failurePoint)}. ` +
        `Last-good checkpoint captured at iteration ${checkpoint.lastCompletedIteration}. ` +
        `Pass to agent.resumeOnError(checkpoint) to continue. ` +
        `Underlying error: ${cause.message}`,
    );
    this.name = 'RunCheckpointError';
    this.cause = cause;
    this.checkpoint = checkpoint;
  }
}

/**
 * Thrown when a stored conversation is handed to an agent that is provably
 * not the one that recorded it (9.2.0).
 *
 * Raised only when BOTH sides named themselves with an explicit
 * `Agent.create({ id })` and the two names differ — see
 * {@link AgentRunCheckpoint.agent} for why that is the whole of the rule.
 * An agent that gained a tool, changed its prompt or moved to a new model
 * since the conversation was stored is NOT this error; continuing across a
 * deploy is the ordinary case and must keep working.
 */
export class ConversationMismatchError extends Error {
  readonly code = 'ERR_CONVERSATION_MISMATCH' as const;
  /** The id stamped on the stored conversation. */
  readonly storedAgentId: string;
  /** The id of the agent it was handed to. */
  readonly agentId: string;

  constructor(door: string, storedAgentId: string, agentId: string) {
    super(
      `${door}: this conversation was recorded by agent '${storedAgentId}' and was handed to ` +
        `agent '${agentId}'. Both agents named themselves with Agent.create({ id }), and the ` +
        `names differ — so this is one agent answering another one's conversation, not a ` +
        `deploy that changed. Continue it on the agent whose id is '${storedAgentId}', or, if ` +
        `handing conversations between these two really is intended, give them the same id. ` +
        `(An agent that merely gained a tool, changed its prompt or moved model since the ` +
        `conversation was stored keeps the same id and is never refused here.)`,
    );
    this.name = 'ConversationMismatchError';
    this.storedAgentId = storedAgentId;
    this.agentId = agentId;
  }
}

/**
 * Refuse a stored conversation that provably belongs to a different agent.
 *
 * Both-sides-named-themselves, or nothing happens. `storedId` is absent on
 * every conversation written before 9.2.0 and on every agent that never chose
 * an id; `agentId` is undefined for the same reason on the reading side.
 *
 * @internal
 */
export function assertContinuable(
  checkpoint: AgentRunCheckpoint,
  agentId: string | undefined,
  door: string,
): void {
  const storedId = checkpoint.agent?.id;
  if (storedId === undefined || agentId === undefined) return;
  if (storedId === agentId) return;
  throw new ConversationMismatchError(door, storedId, agentId);
}

/**
 * The human half of `failurePoint`, as one clause.
 *
 * `"failed at iteration 3 (unknown)"` was what a real production report came
 * back with — a WebKit `fetch` failure is `TypeError: Load failed`, which
 * matches none of {@link classifyFailurePhase}'s patterns, while the run
 * itself knew perfectly well that the LLM call was open at the time. Naming
 * the phase and the stage turns that shrug into a starting point.
 */
function describeFailurePoint(fp: AgentRunCheckpoint['failurePoint']): string {
  if (!fp) return '(phase unknown — nothing was open when it threw)';
  const where =
    fp.phase === 'llm'
      ? 'during the LLM call'
      : fp.phase === 'tool'
      ? 'during a tool call'
      : fp.phase === 'iteration'
      ? 'between iteration boundaries'
      : 'at an unidentified point';
  return fp.stage !== undefined ? `${where} (stage: ${fp.stage})` : where;
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
  /**
   * What is OPEN right now, from the run's own `stream.*` brackets: set on
   * `llm_start` / `tool_start`, cleared on `llm_end` / `tool_end` (8.14.0).
   *
   * OBSERVATION, which is why it exists. {@link classifyFailurePhase} guesses
   * from the error's own name and message and is wrong for every failure that
   * does not describe itself — a browser fetch failure says only
   * `TypeError: Load failed`. This says what the engine was doing, and only
   * falls back to the guess when nothing was open.
   *
   * `stage` holds `'call-llm'` or a declared tool name. Never a URL.
   */
  inFlightPhase?: { readonly phase: 'llm' | 'tool'; readonly stage: string };
}

/**
 * Build a JSON-serializable checkpoint from a tracker + failure
 * info. Pure function — no side effects.
 *
 * @internal
 */
export function buildCheckpoint(
  tracker: RunCheckpointTracker,
  failurePoint?: NonNullable<AgentRunCheckpoint['failurePoint']>,
  /**
   * Spans this run folded, read from committed state by the caller. Passed in
   * rather than tracked, because the tracker follows `history` through events
   * and a fold's span is committed state — and because the same reader then
   * serves both checkpoint carriers, so neither can lose what the other keeps.
   */
  folded?: readonly FoldedSpan[],
  /**
   * Who the run was for and which agent ran it — the two fields that make a
   * stored conversation continuable rather than merely readable (9.2.0).
   * Both are absent unless the caller chose them explicitly; see
   * {@link AgentRunCheckpoint.identity} and {@link AgentRunCheckpoint.agent}.
   */
  owner?: { readonly identity?: MemoryIdentity; readonly agentId?: string },
): AgentRunCheckpoint {
  return {
    version: 1,
    runId: tracker.runId,
    history: tracker.history,
    lastCompletedIteration: tracker.lastCompletedIteration,
    originalInput: tracker.originalInput,
    checkpointedAt: Date.now(),
    ...(failurePoint && { failurePoint }),
    ...(folded !== undefined && folded.length > 0 && { folded }),
    ...(owner?.identity !== undefined && { identity: owner.identity }),
    ...(owner?.agentId !== undefined && { agent: { id: owner.agentId } }),
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
  // The conversation itself, message by message (8.18.0). `Array.isArray` was
  // the whole check, one field away from `originalInput.message` — which HAS
  // been string-checked since this function was written. A checkpoint that
  // round-tripped through a store, a hand edit, or an older writer could carry
  // a turn with no `content`, deserialize cleanly, and take the run down on
  // its first composition with a TypeError naming neither the checkpoint nor
  // the turn. A persisted artifact is checked at the door it comes in.
  for (const [i, msg] of (c.history as readonly unknown[]).entries()) {
    if (!msg || typeof msg !== 'object') {
      throw new TypeError(
        `[resumeOnError] checkpoint history[${i}] is not a message (got ${
          msg === null ? 'null' : typeof msg
        }). Each entry must be { role, content }.`,
      );
    }
    const m = msg as { role?: unknown; content?: unknown };
    if (typeof m.role !== 'string' || typeof m.content !== 'string') {
      throw new TypeError(
        `[resumeOnError] checkpoint history[${i}] is missing text: \`role\` is ${typeof m.role}, ` +
          `\`content\` is ${
            m.content === undefined ? 'missing' : typeof m.content
          }. Every turn in a stored conversation must carry { role: string, content: string } — ` +
          `a turn without content cannot be composed into the next request, and the failure ` +
          `would otherwise surface deep inside the run rather than here.`,
      );
    }
  }
  return c as AgentRunCheckpoint;
}

/**
 * Classify a thrown error into one of the failure-point phase
 * buckets. Heuristic — uses error name / code / message inspection.
 * Fast path returns 'unknown' so unrecognized errors still produce
 * a checkpoint (the cause itself is preserved in
 * `RunCheckpointError.cause`).
 *
 * **The FALLBACK since 8.14.0.** It only runs when the tracker observed no
 * open bracket, because an error's own text is the weakest available evidence
 * about where it happened: `TypeError: Load failed` — WebKit's entire message
 * for a failed `fetch` — matches nothing here and produced `'unknown'` on a
 * real production report while the run knew the LLM call was open. Observation
 * first, this second.
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
