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
 *     run({ continueFrom }) / resumeOnError(), currentRunContext.runId
 *     set per run) —
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
import type { EvidenceRecoveryCheckpoint } from '../../runCheckpoint.js';
import type { FoldedSpan } from '../window/types.js';
import type { MessageMiddleware } from '../middleware/types.js';
import { runMessageChain } from '../middleware/runChain.js';
import { recordDecisions } from '../middleware/ledger.js';
import { withFindingsArgument } from '../findings/reserved.js';
import type { FindingsLedger } from '../findings/types.js';
import type { Ontology } from '../../../ontology/types.js';

/**
 * A stored conversation handed to the next run — what
 * `Agent.ts · applyContinuation` stashes and `seedFrom` consumes.
 *
 * It carries the history EXACTLY as stored and a flag, never a pre-built
 * user entry: the entry this turn adds is written in ONE place,
 * `historyForTurn`, from the message the `'input'` chain let through. A
 * continuation that appended the caller's raw message before the chain ran
 * would put the unrewritten text in front of the model while the record
 * (`userMessage`, `middlewareDecisions`) said the rewrite happened — the
 * bug fixed in 9.112.2.
 */
export interface PendingResumeHistory {
  /** The conversation as stored — no entry for this turn in it. */
  readonly history: readonly LLMMessage[];
  /**
   * `true` for `run({ continueFrom })` (and so `followUp()` and every stored
   * session behind `standingAgent`): continuing a conversation ADDS this
   * turn's user message. `false` for `resumeOnError`, whose failing turn's
   * message is already the last user entry in `history`.
   */
  readonly appendsUserTurn: boolean;
}

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
   * once per `agent.run()` from inside seed. If `run({ continueFrom })` or
   * `resumeOnError(checkpoint)` stashed a stored conversation before this
   * run, this returns it — the history AS STORED plus whether this turn
   * appends a user entry — and clears the field so the NEXT `run()` starts
   * fresh. Returns `undefined` for the normal (non-resume) path.
   */
  readonly consumePendingResumeHistory: () => PendingResumeHistory | undefined;
  /** Same-request recovery only. A new human turn never supplies this state. */
  readonly consumePendingEvidenceRecovery?: () => EvidenceRecoveryCheckpoint | undefined;
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
   * The same read-AND-CLEAR accessor for a continued conversation's findings
   * ledger (9.101.0, `AgentRunCheckpoint.findingsLedger`). Present only on an
   * agent with `.findings()`; returns the stored rows once, or `undefined`
   * for a fresh run and for any conversation stored without the key. The
   * restore is a plain copy of a stored record (the `foldedSpans` twin) —
   * never a `recordFindings` call, so it files no row and emits no event.
   */
  readonly consumePendingResumeFindingsLedger?: () => FindingsLedger | undefined;
  /**
   * THE FINDINGS LEDGER IS ARMED (9.101.0, `.findings()`) — present only
   * then, only ever `true`. The static tool list seeded for iteration 1 (and
   * for a hand-composed chart without the tools slot) gains the reserved
   * `_findings` property through the same `withFindingsArgument` the slot
   * applies, so the first call's served schemas match every later call's.
   */
  readonly findings?: true;
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
  /**
   * An escalation brain is declared (9.19.0). Gates the per-run reset of
   * `skillRefusalsThisTurn` + `skillEscalated` — de-escalation IS the next
   * seed, and the flip is a per-turn fact. Written only when true (the
   * `hasSteps` discipline, one field up), so every other agent commits
   * exactly the keys it always did.
   */
  readonly hasEscalation?: boolean;
  /**
   * The evidence gate is mounted with a posture that can revise (9.35.0).
   * Gates the per-run reset of `evidenceRevisionSpent` — the one bounded
   * revision is a per-TURN budget, so the next turn gets its own. Written
   * only when true (the `hasSteps` discipline, two fields up), so every
   * other agent commits exactly the keys it always did.
   */
  readonly hasEvidenceRevision?: boolean;
  /**
   * The name of the synthetic tool the `'tool-forced'` output strategy puts on
   * every request (9.88.0). Present ONLY under that strategy; absent → this
   * stage commits exactly the keys it always did.
   *
   * Seeded rather than left to the request assembly that adds the tool,
   * because it is a build-time constant and a reader rebuilding what the model
   * was served needs it from the RECORD, not from the receipt it is checking.
   */
  readonly forcedOutputToolName?: string;
  /**
   * How the findings ledger is served on this run (9.101.0) — the
   * `AgentOptions.findings.serve` dial, threaded beside `findings` and under
   * the same gate, so it is present ONLY on an armed agent. Seeded for the
   * `forcedOutputToolName` reason: a rebuild (`servedView.ts` · `viewOf`)
   * collapses judged tool results the way the wire did, and the mode is a
   * build-time constant it must read from the RECORD, not from the receipt
   * it is checking. Absent → this stage commits exactly the keys it always did.
   */
  readonly findingsServe?: 'ledger-and-facts' | 'ledger-only';
  /**
   * The answer-turn ask on this run (9.103.0) — present ONLY on an armed
   * agent whose `findings({ answerAsk })` is `'quote-facts'`; `Agent.ts`
   * threads nothing for the default `'none'`, so an armed agent on the
   * default hands this stage exactly the deps it did before the dial and
   * commits exactly the keys it did. Seeded for the `findingsServe` reason:
   * the rebuild appends `FINDINGS_ANSWER_ASK` to the piece the way the wire
   * did, reading the dial from the RECORD.
   */
  readonly findingsAnswerAsk?: 'quote-facts';
  /**
   * The declared ontology (9.106.0) — present ONLY on an agent built with
   * `.ontology(map)`, threaded by `Agent.ts` under that one gate. Seeded for
   * the `findingsServe` reason: the piece the model is served is composed
   * from the RECORD (`callLLM` reads the key; `servedView.ts · viewOf` reads
   * it back with `readRunConstant`), and a build-time constant the rebuild
   * needs must be on the record, not on the receipt it is checking. Absent →
   * this stage commits exactly the keys it always did.
   */
  readonly ontology?: Ontology;
  /**
   * Which skills declare each tool the map names (9.108.0) — read lazily,
   * because `Agent.buildChart` builds this stage BEFORE the tool registry
   * that owns the fact (`toolDeclaringSkills`); the thunk answers at run
   * time, after the build completed. `undefined` when no tool the map's
   * `via` names is a skill's — then the record carries no `tools` key.
   */
  readonly ontologyTools?: () => Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * The `Tool.wants` declarations, by tool name (9.88.0) — present ONLY when
   * the evidence gate's nudge is armed and at least one tool declares `wants`,
   * which is exactly when request assembly can compose the staged-refs line.
   * Absent → this stage commits exactly the keys it always did.
   *
   * A plain record, not the `Map` the join takes: an object write to scope is
   * JSON-round-tripped, and a `Map` round-trips to `{}`.
   *
   * WHY IT IS ON THE RECORD AT ALL. The nudge is a real line the model reads
   * and it is written to no history — so without this, the one model-facing
   * line the run never persists would also be the one a rebuild could not
   * derive. With it, `servedView.ts` · `servedAt` composes the same line from
   * the same three inputs the stage used.
   */
  readonly toolWantsByName?: Readonly<Record<string, readonly string[]>>;
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
 * The conversation this run starts from, ending in this turn's user entry —
 * the ONE place that entry is written (9.112.2).
 *
 * `message` is what the `'input'` chain let through (the caller's message
 * when there is no chain; on a refusal, the content as it stood when it was
 * refused), so a rewrite — a scrub, a stated quote — is the entry the model
 * reads on a continued turn exactly as on a first one.
 *
 *   • fresh run → `[{ user: message }]`
 *   • `run({ continueFrom })` → the stored conversation + `{ user: message }`
 *   • `resumeOnError` → the stored conversation as-is: its last user entry
 *     IS the failing turn's message, and adding it again would ask twice.
 *     An empty stored history falls back to the fresh-run entry, as it
 *     always did.
 *
 * With no chain, every arm yields the bytes the earlier releases committed.
 */
