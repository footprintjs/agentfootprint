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
 *          for later restoration. The same pattern as `FlowchartCheckpoint`
 *          but at the agent layer (one logical iteration vs. one
 *          DFS stage). Each checkpoint has its own reader and resume contract.
 */

import type { AgentRunCheckpoint, EvidenceRecoveryCheckpoint } from './runCheckpointTypes.js';
import type { LLMMessage } from '../provider-contract/types.js';
import type { ReplayPreparation } from '../thinking/replay.js';
import { replayRetirements, type ReplayRetirement } from '../thinking/replayHistory.js';
import {
  isContextWindowExceeded,
  looksLikeContextWindowExceeded,
} from '../provider-contract/contextWindow.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { FoldedSpan } from './agent/window/types.js';
import type { FindingsLedger } from './agent/findings/types.js';
import { MAX_EVIDENCE_RECOVERY_CHARS } from './agent/evidence/recovery.js';
import { checkpointWithCarriers } from './agent/sourceEvidence/checkpointValidation.js';
import { verificationCheckpointOf } from './agent/findings/verificationCheckpoint.js';
import {
  negativeCheckpointOf,
  type NegativeCheckpoint,
} from './agent/negativeClaims/checkpoint.js';
import type { ClaimVerificationState } from './agent/findings/verificationState.js';
import { carriedTicketsOf, ticketsStillServed } from './agent/placedTickets.js';
import { admitStoredHistory, checkpointReplayHistory } from './checkpointHistory.js';
import { validateCheckpointLedger } from './checkpointLedger.js';
import {
  admitRequestReplayCheckpoint,
  captureRequestReplayCheckpoint,
} from './agent/requestTurn/checkpoint.js';
import {
  admitToolTurnEvidence,
  toolTurnEvidenceFrom,
} from './agent/recordedCalls/toolTurnCheckpoint.js';
import {
  admitFoldedInnerCallPolicy,
  innerCallPolicyFor,
  innerCallPolicyOf,
  innerCallPolicyReferences,
} from '../redaction/innerCallPolicyCarrier.js';
import type { SourceEvidenceIndex } from '../artifacts/sourceEvidence/types.js';
import {
  sourceDeclarationCorrectionOf,
  sourceEvidenceOf,
} from './agent/runtime/conversation/checkpointParts.js';

// ─── Public types ────────────────────────────────────────────────────

export type { AgentRunCheckpoint, EvidenceRecoveryCheckpoint } from './runCheckpointTypes.js';
export { classifyFailurePhase } from './checkpointFailurePhase.js';

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
        `${resumeAdvice(cause)} ` +
        `Underlying error: ${cause.message}`,
    );
    this.name = 'RunCheckpointError';
    this.cause = cause;
    this.checkpoint = checkpoint;
    if (checkpoint.innerCallPolicyArgs !== undefined)
      Object.defineProperty(this, 'checkpoint', { enumerable: false });
  }
}

// ─── Can this failure be resumed at all? (9.6.0) ─────────────────────

/**
 * Why `resumeOnError` cannot help — one clause per class, or `undefined`
 * when the failure really is worth retrying.
 *
 * `resumeOnError(checkpoint)` re-sends the checkpointed conversation to the
 * same provider with the same credentials. That is the right move for a
 * transient failure (a 503, a timeout, a circuit that has since closed) and a
 * DETERMINISTIC LOOP for a failure the request itself causes: measured in the
 * field, a context-length refusal resumed into the identical 400, forever.
 *
 * The list is deliberately short. Anything not named here keeps today's
 * advice, because wrongly telling a caller not to resume costs them a run
 * that would have succeeded.
 */
