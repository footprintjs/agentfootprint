/**
 * route — decider that branches the ReAct loop into 'tool-calls' or 'final'.
 *
 * Runs after CallLLM. If the LLM returned tool calls AND we haven't hit
 * `maxIterations`, route to the tool execution branch (which loops back
 * to PromptBuilder). Otherwise route to the final-branch subflow which
 * persists memory writes and breaks the loop.
 *
 * Emits `agentfootprint.agent.route_decided` with the chosen branch +
 * a human-readable rationale (visible in narrative + observability).
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `addDeciderFunction(...)` in buildAgentChart.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';
import type { LLMMessage } from '../../../adapters/types.js';
import type { MessageMiddleware } from '../middleware/types.js';
import { runMessageChain } from '../middleware/runChain.js';
import { recordDecisions } from '../middleware/ledger.js';
import {
  judgeAnswer,
  recordOutputAttempt,
  type ResolvedOutputEnforcement,
} from '../outputEnforcement.js';
import {
  pointerOf,
  remainingStepsOf,
  stepInProgress,
  type StepPlanFor,
} from '../../../lib/injection-engine/skillSteps.js';
import { checkAnswer, evidenceRefusalSentence, MAX_REPORTED_VALUES } from '../evidence/gate.js';
import { evidenceFromHistory, exemptFromRun } from '../evidence/evidenceIndex.js';
import type { ResolvedEvidenceGate } from '../evidence/types.js';
import { unsupportedClaimsOf } from '../../../integrity/unsupported-claim/check.js';
import type { DeclaredClaim } from '../../../integrity/unsupported-claim/check.js';
import { contextErrorIdentity } from '../../../integrity/finding/types.js';
import type { DispositionLedger } from '../../../integrity/disposition/ledger.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';

export type RouteBranch =
  | 'tool-calls'
  | 'final'
  | 'output-retry'
  | 'step-nudge'
  | 'evidence-recheck'
  | 'wrap-up';

/** The base decision, with the sentence that explains it. Split out so the
 *  enforcement-enabled path can decide, then judge, then announce ONCE — an
 *  agent whose answer is about to be re-asked should not have a route event
 *  saying it finished. */
function decideBranch(scope: TypedScope<AgentState>): {
  chosen: 'tool-calls' | 'final';
  rationale: string;
  /** Set when a LIMIT forced `'final'` while tool calls were still pending. */
  earlyStop?: 'max-iterations' | 'cost-budget';
} {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  // A halting `costBudget` stops the loop HERE, at the same boundary
  // maxIterations uses (8.14.0). Never mid-call: the call that crossed the
  // budget has already completed, been billed and been recorded — this only
  // decides that there will not be another one.
  const costHalt = scope.costBudgetHit === true && scope.costBudgetOnExceed === 'halt';
  const outOfIterations = iteration >= scope.maxIterations;
  const chosen = toolCalls.length > 0 && !outOfIterations && !costHalt ? 'tool-calls' : 'final';
  // A limit only CUT SHORT a turn if the model still wanted to do something.
  // A turn that ended because the model was done is not an early stop, however
  // many iterations it spent getting there.
  //
  // 9.56.0 — with ONE addition: a turn that already spent its wrap-up is cut
  // short for every judge downstream, whether or not this last answer still
  // asked for tools. The budget that forced the wrap-up has not come back, and
  // the wrap-up call is the last one this turn buys — a step nudge or an
  // evidence revision here would loop past a limit that already fired. (It
  // does not double-record: `settleWrapUp` sees the latch first and corrects
  // the existing record instead of writing a second one.)
  const earlyStop =
    chosen === 'final' && (toolCalls.length > 0 || scope.wrapUpAsked === true)
      ? outOfIterations
        ? ('max-iterations' as const)
        : costHalt
        ? ('cost-budget' as const)
        : undefined
      : undefined;
  return {
    chosen,
    rationale:
      chosen === 'tool-calls'
        ? `LLM requested ${toolCalls.length} tool call(s)`
        : outOfIterations
        ? 'maxIterations reached — forcing final'
        : costHalt
        ? 'costBudget reached (onExceed: halt) — forcing final'
        : 'LLM produced no tool calls — final answer',
    ...(earlyStop !== undefined && { earlyStop }),
  };
}

/**
 * Record — and announce — a turn that a LIMIT cut short.
 *
 * Fires only when the model asked for tools and this decider refused to run
 * them. A turn that ended because the model was finished is not an early stop,
 * however many iterations it used.
 *
 * Three channels, deliberately, because before 8.14.0 there were none and the
 * caller received `''`:
 *
 *   1. `cost.limit_hit` — the reserved vocabulary (`kind: 'max_iterations'`
 *      has been in `CostLimitHitPayload` since it was written). **Only for the
 *      iteration limit.** A cost budget already emitted its own one-shot
 *      `limit_hit` from `emitCostTick`, at the moment it was crossed, carrying
 *      the real budget as `limit` — and since 8.14.0 carrying `action: 'abort'`
 *      when it is set to halt. A second event here would double-count the
 *      crossing AND report `limit` as the cumulative spend, which is not the
 *      limit;
 *   2. `scope.stoppedEarly` — committed, so the fact is provable after the run
 *      rather than only observable by whoever happened to be subscribed. Both
 *      reasons write it;
 *   3. a `console.warn`, once, and ONLY when the answer is empty — an empty
 *      string reaching a user is indistinguishable from a bug, and the library
 *      knows exactly why it is empty. Both reasons.
 *
 * It does NOT throw. Unlike 8.6.0's outstanding-consent case — a fault, where
 * the run hands back a plausible answer for work a tool never did — this is a
 * limit the consumer set doing precisely what it was set to do, and the answer
 * is sometimes a real one (a model can return content AND tool calls). Raising
 * would reject good answers to fix a bad one.
 */
