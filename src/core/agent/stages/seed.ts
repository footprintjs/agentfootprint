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
import type { MemoryStore } from '../../../memory/store/index.js';
import { resolveTurnNumber } from '../../../memory/turn/index.js';
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
   * Accessor for this run's hosting session id — `agent.run({ sessionId })`,
   * which is what `standingAgent` passes from `HostRequest.sessionId` (9.4.0).
   *
   * Read by `seedFrom` for ONE purpose: to derive the memory identity when the
   * caller named no identity at all. See the derivation there for why a session
   * is the one honest default and why an explicit identity always outranks it.
   * Returns `undefined` for a run that carries no session, which is every
   * `agent.run(message)` in a script.
   */
  readonly getCurrentSessionId?: () => string | undefined;
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

  /**
   * The durable stores this agent's WRITING memories keep the conversation
   * in (9.6.0). Consulted once per run to resolve `turnNumber` — see
   * `anchorTurnNumber` and `resolveTurnNumber` for why the store is the only
   * honest anchor when a host builds a fresh Agent per turn.
   *
   * Empty / undefined (no memory, read-only memory, corpus-only retrieval) →
   * seed stays the synchronous stage it always was, makes no store call, and
   * commits exactly the keys it always did.
   */
  readonly conversationStores?: readonly MemoryStore[];
  /**
   * Read-AND-CLEAR accessor for the CONVERSATION'S skill cursor (SG-C,
   * `continuity: 'conversation'`) — the `skillCursor` a continued checkpoint
   * carried, stashed by `applyContinuation` beside the history. Consumed on
   * every run (the side channel must clear either way); WRITTEN to
   * `scope.currentSkillId` only when `restoreSkillCursor` is true, so a graph
   * under the default `continuity: 'turn'` seeds the exact keys it always
   * did. The RouteTurn stage then judges the inherited cursor against the new
   * message (sticky default, decisively beaten, or dropped when the mounted
   * graph no longer knows the id).
   */
  readonly consumePendingResumeSkillCursor?: () => string | undefined;
  /** The mounted graph declared `continuity: 'conversation'`. */
  readonly restoreSkillCursor?: boolean;
  /**
   * ≥1 registered skill declares `steps` (9.18.0). Gates the per-run reset
   * of `stepPointer` + `stepNudgeSpent` — written only when true, so an
   * agent without stepped skills commits exactly the keys it always did
   * (the `restoreSkillCursor` discipline, one field up).
   */
  readonly hasSteps?: boolean;
}

/**
 * How many user turns the conversation already contains, this one included.
 * At least 1 — a run always IS a turn.
 */
function countUserTurns(history: readonly LLMMessage[]): number {
  let count = 0;
  for (const message of history) if (message.role === 'user') count++;
  return Math.max(1, count);
}

/**
 * Raise `scope.turnNumber` to what the conversation's own stores know.
 *
 * The turn number is the KEY memory writes stamp on their entries, so two
 * turns of one conversation must never share it. In-process counting cannot
 * provide that: the shape seen in a production field deployment builds a
 * fresh `Agent` per turn against a stable `conversationId`, so every run
 * starts counting from scratch while the store holds the whole history.
 *
 * Runs after `seedFrom`, because it needs the identity that stage resolves.
 * A store that throws is not swallowed — a memory whose store is unreachable
 * fails at its next read anyway, and a guessed turn number is how a
 * conversation quietly overwrites itself.
 */
