/**
 * findings/judge — a calibrated SECOND SOURCE on the ledger (9.104.0).
 *
 * Pattern: a pure question builder (`judgeQuestions`) + one async writer
 *          (`judgeResult`) that spends a `Classifier` call per tool result
 *          and files what came back through `recordFindings` — the ONE
 *          writer of `AgentState.findingsLedger` stays the one writer.
 * Role:    core/ layer. The dispatch loop (`stages/toolCalls.ts`) calls
 *          `judgeResult` right after a tool result is committed to
 *          `toolResults`, and only under `.findings({ judge })`; an agent
 *          with no judge never reaches this file.
 *
 * WHAT IS ASKED. Intent is first-person: the judge is never asked why the
 * model called a tool. It is asked what a RESULT is worth for the
 * PROPOSITION the model declared before the call (`BasisRow.proposition`),
 * or — when the call declared none — for the user's question; the row says
 * which (`against`). Two questions, ids fixed so a bench and a lens can read
 * them: `standing`, a choice over the four standings, and `tests_subject`,
 * the probability that the result tests the proposition / question at all
 * (the probe's `tests_proposition`, renamed because the subject may be the
 * question).
 *
 * WHAT IS WRITTEN. A `JudgmentRow` — source, provider model string, the
 * chosen standing, the whole distribution, the confidence, the noul, usage,
 * latency — or, when the call failed, a `JudgmentErrorRow` with the
 * provider's status and message and the latency spent. Never a guessed
 * standing. The model's own standing (`StandingRow`) is untouched: two
 * sources, two rows, and the disagreement is a fact of the record.
 *
 * WHAT IS SERVED. Nothing, in this packet. `serve.ts` reads
 * `foldLedger(...).standingOf` (the model's) alone — policy A on the design
 * page; the bench decides whether B–D are worth a change.
 */

import type { Classifier, ClassifyRequest } from '../../../classify/types.js';
import { ClassifierError } from '../../../classify/types.js';
import { recordFindings, type FindingsScope, type PreviousResult } from './ledger.js';
import {
  JUDGE_RESULT_CHARS,
  STANDING_VALUES,
  type BasisRow,
  type FindingsRow,
  type JudgmentErrorRow,
  type JudgmentRow,
  type Standing,
} from './types.js';

/** The two question ids every judgment is asked under. */
export const JUDGE_QUESTION_IDS = {
  standing: 'standing',
  testsSubject: 'tests_subject',
} as const;

/**
 * The four standings as criteria for the `choice` question — the ledger's
 * own vocabulary (`findings/types.ts`), described to the judge in the
 * ledger's own terms so its `choice` is a `Standing` by construction.
 */
export const STANDING_CRITERIA: Readonly<Record<Standing, string>> = Object.freeze({
  fact: 'The result establishes the proposition (or answers the question): it can be stood on as it is.',
  open: 'The result bears on the proposition (or question) but leaves it unsettled: a further read would settle it.',
  noise:
    'The result has no bearing on the proposition (or question): nothing in it speaks to it either way.',
  'ruled-out':
    'The result shows the proposition does not hold (or the question has no answer of this kind): it is ruled out by what the tool returned.',
});

const STANDING_INSTRUCTIONS =
  'You are shown a tool result and what it was asked for: a proposition the caller declared before the call, ' +
  'or the question the caller is working on. Judge what the RESULT IS to that subject — not why the tool was called.';

const TESTS_SUBJECT_INSTRUCTIONS =
  'Does this result test the proposition (or bear on the question) at all — could reading it change what one believes about it?';

/** What the judge reads. `result` is the tool's text, clipped at `JUDGE_RESULT_CHARS`. */
export interface JudgeState {
  readonly proposition?: string;
  readonly predicts?: string;
  readonly question: string;
  readonly tool: string;
  readonly result: string;
}

/** The pure output: the request to send, what it judges against, and whether the result was cut. */
export interface JudgeQuestions {
  readonly request: ClassifyRequest;
  readonly against: 'proposition' | 'question';
  readonly clipped: boolean;
}

/**
 * Build the classifier request for one landed result. Pure. `against` is
 * `'proposition'` exactly when the call's basis row carries one; otherwise
 * the user's question is the subject and the row will say so. The result
 * text is cut at `JUDGE_RESULT_CHARS` with the cut reported, never hidden.
 */
