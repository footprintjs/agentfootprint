/**
 * answerEvidence — the evidence gate, bound to the evidence this run read,
 * handed within one Route stage from the gate (`route.ts` · `judgeEvidence`) to
 * answer validation (`answerValidation.ts` · `withAnswerValidation`), where
 * `agentChecks: ['names-and-numbers']` asks it of the EXACT candidate the
 * validation delivers.
 *
 * A JUDGE, never a verdict: the gate judged the model's draft, and an output
 * schema may transform that draft before delivery (1200 read, 9750 delivered).
 * A verdict computed on one form is never reused for another, so the row is
 * always the gate's answer about the bytes the person would receive.
 *
 * Keyed by the stage's own scope object — the per-invocation channel
 * `prepareFinal.ts` · `RAILS_REFUSED` uses: never committed state (the report
 * row is the record), never another stage's or another run's, and gone with the
 * scope. Read only when that Route stage answers `'final'`, so a draft sent back
 * for repair is never judged here, and a validation that finds no judge knows
 * the gate never ran on the answer it is about to deliver.
 */
import type { TypedScope } from 'footprintjs';
import type { SourceLinkRow } from 'foottrace/cause';
import type { EvidenceJudge } from '../../../answer-validation/index.js';
import { canRecordSourceLinkPath } from '../../../redaction/runRedaction.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { checkAnswer, clip } from '../evidence/gate.js';
import { readAnswer } from '../evidence/extract.js';
import type { EvidenceCorpus } from '../evidence/evidenceIndex.js';
import type { CheckSourceMatch } from '../evidence/sourceMatches.js';
import type { EvidenceVerdict, ResolvedEvidenceGate } from '../evidence/types.js';
import { scriptRowsOfTurn } from '../scripts/rows.js';
import { scriptJudge } from '../scripts/judge.js';
import { appendSourceLinkWitnesses, sourceLinkInputFor } from '../sourceLinkWitness.js';
import type { AgentState } from '../types.js';

type Scope = TypedScope<AgentState>;
type CheckedIn = SourceLinkRow['output']['checkedIn'];
type ObservedAnswer = {
  readonly text: string;
  readonly rows: readonly SourceLinkRow[];
};
type Judgement = { verdict: EvidenceVerdict; observation?: ObservedAnswer };

interface PendingCheck {
  readonly judge: (text: string) => Judgement;
  readonly revised: boolean;
  checkedIn: CheckedIn;
  observation?: ObservedAnswer;
  candidate?: ObservedAnswer;
}

// The existing same-stage judge handoff. A validation can replace its draft
// observation only with an observation of the exact candidate it delivers.
const JUDGES = new WeakMap<object, PendingCheck>();

export function canObserveAnswerSources(scope: Scope): boolean {
  return (
    'sourceLinkConsumer' in scope &&
    canRecordSourceLinkPath(scope, ['history']) &&
    canRecordSourceLinkPath(scope, ['llmLatestContent'])
  );
}

/** The original tracked read is the witness unless this stage changes the selected text. */
export function changedCheckedAnswer(
  scope: Scope,
  before: string | undefined,
  peeled: string | undefined,
): CheckedIn {
  const prior = before ?? peeled;
  return prior !== undefined && prior !== scope.llmLatestContent ? 'written' : 'read';
}

const maxAnswerSourceRows = 256;

function observe(scope: Scope, text: string, checkedIn: CheckedIn) {
  const consumer = scope.sourceLinkConsumer;
  if (consumer === undefined) return undefined;
  const rows: SourceLinkRow[] = [];
  const match: CheckSourceMatch = (span, { occurrences, bounded }) => {
    const inputs = occurrences.flatMap((key) => {
      const input = sourceLinkInputFor(consumer, key);
      return input === undefined ? [] : [input];
    });
    const incomplete = bounded || consumer.bounded === true || occurrences.length !== inputs.length;
    const output = { key: 'llmLatestContent', checkedIn, span };
    for (const input of inputs.length > 0 ? inputs : [undefined]) {
      if (rows.length >= maxAnswerSourceRows) {
        const last = rows[maxAnswerSourceRows - 1];
        if (last !== undefined) rows[maxAnswerSourceRows - 1] = { ...last, bounded: true };
        return;
      }
      rows.push({
        kind: 'source-link',
        version: 1,
        linkBasis: 'match',
        check: input === undefined ? 'not-checked' : 'value-found',
        consumer: consumer.consumer,
        output,
        ...(input !== undefined && { input }),
        ...(incomplete && { bounded: true }),
      });
    }
  };
  return { match, observation: { text, rows } };
}