function historyForTurn(
  resume: PendingResumeHistory | undefined,
  message: string,
): readonly LLMMessage[] {
  const entry: LLMMessage = { role: 'user', content: message };
  if (resume === undefined) return [entry];
  if (resume.appendsUserTurn) return [...resume.history, entry];
  return resume.history.length > 0 ? [...resume.history] : [entry];
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

  // If `run({ continueFrom })` or `resumeOnError(...)` set the side channel,
  // restore the stored conversation; this turn's user entry is `message` —
  // the input chain's verdict — on every path (`historyForTurn`). The
  // accessor clears the field, so a later run without a continuation starts
  // fresh.
  const history = historyForTurn(deps.consumePendingResumeHistory(), message);
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
  // The findings ledger beside it (9.101.0): the model's own standings on
  // results this process never saw, carried by `AgentRunCheckpoint.findingsLedger`
  // and restored as the stored record — a copy, never a `recordFindings`
  // write, so nothing is re-declared and no event fires. Written only when the
  // checkpoint carries rows; every other run seeds exactly the keys it always did.
  const resumeLedger = deps.consumePendingResumeFindingsLedger?.();
  if (resumeLedger && resumeLedger.length > 0) {
    scope.findingsLedger = [...resumeLedger];
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
  // The static fallback shares the slot's ONE decorator (9.101.0): armed, the
  // first call serves decorated schemas exactly as every later call will;
  // unarmed, the registry list by reference, byte for byte. NO OFFER here
  // (9.102.0): at seed there is no served history and nothing to name, so the
  // base decoration — an explicit lambda, because passed point-free `.map`
  // would hand the index in as the offer (`reserved.ts · withFindingsArgument`).
  scope.dynamicToolSchemas =
    deps.findings === true
      ? deps.toolSchemas.map((s) => withFindingsArgument(s))
      : deps.toolSchemas;
  // The forced-output tool's NAME (9.88.0) — the one fact about it that lands
  // on the record. Value-conditional: an agent on the default `'instruct'`
  // strategy writes nothing here.
  if (deps.forcedOutputToolName !== undefined) {
    scope.forcedOutputToolName = deps.forcedOutputToolName;
  }
  // The findings ledger's SERVE mode (9.101.0) — the second such constant,
  // written the same way, and only under the arm: the rebuild reads it with
  // `readRunConstant` to collapse judged results as the wire did. It is
  // written on EVERY armed run: `AgentBuilder.findings` normalises `serve` to
  // `'ledger-and-facts'` before `Agent.ts` threads it, so an armed agent
  // whose caller named no mode still records the default (an armed agent's
  // committed key set is the unarmed twin's plus this key, plus
  // `findingsLedger` once the model declares). The `!== undefined` guard is
  // defence for a hand-built `SeedStageDeps`, not the common path. An
  // unarmed agent writes nothing here.
  if (deps.findings === true && deps.findingsServe !== undefined) {
    scope.findingsServe = deps.findingsServe;
  }
  // The answer-turn ask (9.103.0) — the third such constant, under the same
  // arm, but VALUE-conditional where `findingsServe` is not: the dial's
  // default `'none'` is never threaded and never written, so the key is on
  // the record only when the ask went out (absent = the default, the
  // `forcedOutputToolName` shape). An armed agent on the default commits the
  // key set it committed in 9.102.0.
  if (deps.findings === true && deps.findingsAnswerAsk !== undefined) {
    scope.findingsAnswerAsk = deps.findingsAnswerAsk;
  }
  // The declared ontology (9.106.0) — the fourth such constant, written the
  // same way and ONCE per run: the identities the served event carries and
  // the WHOLE spec, so the wire, the rebuild and a lens read one key and
  // nothing else. The map is declared, not learned — no stage writes it
  // again. An agent without `.ontology()` writes nothing here.
  if (deps.ontology !== undefined) {
    const { id, version, hash, nodes, sources, edges } = deps.ontology;
    // The tool → skills join (9.108.0), VALUE-conditional: a map naming only
    // static tools writes the record it wrote in 9.106.0.
    const tools = deps.ontologyTools?.();
    scope.ontology = {
      id,
      version,
      hash,
      spec: { id, version, nodes, sources, edges },
      ...(tools !== undefined && { tools }),
    };
  }
  // The `wants` declarations (9.88.0) — the third input to the staged-refs
  // nudge, and the only one that was build-time-only. Value-conditional in the
  // same way, and under the same condition request assembly uses.
  if (deps.toolWantsByName !== undefined) {
    scope.toolWantsByName = deps.toolWantsByName;
  }
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
  // Escalation state (9.19.0) — fresh every run: the refusal budget is a
  // per-turn budget and DE-escalation is this very reset (the flip never
  // outlives the turn that earned it). Written only when an escalation
  // brain is declared, so every other agent commits exactly the keys it
  // always did.
  if (deps.hasEscalation === true) {
    scope.skillRefusalsThisTurn = 0;
    scope.skillEscalated = false;
  }
  // The evidence gate's one bounded revision (9.35.0) — a per-TURN budget,
  // so it is spent fresh here. Written only when the posture can revise, so
  // an `'assist'` agent (and every agent without the gate) commits exactly
  // the keys it always did.
  if (deps.hasEvidenceRevision === true) {
    const recovery = deps.consumePendingEvidenceRecovery?.();
    scope.evidenceRevisionSpent = recovery?.revisionSpent === true;
    if (recovery?.pending !== undefined) {
      scope.evidenceRecovery = { instruction: recovery.pending.instruction, iteration: 1 };
      scope.evidenceRecoveryUsed = false;
    }
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
