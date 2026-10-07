/**
 * prepareFinal — first stage of the agent's "Final" branch subflow.
 *
 * Captures the turn payload (`finalContent` from the LLM's latest
 * content; `newMessages` as the `[user, assistant]` pair the memory-
 * write subflows persist) and emits the per-turn observability
 * brackets (`iteration_end`, `turn_end`).
 *
 * Mounted as the FIRST stage of the final-branch subflow built in
 * `buildAgentChart`. Subsequent memory-write subflows mount AFTER this
 * stage so they have `newMessages` available; `breakFinal` is the
 * terminal stage that stops the ReAct loop.
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `flowChart(...)` in buildAgentChart.
 *
 * NOT the seam for `messageMiddleware`'s `'output'` half, deliberately.
 * This stage runs inside the Final BRANCH subflow, whose state does not
 * merge back into the run (a branch mount hands its outputMapper the
 * branch's RESULT, not its scope). Rows filed here would land in an
 * isolated commit log and never reach `snapshot.sharedState`, splitting
 * one ledger across two places. The chain runs one stage earlier instead
 * — in the Route decider, in the main chart — and rewrites
 * `llmLatestContent`, which is the value this stage copies. See
 * `stages/route.ts`.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AnswerAssessmentData } from '../assessment/compose.js';
import {
  composeAnswerWithCoverage,
  copyAnswerCoverage,
  type AnswerCoverage,
} from '../coverage/index.js';
import type { TimeLimitLines } from '../coverage/timeLimits.js';
import type { AgentState } from '../types.js';
import type { FindingsLedger } from '../findings/types.js';
import { presentationZoneOf } from '../../time/rows.js';
import type { BoundPresentation } from '../../time/present.js';
import { withheldByOutputPolicy } from './outputAdmission.js';

type FinalStage = (scope: TypedScope<AgentState>) => void | Promise<void>;

/**
 * The stage body, with the answer passed IN.
 *
 * One body, several entry points. The answer is a parameter rather than a
 * read of `scope.llmLatestContent` because `.limitsTravelWithTheAnswer()`
 * composes a different one — and everything filed here (`finalContent`,
 * `newMessages`, which memory persists, and `turn_end.finalContent`) must
 * agree about what the answer WAS. Note that `llmLatestContent` itself is a
 * READ-ONLY input to this branch subflow, so there is no version of this
 * where the composed answer is written back over it: the capture is the only
 * place all four readers meet.
 *
 * `answerCoverage` is a typed answer's limits
 * (`prepareFinalWithLimitsAsDataStage`), already detached: projected onto
 * `turn_end` beside the answer, never into it. `answerAssessment` is the
 * answer layer's standing as data (honesty layer 4), already detached:
 * projected onto `turn_end` the same way.
 */
/**
 * The scopes whose capture records an answer the evidence rails REFUSED
 * (`withRailsRefusal`). Keyed by the stage's own scope object — the
 * per-invocation channel `interrupt()` uses — so the capture learns it
 * without a second state read and every other turn's payload keeps its bytes.
 */
const RAILS_REFUSED = new WeakSet<object>();