function recordEarlyStop(
  scope: TypedScope<AgentState>,
  reason: 'max-iterations' | 'cost-budget',
  /** True when the WrapUp branch is about to run, so the answer the caller
   *  receives is not the one being measured here yet (9.56.0). */
  wrapUp: boolean,
): void {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  const answerWasEmpty = ((scope.llmLatestContent as string | undefined) ?? '') === '';

  scope.stoppedEarly = {
    reason,
    iteration,
    pendingToolCalls: toolCalls.length,
    answerWasEmpty,
  };

  if (reason === 'max-iterations') {
    typedEmit(scope, 'agentfootprint.cost.limit_hit', {
      kind: 'max_iterations',
      limit: scope.maxIterations as number,
      actual: iteration,
      action: 'abort',
    });
  }

  // 9.56.0 — a FOURTH channel, and the one a dashboard reads. `limit_hit`
  // reports a limit being crossed and has to stay exactly that (it is the
  // reserved cost vocabulary, and a cost budget fires its own). This one
  // reports what the run DID about the crossing, which is the difference
  // between an outcome chip that says "answered" and one that says "answered
  // after the budget ran out". Emitted for BOTH limits: the fact is true
  // either way, and only `action` differs.
  typedEmit(scope, 'agentfootprint.agent.budget_exhausted', {
    reason,
    iteration,
    // `limit` only where the run actually HOLDS the limit. For a cost budget it
    // holds the cumulative spend instead, and reporting spend as a limit is the
    // exact mistake the `cost.limit_hit` comment above exists to avoid.
    ...(reason === 'max-iterations' && { limit: scope.maxIterations as number }),
    pendingToolCalls: toolCalls.length,
    action: wrapUp ? 'wrapped-up' : 'cut-short',
  });

  // Held back when a wrap-up is about to run: the answer this warning is
  // about does not exist yet, and warning about a string that is being
  // replaced would be the library complaining about its own draft.
  // `settleWrapUp` warns on the pass after, if the wrap-up came back empty
  // too.
  if (answerWasEmpty && !wrapUp) {
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] this turn stopped at iteration ${iteration} because ` +
        `${
          reason === 'max-iterations' ? 'maxIterations was reached' : 'costBudget was reached'
        }, ` +
        `while the model was still asking for ${toolCalls.length} tool call(s). Those calls did ` +
        `not run, so the answer handed back is the empty string — not a refusal, and not the ` +
        `model's conclusion. Raise the limit, or read agent.stoppedEarly() and decide what to ` +
        `show.`,
    );
  }
}

/**
 * Is this would-be-final turn going to be WRAPPED UP instead (9.56.0)?
 *
 * Pure, so the four deciders can announce the branch they are really taking
 * before anything is recorded — the ordering every one of them already has
 * (`route_decided`, then the early-stop record).
 *
 * Only the ITERATION budget is wrapped up. A halting `costBudget` capped the
 * MONEY, and one more call would spend past the cap the person set; an action
 * cap says nothing about a call that takes no action. `wrapUpAsked` is the
 * one-per-turn latch: the wrap-up call itself can never buy a second one.
 */
function wantsWrapUp(
  scope: TypedScope<AgentState>,
  earlyStop: 'max-iterations' | 'cost-budget' | undefined,
  hasWrapUp: boolean,
): boolean {
  return hasWrapUp && earlyStop === 'max-iterations' && scope.wrapUpAsked !== true;
}

/**
 * File what a limit did to this turn (9.56.0) — called at every moment the
 * four deciders answer `'final'` or `'wrap-up'`. Three outcomes:
 *
 *   • the wrap-up already ran → its answer IS the turn's answer: correct the
 *     committed record to describe that string (not the fragment it replaced),
 *     mark it `wrappedUp`, and warn only if even the wrap-up came back empty.
 *     Never a second `limit_hit`, never a second `budget_exhausted` — one
 *     crossing, one report;
 *   • a limit just fired → today's `recordEarlyStop`, told whether a wrap-up
 *     is about to run (which holds back the empty-answer warning, since the
 *     answer it is about does not exist yet);
 *   • neither → nothing, after one `undefined` check.
 */
function settleWrapUp(
  scope: TypedScope<AgentState>,
  earlyStop: 'max-iterations' | 'cost-budget' | undefined,
  wrapUp: boolean,
): void {
  if (scope.wrapUpAsked === true) {
    const cut = scope.stoppedEarly;
    // Unreachable through the decider (the branch only runs after the record
    // is written), but a hand-built chart mounting the branch without the
    // decider must not take down a run — the SchemaRetry discipline.
    if (cut === undefined) return;
    const answer = (scope.llmLatestContent as string | undefined) ?? '';
    scope.stoppedEarly = { ...cut, answerWasEmpty: answer === '', wrappedUp: true };
    if (answer === '') {
      // eslint-disable-next-line no-console
      console.warn(
        `[agentfootprint] this turn stopped at iteration ${cut.iteration} because ` +
          `maxIterations was reached, while the model was still asking for ` +
          `${cut.pendingToolCalls} tool call(s). One more call went out with the tools ` +
          `withheld, asking for a final summary, and it came back EMPTY — so the answer ` +
          `handed back is still the empty string. Raise the limit, or read ` +
          `agent.stoppedEarly() and decide what to show.`,
      );
    }
    return;
  }
  if (earlyStop === undefined) return;
  recordEarlyStop(scope, earlyStop, wrapUp);
}

