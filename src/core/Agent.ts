import { AgentRuntimeHost, getAgentRuntime } from './agent/runtime/native/host.js';

import type { AgentRunOptions } from './agent/runtime/runOptions/options.js';
export type { AgentRunOptions } from './agent/runtime/runOptions/options.js';

import { type AroundTurn } from './agent/aroundTurn/index.js';

/**
 * Agent — ReAct primitive (LLM + tools + iteration loop).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 * Role:    Layer-5 primitive (core/). Assembles the 3-slot context
 *          pipeline + callLLM + route decider + tool-calls subflow +
 *          loopTo. Composition nestable anywhere that accepts a Runner.
 * Emits:   Via internal recorders:
 *            agentfootprint.agent.turn_start / turn_end
 *            agentfootprint.agent.iteration_start / iteration_end
 *            agentfootprint.agent.route_decided
 *            agentfootprint.stream.llm_start / llm_end
 *            agentfootprint.stream.tool_start / tool_end
 *            agentfootprint.context.* (via ContextRecorder)
 */

import {
  type CombinedNarrativeEntry,
  type FlowchartCheckpoint,
  type ObserverDrainResult,
  type RuntimeSnapshot,
} from 'footprintjs';

import type { CachePolicy, CacheStrategy } from '../cache/types.js';
import type { ReliabilityConfig } from '../reliability/types.js';

import { type RunnerPauseOutcome } from './pause.js';

import type { ArtifactStore } from '../artifacts/types.js';

import type { AgentfootprintEvent } from '../events/registry.js';

import type { SkillGraphDeclaredMap } from './agent/skillGraphDeclared.js';
import type { AppliedRecipe } from '../recipes/types.js';

import type { WindowStrategy } from './agent/window/strategy.js';

import type { AnswerAssessment, AssessmentDeclarations } from './agent/assessment/types.js';
import { type CheckInBuilderOptions } from './checkin.js';

import type { MemoryDefinition } from '../memory/define.types.js';

import type { SelfExplainBinding } from '../trace-toolpack/selfExplain.js';

import { type ChildOutcome } from './terminalVerdict.js';

import type { ResolvedEvidenceGate } from './agent/evidence/types.js';
import type { ResolvedScriptTravel } from './agent/scripts/types.js';

import type { Injection, InjectionContext } from '../injection-engine/types.js';
import type { CursorMove, EntryScoring, TurnRoutingPlan } from '../injection-engine/skillGraph.js';

import { type ResolvedOutputFallback } from './outputFallback.js';
import { type AgentRunCheckpoint } from './runCheckpoint.js';

import { type OutputSchemaParser } from '../answer-validation/outputSchema.js';

import '../time/rows.js';

import type { ResolvedOutputEnforcement } from './agent/outputEnforcement.js';

import type { ToolRegistryEntry } from '../tools/tools.js';
import type { ToolProvider } from '../tools/toolProvider.js';

import type {
  AgentArtifactsOptions,
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentRecordingsOptions,
  AgentState,
  ObserverDeliveryOptions,
  RunConfig,
  RunConfigContext,
  RunConfigFn,
  WriteProvenanceMode,
} from './agent/types.js';

import type { ResolvedNegativeClaims } from './agent/negativeClaims/config.js';

import type { AnswerNegatives } from './agent/negativeClaims/delivery.js';

import type { AnswerCoverage } from '../semantics/coverage/answer.js';
import {
  type AnswerValidationReport,
  type ResolvedAnswerValidation,
} from '../answer-validation/index.js';

import type { MessageMiddleware, ToolMiddleware } from './agent/middleware/types.js';

import { AgentBuilder } from './agent/AgentBuilder.js';
export type { SkillGraphOptions } from './agent/AgentBuilder.js';
// Per-skill model switching (9.19.0) — the declared brain shapes.
export type { ProviderChoice, EscalationPolicy } from './agent/skillBrains.js';

import type { ThinkingHandler } from '../thinking/types.js';

export { AgentBuilder };

// Re-export public Agent types so the 28+ existing import sites
// (e.g., `import { type AgentInput } from '../core/Agent.js'`) keep
// working while implementation gradually moves into `./agent/*`.
// Public types canonically live in `./agent/types.ts` (v2.11.1).
export type {
  AgentArtifactsOptions,
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentRecordingsOptions,
  ObserverDeliveryOptions,
  RunConfig,
  RunConfigContext,
  RunConfigFn,
  WriteProvenanceMode,
};
export class Agent extends AgentRuntimeHost {
  declare readonly name: string;

  declare readonly id: string;

  /**
   * Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
   * `appName` is the active actor in narration ("Chatbot called…").
   * `commentaryTemplates` drives Lens's third-person panel.
   * `thinkingTemplates` drives chat-bubble first-person status.
   * Defaults to bundled English; consumer overrides via builder.
   */
  declare readonly appName: string;