const captureTurnPayload = (
  scope: TypedScope<AgentState>,
  answer: string,
  commitValidated = false,
  answerCoverage?: AnswerCoverage,
  answerAssessment?: AnswerAssessmentData,
  releaseTokens = false,
): void => {
  const iteration = scope.iteration;
  scope.finalContent = answer;
  // v2.14 — attach thinking blocks to the assistant final message
  // (if any). For non-Anthropic providers this is informational; for
  // Anthropic + extended-thinking-with-tool-use, signature round-trip
  // requires the blocks to persist on the assistant turn even when
  // it's the FINAL turn (continuation in the next user message).
  const thinkingBlocks = scope.thinkingBlocks;
  const hasThinking = thinkingBlocks !== undefined && thinkingBlocks.length > 0;
  // The turn payload memory writes persist: the user's message
  // paired with the agent's final answer.
  scope.newMessages = [
    { role: 'user', content: scope.userMessage },
    {
      role: 'assistant',
      content: scope.finalContent,
      ...(hasThinking && { thinkingBlocks }),
    },
  ];

  if (commitValidated) {
    scope.answerValidationCommitted = true;
  }
  const refused = RAILS_REFUSED.has(scope);
  if ((commitValidated || releaseTokens) && !refused) {
    // The stream carries exactly the captured candidate, including any
    // earlier output transformation. Replaying provider chunks would undo it.
    // A refused answer is never released.
    if (answer.length > 0) {
      typedEmit(scope, 'agentfootprint.stream.token', {
        iteration,
        tokenIndex: 0,
        content: answer,
      });
    }
  }

  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
  });
  // 9.56.0 — a turn a LIMIT cut short says so ON `turn_end`, the event a
  // consumer already reads to render an outcome. Without it, `finalContent`
  // alone cannot tell a finished answer from the fragment a loop stopped in
  // the middle of, which is how a half-sentence ends up under a green tick.
  // Value-conditional and projected (never the whole committed record): a turn
  // that finished normally emits the exact payload it always did.
  const cut = scope.stoppedEarly;
  typedEmit(scope, 'agentfootprint.agent.turn_end', {
    turnIndex: 0,
    finalContent: scope.finalContent,
    totalInputTokens: scope.totalInputTokens,
    totalOutputTokens: scope.totalOutputTokens,
    iterationCount: iteration,
    durationMs: Date.now() - scope.turnStartMs,
    ...(cut !== undefined && {
      stoppedEarly: {
        reason: cut.reason,
        iteration: cut.iteration,
        pendingToolCalls: cut.pendingToolCalls,
        ...(cut.wrappedUp === true && { wrappedUp: true as const }),
      },
    }),
    // A typed answer's limits, beside it — the same value-conditional grammar:
    // a turn with nothing to carry emits the exact payload it always did.
    ...(answerCoverage !== undefined && { answerCoverage }),
    // The answer layer's standing (honesty layer 4) — only on an agent that
    // armed it; every other turn emits the exact payload it always did.
    ...(answerAssessment !== undefined && { answerAssessment }),
    // A refused answer rides for the record, flagged so no consumer shows it.
    ...(refused && { refused: { by: 'evidence-rails' as const } }),
  });
};

const prepareFinal = (scope: TypedScope<AgentState>, releaseTokens = false): void => {
  captureTurnPayload(scope, scope.llmLatestContent, false, undefined, undefined, releaseTokens);
};
export const prepareFinalStage = (scope: TypedScope<AgentState>): void => prepareFinal(scope);

/**
 * Configured answer validation is the only door that may release its candidate.
 * The authoritative report lives in the outer Route stage. This defensive
 * final guard prevents a missing report or prior refusal from reaching the
 * capture, its public events or the memory writers mounted after it.
 */
export const prepareFinalWithValidationStage = (scope: TypedScope<AgentState>): void => {
  if (withheldByValidation(scope)) return;
  captureTurnPayload(scope, scope.llmLatestContent, true);
};

/**
 * The validated door's guard, ONE owner for both of its stages (with and
 * without the answer layer): a missing report, a failed or unverified enforce
 * report, a prior refusal or a denied answer breaks the branch before the
 * capture — returns `true` when it did.
 */
function withheldByValidation(scope: TypedScope<AgentState>): boolean {
  const report = scope.answerValidation;
  const mayDeliver =
    report !== undefined &&
    (report.mode === 'observe' ||
      (report.mode === 'enforce' && report.status === 'passed' && report.schemaAccepted === true));
  if (
    scope.answerValidationBlocked === true ||
    !mayDeliver ||
    scope.messageDeniedReason !== undefined ||
    scope.unsupportedValues?.refused === true
  ) {
    scope.$break('answer validation withheld terminal delivery');
    return true;
  }
  return false;
}

/**
 * `.limitsTravelWithTheAnswer()` on a TYPED answer (`.outputSchema()`) — the
 * SAME stage, with the answer left exactly as the model sent it and the limits
 * carried beside it.
 *
 * Mounted in place of `prepareFinalStage` by both chart builders only when the
 * agent has an output schema AND asked for its limits to travel. The block
 * `prepareFinalWithLimitsStage` appends is prose, and a typed answer followed
 * by prose is not JSON — `runTyped()` threw on every answer that had limits.
 * So nothing is appended here: `finalContent`, the memory turn and
 * `turn_end.finalContent` all carry the model's (peeled) answer, and the limits
 * the block would have printed ride `turn_end.answerCoverage` — a projection
 * of `AgentState.answerCoverage`, which the Route decider committed on the main
 * chart (`./answerCoverage.ts` · `withAnswerCoverage`). The key is read only
 * under this arm: a run that asked for neither never reads it.
 */