/** The `route_decided` rationale for a wrap-up. */
function wrapUpRationale(scope: TypedScope<AgentState>): string {
  const pending = (scope.llmLatestToolCalls as readonly { name: string }[]).length;
  return (
    `maxIterations reached with ${pending} tool call(s) still pending — asking once more ` +
    `with the tools withheld, so the turn ends with a summary instead of a fragment`
  );
}

function emitRouteDecided(
  scope: TypedScope<AgentState>,
  chosen: RouteBranch,
  rationale: string,
): void {
  typedEmit(scope, 'agentfootprint.agent.route_decided', {
    turnIndex: 0,
    iterIndex: scope.iteration as number,
    chosen,
    rationale,
  });
}

/**
 * Judge a WOULD-BE-FINAL answer against the active step procedure (9.18.0).
 *
 * Called only at a moment the decider is about to return `'final'` (never on
 * a denied answer — a withheld answer is not re-asked, and not nudged). Three
 * verdicts, per the declared table:
 *
 *   • steps remain, no limit fired, nudge unspent → `'step-nudge'`: the
 *     StepNudge branch appends the one teaching re-ask and loops (it emits
 *     `steps_unfinished { action: 'nudged' }` itself, where the work is);
 *   • steps remain, nudge already spent → final proceeds — NEVER a forced
 *     continue; `steps_unfinished { action: 'accepted' }` goes on the record
 *     here (no stage runs for an accepted stop);
 *   • steps remain, a LIMIT forced final → final proceeds, no nudge (a nudge
 *     would spend an iteration the limit refused);
 *     `steps_unfinished { action: 'cut-short' }`.
 *
 * A turn that tenured two stepped skills is judged on the CURRENT pointer
 * only — an earlier tenant's unfinished procedure died at its cursor move
 * (the re-key), already visible in the record as a pointer that never
 * completed. Undefined `stepPlanFor`, no pointer, or a complete procedure →
 * `undefined` and not one event (zero-cost-when-unused).
 */
function judgeUnfinishedSteps(
  scope: TypedScope<AgentState>,
  stepPlanFor: StepPlanFor | undefined,
  earlyStop: 'max-iterations' | 'cost-budget' | undefined,
): 'step-nudge' | undefined {
  if (!stepPlanFor) return undefined;
  const ptr = pointerOf(scope.stepPointer);
  if (!stepInProgress(ptr)) return undefined;
  const plan = stepPlanFor(ptr.skillId);
  if (!plan) return undefined;
  const iteration = scope.iteration as number;
  if (earlyStop !== undefined) {
    typedEmit(scope, 'agentfootprint.skill.steps_unfinished', {
      skillId: ptr.skillId,
      remaining: remainingStepsOf(ptr, plan),
      total: ptr.total,
      action: 'cut-short',
      iteration,
    });
    return undefined;
  }
  if (scope.stepNudgeSpent === true) {
    typedEmit(scope, 'agentfootprint.skill.steps_unfinished', {
      skillId: ptr.skillId,
      remaining: remainingStepsOf(ptr, plan),
      total: ptr.total,
      action: 'accepted',
      iteration,
    });
    return undefined;
  }
  return 'step-nudge';
}

/**
 * Judge a WOULD-BE-FINAL answer against the evidence this turn actually read
 * (9.35.0) — `.namesAndNumbersFromEvidence()`.
 *
 * Called only at a moment the decider is about to return `'final'`, and never
 * on a denied answer (a withheld answer is not re-asked and not flagged) nor
 * on one that already failed its output schema (it is about to be replaced
 * wholesale, so grounding it would be paying for a turn twice). It runs AFTER
 * the step judge for the same reason: an answer that is about to be nudged is
 * not the final answer yet.
 *
 * The check itself is deterministic set membership — no model call, no
 * embedding, no judge. See `../evidence/gate.ts` for why that is the one
 * non-negotiable property of this feature.
 *
 * Four outcomes, one `evidence_checked` event each (the `'revision-asked'`
 * one is emitted by the branch stage, where the work is — the `steps_unfinished
 * { action: 'nudged' }` precedent):
 *
 *   • clean → `'grounded'`, nothing else happens;
 *   • unsupported values, posture can revise, revision unspent, no limit fired
 *     → `'evidence-recheck'`: the branch names them back and loops once;
 *   • unsupported values, nothing left to try, posture `'rails'` → `'refused'`:
 *     the verdict is committed and the boundary raises instead of returning;
 *   • otherwise → `'flagged'`: the answer ships unchanged with the fact on the
 *     record and one warning naming the values.
 */