export function judgeQuestions(
  basis: BasisRow | undefined,
  userQuestion: string,
  result: { readonly toolName: string; readonly result: string },
): JudgeQuestions {
  const clipped = result.result.length > JUDGE_RESULT_CHARS;
  const state: JudgeState = {
    ...(basis?.proposition !== undefined && { proposition: basis.proposition }),
    ...(basis?.predicts !== undefined && { predicts: basis.predicts }),
    question: userQuestion,
    tool: result.toolName,
    result: clipped ? result.result.slice(0, JUDGE_RESULT_CHARS) : result.result,
  };
  return {
    request: {
      state,
      questions: {
        [JUDGE_QUESTION_IDS.standing]: {
          type: 'choice',
          instructions: STANDING_INSTRUCTIONS,
          criteria: STANDING_CRITERIA,
        },
        [JUDGE_QUESTION_IDS.testsSubject]: {
          type: 'noul',
          instructions: TESTS_SUBJECT_INSTRUCTIONS,
        },
      },
    },
    against: basis?.proposition !== undefined ? 'proposition' : 'question',
    clipped,
  };
}

/** The scope surface the judge needs: the ledger (to find the basis row) and the user's question. */
export interface JudgeScope extends FindingsScope {
  userMessage?: string;
}

/**
 * Ask the judge about ONE landed result and file the answer. Never throws:
 * a provider failure — a status, a network error, a malformed answer, an
 * abort — is a `JudgmentErrorRow` and the run continues, because the judge
 * is advisory and its absence must never cost the run its answer.
 */
export async function judgeResult(
  scope: JudgeScope,
  judge: Classifier,
  entry: PreviousResult & { readonly toolName: string },
  iteration: number,
  signal?: AbortSignal,
): Promise<void> {
  const basis = lastBasisRowFor(scope.findingsLedger ?? [], entry.toolCallId);
  const { request, against, clipped } = judgeQuestions(basis, scope.userMessage ?? '', entry);
  const startedAt = Date.now();
  let row: JudgmentRow | JudgmentErrorRow;
  try {
    const result = await judge.classify(request, signal);
    row = judgmentRowFrom(result, judge.name, entry, against, clipped, iteration);
  } catch (err) {
    row = {
      kind: 'judgment-error',
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      source: 'judge',
      judge: { name: judge.name },
      ...(err instanceof ClassifierError && err.status !== undefined && { status: err.status }),
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
      iteration,
    };
  }
  recordFindings(scope, [row]);
}

/** The LAST basis row filed for a call — the proposition declared before its result existed. */
function lastBasisRowFor(rows: readonly FindingsRow[], toolCallId: string): BasisRow | undefined {
  let found: BasisRow | undefined;
  for (const row of rows) {
    if (row.kind === 'basis' && row.toolCallId === toolCallId) found = row;
  }
  return found;
}

/**
 * The provider's answer as a row — field for field. An answer whose
 * `standing` is not a `choice` over the four standings is a failure, not a
 * row: the record never carries a standing nobody produced.
 */
function judgmentRowFrom(
  result: Awaited<ReturnType<Classifier['classify']>>,
  judgeName: string,
  entry: PreviousResult & { readonly toolName: string },
  against: 'proposition' | 'question',
  clipped: boolean,
  iteration: number,
): JudgmentRow {
  const standing = result.answers[JUDGE_QUESTION_IDS.standing];
  if (standing === undefined || standing.type !== 'choice') {
    throw new ClassifierError(
      `judge: no 'choice' answer under '${JUDGE_QUESTION_IDS.standing}' in the reply`,
    );
  }
  if (!(STANDING_VALUES as readonly string[]).includes(standing.choice)) {
    throw new ClassifierError(
      `judge: answered a standing outside the vocabulary: ${JSON.stringify(standing.choice)}`,
    );
  }
  const tests = result.answers[JUDGE_QUESTION_IDS.testsSubject];
  const probabilities: Partial<Record<Standing, number>> = {};
  for (const s of STANDING_VALUES) {
    const p = standing.probabilities[s];
    if (p !== undefined) probabilities[s] = p;
  }
  return {
    kind: 'judgment',
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    source: 'judge',
    judge: { name: judgeName, model: result.model },
    against,
    standing: standing.choice as Standing,
    // The provider's distribution over the ledger's vocabulary, as sent — a
    // standing the provider did not score is absent, never zero.
    probabilities: probabilities as Readonly<Record<Standing, number>>,
    confidence: standing.confidence,
    ...(tests?.type === 'noul' && { testsSubject: tests.noul }),
    ...(result.usage !== undefined && { usage: result.usage }),
    latencyMs: result.latencyMs,
    ...(clipped && { clipped: true as const }),
    iteration,
  };
}