const prepareFinalWithLimitsAsData = (
  scope: TypedScope<AgentState>,
  releaseTokens = false,
): void => {
  const limits = scope.answerCoverage;
  captureTurnPayload(
    scope,
    scope.llmLatestContent,
    false,
    limits === undefined ? undefined : copyAnswerCoverage(limits),
    undefined,
    releaseTokens,
  );
};
export const prepareFinalWithLimitsAsDataStage = (scope: TypedScope<AgentState>): void =>
  prepareFinalWithLimitsAsData(scope);

/**
 * `.limitsTravelWithTheAnswer()`'s half of prepare-final — the SAME stage,
 * with the run's declared coverage folded into the answer first.
 *
 * Mounted in place of `prepareFinalStage` by both chart builders when the
 * option is configured on an answer with no output schema, and nowhere else:
 * an agent that did not ask for it runs `prepareFinalStage`, byte for byte,
 * and a TYPED answer runs `prepareFinalWithLimitsAsDataStage` (above), which
 * appends nothing. Written as one stage rather than a second one because
 * everything the capture files must agree about what the answer WAS — a
 * second stage afterwards would leave `turn_end` reporting an answer the
 * caller never saw.
 *
 * It runs AFTER the evidence gate has judged (the gate is in the Route
 * decider, one stage earlier). That ordering is deliberate: the block is
 * composed by the framework out of what the TOOLS declared, so subjecting it
 * to a check for values the MODEL could not support would be asking whether
 * the library grounded itself.
 */
const prepareFinalWithLimits = (scope: TypedScope<AgentState>, releaseTokens = false): void => {
  const declared = scope.coverageDeclared;
  const answer =
    declared !== undefined && declared.length > 0
      ? composeAnswerWithCoverage(scope.llmLatestContent, declared)
      : scope.llmLatestContent;
  captureTurnPayload(scope, answer, false, undefined, undefined, releaseTokens);
};
export const prepareFinalWithLimitsStage = (scope: TypedScope<AgentState>): void =>
  prepareFinalWithLimits(scope);

/**
 * The run's presentation zone (the time layer) — the zone of the turn's
 * `clock` row (`core/time/rows.ts` · `presentationZoneOf`). Read ONLY by the
 * variants mounted under `.time()`, so an agent without the layer never reads
 * the ledger here. `undefined` when no clock was filed (a paused turn from a
 * runtime without the layer): the lines are then the declared instants.
 */
async function presentationOf(
  scope: TypedScope<AgentState>,
): Promise<BoundPresentation | undefined> {
  const zone = presentationZoneOf(scope.findingsLedger as FindingsLedger | undefined);
  if (zone === undefined) return undefined;
  // The renderer loads only here, under `.time()` — the optional-family law.
  const { bindPresentation } = await import('../../time/present.js');
  return bindPresentation({ zone });
}

/**
 * The time layer's limits lines for THIS turn (step T8), composed from the
 * record: one line per `period` row whose result checks hold
 * (`coverage/period.ts` · `periodCheckLine`) and the wall-clock sources'
 * `Clocks` lines (`source-clock` rows; `core/time/check.ts` · `clocksDiffer`).
 * `undefined` when there is no clock (nothing to render in) or nothing to say.
 */
async function timeLinesOf(scope: TypedScope<AgentState>): Promise<TimeLimitLines | undefined> {
  // The composer (and the renderer it binds) loads only here, under `.time()` — the
  // optional-family law, as `presentationOf`.
  const { timeLimitLinesOf } = await import('../coverage/timeLimits.js');
  return timeLimitLinesOf(
    scope.findingsLedger as FindingsLedger | undefined,
    scope.turnNumber as number | undefined,
  );
}

