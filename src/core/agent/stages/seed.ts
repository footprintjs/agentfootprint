/**
 * seed — initial stage of the agent's chart. Initializes every mutable
 * field of `AgentState` from the consumer's input.
 *
 * Runs once per `agent.run({ input })`. The chart is built once at
 * Agent construction, so seed has access to BOTH:
 *
 *   • CHART-BUILD-TIME constants (maxIterations, cachingDisabled,
 *     toolSchemas) — passed as direct values to the factory.
 *   • PER-RUN MUTABLE state (pendingResumeHistory from
 *     resumeOnError(), currentRunContext.runId set per run) —
 *     passed as accessor closures over the Agent instance, since
 *     these change between consecutive `agent.run()` invocations.
 *
 * The accessor pattern keeps `seed` decoupled from the Agent class
 * while preserving the per-run mutability the resume + identity
 * features need.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMToolSchema } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentInput, AgentState, RunConfig } from '../types.js';
import type { FoldedSpan } from '../window/types.js';
import type { MessageMiddleware } from '../middleware/types.js';
import { runMessageChain } from '../middleware/runChain.js';
import { recordDecisions } from '../middleware/ledger.js';

export interface SeedStageDeps {
  /** Resolved `clampIterations(opts.maxIterations ?? 10)`. Frozen at
   *  chart-build time. */
  readonly maxIterations: number;
  /** Resolved cache kill switch from `Agent.create({ caching: 'off' })`. */
  readonly cachingDisabled: boolean;
  /**
   * What a crossed `costBudget` does — `'warn'` (keep going) or `'halt'`
   * (stop the loop at the next Route boundary). Committed by seed so the
   * decider can read the policy off the run's own state rather than closing
   * over it, which is how every other run-level fact reaches that stage.
   */
  readonly costBudgetOnExceed?: 'warn' | 'halt';
  /** Static tool schemas resolved at chart-build time. The tools slot
   *  subflow can OVERRIDE this per-iteration via `dynamicToolSchemas`,
   *  but seed populates the initial value so iter 1 has it. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /**
   * Read-AND-CLEAR accessor for the resume side-channel. Called exactly
   * once per `agent.run()` from inside seed. If `resumeOnError(checkpoint)`
   * was invoked before `run()`, this returns the checkpointed history
   * and clears the field so the NEXT `run()` starts fresh. Returns
   * `undefined` for the normal (non-resume) path.
   */
  readonly consumePendingResumeHistory: () => readonly LLMMessage[] | undefined;
  /**
   * The same read-AND-CLEAR accessor for the conversation's folded spans.
   *
   * A restored window can contain summaries that stand for messages this
   * process never saw. Restoring the window without the spans would leave the
   * agent holding claims whose evidence nothing can produce — and the next
   * `checkpoint()` would then write that loss back to the store permanently.
   * Undefined for a fresh run, and for any conversation stored before 8.2.
   */
  readonly consumePendingResumeFolded?: () => readonly FoldedSpan[] | undefined;
  /**
   * Accessor for the current run's id, used to default the memory
   * identity when consumer didn't pass `agent.run({ identity })`. Set
   * by RunnerBase on every `agent.run()` call before the chart starts.
   * Returns `undefined` only in degenerate (test) cases.
   */
  readonly getCurrentRunId: () => string | undefined;
  /**
   * Per-run config resolver from `.configure()`. Seed is where run-level
   * facts are decided AND committed (identity, iteration budget, turn
   * number all land here), so this rides the same commit rather than
   * inventing a second place a run can change itself. Undefined when the
   * consumer never called `.configure()` — and then nothing extra is
   * written, so the commit log is byte-identical to earlier releases.
   */
  readonly resolveRunConfig?: (input: AgentInput) => RunConfig | undefined;
  /**
   * The message chain (`.messageMiddleware(...)`), walked here at the
   * `'input'` phase — BEFORE `userMessage` and `history` are written.
   *
   * This is the only placement that keeps the run honest. Everything
   * downstream reads `scope.history`: the window strategies, the injection
   * engine, all three slots, the request that goes on the wire, and every
   * slice taken afterwards. Transform later than this and those components
   * disagree about what the user actually said — the trace would show one
   * message and the model would have answered another.
   *
   * Empty / undefined → seed stays the synchronous stage it always was.
   */
  readonly messageMiddleware?: readonly MessageMiddleware[];
}

/**
 * Build the seed stage function for an Agent instance. Captures both
 * the chart-build-time constants and the per-run mutable accessors
 * via the deps object.
 */
export function buildSeedStage(
  deps: SeedStageDeps,
): (scope: TypedScope<AgentState>) => void | Promise<void> {
  const chain = deps.messageMiddleware ?? [];
  // No chain → the same synchronous function this stage has always been.
  // Not an optimisation: an agent without middleware must produce the same
  // stage shape, the same committed keys and the same request bytes as before.
  if (chain.length === 0) {
    return (scope) => {
      seedFrom(scope, scope.$getArgs<AgentInput>().message, deps);
    };
  }
  return async (scope) => {
    const args = scope.$getArgs<AgentInput>();
    const verdict = await runMessageChain(chain, {
      phase: 'input',
      content: args.message,
      history: [],
      // The input boundary runs before iteration 1 exists.
      iteration: 0,
      ...(args.identity && { identity: args.identity }),
    });
    recordDecisions(scope, verdict.decisions);
    if (verdict.kind === 'deny') {
      // Seed the run anyway, with the content as it stood when it was
      // refused, then stop. Committing it costs nothing (a refusal is a fact
      // about a run, and hiding what was refused would make the record
      // useless), and a fully-seeded state means `resumeOnError` and every
      // recorder see the shape they expect rather than a half-built one.
      seedFrom(scope, verdict.content, deps);
      scope.messageDeniedReason = verdict.reason;
      scope.messageDeniedPhase = 'input';
      scope.messageDeniedBy = verdict.middleware;
      // Stops the chart here: no injections, no slots, no LLM call. The
      // boundary turns these flags into a MessageDeniedError.
      scope.$break(`message denied at input: ${verdict.reason}`);
      return;
    }
    seedFrom(scope, verdict.content, deps);
  };
}