function judgeEvidence(
  scope: TypedScope<AgentState>,
  gate: ResolvedEvidenceGate | undefined,
  earlyStop: 'max-iterations' | 'cost-budget' | undefined,
): 'evidence-recheck' | undefined {
  if (gate === undefined) return undefined;
  const answer = (scope.llmLatestContent as string | undefined) ?? '';
  const iteration = scope.iteration as number;
  const afterRevision = scope.evidenceRevisionSpent === true;
  // An empty answer states nothing. `stoppedEarly` already reports why it is
  // empty; adding "and it cited nothing" would be noise about a non-answer.
  if (answer === '') return undefined;

  const history = scope.history as readonly LLMMessage[];
  const verdict = checkAnswer(answer, {
    gate,
    evidence: evidenceFromHistory(history),
    exempt: exemptFromRun({
      userMessage: scope.userMessage as string | undefined,
      history,
      systemPromptInjections: scope.systemPromptInjections as
        | readonly InjectionRecord[]
        | undefined,
    }),
  });

  if (verdict.unsupported.length === 0) {
    typedEmit(scope, 'agentfootprint.agent.evidence_checked', {
      iteration,
      posture: gate.posture,
      candidates: verdict.candidates,
      unsupported: [],
      action: 'grounded',
      afterRevision,
    });
    return undefined;
  }

  // A revision is worth asking for only when the posture allows one, the turn
  // has not already spent it, and no LIMIT just refused to run another turn
  // (a correction would spend an iteration the limit denied — the step
  // nudge's `cut-short` reasoning).
  const mayRevise =
    gate.posture !== 'assist' &&
    !afterRevision &&
    earlyStop === undefined &&
    // A partial evidence index can call a grounded value fabricated. Acting
    // on one would be an accusation from a half-read corpus, so a truncated
    // index downgrades every posture to record-only.
    !verdict.evidenceTruncated;

  if (mayRevise) {
    scope.evidenceUnsupported = {
      values: verdict.unsupported.slice(0, MAX_REPORTED_VALUES),
      candidates: verdict.candidates,
    };
    return 'evidence-recheck';
  }

  const refused = gate.posture === 'rails' && !verdict.evidenceTruncated;
  scope.unsupportedValues = {
    values: verdict.unsupported.slice(0, MAX_REPORTED_VALUES),
    candidates: verdict.candidates,
    revised: afterRevision,
    refused,
    posture: gate.posture,
  };
  typedEmit(scope, 'agentfootprint.agent.evidence_checked', {
    iteration,
    posture: gate.posture,
    candidates: verdict.candidates,
    unsupported: verdict.unsupported.slice(0, MAX_REPORTED_VALUES),
    action: refused ? 'refused' : 'flagged',
    afterRevision,
    ...(verdict.evidenceTruncated && { evidenceTruncated: true }),
  });
  if (!refused) {
    // Only on the shipping path: a refusal raises a teaching error at the
    // boundary, and warning about an answer nobody receives is noise.
    // eslint-disable-next-line no-console
    console.warn(
      evidenceRefusalSentence(verdict.unsupported, gate.posture, afterRevision) +
        (verdict.evidenceTruncated
          ? ' NOTE: this turn read more evidence than the index holds, so the check ' +
            'recorded its verdict without acting on it.'
          : ''),
    );
  }
  return undefined;
}

/** The `route_decided` rationale for an evidence recheck. */
function evidenceRecheckRationale(scope: TypedScope<AgentState>): string {
  const pending = scope.evidenceUnsupported;
  const count = pending?.values.length ?? 0;
  return (
    `final answer states ${count} value(s) that appear in no tool result — ` +
    `naming them back to the model for one revision (at most once per turn)`
  );
}

/** The `route_decided` rationale for a step nudge. */
function stepNudgeRationale(scope: TypedScope<AgentState>): string {
  const ptr = pointerOf(scope.stepPointer)!;
  const remaining = ptr.total - ptr.step + 1;
  return (
    `final answer left ${remaining} declared step(s) of '${ptr.skillId}' unrun — ` +
    `one teaching nudge goes back (at most once per turn)`
  );
}

/**
 * The decider every plain agent runs: decide, announce, file whatever a limit
 * did. `hasWrapUp` is the ONE build-time fact it needs — a decider may never
 * name a branch the chart did not mount.
 */
function buildSimpleDecider(hasWrapUp: boolean): (scope: TypedScope<AgentState>) => RouteBranch {
  return (scope) => {
    const { chosen, rationale, earlyStop } = decideBranch(scope);
    // ── The out-of-budget wrap-up (9.56.0) ─────────────────────────────
    // FIRST, and before the output chain or any judge: a fragment the loop is
    // about to replace is not the final answer, so it is not middlewared, not
    // schema-judged and not grounded — the step nudge's reasoning, one branch
    // over. `false` for hasWrapUp short-circuits here in one comparison.
    if (chosen === 'final' && wantsWrapUp(scope, earlyStop, hasWrapUp)) {
      emitRouteDecided(scope, 'wrap-up', wrapUpRationale(scope));
      settleWrapUp(scope, earlyStop, true);
      return 'wrap-up';
    }
    emitRouteDecided(scope, chosen, rationale);
    if (chosen === 'final') settleWrapUp(scope, earlyStop, false);
    return chosen;
  };
}

/** The wrap-up-less decider, kept as a module constant because it is the exact
 *  function reference every pre-9.56.0 chart was handed. */
export const routeDeciderStage = buildSimpleDecider(false);