  declare readonly commentaryTemplates: Readonly<Record<string, string>>;

  declare readonly thinkingTemplates: Readonly<Record<string, string>>;
  constructor(
    opts: AgentOptions,
    systemPromptValue: string,
    registry: readonly ToolRegistryEntry[],
    voice: {
      readonly appName: string;
      readonly commentaryTemplates: Readonly<Record<string, string>>;
      readonly thinkingTemplates: Readonly<Record<string, string>>;
    },
    injections: readonly Injection[] = [],
    memories: readonly MemoryDefinition[] = [],
    outputSchemaParser?: OutputSchemaParser<unknown>,
    toolProvider?: ToolProvider,
    systemPromptCachePolicy: CachePolicy = 'always',
    cachingDisabled = false,
    cacheStrategy?: CacheStrategy,
    outputFallbackCfg?: ResolvedOutputFallback<unknown>,
    reliabilityConfig?: ReliabilityConfig,
    thinkingHandlerValue?: ThinkingHandler | null,
    thinkingBudgetValue?: number,
    skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined,
    skillGraphReachable?: (currentSkillId?: string) => readonly string[],
    skillGraphScoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>,
    checkInOptions?: CheckInBuilderOptions,
    runConfigFn?: RunConfigFn,
    windowStrategy?: WindowStrategy,
    toolMiddleware?: readonly ToolMiddleware[],
    messageMiddleware?: readonly MessageMiddleware[],
    outputEnforcement?: ResolvedOutputEnforcement,
    skillGraphEdgeTargets?: readonly string[],
    skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove,
    skillGraphIsTree?: boolean,
    skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[],
    skillGraphCascade?: {
      readonly turnRouting?: TurnRoutingPlan;
      readonly strictness: 'assist' | 'guard' | 'rails';
      readonly continuity: 'turn' | 'conversation';
      readonly nodeIds: ReadonlySet<string>;
    },
    skillBrains?: import('./agent/skillBrains.js').FoldedSkillBrains,
    evidenceGate?: ResolvedEvidenceGate,
    limitsTravelWithTheAnswer?: boolean,
    recipes?: readonly AppliedRecipe[],
    skillGraphDeclared?: SkillGraphDeclaredMap,
    mapsPlan?: import('../maps/engagement/types.js').EngagementPlan,
    claimContract?: readonly import('../integrity/unsupported-claim/check.js').DeclaredClaim[],
    answerValidationConfig?: ResolvedAnswerValidation,
    systemPromptCacheExplicit = false,
    negativeClaimsConfig?: ResolvedNegativeClaims,
    scriptTravel?: ResolvedScriptTravel,
    aroundTurn?: AroundTurn,
  ) {
    super(
      OWN_TURN_METHODS,
      opts,
      systemPromptValue,
      registry,
      voice,
      injections,
      memories,
      outputSchemaParser,
      toolProvider,
      systemPromptCachePolicy,
      cachingDisabled,
      cacheStrategy,
      outputFallbackCfg,
      reliabilityConfig,
      thinkingHandlerValue,
      thinkingBudgetValue,
      skillGraphNextSkill,
      skillGraphReachable,
      skillGraphScoreEntries,
      checkInOptions,
      runConfigFn,
      windowStrategy,
      toolMiddleware,
      messageMiddleware,
      outputEnforcement,
      skillGraphEdgeTargets,
      skillGraphExplainNextSkill,
      skillGraphIsTree,
      skillGraphSupersededEntries,
      skillGraphCascade,
      skillBrains,
      evidenceGate,
      limitsTravelWithTheAnswer,
      recipes,
      skillGraphDeclared,
      mapsPlan,
      claimContract,
      answerValidationConfig,
      systemPromptCacheExplicit,
      negativeClaimsConfig,
      scriptTravel,
      aroundTurn,
    );
  }
  static create(opts: AgentOptions): AgentBuilder {
    return new AgentBuilder(opts);
  }

  /**
   * Cache policy for the base system prompt. Read by the CacheDecision
   * subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
   * cache markers. Exposed as a method (not direct field access) so
   * the Agent's encapsulation boundary stays clean.
   */
  getSystemPromptCachePolicy(): CachePolicy {
    return getAgentRuntime(this).getSystemPromptCachePolicy();
  }

  /**
   * The artifact store this agent was built with, or `undefined` when none
   * was attached (9.23.0).
   *
   * For COMPOSERS that resolve refs on the agent's behalf — the hosting
   * layer's `artifact-head` / `artifact-get` wire operations redeem a
   * screen's claim tickets against exactly this store. It is the store, not
   * a scope-bound capability: whoever calls it owns composing the resolution
   * scope (the hosting layer composes the requesting session's identity, the
   * same tuple the run's own tools resolved under). Tools never touch this —
   * `ctx.artifacts` is already bound to the run's scope, and that remains
   * their only door.
   */
  getArtifactStore(): ArtifactStore | undefined {
    return getAgentRuntime(this).getArtifactStore();
  }