/**
 * `prepareFinalWithLimitsStage` under `.time()` (the time layer): the same
 * block, each `Period:` line rendered in the run's clock zone with the zone
 * named (`coverage/period.ts` · `periodLine`), and — step T8 — the result
 * checks' lines and the wall-clock sources (`timeLinesOf`). The typed record
 * keeps the declared instants; only the person's line changes.
 */
const prepareFinalWithLimitsInZone = async (
  scope: TypedScope<AgentState>,
  releaseTokens = false,
): Promise<void> => {
  const declared = scope.coverageDeclared ?? [];
  const time = await timeLinesOf(scope);
  const answer =
    declared.length > 0 || time !== undefined
      ? composeAnswerWithCoverage(
          scope.llmLatestContent,
          declared,
          '',
          '',
          await presentationOf(scope),
          time,
        )
      : scope.llmLatestContent;
  captureTurnPayload(scope, answer, false, undefined, undefined, releaseTokens);
};
export const prepareFinalWithLimitsInZoneStage = (scope: TypedScope<AgentState>): Promise<void> =>
  prepareFinalWithLimitsInZone(scope);

/**
 * `.limitsTravelWithTheAnswer()` on an agent whose inputs layer is armed
 * (honesty layer 2) — the limits stage above, plus the values a tool's
 * `assume` rule filled THIS turn: "Assumed (a tool's rule, not your words)",
 * composed by the framework from the committed `argument` rows
 * (`arguments/serve.ts` · `assumedBlockOf`), so the model cannot drop it.
 *
 * Mounted in place of `prepareFinalWithLimitsStage` by both chart builders
 * ONLY when both arms are on — the one place the final branch reads the
 * ledger's argument rows, so a run that armed neither never reads the key (a
 * tracked read of a key a run never writes is a phantom context source). With
 * neither coverage nor an assumed value this turn, the answer is unchanged.
 * The block's reader is loaded through `import()` — the optional-family law
 * of docs-next's site budget — so this variant is async where the others are
 * not, and only an armed agent ever mounts it.
 *
 * `readsRewrites` — the agent has a before-tool middleware chain
 * (`.toolMiddleware()`), so a middleware may have rewritten an argument the
 * layer filled: the call then ran with the REWRITE's value, and a line naming
 * the filled one would put a value in the person's answer that the call did
 * not run with. The stage then reads `middlewareDecisions` and leaves such a
 * row out (omit, never deny) — the reading the answer's standing takes
 * (`middleware/rewrites.ts` · `argumentRewritesOf`), which reads the rewrite
 * itself. Without a chain the key can hold no tool rewrite and is never read.
 */
export function prepareFinalWithLimitsAndAssumedStage(
  readsRewrites: boolean,
  inZone = false,
  releaseTokens = false,
): FinalStage {
  return async (scope) => {
    const { assumedBlockOf } = await import('../arguments/serve.js');
    const declared = scope.coverageDeclared ?? [];
    // The decisions are read only when there is a row a rewrite could
    // supersede — and only on an agent whose chain can write one.
    const assumed = assumedBlockOf(
      scope.findingsLedger ?? [],
      scope.turnNumber as number,
      readsRewrites
        ? () => [...((scope.middlewareDecisions as readonly unknown[] | undefined) ?? [])]
        : undefined,
    );
    const time = inZone ? await timeLinesOf(scope) : undefined;
    const answer =
      declared.length > 0 || assumed !== '' || time !== undefined
        ? composeAnswerWithCoverage(
            scope.llmLatestContent,
            declared,
            assumed,
            '',
            inZone ? await presentationOf(scope) : undefined,
            time,
          )
        : scope.llmLatestContent;
    captureTurnPayload(scope, answer, false, undefined, undefined, releaseTokens);
  };
}

// ─── The answer layer (honesty layer 4) ─────────────────────────────────