function notResumableBecause(cause: unknown): string | undefined {
  // The typed error when an adapter caught it, and the vendor's own sentence
  // when it came from somewhere else — a custom `LLMProvider`, a gateway
  // wrapper, a proxy. The advice is the same either way, and it is the advice
  // the field case needed: that error never passed through an adapter and
  // would otherwise have fallen into the generic "malformed request" arm.
  if (isContextWindowExceeded(cause) || looksLikeContextWindowExceeded(cause)) {
    return (
      `Resume cannot help: agent.resumeOnError(checkpoint) re-sends this same ` +
      `conversation, and the conversation is what did not fit — the identical ` +
      `request fails identically. Make the next request smaller instead: cap ` +
      `oversized tool results where they are produced, add ` +
      `.window(slidingWindow({ keepRecentTurns: 2 })) to drop older rounds, and ` +
      `note that .compaction() cannot fold a span bigger than the window (its ` +
      `summarizer call sends that span). The checkpoint still carries the full ` +
      `history — keep it for the post-mortem (checkpoint.history is what was ` +
      `about to be sent), not for a retry.`
    );
  }

  const status = statusOf(cause);
  const name = cause instanceof Error ? cause.name : '';
  const text = cause instanceof Error ? cause.message : '';

  if (status === 401 || status === 403 || AUTH_NAMES.test(name) || AUTH_PHRASES.test(text)) {
    return (
      `Resume cannot help: the provider rejected the CREDENTIALS, and resume ` +
      `replays the run with the same ones. Fix the key / role / region and start ` +
      `a fresh run — the checkpoint keeps the conversation meanwhile, so nothing ` +
      `said so far is lost (checkpoint.history).`
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    return (
      `Resume cannot help: the provider refused the REQUEST itself (HTTP ` +
      `${status}), and resume re-sends the same one. Fix what it named — an ` +
      `unknown model id, a malformed tool schema, an unsupported parameter — ` +
      `then start a fresh run. The checkpoint keeps the conversation for the ` +
      `post-mortem (checkpoint.history).`
    );
  }

  return undefined;
}

/**
 * Auth failures that arrive without a status — matched on the vendor's
 * EXCEPTION NAME (AWS SDK errors carry theirs there) rather than on loose
 * prose, so a tool that happens to report "unauthorized" from some downstream
 * system is not mistaken for the agent's own credentials being wrong.
 */
const AUTH_NAMES =
  /^(UnrecognizedClientException|ExpiredTokenException|InvalidSignatureException|IncompleteSignatureException|MissingAuthenticationTokenException|InvalidClientTokenId|AccessDenied\w*|AuthFailure|CredentialsError|UnauthorizedException|AuthenticationError|PermissionDeniedError)$/i;

/** The two phrasings every LLM vendor uses for "that key is not a key". */
const AUTH_PHRASES = /(invalid[_ -]?api[_ -]?key|incorrect api key|no api key provided)/i;

function statusOf(err: unknown): number | undefined {
  const record = err as {
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  for (const value of [record?.status, record?.statusCode, record?.$metadata?.httpStatusCode]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Can `agent.resumeOnError(checkpoint)` plausibly succeed for this failure?
 *
 * `true` for the transient classes resume exists for; `false` for the ones
 * where replaying the same request reproduces the same refusal (a request too
 * large for the context window, rejected credentials, a malformed request).
 * Branch on this instead of reading the message — a retry loop that resumes a
 * non-resumable failure is an expensive infinite loop.
 *
 * @example
 * ```ts
 * import { canResume, RunCheckpointError } from 'agentfootprint';
 *
 * try {
 *   await agent.run({ message });
 * } catch (err) {
 *   if (err instanceof RunCheckpointError && canResume(err.cause)) {
 *     await agent.resumeOnError(err.checkpoint);
 *   } else {
 *     throw err; // fix the request; the checkpoint is evidence, not a retry handle
 *   }
 * }
 * ```
 */
export function canResume(error: unknown): boolean {
  return notResumableBecause(error) === undefined;
}

/** Today's hint, verbatim, unless the failure is one resume cannot fix. */
function resumeAdvice(cause: Error): string {
  return notResumableBecause(cause) ?? 'Pass to agent.resumeOnError(checkpoint) to continue.';
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
  /** Explicit prepared thinking edits only; no failed-iteration tool/output state. */
  replayRetirements?: readonly ReplayRetirement[];
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

/** A transport preparation is durable even if its request subsequently fails. */
export function retainReplayRetirements(
  tracker: RunCheckpointTracker,
  preparation: ReplayPreparation,
): void {
  const edits = replayRetirements(preparation);
  if (edits.length === 0) return;
  tracker.replayRetirements = [...(tracker.replayRetirements ?? []), ...structuredClone(edits)];
}

/** Build a storage checkpoint from committed history and failure observations. @internal */
export function buildCheckpoint(
  tracker: RunCheckpointTracker,
  failurePoint?: NonNullable<AgentRunCheckpoint['failurePoint']>,
  /** Compaction spans paired with the committed history. */
  folded?: readonly FoldedSpan[],
  /** The original owner and agent, when the caller named them. */
  owner?: { readonly identity?: MemoryIdentity; readonly agentId?: string },
  skillCursor?: string,
  evidenceRecovery?: EvidenceRecoveryCheckpoint,
  findingsLedger?: FindingsLedger,
  turnNumber?: number,
  /** Private evidence beside the same committed ledger; absent unless explicitly opted in. */
  claimVerification?: ClaimVerificationState,
  negativeClaims?: NegativeCheckpoint,
  sourceEvidence?: SourceEvidenceIndex,
  sourceDeclarationCorrection?: AgentRunCheckpoint['sourceDeclarationCorrection'],
  placed?: unknown,
  state?: unknown,
): AgentRunCheckpoint {
  const verification =
    claimVerification === undefined
      ? undefined
      : verificationCheckpointOf({ claimVerification, findingsLedger: findingsLedger ?? [] });
  const history = checkpointReplayHistory(tracker.history, tracker);
  const placedTickets = ticketsStillServed(placed, history);
  const innerCallPolicyArgs = innerCallPolicyFor(state, history);
  const toolTurnEvidence = toolTurnEvidenceFrom(state);
  const requestReplay = captureRequestReplayCheckpoint(state, history);
  return {
    version: 1,
    runId: tracker.runId,
    history,
    ...(innerCallPolicyArgs !== undefined && { innerCallPolicyArgs }),
    lastCompletedIteration: tracker.lastCompletedIteration,
    originalInput: tracker.originalInput,
    checkpointedAt: Date.now(),
    ...(failurePoint && { failurePoint }),
    ...(toolTurnEvidence !== undefined && { toolTurnEvidence }),
    ...(requestReplay !== undefined && { requestReplay }),
    ...(folded !== undefined && folded.length > 0 && { folded }),
    ...(owner?.identity !== undefined && { identity: owner.identity }),
    ...(owner?.agentId !== undefined && { agent: { id: owner.agentId } }),
    ...(skillCursor !== undefined && { skillCursor }),
    ...(evidenceRecovery !== undefined && { evidenceRecovery }),
    ...(sourceDeclarationCorrection === undefined
      ? {}
      : {
          sourceDeclarationCorrection: sourceDeclarationCorrectionOf({
            sourceDeclarationCorrection,
          }),
        }),
    ...(findingsLedger !== undefined && findingsLedger.length > 0 && { findingsLedger }),
    ...(turnNumber !== undefined && { turnNumber }),
    ...(placedTickets !== undefined && { placedTickets }),
    ...(verification !== undefined && { claimVerification: verification }),
    ...(negativeClaims === undefined ? {} : negativeCheckpointOf(negativeClaims)),
    ...(sourceEvidence === undefined
      ? {}
      : { sourceEvidence: sourceEvidenceOf({ sourceEvidence }) }),
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
  const toolTurnEvidence = admitToolTurnEvidence(c);
  const sourceEvidence = sourceEvidenceOf(c);
  const sourceDeclarationCorrection = sourceDeclarationCorrectionOf(c);
  // Optional fields are validated only when PRESENT — absence is the ordinary
  // pre-SG-C checkpoint and must keep deserializing byte-identically.
  if (c.skillCursor !== undefined && typeof c.skillCursor !== 'string') {
    throw new TypeError(
      `[resumeOnError] checkpoint \`skillCursor\` must be a skill id string when present ` +
        `(got ${typeof c.skillCursor}). It is written by a graph with ` +
        `continuity: 'conversation' and names the node the stored turn ended on.`,
    );
  }
  if (c.evidenceRecovery !== undefined) {
    const recovery = c.evidenceRecovery;
    const pending = recovery?.pending;
    if (
      recovery === null ||
      typeof recovery !== 'object' ||
      Array.isArray(recovery) ||
      recovery.revisionSpent !== true ||
      Object.keys(recovery).some((key) => key !== 'revisionSpent' && key !== 'pending') ||
      (pending !== undefined &&
        (pending === null ||
          typeof pending !== 'object' ||
          Array.isArray(pending) ||
          Object.keys(pending).some((key) => key !== 'instruction' && key !== 'conclusion') ||
          (pending.conclusion !== undefined &&
            (typeof pending.conclusion !== 'string' ||
              pending.conclusion.length === 0 ||
              pending.conclusion.length > MAX_EVIDENCE_RECOVERY_CHARS)) ||
          typeof pending.instruction !== 'string' ||
          pending.instruction.length === 0 ||
          pending.instruction.length > MAX_EVIDENCE_RECOVERY_CHARS))
    ) {
      throw new TypeError(
        '[resumeOnError] checkpoint evidenceRecovery must carry a spent revision and optional bounded instruction.',
      );
    }
  }
  validateCheckpointLedger(c);
  // The two checkpoint carriers use one admission rule. Only a present opted-in
  // carrier is copied/validated; every old checkpoint keeps its return identity.
  let claimVerification: ClaimVerificationState | undefined;
  try {
    claimVerification = verificationCheckpointOf(c);
  } catch {
    throw new TypeError('[resumeOnError] checkpoint claimVerification is malformed.');
  }
  // The turn the stored history ends on (honesty layers), by the same
  // present-only rule: a checkpoint without the key is every conversation
  // stored without a layer armed. When present it is a turn — a positive
  // whole number — because the next run's turn stamp starts from it.
  const turn = c.turnNumber;
  if (turn !== undefined && (!Number.isSafeInteger(turn) || turn < 1)) {
    throw new TypeError(
      `[resumeOnError] checkpoint \`turnNumber\` must be a positive whole number when present ` +
        `(got ${JSON.stringify(turn) ?? typeof turn}). It is the conversation ` +
        `turn the stored history ends on, written while an honesty layer is armed.`,
    );
  }
  admitStoredHistory(c.history, c.folded);
  const requestReplay = admitRequestReplayCheckpoint(c, c.history);
  innerCallPolicyReferences(c.history);
  admitFoldedInnerCallPolicy(c.folded);
  const innerCallPolicyArgs = innerCallPolicyOf(c);
  negativeCheckpointOf(c);
  if (c.placedTickets !== undefined) carriedTicketsOf(c.placedTickets);
  const checkpoint = checkpointWithCarriers(c, claimVerification, sourceEvidence);
  return sourceDeclarationCorrection === undefined &&
    innerCallPolicyArgs === undefined &&
    toolTurnEvidence === undefined &&
    requestReplay === undefined
    ? checkpoint
    : {
        ...checkpoint,
        ...(sourceDeclarationCorrection !== undefined && { sourceDeclarationCorrection }),
        ...(innerCallPolicyArgs !== undefined && { innerCallPolicyArgs }),
        ...(toolTurnEvidence !== undefined && { toolTurnEvidence }),
        ...(requestReplay !== undefined && { requestReplay }),
      };
}