  /**
   * Does `event` belong to the run this agent is serving (or served last)? The
   * run-membership rule (`bridge/eventMeta.ts · eventBelongsToRun`) against
   * this instance's run context — asked by the per-run recording and by the
   * self-explain evidence, the two collectors that keep one run's events.
   *
   * @internal
   */
  ownsEvent(event: AgentfootprintEvent): boolean {
    return getAgentRuntime(this).ownsEvent(event);
  }

  /**
   * The footprintjs `RuntimeSnapshot` from the most recent `run()` /
   * `resume()`. Feeds Lens's Trace tab (ExplainableShell `runtimeSnapshot`
   * prop) so consumers can scrub the execution timeline post-run without
   * threading a recorder through the call site.
   *
   * `undefined` until a run has STARTED. After that it is the most recent
   * run's snapshot — including across multiple turns of the same instance.
   *
   * **It is LIVE during a run, not a completed-runs-only view.** The executor
   * is assigned at run start, so calling this from an event listener, a tool,
   * or any other mid-run vantage point returns the IN-FLIGHT run, partially
   * filled. That is deliberate (Lens scrubs a running agent through it), and
   * it is why `.selfExplain()` captures at the terminal flush instead of
   * resolving through this: evidence that is supposed to describe a FINISHED
   * turn cannot be read from a getter that also answers about an unfinished
   * one.
   *
   * **Under `redact` it is the SERVED snapshot** — footprintjs's redacted view
   * (`RunnerBase.getLastSnapshot`): the placeholder wherever the policy
   * selected a value, and no `initialState`. The agent's own logic never reads
   * this getter; `checkpoint()`, `followUp()` and the crash checkpoint read the
   * live run, so redaction never changes what the agent continues from.
   */
  override getLastSnapshot(): RuntimeSnapshot | undefined {
    return getAgentRuntime(this).getLastSnapshot();
  }

  /**
   * Structured narrative entries from the most recent run. Pairs with
   * `getLastSnapshot()` for ExplainableShell's `narrativeEntries` prop.
   * Empty array (not `undefined`) when no run has completed — matches
   * the prop's expected shape so consumers can wire it directly without
   * a defensive guard.
   *
   * Under `redact`, footprintjs wrote these lines through the run's rule: a
   * read or write of a selected key reads `[REDACTED]`, and an `[emit]` line
   * shows the event's served payload (`src/redaction/runRedaction.ts`).
   */
  /** Empty during preparation before native origin; capture prior entries before the next call. */
  getLastNarrativeEntries(): readonly CombinedNarrativeEntry[] {
    return getAgentRuntime(this).getLastNarrativeEntries();
  }

  /**
   * Parse + validate a raw agent answer against the agent's
   * `outputSchema` parser. Throws `OutputSchemaError` on JSON parse
   * or schema validation failure (the rawOutput is preserved on the
   * error for triage). Throws a plain `Error` if the agent has no
   * outputSchema set.
   *
   * Use this when you need to keep `agent.run()` returning the raw
   * string for logging/observability and validate at a different
   * layer; otherwise prefer `agent.runTyped()`.
   */
  parseOutput<T = unknown>(raw: string): T {
    return getAgentRuntime(this).parseOutput<T>(raw);
  }

  /**
   * Async sister of `parseOutput()`. When the agent is configured
   * with `.outputFallback({...})`, this is the version that engages
   * the 3-tier degradation chain on validation failure (the sync
   * `parseOutput` always throws on failure for back-compat).
   *
   * Without `outputFallback`, behaves identically to `parseOutput`
   * — returns sync-style on the happy path, throws OutputSchemaError
   * on validation failure.
   */
  parseOutputAsync<T = unknown>(raw: string): Promise<T> {
    return getAgentRuntime(this).parseOutputAsync<T>(raw);
  }

  /**
   * Run the agent and return the schema-validated typed output.
   * Convenience over `parseOutputAsync(await agent.run({...}))`.
   *
   * Throws `OutputSchemaError` on parse / validation failure UNLESS
   * `.outputFallback({...})` is configured, in which case the
   * 3-tier degradation chain (primary → fallback → canned) engages.
   *
   * Throws if the agent has no outputSchema set or if the run
   * pauses (use `run()` directly when pauses are expected).
   *
   * With `.limitsTravelWithTheAnswer()`, nothing is appended to a typed
   * answer: the limits its tools declared come back as data, from
   * `agent.answerCoverage()`.
   */
  runTyped<T = unknown>(input: AgentInput | string, options?: AgentRunOptions): Promise<T> {
    return getAgentRuntime(this).runTyped<T>(input, options);
  }