/** Which PrepareFinal body the final branch mounts — the arms both chart builders read. */
export interface FinalStageArms {
  readonly hasAnswerValidation?: boolean;
  readonly releaseOutputTokens?: true;
  readonly coverageLimitsAsData?: boolean;
  readonly attachCoverageLimits?: boolean;
  /** The inputs layer is armed; `rewrites` — a before-tool chain can rewrite a filled value. */
  readonly inputsLayer?: { readonly rewrites?: true };
  /** The answer layer is armed; `standingLine` — its one line travels with a prose answer. */
  readonly answerLayer?: { readonly standingLine?: true };
  /** The time layer is armed — the limits block's `Period:` lines render in the clock's zone. */
  readonly timeLayer?: true;
  /** The evidence gate's `'rails'` posture — a refused answer is recorded flagged and ends the branch. */
  readonly evidenceRails?: true;
}

/**
 * THE ONE CHOICE of PrepareFinal's body, for both chart builders (the twins
 * cannot drift). Without the answer layer it returns the very stage function
 * each combination of arms has always mounted — same reference, same bytes;
 * with it, the variant that also carries the layer's standing
 * (`prepareFinalWithAnswerLayerStage`).
 */
export function prepareFinalFor(
  arms: FinalStageArms,
): (scope: TypedScope<AgentState>) => void | Promise<void> {
  const composed = finalStageFor(arms);
  // Under answer validation its guard already stops a rails refusal before the capture.
  const stage =
    arms.evidenceRails === true && arms.hasAnswerValidation !== true
      ? withRailsRefusal(composed)
      : composed;
  if (arms.releaseOutputTokens !== true) return stage;
  return (scope) => {
    if (withheldByOutputPolicy(scope)) return;
    return stage(scope);
  };
}

/**
 * Evidence rails (9.35.0) without answer validation: an answer the rails
 * REFUSED is captured for the record — `turn_end` carries it flagged
 * `refused: { by: 'evidence-rails' }`, because the answer account explains the
 * refusal from it — and then ends the branch: not written to memory, not
 * handed back as the chart's result. The chart ends with NO answer and the
 * verdict in its state (`core/terminalVerdict.ts`), so a composition mounting
 * it reads the refusal, never the refused text. One read, on every rails turn.
 */
function withRailsRefusal(stage: FinalStage): FinalStage {
  return async (scope) => {
    if (scope.unsupportedValues?.refused !== true) return stage(scope);
    RAILS_REFUSED.add(scope);
    try {
      await stage(scope);
    } finally {
      RAILS_REFUSED.delete(scope);
    }
    scope.$break('evidence rails refused this answer');
  };
}

/**
 * Answer validation's guard, for a stage that must not run on an answer the
 * guard withholds (the answer layer's AssessAnswer, before PrepareFinal) —
 * absent when validation is not configured.
 */
export function finalGuardFor(
  arms: Pick<FinalStageArms, 'hasAnswerValidation'>,
): ((scope: TypedScope<AgentState>) => boolean) | undefined {
  return arms.hasAnswerValidation === true ? withheldByValidation : undefined;
}

/** Pick the existing composer; output admission wraps it without recomposing the answer. */
function finalStageFor(arms: FinalStageArms): FinalStage {
  const releaseTokens = arms.releaseOutputTokens === true;
  // A stage's second argument belongs to the engine. Bind delivery here,
  // never add a policy parameter to the function the executor invokes.
  const select = (
    original: FinalStage,
    body: (scope: TypedScope<AgentState>, releaseTokens: boolean) => void | Promise<void>,
  ): FinalStage => (releaseTokens ? (scope) => body(scope, true) : original);
  if (arms.answerLayer !== undefined) {
    return prepareFinalWithAnswerLayerStage(
      {
        validation: arms.hasAnswerValidation === true,
        limitsAsData: arms.coverageLimitsAsData === true,
        limits: arms.attachCoverageLimits === true,
        ...(arms.inputsLayer !== undefined && {
          assumed: { readsRewrites: arms.inputsLayer.rewrites === true },
        }),
        standingLine: arms.answerLayer.standingLine === true,
        ...(arms.timeLayer === true && { inZone: true }),
      },
      releaseTokens,
    );
  }
  const inZone = arms.timeLayer === true;
  return arms.hasAnswerValidation === true
    ? prepareFinalWithValidationStage
    : arms.coverageLimitsAsData === true
    ? select(prepareFinalWithLimitsAsDataStage, prepareFinalWithLimitsAsData)
    : arms.attachCoverageLimits === true
    ? arms.inputsLayer !== undefined
      ? prepareFinalWithLimitsAndAssumedStage(
          arms.inputsLayer.rewrites === true,
          inZone,
          releaseTokens,
        )
      : inZone
      ? select(prepareFinalWithLimitsInZoneStage, prepareFinalWithLimitsInZone)
      : select(prepareFinalWithLimitsStage, prepareFinalWithLimits)
    : select(prepareFinalStage, prepareFinal);
}

