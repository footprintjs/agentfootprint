import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import {
  type StepPointer,
  type StepPlan,
  pointerOf,
  stepInProgress,
  currentStepOf,
  skipNothingActiveSentence,
  skipNeedsReasonSentence,
  skipHoldSentence,
  skipAdvanceSentence,
  stepAdvanceSuffix,
  readSkillStepIntro,
} from '../../../../../injection-engine/skillSteps.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';

/** Compose the existing steps callbacks once for this handler. */
export function buildToolStepsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'stepPlanFor' | 'escalation'>,
): ToolStepsOperations {
  // ── Step-procedure boundary (9.18.0) — ONE implementation, five sites ──
  // The batch loop and the four resume paths all finalize results; each
  // calls these where its result becomes final, so a pointer can never miss
  // a move because of which door the result came through (the resume-path
  // law: the checkpoint carries the pointer for free in sharedState, and
  // the answered call advances it HERE on resume).

  /** The in-progress procedure, when there is one: pointer + plan + the
   *  current step. Undefined on every agent without steps, between tenures,
   *  and once a procedure completed. */
  const stepStateOf = (
    scope: TypedScope<AgentState>,
  ): { ptr: StepPointer; plan: StepPlan; step: { tool: string; note: string } } | undefined => {
    if (!deps.stepPlanFor) return undefined;
    // A VALUE, not a handle: `scope.stepPointer[0]` is a proxy that reads
    // live by path (footprintjs 9.22.0), so after `scope.stepPointer = [next]`
    // below it would already answer with `next` — and the event that names
    // the step just completed would name the one after it. `$getValue`
    // hands back the committed/staged object itself, which never changes
    // once the pointer is replaced (committed state is immutable-after-swap).
    const ptr = pointerOf(scope.$getValue('stepPointer'));
    if (!stepInProgress(ptr)) return undefined;
    const plan = deps.stepPlanFor(ptr.skillId);
    if (!plan) return undefined;
    const step = currentStepOf(ptr, plan);
    return step ? { ptr, plan, step } : undefined;
  };

  // LENS · tool-result · persistent-history
  // reads: the advanced pointer ← pointerOf(scope.stepPointer), under `toolCalls/routing/stepsOperations.ts` · "── Step-procedure boundary (9.18.0)"; the sentence ← ../../injection-engine/skillSteps.ts
  // note: it overwrites the placeholder BEFORE the after-tool moment, so the record carries the authoritative words.
  // law: may omit, never deny; every clause anchored to the call it was composed on.
  /**
   * `skip_step` bookkeeping — returns the AUTHORITATIVE result that
   * replaces the tool's placeholder (both channels, the read_skill-refusal
   * precedent). Emits `step_skipped` and moves/holds the pointer per the
   * declared policy; a teaching answer (no active procedure / empty
   * reason) emits nothing.
   */
  const applySkipStep = (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ): string => {
    const state = stepStateOf(scope);
    if (!state) return skipNothingActiveSentence();
    const raw = (call.args as { reason?: unknown }).reason;
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (reason.length === 0) return skipNeedsReasonSentence();
    const { ptr, plan, step } = state;
    typedEmit(scope, 'agentfootprint.skill.step_skipped', {
      skillId: ptr.skillId,
      step: { index: ptr.step, total: ptr.total, tool: step.tool, note: step.note },
      reason,
      policy: plan.onSkip,
      iteration: call.iteration,
      toolCallId: call.toolCallId,
    });
    // 'hold': recorded and held — the step stays the offer; repeated skips
    // of a held step are each recorded, because each is a fact.
    if (plan.onSkip === 'hold') return skipHoldSentence(ptr, reason, plan);
    const next: StepPointer = {
      skillId: ptr.skillId,
      step: ptr.step + 1,
      total: ptr.total,
      skipped: [...ptr.skipped, ptr.step],
    };
    scope.stepPointer = [next];
    return skipAdvanceSentence(ptr.step, reason, next, plan);
  };

  /**
   * Advance-on-return — the caller has just finalized a NON-error,
   * NON-denied, NON-refused result for `toolName`. When that call is the
   * current step's tool: pointer + 1, `step_advanced` (with `completed` on
   * the last), and the returned suffix joins the model-visible result
   * BEFORE the history push. Empty string otherwise. Eligibility (ran,
   * not denied/rejected/errored) is judged by the CALLING site, because
   * each dispatch path knows its own truth about that.
   */
  const applyStepReturn = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  ): string => {
    const state = stepStateOf(scope);
    if (!state || state.step.tool !== call.toolName) return '';
    const { ptr, plan, step } = state;
    const next: StepPointer = {
      skillId: ptr.skillId,
      step: ptr.step + 1,
      total: ptr.total,
      skipped: [...ptr.skipped],
    };
    scope.stepPointer = [next];
    const completed = next.step > next.total;
    typedEmit(scope, 'agentfootprint.skill.step_advanced', {
      skillId: ptr.skillId,
      step: { index: ptr.step, total: ptr.total, tool: step.tool, note: step.note },
      iteration: call.iteration,
      toolCallId: call.toolCallId,
      ...(completed && { completed: true as const }),
    });
    return stepAdvanceSuffix(next, plan);
  };

  /** The `read_skill` activation intro for a STEPPED skill — where its
   *  procedure starts. Rides the same "activated for the next iteration"
   *  promise the read_skill result already makes (a same-batch declared
   *  edge that outruns the pick reports itself via `reroute_superseded`,
   *  exactly as it does for the activation sentence). */
  const readSkillStepIntroFor = (pickedId: string): string => {
    const plan = deps.stepPlanFor?.(pickedId);
    return plan ? readSkillStepIntro(plan) : '';
  };

  // ── Escalate-on-evidence (9.19.0) — the refusal budget ─────────────────
  // Called beside ALL THREE `skill.rejected` emit sites — self-call,
  // reachability and posture: real recorded refusals are the only evidence that
  // counts. The self-call site is deliberate and worth stating, because the
  // sentence it composes is NOT a refusal to the model (see `selfCallNotice`):
  // what the budget measures is not how a message reads, it is a model that
  // keeps asking the graph where it is instead of working — the stuck run this
  // budget exists to escalate. Both facts hold at once, and neither comment
  // gets to imply the other away. At the
  // declared threshold the flip is committed (`skillEscalated` — the fact
  // callLLM's brainFor reads) and `skill.escalated` fires ONCE; the counter
  // keeps counting so the record shows the whole loop. Gated on the policy
  // being declared — otherwise not one key is read or written.
  const noteSkillRefusal = (scope: TypedScope<AgentState>, iteration: number): void => {
    const escalation = deps.escalation;
    if (!escalation) return;
    const refusals = ((scope.skillRefusalsThisTurn as number | undefined) ?? 0) + 1;
    scope.skillRefusalsThisTurn = refusals;
    if (refusals >= escalation.afterRefusals && scope.skillEscalated !== true) {
      scope.skillEscalated = true;
      typedEmit(scope, 'agentfootprint.skill.escalated', {
        iteration,
        afterRefusals: escalation.afterRefusals,
        refusals,
        from: escalation.describeFrom(
          scope.currentSkillId as string | undefined,
          scope.resolvedModel as string | undefined,
        ),
        to: escalation.to,
      });
    }
  };

  return { stepStateOf, applySkipStep, applyStepReturn, readSkillStepIntroFor, noteSkillRefusal };
}