export function answerEvidenceJudge(
  scope: Scope,
  params: {
    gate: ResolvedEvidenceGate;
    evidence: EvidenceCorpus;
    history: readonly LLMMessage[];
    exempt: ReadonlySet<string>;
    derived?: ReadonlySet<string>;
    figures?: typeof import('../evidence/figures.js');
    typedAnswer?: true;
  },
) {
  const { gate, evidence, history, exempt, derived, figures, typedAnswer } = params;
  const judgeProse = (text: string, onSourceMatch?: CheckSourceMatch): EvidenceVerdict =>
    checkAnswer(text, {
      gate,
      evidence,
      ...(derived !== undefined && { derived }),
      // The figures dial: the results' numbers, folded for the derivation
      // question (`evidence/figures.ts`). Off → not built, the verdict as it was.
      ...(figures !== undefined && { figures: figures.figureCheckOf(text, history, gate) }),
      exempt,
      ...(typedAnswer === true && { typed: true }),
      ...(onSourceMatch !== undefined && { onSourceMatch }),
    });
  // `code: 'match'` on a PROSE answer: the script match in front of the same
  // judge (`scripts/judge.ts`) — matched blocks are cut out of the text the
  // gate reads, the verdict carries `scripts` and each flagged value's
  // `region`. Reads this turn's `script` rows (and the drop count) only here,
  // under the arm; a typed answer is read as today (design § 12).
  const turnScripts =
    gate.code === 'match' && typedAnswer !== true
      ? scriptRowsOfTurn(
          scope.findingsLedger as readonly unknown[] | undefined,
          scope.turnNumber as number,
        )
      : undefined;
  const scriptJudgement =
    turnScripts === undefined
      ? undefined
      : scriptJudge({
          judgeProse,
          valuesIn: (text) =>
            new Set(
              readAnswer(text, gate, {
                ...(figures !== undefined && {
                  figures: figures.figureCheckOf(text, history, gate).numbers,
                }),
                exactTokens: evidence.values,
              }).candidates.map((c) => clip(c.value)),
            ),
          turn: turnScripts,
          ...(scope.scriptsDropped !== undefined && {
            scriptsDropped: scope.scriptsDropped as number,
          }),
        });

  return {
    turnScripts,
    judge(text: string, checkedIn: CheckedIn): Judgement {
      // Script removal changes the string's coordinates. Never attach offsets
      // from the reduced copy to the original answer.
      if (scriptJudgement !== undefined) return { verdict: scriptJudgement(text) };
      const captured =
        evidence.occurrences === undefined ? undefined : observe(scope, text, checkedIn);
      return {
        verdict: judgeProse(text, captured?.match),
        ...(captured !== undefined && { observation: captured.observation }),
      };
    },
  };
}

/** File the actual draft check and the same judge for a canonical candidate. */
export function noteAnswerEvidence(
  scope: Scope,
  judge: (text: string, checkedIn: CheckedIn) => Judgement,
  checked: Judgement,
  checkedIn: CheckedIn,
  revised: boolean,
): void {
  JUDGES.set(scope, {
    judge: (text) => judge(text, 'written'),
    revised,
    checkedIn,
    ...(checked.observation !== undefined && { observation: checked.observation }),
  });
}

/** The validation's check is private to this stage and does not alter its public report. */
export function takeAnswerEvidence(scope: Scope): EvidenceJudge | undefined {
  const pending = JUDGES.get(scope);
  if (pending === undefined) return undefined;
  return (text) => {
    const { verdict, observation } = pending.judge(text);
    if (observation !== undefined) pending.candidate = observation;
    return {
      lookedUp: verdict.lookedUp,
      unsupported: verdict.unsupported.length,
      truncated: verdict.evidenceTruncated,
      unread: verdict.unread ?? 0,
      revised: pending.revised,
    };
  };
}

export function selectDeliveredAnswerEvidence(scope: Scope, output: string, before: string): void {
  const pending = JUDGES.get(scope);
  if (pending?.candidate?.text !== output) return;
  const checkedIn = output === before ? pending.checkedIn : 'written';
  pending.observation = {
    text: output,
    rows: pending.candidate.rows.map((row) => ({
      ...row,
      output: { ...row.output, checkedIn },
    })),
  };
}

export function finishAnswerEvidence(scope: Scope, runId: string, final: boolean): void {
  const pending = JUDGES.get(scope);
  JUDGES.delete(scope);
  const observation = pending?.observation;
  if (!final || observation === undefined || observation.rows.length === 0) return;
  const consumer = scope.sourceLinkConsumer;
  if (
    !canObserveAnswerSources(scope) ||
    consumer?.runId !== runId ||
    observation.text !== scope.llmLatestContent ||
    scope.messageDeniedReason !== undefined ||
    scope.unsupportedValues?.refused === true ||
    scope.answerValidationBlocked === true
  )
    return;
  appendSourceLinkWitnesses(scope, observation.rows);
}