  /**
   * Answer one turn.
   *
   * **`run()` is ONE turn, and it starts a new conversation every time.** The
   * chart seeds its history from this call's `message` alone, so a second
   * `run()` on the same agent does not continue the first: the model is shown
   * one user message and will honestly tell your user it has not spoken to
   * them before. That is deliberate — a primitive that quietly accumulated
   * state across calls could never be used for one-shot work, and a hidden
   * transcript is the most expensive thing an agent can carry.
   *
   * To continue a conversation, name it:
   *
   *   - `agent.followUp(message)` — continue THIS agent's own last completed
   *     run. The one-liner, and what most callers want.
   *   - `run({ message, continueFrom })` — continue a conversation you are
   *     holding: `agent.checkpoint()` from an earlier turn, persisted anywhere
   *     and handed back. Works across a restart, a deploy, or a different
   *     machine, and is what `standingAgent` uses per session.
   *
   * Passing the same `identity.conversationId` to two `run()` calls does NOT
   * continue anything — see {@link AgentInput.identity}. What a registered
   * memory adds is *recall* of prior turns into the system-prompt slot, which
   * is a different thing from the conversation itself.
   *
   * Two refusals guard the per-instance state this agent keeps; both replace
   * behavior that used to succeed while quietly being wrong (9.2.0):
   * {@link RunInFlightError} when a run is already in flight, and
   * {@link PendingQuestionError} when the last run paused to ask a person
   * something that nobody has answered.
   *
   * @example  One turn, then a follow-up
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * await agent.followUp('Make it three.');       // remembers the table
   * ```
   */
  run(
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    return getAgentRuntime(this).run(input, options);
  }

  /**
   * Continue this agent's own last completed conversation.
   *
   * The one-liner for turn two and after. `run()` is one turn and starts a new
   * conversation each time (see {@link Agent.run}); this reads the
   * conversation off the last completed run, appends `message` as the next
   * user turn, and runs from there — so the model sees what was actually said.
   *
   * Sugar over `run({ message, continueFrom: this.checkpoint() })` and nothing
   * more: one restoration path, so the convenience cannot drift from the
   * mechanism. Reach for `run({ continueFrom })` directly when the
   * conversation comes from somewhere other than this instance's last run — a
   * store, another process, a different machine.
   *
   * Refuses rather than guessing: {@link NoConversationError} when this agent
   * has no completed run to continue (a "follow-up" that quietly became a
   * first turn would be exactly the confusion this door exists to remove),
   * and — through `run()` — {@link PendingQuestionError} when the last run
   * paused to ask a person something, because a pause has its own door:
   * `resume(checkpoint, decision)`.
   *
   * The conversation grows every turn and nothing here trims it; bounding what
   * the model is shown is `.window()` / `.compaction()` / `.memory()`, not a
   * silent cap on the way through.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * await agent.followUp('Make it three.');
   * await agent.followUp('And move it to 8pm.');
   * ```
   */
  followUp(message: string, options?: AgentRunOptions): Promise<AgentOutput | RunnerPauseOutcome> {
    return getAgentRuntime(this).followUp(message, options);
  }

  /**
   * Drop the question this agent's last run paused to ask, on the record.
   *
   * A paused run is waiting on a person. Sending a different message while one
   * is outstanding is refused ({@link PendingQuestionError}) because silently
   * discarding a pending question makes a consent gate something any later
   * message can walk around. When the question really is being dropped —
   * the user changed the subject, the session timed out, the approval is no
   * longer wanted — say so with this, and the next `run()` proceeds.
   *
   * Returns what was dropped (`undefined` when nothing was pending), so a
   * caller can log or audit the abandonment rather than perform it blind. It
   * does not touch the paused run's checkpoint: if you still hold that, it
   * remains resumable.
   */
  abandonPause(): Promise<
    | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
    | undefined
  > {
    return getAgentRuntime(this).abandonPause();
  }

  /**
   * Whether {@link Agent.selfExplain}'s why-questions have a run to answer
   * from right now.
   *
   * `false` for two different reasons, both honest: this agent was not built
   * with `.selfExplain()`, or it was and no turn has completed yet (evidence
   * binds at the END of a run, never to the one in flight). Either way there
   * is nothing to explain, which is what a caller routing a why-question needs
   * to know before it routes.
   *
   * The model is told the same thing by the same fact — the trace tools answer
   * "No completed run is available yet" and the skill body says to say so
   * plainly. This is that answer, for the program.
   *
   * Evidence is kept per conversation, so on an agent serving several sessions
   * this answers for the session of the run in flight — or, between runs, of
   * the run served last.
   */
  canExplain(): boolean {
    return getAgentRuntime(this).canExplain();
  }