async function anchorTurnNumber(
  scope: TypedScope<AgentState>,
  stores: readonly MemoryStore[],
): Promise<void> {
  scope.turnNumber = await resolveTurnNumber({
    stores,
    identity: scope.runIdentity,
    hostTurn: scope.turnNumber,
  });
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
  const stores = deps.conversationStores ?? [];
  // No chain and no conversation store → the same synchronous function this
  // stage has always been. Not an optimisation: an agent without middleware
  // and without memory must produce the same stage shape, the same committed
  // keys and the same request bytes as before.
  if (chain.length === 0 && stores.length === 0) {
    return (scope) => {
      seedFrom(scope, scope.$getArgs<AgentInput>().message, deps);
    };
  }
  if (chain.length === 0) {
    return async (scope) => {
      seedFrom(scope, scope.$getArgs<AgentInput>().message, deps);
      await anchorTurnNumber(scope, stores);
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
      // No turn anchoring on this path: a denied message never reaches the
      // memory subflows, so nothing will be written under this turn and the
      // store call would be spent on a question nothing asks.
      scope.$break(`message denied at input: ${verdict.reason}`);
      return;
    }
    seedFrom(scope, verdict.content, deps);
    if (stores.length > 0) await anchorTurnNumber(scope, stores);
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
  const history: readonly LLMMessage[] =
    resumeHistory && resumeHistory.length > 0
      ? [...resumeHistory]
      : [{ role: 'user', content: message }];
  scope.history = history;

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

  // ── WHO this run is for, and where that answer comes from ────────────
  //
  // Three rungs, in this order, and the order is the whole design:
  //
  //  1. AN EXPLICIT IDENTITY ALWAYS WINS. `agent.run({ identity })`,
  //     `run(input, { identity })`, or the identity a continued conversation
  //     carries — all three arrive here as `args.identity`. Nothing below may
  //     override it: a caller who named a tenant and a principal has said
  //     something this library is not entitled to second-guess.
  //  2. NO IDENTITY BUT A SESSION → `{ conversationId: sessionId }` (9.10.0).
  //     A hosting session IS a conversation — that is what the id means to the
  //     person holding it — so a session-bound run reads and writes its memory
  //     under the session's own namespace and turn two remembers turn one.
  //     Before this, a served session got `{ conversationId: '<runId>' }` and a
  //     FRESH runId every turn, so a `.memory()` behind `standingAgent` wrote
  //     twelve namespaces of one exchange each and recalled nothing. The turn
  //     always looked right; only the recall was missing.
  //  3. NEITHER → `{ conversationId: '<runId>' }`, unchanged since 1.x, so a
  //     script that names nobody still gets per-run isolation.
  //
  // The derivation is RECORDED rather than inferred: rung 2 also commits
  // `runIdentitySource: 'session'`, so a reader of the trace can tell a
  // namespace the caller chose from one this library derived. It is written on
  // that path ONLY — a run on rung 1 or rung 3 commits exactly the keys it
  // always did. And note what does NOT change: `Agent.lastRunIdentity` stays
  // the CALLER's identity, so a derived namespace never reaches `tool.execute`
  // as `ctx.identity` and "absent" keeps meaning "nobody named one".
  const sessionId = deps.getCurrentSessionId?.();
  if (args.identity !== undefined) {
    scope.runIdentity = args.identity;
  } else if (sessionId !== undefined) {
    scope.runIdentity = { conversationId: sessionId };
    scope.runIdentitySource = 'session';
  } else {
    scope.runIdentity = { conversationId: deps.getCurrentRunId() ?? 'default' };
  }
  scope.newMessages = [];
  // WHICH TURN THIS IS (9.6.0). Every release up to 9.5.1 wrote `1` here, on
  // every run — and memory writes key their entries on it (`msg-{turn}-{i}`),
  // so turn two of a conversation overwrote turn one and a `.memory()` with a
  // twelve-turn window silently recalled exactly one exchange.
  //
  // The honest floor available without I/O is the conversation this run was
  // handed: a fresh run is turn 1, a run continuing a stored conversation of
  // three exchanges is turn 4. It is a FLOOR, not the answer — a host that
  // builds a fresh Agent per turn hands over no history at all, and for that
  // shape `anchorTurnNumber` below raises this to what the STORE knows.
  // Over-counting (a checkpoint captured mid-retry carries an extra authored
  // user message) costs a skipped ordinal, never a collision.
  scope.turnNumber = countUserTurns(history);
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
  // …unless the graph declared `continuity: 'conversation'` and this run
  // continues a stored conversation (SG-C): the SAME key, one clause earlier —
  // no second cursor, no new time axis. Consumed unconditionally (the side
  // channel clears whether or not it is honored); written only under the
  // option, so `continuity: 'turn'` commits exactly the keys it always did.
  const inheritedCursor = deps.consumePendingResumeSkillCursor?.();
  if (deps.restoreSkillCursor === true && inheritedCursor !== undefined) {
    scope.currentSkillId = inheritedCursor;
  }
  // The model's `read_skill` pick — nothing picked yet on a fresh turn.
  scope.pendingSkillPick = undefined;
  // Step-procedure state (9.18.0) — fresh every run, beside the cursor reset
  // it is subordinate to. Steps are TURN-scoped by design: even under
  // `continuity: 'conversation'` only the CURSOR carries, and a re-tenured
  // stepped skill starts at step 1 on the continued turn (the restored
  // history still shows the prior turn's completed step results — the record
  // is not lost, the pointer is fresh). Written only when a stepped skill is
  // registered, so every other agent commits exactly the keys it always did.
  if (deps.hasSteps === true) {
    scope.stepPointer = [];
    scope.stepNudgeSpent = false;
  }

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