/**
 * Build the Route decider, optionally carrying the `'output'` half of the
 * message chain.
 *
 * ## Why the chain runs HERE and not in PrepareFinal
 *
 * PrepareFinal is where `finalContent` is set, which makes it look like the
 * output seam. It is not, for one structural reason: it lives inside the Final
 * BRANCH subflow, and a branch mount hands its `outputMapper` the branch's
 * RESULT, not its scope — so nothing that stage writes reaches the run's
 * shared state. Ledger rows filed there would sit in an isolated commit log,
 * and one ledger would be split across two places a reader has to know about.
 *
 * The decider is one stage earlier, in the main chart, and it is the first
 * moment the run KNOWS this turn is the final answer. Its writes commit before
 * the branch resolves (footprintjs commits a decider stage ahead of matching
 * the branch), and the value it rewrites — `llmLatestContent` — is exactly
 * what PrepareFinal copies into `finalContent`. So the caller, the committed
 * record, the `newMessages` the memory writes persist, and the ledger row all
 * carry the same string. One seam, one answer.
 *
 * The `'tool-calls'` path is untouched: a turn that is still calling tools has
 * not produced an answer, and running an output rule over a half-finished turn
 * would be running it over something that is not the output.
 *
 * Empty chain → the exact synchronous decider this file has always exported.
 *
 * ## Why the schema is judged HERE too
 *
 * The same property that made this the output seam makes it the enforcement
 * seam. `outputSchema` used to be judged only at the caller's boundary, after
 * the run — a fine place to reject an answer and a useless place to fix one,
 * because the loop has already stopped. Judged here, one stage before the
 * Final branch, the run still HAS a loop: a failed answer can route to
 * `'output-retry'`, which loops back for one more real turn.
 *
 * The judging runs AFTER the message chain, over the content the chain
 * produced, because that is the string the caller will receive — validating
 * the pre-chain value would judge an answer nobody gets. A DENIED answer is
 * never judged or retried: it was withheld on purpose, and re-asking for it
 * would be the library working around a rule the app wrote.
 */