/**
 * Initialise every mutable field of `AgentState` from `message` + the run
 * args. Split out so the message the run proceeds with can come either
 * straight from the caller or from the `'input'` middleware chain — one
 * initialiser, so the two paths cannot drift.
 */
function seedFrom(scope: TypedScope<AgentState>, message: string, deps: SeedStageDeps): void {
  const args = scope.$getArgs<AgentInput>();
  scope.userMessage = message;

  // If `resumeOnError(...)` set the side channel, restore the
  // checkpointed conversation history. The next iteration sees
  // the prior messages and continues from the failure point.
  // Always clear the field after reading so subsequent runs
  // (without resumeOnError) start fresh.
  const resumeHistory = deps.consumePendingResumeHistory();
  if (resumeHistory && resumeHistory.length > 0) {
    scope.history = [...resumeHistory];
  } else {
    scope.history = [{ role: 'user', content: message }];
  }

  // The window's durable companion. Restored whether or not THIS agent is
  // configured to fold: the spans belong to the conversation, not to the
  // runtime that happens to be carrying it, and a runtime with no
  // `.compaction()` must still hand them on rather than quietly drop somebody
  // else's evidence. Written only when there is something to restore, so a
  // conversation that never folded commits exactly the keys it always did.
  const resumeFolded = deps.consumePendingResumeFolded?.();
  if (resumeFolded && resumeFolded.length > 0) {
    scope.foldedSpans = [...resumeFolded];
  }

  // Default identity uses the runId so multi-run isolation works
  // without consumer changes; explicit identity (multi-tenant)
  // overrides via `agent.run({ identity })`.
  scope.runIdentity = args.identity ?? {
    conversationId: deps.getCurrentRunId() ?? 'default',
  };
  scope.newMessages = [];
  scope.turnNumber = 1;
  // Permissive default — explicit cap will land when PricingTable
  // gets a context-window field. Memory pickByBudget treats anything
  // ≥ minimumTokens as "fits", so this just enables the budget path.
  scope.contextTokensRemaining = 32_000;
  scope.iteration = 1;
  scope.maxIterations = deps.maxIterations;
  scope.finalContent = '';
  scope.totalInputTokens = 0;
  scope.totalOutputTokens = 0;
  scope.turnStartMs = Date.now();
  scope.systemPromptInjections = [];
  scope.messagesInjections = [];
  scope.toolsInjections = [];
  scope.llmLatestContent = '';
  scope.llmLatestToolCalls = [];
  // v2.14 — initialize thinking blocks. Empty array means "no thinking
  // this iteration"; the NormalizeThinking sub-subflow overwrites
  // this AFTER each CallLLM when a ThinkingHandler is configured.
  scope.thinkingBlocks = [];
  scope.pausedToolCallId = '';
  scope.pausedToolName = '';
  scope.pausedToolStartMs = 0;
  scope.cumTokensInput = 0;
  scope.cumTokensOutput = 0;
  scope.cumEstimatedUsd = 0;
  scope.costBudgetHit = false;
  if (deps.costBudgetOnExceed !== undefined) scope.costBudgetOnExceed = deps.costBudgetOnExceed;
  scope.activeInjections = [];
  scope.activatedInjectionIds = [];
  scope.dynamicToolSchemas = deps.toolSchemas;
  // Messages-slot delivery ledger (7.21) — empty at the start of every run.
  // A resumed run rebuilds it from the markers in the restored window rather
  // than trusting this, so an empty ledger never means "deliver it again".
  scope.deliveredMessageKeys = [];
  // Cache layer state (v2.6) — initialized to inert defaults.
  // CacheDecision subflow populates `cacheMarkers` per iteration;
  // UpdateSkillHistory + CacheGate consume `cachingDisabled`,
  // `recentHitRate`, `skillHistory`. Empty defaults mean the
  // CacheGate falls through to 'apply-markers' on iter 1 (no
  // history yet → no churn detected; recentHitRate undefined →
  // hit-rate floor doesn't fire).
  scope.cacheMarkers = [];
  scope.cachingDisabled = deps.cachingDisabled;
  scope.recentHitRate = undefined;
  scope.skillHistory = [];
  // Skill-graph cursor — reset per turn so each new user message re-enters the
  // graph through the entry router (cold start). The Injection Engine advances
  // it each iteration; undefined for agents without a skillGraph().
  scope.currentSkillId = undefined;
  // The model's `read_skill` pick — nothing picked yet on a fresh turn.
  scope.pendingSkillPick = undefined;

  // `.configure()` — resolved ONCE here (seed runs exactly once per run)
  // and written to scope, which means the run's commit log records the
  // model and instructions the run actually used. A run that changed its
  // own model without committing that fact would produce a trace that
  // reads as if the built-in default answered.
  //
  // Only what the resolver actually returned is written: an agent with no
  // `.configure()`, or one whose resolver returned `{}`, commits nothing
  // extra and behaves exactly as before.
  if (deps.resolveRunConfig) {
    const resolved = deps.resolveRunConfig(args);
    if (resolved?.model !== undefined) scope.resolvedModel = resolved.model;
    if (resolved?.instructions !== undefined) scope.resolvedInstructions = resolved.instructions;
  }

  typedEmit(scope, 'agentfootprint.agent.turn_start', {
    turnIndex: 0,
    userPrompt: message,
  });
}