  /**
   * Resume an agent run from a checkpoint produced by a prior
   * `RunCheckpointError`. Unlike `agent.resume()` (which takes a
   * `FlowchartCheckpoint` from an intentional pause), this takes
   * an `AgentRunCheckpoint` (conversation-history snapshot) and
   * replays the agent run with that history restored.
   *
   * The next iteration retries the call that originally failed —
   * with the latest provider state (circuit breaker may have
   * closed, vendor may have recovered, etc.).
   *
   * **Resume = REPLAY from the last completed iteration boundary,
   * not exact-state restore.** Only the conversation history is
   * restored; everything else re-seeds fresh:
   *
   *   - **Tool re-execution / idempotency**: tool side effects from
   *     the FAILED iteration are not in the checkpoint. The model
   *     re-decides from the restored history and may re-issue those
   *     tool calls — they WILL execute again (there is no built-in
   *     toolCallId dedup). Mutating tools (payments, emails, DB
   *     writes) must be idempotent — key on stable call content, not
   *     `ctx.toolCallId` (a re-issued call gets a new id).
   *   - **Fresh `runId`**: the resumed run's events carry a new
   *     `runId`; use `checkpoint.runId` to correlate back to the
   *     failing run.
   *   - **Iteration counter + budget reset**: the resumed run starts
   *     at iteration 1 with a full `maxIterations` budget
   *     (`checkpoint.lastCompletedIteration` is diagnostic only).
   *     Token/cost accumulators also restart at zero.
   *
   * @example
   * ```ts
   * try {
   *   const result = await agent.run({ message: 'long task' });
   * } catch (err) {
   *   if (err instanceof RunCheckpointError) {
   *     await checkpointStore.put(sessionId, err.checkpoint);
   *     // hours / restart later:
   *     const checkpoint = await checkpointStore.get(sessionId);
   *     const result = await agent.resumeOnError(checkpoint);
   *   }
   * }
   * ```
   */
  resumeOnError(
    checkpoint: AgentRunCheckpoint | unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    return getAgentRuntime(this).resumeOnError(checkpoint, options);
  }