export function buildRouteDeciderStage(
  messageMiddleware?: readonly MessageMiddleware[],
  enforcement?: ResolvedOutputEnforcement,
  stepPlanFor?: StepPlanFor,
  evidence?: ResolvedEvidenceGate,
  /** Whether the chart mounted the WrapUp branch (9.56.0). A decider may never
   *  name a branch that does not exist, so this is build-time knowledge, not a
   *  scope read. `false` reproduces every earlier release exactly. */
  hasWrapUp = false,
  /** The declared claim contract (9.61.0) and the run's disposition ledger.
   *  Both absent → the claim seam never runs and not one line changes. */
  claims?: readonly DeclaredClaim[],
  integrityLedger?: { current: DispositionLedger | undefined },
): (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch> {
  const chain = messageMiddleware ?? [];
  if (
    chain.length === 0 &&
    enforcement === undefined &&
    stepPlanFor === undefined &&
    evidence === undefined
  ) {
    return hasWrapUp ? buildSimpleDecider(true) : routeDeciderStage;
  }
  if (enforcement !== undefined)
    return buildEnforcingDecider(
      chain,
      enforcement,
      stepPlanFor,
      evidence,
      hasWrapUp,
      claims,
      integrityLedger,
    );
  if (stepPlanFor !== undefined || evidence !== undefined)
    return buildJudgingDecider(chain, stepPlanFor, evidence, hasWrapUp);
  return async (scope) => {
    const { chosen, rationale, earlyStop } = decideBranch(scope);
    // ── The out-of-budget wrap-up (9.56.0) ─────────────────────────────
    // FIRST, and before the output chain or any judge: a fragment the loop is
    // about to replace is not the final answer, so it is not middlewared, not
    // schema-judged and not grounded — the step nudge's reasoning, one branch
    // over. `false` for hasWrapUp short-circuits here in one comparison.
    if (chosen === 'final' && wantsWrapUp(scope, earlyStop, hasWrapUp)) {
      emitRouteDecided(scope, 'wrap-up', wrapUpRationale(scope));
      settleWrapUp(scope, earlyStop, true);
      return 'wrap-up';
    }
    emitRouteDecided(scope, chosen, rationale);
    if (chosen !== 'final') return chosen;

    const verdict = await runMessageChain(chain, {
      phase: 'output',
      content: scope.llmLatestContent,
      history: [...(scope.history as readonly LLMMessage[])],
      iteration: scope.iteration,
      ...(scope.runIdentity && { identity: scope.runIdentity }),
    });
    recordDecisions(scope, verdict.decisions);
    if (verdict.kind === 'deny') {
      // The answer is NOT released. It stays in the commit log where the run
      // put it, under whatever redaction the run configured, and the boundary
      // raises instead of returning — handing the caller a refusal in place of
      // an answer is the one substitution they must never make unknowingly.
      scope.messageDeniedReason = verdict.reason;
      scope.messageDeniedPhase = 'output';
      scope.messageDeniedBy = verdict.middleware;
    }
    // Committed either way: on a refusal this is what was withheld, and the
    // ledger row beside it says who withheld it and why.
    scope.llmLatestContent = verdict.content;
    // AFTER the chain: `answerWasEmpty` has to be judged on the string the
    // caller will actually receive, and the chain may have rewritten it.
    settleWrapUp(scope, earlyStop, false);
    return chosen;
  };
}

/**
 * The decider an agent with a STEPPED skill (9.18.0) and/or the evidence gate
 * (9.35.0) runs, without schema enforcement: decide, run the output chain if
 * there is one, judge the would-be-final answer against the active procedure
 * and then against the evidence, THEN announce the branch once — so
 * `route_decided` names the branch the run actually took (the enforcing
 * decider's discipline). A DENIED answer is neither judged nor nudged nor
 * grounded: it was withheld on purpose, and looping it would re-ask for an
 * answer the app refused to release.
 *
 * Only agents that asked for one of those two receive this function —
 * everyone else keeps the exact decider (and event timing) they always had.
 */
/**
 * THE CLAIM SEAM (9.61.0) — the last judge, and the only one that changes
 * nothing.
 *
 * It runs where the answer is about to be handed back: after the schema
 * accepted it, after the procedure judge, after the evidence gate grounded
 * its values. That order is the point — this check reads the VALIDATED
 * answer object, so it can only run on an answer the schema already let
 * stand, and it asks a question none of the others can: does what the
 * answer SAYS agree with what the run SETTLED?
 *
 * It never re-routes. The other three judges can send the turn back for a
 * revision; a contradiction between the answer and the ledger is a fact
 * about a finished run, and re-asking the model would invite it to change
 * the claim rather than the run to change the facts. So this files a
 * finding and returns — detection converting a silent disagreement into an
 * attributable one, exactly as every other seam in this family does.
 */
function judgeClaims(
  scope: TypedScope<AgentState>,
  claims: readonly DeclaredClaim[] | undefined,
  ledgerHolder: { current: DispositionLedger | undefined } | undefined,
): void {
  if (claims === undefined || claims.length === 0) return;
  const parser = undefined;
  void parser;
  const answer = readValidatedAnswer(scope);
  const iteration = (scope.iteration as number | undefined) ?? 0;
  if (answer === undefined) {
    // The answer is not readable as the typed stratum (a parser that
    // returns a non-object, an answer that is bare prose). Incomparable —
    // stated per declared claim, never guessed at.
    for (const claim of claims) {
      ledgerHolder?.current?.note('unsupported-claim', 'claim', 'unreachable');
      void claim;
    }
    return;
  }
  const { findings, dispositions } = unsupportedClaimsOf(
    claims,
    (scope.claimFacts as Parameters<typeof unsupportedClaimsOf>[1] | undefined) ?? [],
    answer,
    iteration,
  );
  for (const d of dispositions) {
    ledgerHolder?.current?.note(
      'unsupported-claim',
      'claim',
      d.disposition,
      d.disposition === 'checked-fail' ? Date.now() : undefined,
    );
  }
  if (findings.length === 0) return;
  const seenIds =
    (scope.$getValue('integrityFindingIds') as readonly string[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ??
    [];
  const newIds: string[] = [...seenIds];
  for (const f of findings) {
    const id = contextErrorIdentity({ ...f, epoch: undefined });
    if (newIds.includes(id)) continue;
    newIds.push(id);
    typedEmit(scope, 'agentfootprint.integrity.context_error', { ...f, iteration });
  }
  if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
}

/**
 * The answer as a typed object, or `undefined` when there is none to read.
 *
 * Deliberately re-parses the STRING the caller will receive rather than
 * reaching for a parsed object: both output strategies normalize to that
 * string (`tool-forced` re-serializes its tool args into it), so this is
 * the one shape that exists on every path — and checking anything else
 * would check an answer nobody gets.
 */
function readValidatedAnswer(scope: TypedScope<AgentState>): unknown | undefined {
  const raw = scope.llmLatestContent as string | undefined;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildJudgingDecider(
  chain: readonly MessageMiddleware[],
  stepPlanFor: StepPlanFor | undefined,
  evidence: ResolvedEvidenceGate | undefined,
  hasWrapUp: boolean,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const { chosen, rationale, earlyStop } = decideBranch(scope);
    if (chosen !== 'final') {
      emitRouteDecided(scope, chosen, rationale);
      return chosen;
    }
    // ── The out-of-budget wrap-up (9.56.0) ─────────────────────────────
    // FIRST, and before the output chain or any judge: a fragment the loop is
    // about to replace is not the final answer, so it is not middlewared, not
    // schema-judged and not grounded — the step nudge's reasoning, one branch
    // over. `false` for hasWrapUp short-circuits here in one comparison.
    if (wantsWrapUp(scope, earlyStop, hasWrapUp)) {
      emitRouteDecided(scope, 'wrap-up', wrapUpRationale(scope));
      settleWrapUp(scope, earlyStop, true);
      return 'wrap-up';
    }
    let denied = false;
    if (chain.length > 0) {
      const verdict = await runMessageChain(chain, {
        phase: 'output',
        content: scope.llmLatestContent,
        history: [...(scope.history as readonly LLMMessage[])],
        iteration: scope.iteration,
        ...(scope.runIdentity && { identity: scope.runIdentity }),
      });
      recordDecisions(scope, verdict.decisions);
      if (verdict.kind === 'deny') {
        denied = true;
        scope.messageDeniedReason = verdict.reason;
        scope.messageDeniedPhase = 'output';
        scope.messageDeniedBy = verdict.middleware;
      }
      scope.llmLatestContent = verdict.content;
    }
    if (!denied && judgeUnfinishedSteps(scope, stepPlanFor, earlyStop) === 'step-nudge') {
      emitRouteDecided(scope, 'step-nudge', stepNudgeRationale(scope));
      return 'step-nudge';
    }
    // AFTER the step judge: an answer about to be nudged is not the final
    // answer, and grounding it would pay for a turn that is being replaced.
    if (!denied && judgeEvidence(scope, evidence, earlyStop) === 'evidence-recheck') {
      emitRouteDecided(scope, 'evidence-recheck', evidenceRecheckRationale(scope));
      return 'evidence-recheck';
    }
    emitRouteDecided(scope, 'final', rationale);
    settleWrapUp(scope, earlyStop, false);
    return 'final';
  };
}

/**
 * The decider an agent with `.outputSchema(parser, { retries })` runs:
 * decide, run the output chain if there is one, judge the answer, THEN
 * announce the branch — so `route_decided` names the branch the run actually
 * took rather than the one it was heading for.
 */
function buildEnforcingDecider(
  chain: readonly MessageMiddleware[],
  enforcement: ResolvedOutputEnforcement,
  stepPlanFor: StepPlanFor | undefined,
  evidence: ResolvedEvidenceGate | undefined,
  hasWrapUp: boolean,
  claims: readonly DeclaredClaim[] | undefined,
  integrityLedger: { current: DispositionLedger | undefined } | undefined,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const base = decideBranch(scope);
    if (base.chosen !== 'final') {
      emitRouteDecided(scope, base.chosen, base.rationale);
      return base.chosen;
    }
    // ── The out-of-budget wrap-up (9.56.0) ─────────────────────────────
    // FIRST, and before the output chain or any judge: a fragment the loop is
    // about to replace is not the final answer, so it is not middlewared, not
    // schema-judged and not grounded — the step nudge's reasoning, one branch
    // over. `false` for hasWrapUp short-circuits here in one comparison.
    if (wantsWrapUp(scope, base.earlyStop, hasWrapUp)) {
      emitRouteDecided(scope, 'wrap-up', wrapUpRationale(scope));
      settleWrapUp(scope, base.earlyStop, true);
      return 'wrap-up';
    }

    let denied = false;
    // Who, if anyone, rewrote the answer on its way out — and whether the
    // answer they rewrote was already good. See `brokenBy` below.
    let rewrittenBy: string | undefined;
    const preChainAnswer = scope.llmLatestContent as string;
    if (chain.length > 0) {
      const verdict = await runMessageChain(chain, {
        phase: 'output',
        content: scope.llmLatestContent,
        history: [...(scope.history as readonly LLMMessage[])],
        iteration: scope.iteration,
        ...(scope.runIdentity && { identity: scope.runIdentity }),
      });
      recordDecisions(scope, verdict.decisions);
      if (verdict.kind === 'deny') {
        denied = true;
        scope.messageDeniedReason = verdict.reason;
        scope.messageDeniedPhase = 'output';
        scope.messageDeniedBy = verdict.middleware;
      }
      // The LAST link that changed the content is the one holding the string
      // about to be judged. Read off the ledger rows the chain just filed, so
      // the attribution and the record cannot disagree.
      for (const d of verdict.decisions) if (d.changed === true) rewrittenBy = d.middleware;
      scope.llmLatestContent = verdict.content;
    }

    // A withheld answer is not judged and never re-asked. The app decided
    // nobody gets this string; asking the model for a better-shaped version
    // of it would be the library routing around that decision.
    if (denied) {
      emitRouteDecided(scope, 'final', base.rationale);
      settleWrapUp(scope, base.earlyStop, false);
      return 'final';
    }

    const attempt = ((scope.outputAttempts?.length as number | undefined) ?? 0) + 1;
    const failure = judgeAnswer(scope.llmLatestContent as string, enforcement.parser);

    if (failure === undefined) {
      recordOutputAttempt(scope, {
        attempt,
        iteration: scope.iteration as number,
        outcome: 'passed',
      });
      // The schema verdict ran FIRST (an answer being re-asked is not a
      // stop); the step judge sees only an answer the schema let stand.
      if (judgeUnfinishedSteps(scope, stepPlanFor, base.earlyStop) === 'step-nudge') {
        emitRouteDecided(scope, 'step-nudge', stepNudgeRationale(scope));
        return 'step-nudge';
      }
      // The evidence gate is last of the three judges: it grounds the answer
      // the schema accepted and the procedure finished — the one that is
      // really about to be handed back.
      if (judgeEvidence(scope, evidence, base.earlyStop) === 'evidence-recheck') {
        emitRouteDecided(scope, 'evidence-recheck', evidenceRecheckRationale(scope));
        return 'evidence-recheck';
      }
      // LAST, and it re-routes nothing: this answer is the one being handed
      // back, and a claim that disagrees with the run's settled facts is a
      // fact about a finished run (see judgeClaims).
      judgeClaims(scope, claims, integrityLedger);
      emitRouteDecided(scope, 'final', base.rationale);
      settleWrapUp(scope, base.earlyStop, false);
      return 'final';
    }

    // Did the OUTPUT CHAIN break an answer the model got right? (8.18.0)
    //
    // Judging after the chain is correct — that string is what the caller
    // receives — but it made the model wear a middleware's mistake. A rule that
    // rewrites a valid answer into an invalid one will do it again to the next
    // answer, so re-asking cannot converge: the run pays for every retry and
    // ends where it started. Before this, the ledger read
    // `[retried, retried, exhausted]` with the validator's complaint about text
    // the model never wrote.
    //
    // The judgement is on the PRE-chain string, and only when a link actually
    // changed something — so a chain that merely inspected the answer costs a
    // second parse of nothing.
    const brokenByChain =
      rewrittenBy !== undefined && judgeAnswer(preChainAnswer, enforcement.parser) === undefined
        ? rewrittenBy
        : undefined;

    if (attempt <= enforcement.retries && brokenByChain === undefined) {
      // The retry stage writes the correction and files the row, because it
      // is the one that knows what it wrote. This is the hand-off.
      scope.outputSchemaFailure = { attempt, ...failure };
      emitRouteDecided(
        scope,
        'output-retry',
        `final answer failed the output schema (${failure.stage}) — ` +
          `asking again, attempt ${attempt + 1} of ${enforcement.retries + 1}`,
      );
      return 'output-retry';
    }

    // Out of retries — or holding an answer no retry could fix. The answer
    // stands as the run's answer; `runTyped()` throws on it at the boundary
    // exactly as it did before any of this existed, and `.outputFallback()`
    // still gets its turn there.
    recordOutputAttempt(scope, {
      attempt,
      iteration: scope.iteration as number,
      outcome: 'exhausted',
      stage: failure.stage,
      error: failure.error,
      ...(failure.path !== undefined && { path: failure.path }),
      ...(brokenByChain !== undefined && { brokenBy: brokenByChain }),
    });
    recordContractUnmet(scope, {
      failure,
      attempts: attempt,
      retriesSpent: attempt - 1,
      fallbackConfigured: enforcement.hasFallback,
      ...(brokenByChain !== undefined && { brokenBy: brokenByChain }),
    });
    // A schema-exhausted answer is still a would-be-final one, and the step
    // table is unconditional on schema state: steps remaining + nudge
    // unspent → one teaching re-ask (its turn may well fix both).
    if (judgeUnfinishedSteps(scope, stepPlanFor, base.earlyStop) === 'step-nudge') {
      emitRouteDecided(scope, 'step-nudge', stepNudgeRationale(scope));
      return 'step-nudge';
    }
    // The evidence gate deliberately does NOT run here. This answer already
    // failed its own contract and the caller is being told so; grounding the
    // values inside a shape the app has declared invalid would file a second
    // verdict about a string nobody is going to use, and under `guard` it
    // would buy a revision for an answer that cannot pass anyway.
    emitRouteDecided(
      scope,
      'final',
      brokenByChain !== undefined
        ? `final answer satisfied the output schema until the output rule '${brokenByChain}' ` +
            `rewrote it (${failure.stage}) — not re-asked, because the model's answer was fine`
        : `final answer failed the output schema (${failure.stage}) and ` +
            `${enforcement.retries} retry/retries were spent`,
    );
    settleWrapUp(scope, base.earlyStop, false);
    return 'final';
  };
}

/**
 * File — and announce — a run whose answer does not satisfy its own contract.
 *
 * Three channels, for the reason `recordEarlyStop` has three: before 8.18.0
 * this moment had ZERO. `run()` returned the contract-violating string, no
 * event fired, nothing was warned, and under the default `retries: 0` not even
 * a ledger row existed — the run's own record could not show that a contract
 * had been declared, let alone missed. `runTyped()` threw, which helps exactly
 * the callers who were already asking.
 *
 * It does NOT throw. `run()` returns a string by contract, and an answer that
 * failed validation is still what the model said — the caller who wants a
 * raise has `runTyped()`, and that choice stays theirs.
 */
function recordContractUnmet(
  scope: TypedScope<AgentState>,
  facts: {
    readonly failure: { stage: 'json-parse' | 'schema-validate'; error: string; path?: string };
    readonly attempts: number;
    readonly retriesSpent: number;
    readonly fallbackConfigured: boolean;
    readonly brokenBy?: string;
  },
): void {
  const { failure, attempts, retriesSpent, fallbackConfigured, brokenBy } = facts;
  scope.outputContractUnmet = {
    stage: failure.stage,
    error: failure.error,
    ...(failure.path !== undefined && { path: failure.path }),
    attempts,
    retriesSpent,
    fallbackConfigured,
    ...(brokenBy !== undefined && { brokenBy }),
  };

  typedEmit(scope, 'agentfootprint.agent.output_contract_unmet', {
    stage: failure.stage,
    error: failure.error,
    ...(failure.path !== undefined && { path: failure.path }),
    attempts,
    retriesSpent,
    fallbackConfigured,
    iteration: scope.iteration as number,
    ...(brokenBy !== undefined && { brokenBy }),
  });

  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] this run's answer does NOT satisfy the output schema ` +
      `(${failure.stage}: ${failure.error})` +
      (brokenBy !== undefined
        ? `. The model's own answer PASSED — the output rule '${brokenBy}' rewrote it into one ` +
          `that does not, so it was not re-asked: re-asking cannot fix a rule.`
        : retriesSpent > 0
        ? `, after ${retriesSpent} corrective re-ask(s) that were billed.`
        : `. No re-ask was configured — .outputSchema(parser, { retries: 1 }) buys one.`) +
      ` run() hands back the raw answer as it always has; runTyped() throws OutputSchemaError ` +
      `on it` +
      (fallbackConfigured
        ? `, and this agent's .outputFallback() tiers run there — run() does not reach them.`
        : `.`) +
      ` Read agent.outputContractUnmet() for the same facts after the run.`,
  );
}