/** The answer layer's standing as detached plain data — the fields the projection declares, nothing else. */
function copyAssessment(value: AnswerAssessmentData): AnswerAssessmentData {
  return {
    assessment: value.assessment,
    standing: value.standing,
    reasons: [...value.reasons],
    checked: value.checked.map((c) => ({ layer: c.layer, check: c.check, ran: c.ran, of: c.of })),
  };
}

/**
 * PrepareFinal on an agent whose ANSWER LAYER is armed (honesty layer 4): the
 * same capture, plus the standing the layer's stage filed one stage earlier
 * (`assessment/stage.ts` · `assessAnswerStage`) — on `turn_end` as
 * `answerAssessment`, and, under `.answerLayer({ standingLine: true })`, as
 * one line appended to a PROSE answer.
 *
 * Every other arm keeps its own law: the validated door delivers exactly the
 * judged bytes (the line is refused beside `.answerValidation()` at build); a
 * typed answer is never touched (the line is refused beside `.outputSchema()`,
 * and its limits still travel as data); a prose answer under
 * `.limitsTravelWithTheAnswer()` still gets the limits block — and when the
 * line is on, the line names the assumed values and the "Assumed" block is
 * not appended too (one composer for one fact). The answer is composed by the
 * one composer (`coverage/answer.ts` · `composeAnswerWithCoverage`); with
 * nothing to append it is the model's answer, byte for byte.
 */
export function prepareFinalWithAnswerLayerStage(
  o: {
    readonly validation: boolean;
    readonly limitsAsData: boolean;
    readonly limits: boolean;
    /** The inputs layer is armed beside the prose limits block. */
    readonly assumed?: { readonly readsRewrites: boolean };
    readonly standingLine: boolean;
    /** The time layer is armed — `Period:` lines render in the clock's zone. */
    readonly inZone?: true;
  },
  releaseTokens = false,
): FinalStage {
  return async (scope) => {
    const filed = scope.$getValue('answerAssessment') as AnswerAssessmentData | undefined;
    const assessed = filed === undefined ? undefined : copyAssessment(filed);
    if (o.validation) {
      if (withheldByValidation(scope)) return;
      captureTurnPayload(scope, scope.llmLatestContent, true, undefined, assessed);
      return;
    }
    if (o.limitsAsData) {
      const limits = scope.answerCoverage;
      captureTurnPayload(
        scope,
        scope.llmLatestContent,
        false,
        limits === undefined ? undefined : copyAnswerCoverage(limits),
        assessed,
        releaseTokens,
      );
      return;
    }
    const line = o.standingLine ? scope.answerStandingLine ?? '' : '';
    const declared = o.limits ? scope.coverageDeclared ?? [] : [];
    let assumed = '';
    if (o.limits && o.assumed !== undefined && !o.standingLine) {
      const { assumedBlockOf } = await import('../arguments/serve.js');
      const readsRewrites = o.assumed.readsRewrites;
      assumed = assumedBlockOf(
        scope.findingsLedger ?? [],
        scope.turnNumber as number,
        readsRewrites
          ? () => [...((scope.middlewareDecisions as readonly unknown[] | undefined) ?? [])]
          : undefined,
      );
    }
    const time = o.limits && o.inZone === true ? await timeLinesOf(scope) : undefined;
    const answer =
      declared.length > 0 || assumed !== '' || line !== '' || time !== undefined
        ? composeAnswerWithCoverage(
            scope.llmLatestContent,
            declared,
            assumed,
            line,
            o.inZone === true && (declared.length > 0 || time !== undefined)
              ? await presentationOf(scope)
              : undefined,
            time,
          )
        : scope.llmLatestContent;
    captureTurnPayload(scope, answer, false, undefined, assessed, releaseTokens);
  };
}
