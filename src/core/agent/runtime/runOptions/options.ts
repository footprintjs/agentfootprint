import type { RedactionPolicy } from 'footprintjs';
import type { RunOptions } from '../../../runner.js';
import type { MemoryIdentity } from '../../../../memory/identity/types.js';
import type { RunTime } from '../../../../time/clock.js';

/**
 * `RunOptions` (footprintjs) + agentfootprint-domain correlation fields.
 *
 * `correlationId`/`traceId` are NOT footprintjs concepts — footprintjs's
 * `RunOptions.env` is an intentionally closed infra bag (signal/timeoutMs/
 * traceId only; see footprintjs's `ExecutionEnv`). These two ride separately
 * into the native invocation metadata, then each event's `EventMeta` via `buildEventMeta` (`RunContext` already declares both —
 * `src/bridge/eventMeta.ts`), so a caller can join agentfootprint's event
 * stream against an external system (a upstream request id, an OTEL trace,
 * a cross-tier why() join key) without threading it through tool args.
 *
 * `traceId` here wins over `env.traceId` when both are set; `env.traceId`
 * remains a fallback since footprintjs already threads it to subflows.
 */
export interface AgentRunOptions extends RunOptions {
  /** Domain correlation id — forwarded onto every emitted event's `EventMeta.correlationId`. */
  correlationId?: string;
  /** OTEL-style trace id — forwarded onto every emitted event's `EventMeta.traceId`. Falls back to `options.env?.traceId` when unset. */
  traceId?: string;
  /**
   * The hosting CONVERSATION this run belongs to (9.4.0) — forwarded onto
   * every emitted event's `EventMeta.sessionId`, and from there into whatever
   * an observability strategy ships (the CloudWatch/AgentCore adapters
   * serialize the whole envelope, so it arrives without their knowing).
   *
   * `runId` is per run; a session spans many. Without this, a shipped event
   * stream can answer "what happened in this run?" and not "what happened in
   * this conversation?", which is the question a session-oriented host is
   * built around. `standingAgent` sets this for you from the request's own
   * session id, on both `run()` and `resume()`.
   *
   * **It also decides the memory namespace when you named no identity
   * (9.10.0):** a run with a session and no `identity` scopes its memory to
   * `{ conversationId: sessionId }`, because a hosting session IS a
   * conversation. An `identity` you pass always wins. See
   * {@link AgentInput.identity} for the full ladder.
   *
   * Omit it for an unhosted run. It is never derived, guessed, or defaulted to
   * the runId: an absent session and an invented one are different facts.
   */
  sessionId?: string;
  /**
   * Who this run is for — the same tuple as `run({ identity })`, reachable
   * from the doors whose input is a stored conversation rather than a
   * message bag: `resumeOnError(checkpoint, { identity })` and
   * `followUp(message, { identity })` (9.2.0).
   *
   * Before this existed, `resumeOnError` could not carry an identity at all,
   * so every continued turn silently re-namespaced its memory under a fresh
   * runId. Omitted, the conversation's own stored `identity` is used; given,
   * it wins. On `run()` this is a second spelling of `run({ identity })` and
   * the one on the input wins, since that is where the caller looked first.
   */
  identity?: MemoryIdentity;
  /**
   * THIS TURN'S CLOCK, on the doors whose input is not a message bag —
   * `followUp(message, { time })`, `resumeOnError(checkpoint, { time })` and
   * `resume(checkpoint, answer, { time })` — read only by an agent with
   * `.time()`, refused on one without. On `run()` it is a second spelling of
   * `run({ time })`, and the one on the input wins. On `resume()` the paused
   * turn's clock is KEPT (its words were resolved against it): a `time` that
   * differs is recorded as a `clock-on-resume` row, never applied.
   */
  time?: RunTime;
  /**
   * A redaction policy the CALLER adds for this run, joined with the agent's
   * own `redact` — it can only add names, never remove one. This is how a
   * policy reaches an agent run on someone else's behalf: a tool that runs
   * another agent hands it the policy its own run is covered by, exactly as it
   * hands `ctx.signal`:
   *
   * ```ts
   * execute: (args, ctx) => specialist.run({ message: args.text }, {
   *   ...(ctx.signal && { env: { signal: ctx.signal } }),
   *   ...(ctx.redact && { redact: ctx.redact }),
   * })
   * ```
   *
   * Validated like `Agent.create({ redact })`. A pause carries it: the run
   * commits it to its own state (`runRedaction`: its names, and each pattern
   * as a reference), so `resume()` covers the resumed leg by it without being
   * handed it again — except a pattern of your own, which is never compiled
   * from a checkpoint: pass the same `redact` to `resume()` (or declare it on
   * the agent), or the resume is refused (`ResumeRedactionError`,
   * `'unknown-pattern'`). A `redact` passed to `resume()` adds to it. A
   * conversation continued from the run (`followUp`, `continueFrom`) is a new
   * run, covered by what it is given.
   */
  redact?: RedactionPolicy;
}