  /**
   * Continue a run that paused to ask a person something, with their answer.
   *
   * WHO the resumed run is for is the paused run's caller, read off the
   * checkpoint (`agent/callerIdentity.ts`) — never whatever this instance ran
   * last; the session is the paused run's. A supplied `sessionId` must match. A
   * checkpoint names who it is for; it is not proof: a host that lets
   * checkpoints leave its trust boundary signs them or keeps them
   * server-side, and passes the identity it verified as `options.identity`.
   *
   * @throws ResumeIdentityConflictError when `options.identity` is not the
   *   paused run's caller identity — before anything runs.
   * @throws DecisionRequiredError when a consent gate is answered with
   *   something other than a decision.
   * @throws ResumeDecisionError when the decision does not answer the request
   *   this run is paused on: it names no request, another request, a call the
   *   checkpoint no longer holds (refused before anything runs), or a request
   *   a resume already answered (refused before the tool runs). The tool never
   *   runs on a refusal.
   * @throws RunInFlightError when a run is already in flight.
   *
   * @example
   * ```ts
   * const outcome = await agent.run({ message: 'refund me', identity }, { sessionId });
   * if (isPaused(outcome)) await agent.resume(outcome.checkpoint, 'yes', { identity, sessionId });
   * ```
   */
  resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    return getAgentRuntime(this).resume(checkpoint, input, options);
  }

  /**
   * The conversation this agent's LAST completed run leaves behind, packed as
   * the same `AgentRunCheckpoint` that `resumeOnError(...)` accepts. Store it,
   * hand it back next turn, and the agent continues where it left off — across
   * a restart, a deploy, or a different machine.
   *
   * Returns `undefined` before any run has completed or when the latest run
   * was refused by input middleware. A refused input is not an admitted
   * conversation. Keep an earlier accepted checkpoint to continue explicitly;
   * `followUp()` after input denial raises `NoConversationError`.
   *
   * **Read from the run's own committed state, not from a second copy.** The
   * history comes from the LIVE snapshot's `sharedState.history` — the state
   * the run actually committed, never the served record (an agent's `redact`
   * keeps the conversation out of `getLastSnapshot()`, never out of the
   * conversation it continues) — cloned on the way out so a persistence layer
   * can never mutate the live heap. The final assistant turn is appended from the answer
   * `run()` returned, because nothing ever writes it back into `history`: the
   * loop appends assistant turns only when they carry tool calls, and the turn
   * that ends the run carries none. An agent that stored this conversation
   * without that append would drop its own reply every turn and answer the next
   * one having forgotten what it just said.
   * Provider replay evidence and its normalized thinking travel with that
   * accepted answer, including a terminal proof with empty text. The answer
   * remains the delivered text, including output-policy edits; raw provider
   * text is never substituted back. Evidence comes from live state, not the
   * redacted observation. Denied, failed and paused runs append no final turn.
   *
   * Explicit thinking retirements recorded before transport also apply here:
   * a failed grouped call cannot restore reasoning omitted from its request.
   * This copies no other failed-stage state or tool effects into the history.
   * Adds no events, no scope writes and no capture: every recording is
   * byte-identical to an agent that never calls this.
   *
   * After a run that **paused**, this is the conversation as of the pause, with
   * no answer appended — a pause is unfinished work, and pause/resume has its
   * own carrier (`FlowchartCheckpoint`) that holds engine state this shape
   * cannot.
   *
   * The conversation grows every turn and nothing here trims it. Bounding what
   * the model is shown is the memory subsystem's job (`.memory(...)`), not a
   * silent cap applied on the way to storage.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * const conversation = agent.checkpoint();          // persist anywhere
   * // …a restart later, on a fresh Agent:
   * await agent.run({ message: 'Make it three.', continueFrom: conversation });
   * // `continueFrom` admits the new turn through the 'input' middleware chain.
   * // `resumeOnError` rechecks originalInput but replays stored history as-is;
   * // it does not rewrite entries manually appended to that history.
   * ```
   */
  /** During preparation before native origin this is undefined; capture before the next call. */
  checkpoint(): AgentRunCheckpoint | undefined {
    return getAgentRuntime(this).checkpoint();
  }

  /**
   * Hand the `.selfExplain()` binding to the agent that owns it.
   *
   * Called once by `AgentBuilder.build()`, immediately after `bindTo`. The
   * binding stays the tool provider's to read; the Agent holds it only so
   * `canExplain()` answers from the same fact the trace tools answer from,
   * rather than from a second guess about whether a run has completed.
   *
   * @internal
   */
  bindSelfExplain(binding: SelfExplainBinding): void {
    return getAgentRuntime(this).bindSelfExplain(binding);
  }

  /**
   * Flush the deferred-observer backlog of the most recent run's executor,
   * then await async listener completions under a deadline (RFC-001 §11 —
   * the serverless / graceful-shutdown pattern). Resolves immediately with
   * zeros before the first run or when `observerDelivery` is `'inline'`
   * and no recorder opted into `'deferred'` itself.
   *
   * `pending === 0` means a full drain; non-zero honestly reports
   * continuations still outstanding at the deadline — never silent loss.
   *
   * @example Lambda-style handler
   * ```ts
   * export const handler = async (event) => {
   *   const reply = await agent.run({ message: event.message });
   *   // settle "one beat behind" observer work BEFORE the freeze:
   *   await agent.drainObservers({ timeoutMs: 5_000 });
   *   return reply;
   * };
   * ```
   */
  drainObservers(opts?: { timeoutMs?: number }): Promise<ObserverDrainResult> {
    return getAgentRuntime(this).drainObservers(opts);
  }

  /**
   * Did the last turn stop because a LIMIT cut it short — and if so, which?
   *
   * `undefined` on every normal finish, including a turn that used its whole
   * `maxIterations` budget and then genuinely finished. It is set only when
   * the model was still asking for tools and the run refused to run them:
   * `maxIterations` was reached, or a `costBudget: { onExceed: 'halt' }` was
   * crossed.
   *
   * ## Why this is a method and not part of the answer
   *
   * `run()` resolves to a bare string. There is nowhere in a string to write
   * "…and three tool calls never ran", which is the same wall 8.6.0 hit with
   * an outstanding credential consent — and there the turn raises, because
   * handing back a plausible answer for work a tool never did is a silent
   * success. This is not that. A limit you configured firing is the limit
   * working, and the answer is sometimes real (a model can return content AND
   * tool calls). So it does not raise; it records, in committed state, where
   * it is provable after the fact — `getLastSnapshot().sharedState.stoppedEarly`
   * is the same value (unless the agent's `redact` names it: this accessor
   * reads the live run), and this is the short way to it.
   *
   * When the answer came back EMPTY the library also warns once on the
   * console, because an empty string reaching a user is indistinguishable
   * from a bug.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'audit every log file' });
   * const cut = agent.stoppedEarly();
   * if (cut) {
   *   console.log(`stopped at iteration ${cut.iteration}: ${cut.reason}`);
   *   console.log(`${cut.pendingToolCalls} tool call(s) never ran`);
   * }
   * ```
   */
  stoppedEarly(): AgentState['stoppedEarly'] {
    return getAgentRuntime(this).stoppedEarly();
  }

  /**
   * Did the last turn's answer FAIL this agent's `outputSchema` — and how (8.18.0)?
   *
   * `undefined` when the answer satisfied the contract, and on any agent with
   * no `.outputSchema()`. Set on every run whose final answer was judged and
   * rejected, including the default `retries: 0` case where the first answer is
   * the only one there was.
   *
   * ## Why a method, when `runTyped()` already throws
   *
   * Because `run()` does not, and `run()` is what a server, a queue worker and
   * `standingAgent` call. Before this existed, that caller received a string
   * that violated a contract they had declared, with nothing anywhere saying
   * so: the retries were billed, the ledger row was written under `retries > 0`
   * and absent under `retries: 0`, and the answer looked exactly like a good
   * one. `runTyped()` still throws `OutputSchemaError` — that is the caller
   * ASKING to be raised at, and it is unchanged.
   *
   * `brokenBy` is the case worth a dashboard: the model's answer PASSED and one
   * of your own `act({ output })` rules rewrote it into one that fails. The run
   * stops re-asking when that happens — a deterministic rule breaks the next
   * answer identically, so the retries would be bought for nothing.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'summarise ticket 91' });
   * const unmet = agent.outputContractUnmet();
   * if (unmet) {
   *   log.warn({ stage: unmet.stage, error: unmet.error, brokenBy: unmet.brokenBy });
   *   return safeDefault;               // …rather than shipping `answer` as typed data
   * }
   * ```
   */
  outputContractUnmet(): AgentState['outputContractUnmet'] {
    return getAgentRuntime(this).outputContractUnmet();
  }

  /**
   * Did the last turn's answer state names or numbers that appear in NO tool
   * result (9.35.0)?
   *
   * `undefined` when every value was grounded — and on any agent without
   * `.namesAndNumbersFromEvidence()`. Set on a turn that shipped flagged
   * (`'assist'` / `'guard'`) and on one that was refused (`'rails'`, where
   * `run()` also raised `UnsupportedValuesError`, so this is what a caller
   * reads in the `catch`).
   *
   * `revised: true` means the model was asked once to correct the values and
   * they survived that turn — the fact worth alerting on, because it is a
   * model that cannot ground its own claims rather than one that slipped.
   *
   * Remember what the verdict does NOT say: values were invented. It cannot
   * tell you whether a claim built from real values is true.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'which port is down?' });
   * const bad = agent.unsupportedValues();
   * if (bad) log.warn({ values: bad.values.map((v) => v.value), revised: bad.revised });
   * ```
   */
  unsupportedValues(): AgentState['unsupportedValues'] {
    return getAgentRuntime(this).unsupportedValues();
  }

  /**
   * The last run's findings ledger (9.101.0) — the model's OWN standings on
   * its tool results, as `.findings()` recorded them: `basis` rows (what a
   * call was for, declared before it ran), `standing` rows (`fact` with the
   * assertions stood on, `open`, `ruled-out`, `noise` — the LAST row per
   * `toolCallId` is the current reading; earlier ones are quotable history)
   * and `conflict` rows (two stood-on readings that disagree, witnesses by
   * identity). Undefined when nothing filed a row — never an empty array
   * standing in for "no findings", and an id with no standing row is
   * undeclared, never `open`.
   *
   * THE INPUTS LAYER files here too (honesty layer 2): an agent whose tools
   * declare `askOrAssume` gets `argument` rows — the library's verdict on each
   * ruled argument of each call (`source: 'default'` when a tool's rule
   * assumed the value, `'model'` when the model sent one the record does not
   * trace), each stamped with its conversation `turn` — WITHOUT `.findings()`.
   * A reader that switches over every row kind must skip one it does not know.
   *
   * THE RESULTS LAYER files here too (honesty layer 3, step 7b): `period` rows
   * — one per call whose result declared the period its read covered, or whose
   * tool declares a period argument: `covered`, `partly-held`, `not-held`,
   * `unknown`, or `undeclared` (the result said nothing about its period).
   *
   * Detached from the execution record (`structuredClone`), so a caller may
   * keep or mutate it without touching the run's state.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'which port is down?' });
   * const current = new Map<string, string>();
   * for (const row of agent.findings() ?? []) {
   *   if (row.kind === 'standing') current.set(row.toolCallId, row.standing);
   * }
   * ```
   */
  findings(): AgentState['findingsLedger'] {
    return getAgentRuntime(this).findings();
  }

  /** The library-composed negative statements and their recorded limits.
   * Detached, in-process data for the caller. Record redaction applies to the
   * snapshots and emitted events, not this caller-owned value. */
  answerNegatives(): AnswerNegatives | undefined {
    return getAgentRuntime(this).answerNegatives();
  }

  /** The last run's answer checks, detached from its execution record.
   * Undefined means no terminal validation ran, never an implicit pass. */
  answerValidation(): AnswerValidationReport | undefined {
    return getAgentRuntime(this).answerValidation();
  }

  /**
   * The limits of the last run's TYPED answer, as data — what its tools
   * declared they `checked`, did not check (`notChecked`) and can never see
   * (`cannotCover`), folded across the run: duplicates said once, every entry
   * kept.
   *
   * Set when the agent has an output schema AND `.limitsTravelWithTheAnswer()`:
   * a typed answer is JSON, and the limits block that option appends to a
   * prose answer would stop it being JSON, so for a typed answer the limits
   * travel beside it instead — here, on `turn_end.answerCoverage`, and in
   * `getLastSnapshot().sharedState.answerCoverage` (served, under the agent's
   * `redact`), one value three ways. The
   * answer string, and so `runTyped()`, is exactly the model's.
   *
   * On an agent whose inputs layer is armed (a tool declares `askOrAssume`),
   * `assumed` lists the values a tool's rule filled this turn — the same rows,
   * read the same way, that a prose answer's "Assumed" block prints — each in
   * the tool's own argument view (`'REDACTED'` with `hidden` when that view
   * hides it).
   *
   * `undefined` when the run's tools declared no limits and nothing was
   * assumed, on a prose answer (the block is in the answer string there;
   * `sharedState.coverageDeclared` holds the raw rows either way), and before
   * the first run. Detached from the execution record, so a caller may keep
   * or mutate it.
   *
   * `periods` (honesty step 7b) — present only when a call's result declared
   * the period its read covered: one entry per declaring call, `{ toolName,
   * toolCallId, queried, held, readAt? }`, the period as the tool declared it
   * — the data twin of the prose block's `Period:` lines.
   *
   * @example
   * ```ts
   * const agent = Agent.create({ provider, model })
   *   .tool(replicationHealth) // returns coverage(verdict, { … })
   *   .outputSchema(Verdict)
   *   .limitsTravelWithTheAnswer()
   *   .build();
   *
   * const verdict = await agent.runTyped({ message: 'is replication healthy?' });
   * const limits = agent.answerCoverage();
   * for (const item of limits?.cannotCover ?? []) {
   *   console.log(`never covered: ${item.what} (${item.why})`);
   * }
   * ```
   */
  answerCoverage(): AnswerCoverage | undefined {
    return getAgentRuntime(this).answerCoverage();
  }

  /**
   * How far the last run's answer stands — folded from its COMMITTED record,
   * never from how sure the model sounded: `known` · `consistent` (checks ran,
   * none fired — never "verified") · `not-sure` (with the reasons) · `ask` (the
   * run paused on a question still waiting for a person) · `not-assessed`
   * (nothing on the record could be checked).
   *
   * The same pure fold as `assessAnswer` on `agentfootprint/observe`, over this
   * agent's last snapshot; it reads committed state, never events, so a later
   * reader of the same recording folds the same standing. (This call folds the
   * LIVE run. Under `redact` a recording holds the placeholder wherever the
   * policy selected a value, and a fold of it stands only on what the policy
   * left — the same standing unless a selected key is one the fold reads.) It resolves
   * asynchronously because the fold is loaded through `import()` on first use —
   * an agent that never asks does not carry it.
   *
   * Resolves to `undefined` when there is no answer to assess: before the first
   * run, while a run is in flight, and after a run that threw or whose answer a
   * rule refused (the typed error carries that verdict).
   *
   * `declarations` is the answer account's object, accepted as it is: the fold
   * reads `tools[name].rowsAt`, where an object result keeps its rows.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Which ports on switch A are down?' });
   * const a = await agent.assessment();
   * if (a?.standing === 'not-sure') {
   *   for (const r of a.reasons) console.log(r.reason); // e.g. 'empty-undeclared'
   * }
   * ```
   */
  assessment(declarations?: AssessmentDeclarations): Promise<AnswerAssessment | undefined> {
    return getAgentRuntime(this).assessment(declarations);
  }

  /**
   * @internal What a mount of this agent's chart handed back
   * (`core/terminalVerdict.ts` · `ReadsItsOwnOutcome`, read by every
   * composition): the ANSWER, or the terminal verdict the chart ended on. A
   * string, or the validated answer's `{ finalContent, answerValidationCommitted }`,
   * is the answer; a verdict is read ONLY from the chart's state — handed over
   * when the chart returned no result — with the one translation this agent's
   * own run boundary (`finalizeResult`) uses. The `'tell-model'` consent record
   * travels off tracked state, so it is raised by the run boundary only.
   */
  outcomeOf(sfOutput: unknown): ChildOutcome {
    return getAgentRuntime(this).outcomeOf(sfOutput);
  }
}

/** The class's own turn doors, captured at load: patching the prototype later still counts. */
const OWN_TURN_METHODS = Object.freeze({
  run: Agent.prototype.run,
  resume: Agent.prototype.resume,
});
