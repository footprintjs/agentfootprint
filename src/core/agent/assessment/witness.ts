/**
 * assessment/witness — the answer layer's committed witness rows: two verdicts
 * the Route decider computes that were EVENTS only until the answer layer
 * (honesty layer 4) needed them on the record.
 *
 * Pattern: Map. Three row types, their builders and their well-formedness
 *          check — the one owner of the `grounded`, `steps-unfinished` and
 *          `script-shown` row kinds.
 *          `findings/types.ts` · `FindingsRow` imports the types; the rows
 *          are filed through the one writer (`findings/ledger.ts` ·
 *          `recordFindings`) by the Route decider, and ONLY while the answer
 *          layer is armed (`stages/route.ts` · `judgeEvidence`,
 *          `judgeUnfinishedSteps`).
 * Role:    core/ layer leaf of the answer layer. Static on purpose: the
 *          checkpoint door (`core/runCheckpoint.ts` · `validateCheckpoint`,
 *          a synchronous door) asks `witnessRowIsWellFormed`, so this module
 *          imports nothing but the script labels (`../scripts/label.ts`, a
 *          leaf) and stays small.
 * Emits:   N/A. A witness row emits nothing of its own — the verdict's event
 *          (`agentfootprint.agent.evidence_checked`,
 *          `agentfootprint.skill.steps_unfinished`) already fired, beside the
 *          row, from the same stage.
 *
 * ## Why a row, when the event already says it
 *
 * The answer's standing is folded from COMMITTED rows only
 * (`assessment/assess.ts` · `assessAnswer`), never from events, so the running
 * agent and every later reader fold the same bytes. A verdict that exists only
 * as an event cannot be folded: the gate's clean pass could not say "the names
 * and numbers check ran", and an answer given before its declared steps
 * finished could not say so at all. Each row is the verdict, not a copy of the
 * event: names, enums and counts — never a value from the answer, a quote, or
 * a step's note.
 *
 * ## Always stamped with the turn
 *
 * The ledger crosses turns on a continued conversation and `iteration`
 * restarts at 1 every run, so a witness row always carries `turn`
 * (`AgentState.turnNumber`): the fold reads this turn's witness rows only.
 */

import { SCRIPT_LABELS } from '../scripts/label.js';
import type { ScriptBlockVerdict, ScriptLabel, UnmatchedReason } from '../scripts/types.js';

const UNMATCHED_REASONS: readonly UnmatchedReason[] = Object.freeze([
  'no-submission-this-turn',
  'over-size',
  'kept-out',
]);

/** The evidence gate's posture — the `.namesAndNumbersFromEvidence()` vocabulary. */
export type WitnessPosture = 'assist' | 'guard' | 'rails';

/**
 * The evidence gate's CLEAN verdict on the answer (`action: 'grounded'` on
 * `agentfootprint.agent.evidence_checked`): every name and number the answer
 * states was found in a tool result, or was exempt. Filed by the Route decider
 * on the turn's answer while the answer layer is armed. A flagged or refused
 * verdict needs no witness row — `AgentState.unsupportedValues` is already
 * committed.
 *
 * The fold reads it as the names-and-numbers check having RUN on this answer —
 * never as support: finding a value in a tool result is a membership pass, and
 * a membership pass never makes an answer "known".
 */
export interface GroundedRow {
  readonly kind: 'grounded';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  /** The iteration whose answer the gate judged. */
  readonly iteration: number;
  /** The posture in force. */
  readonly posture: WitnessPosture;
  /** How many distinct values the answer had to ground, exempt ones included. */
  readonly candidates: number;
  /** How many of `candidates` the gate looked up in the tool results (the rest were exempt). */
  readonly lookedUp: number;
  /** Set when the grounded answer was the one revision the gate asked for. */
  readonly afterRevision?: true;
}

/** One declared step the answer came before — its position and its tool, never its note. */
export interface UnfinishedStep {
  readonly index: number;
  readonly tool: string;
}

/**
 * The answer came before the active skill's declared steps finished
 * (`agentfootprint.skill.steps_unfinished` with `action: 'accepted'` — the one
 * teaching nudge was already spent — or `'cut-short'` — a limit forced the
 * answer). Filed by the Route decider while the answer layer is armed, and
 * only for the answer that STANDS: the step judge runs before the evidence
 * gate, so a stop it accepted on a draft the gate then sends back files no row
 * (the event still fires) — the revision is judged again, and at most one row
 * per answer reaches the ledger. The `'nudged'` verdict needs no row: the turn
 * went on.
 */
export interface StepsUnfinishedRow {
  readonly kind: 'steps-unfinished';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  /** The iteration whose answer the step judge read. */
  readonly iteration: number;
  /** The skill whose procedure was in progress. */
  readonly skillId: string;
  /** The declared steps not reached, in order — position and tool only. */
  readonly remaining: readonly UnfinishedStep[];
  /** How many steps the procedure declares. */
  readonly total: number;
  readonly action: 'accepted' | 'cut-short';
}

/**
 * One fenced block the answer SHOWED, and the script match's verdict on it
 * (`.namesAndNumbersFromEvidence({ code: 'match' })`, `scripts/match.ts`) —
 * filed by the Route decider while the answer layer is armed, one row per
 * block read, and only for the answer that STANDS (a draft sent back for
 * revision files none). Names, enums and counts — never the code.
 *
 * The fold reads `label: 'unmatched'` as the reason `script-unmatched` (a
 * script shown in the answer matches no submission of this turn on the
 * record), and every row as the `script-match` check having reached a
 * verdict. A matched block fires nothing and supports nothing.
 */
export interface ScriptShownRow {
  readonly kind: 'script-shown';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  /** The iteration whose answer the match read. */
  readonly iteration: number;
  /** 1-based position among the answer's fenced blocks that were read. */
  readonly block: number;
  /** The matched call's label, or `'unmatched'`. */
  readonly label: ScriptLabel | 'unmatched';
  /** On `'unmatched'`: why. */
  readonly reason?: UnmatchedReason;
  /** On a match: the call it equals, and the name the model called. */
  readonly toolCallId?: string;
  readonly tool?: string;
  /** On a match: the call's dispatch within the turn (`ScriptRow.dispatch`) — its identity. */
  readonly dispatch?: number;
  /** On a match: exactly the runner's exit code, when it supplied one. */
  readonly exitCode?: number;
}

/** Either witness row. */
export type AnswerWitnessRow = GroundedRow | StepsUnfinishedRow | ScriptShownRow;

const POSTURES: readonly WitnessPosture[] = Object.freeze(['assist', 'guard', 'rails']);

/** The script match's verdicts as rows — one per block read, ids and labels only. */
export function scriptShownRowsFrom(
  blocks: readonly ScriptBlockVerdict[],
  at: { readonly turn: number; readonly iteration: number },
): ScriptShownRow[] {
  return blocks.map((b) =>
    b.label === 'unmatched'
      ? {
          kind: 'script-shown',
          turn: at.turn,
          iteration: at.iteration,
          block: b.block,
          label: 'unmatched',
          reason: b.reason,
        }
      : {
          kind: 'script-shown',
          turn: at.turn,
          iteration: at.iteration,
          block: b.block,
          label: b.label,
          toolCallId: b.toolCallId,
          tool: b.tool,
          dispatch: b.dispatch,
          ...(b.exitCode !== undefined && { exitCode: b.exitCode }),
        },
  );
}

/** The gate's clean verdict as a row — built from the event's own counts. */
export function groundedRowFrom(verdict: {
  readonly turn: number;
  readonly iteration: number;
  readonly posture: WitnessPosture;
  readonly candidates: number;
  readonly lookedUp: number;
  readonly afterRevision: boolean;
}): GroundedRow {
  return {
    kind: 'grounded',
    turn: verdict.turn,
    iteration: verdict.iteration,
    posture: verdict.posture,
    candidates: verdict.candidates,
    lookedUp: verdict.lookedUp,
    ...(verdict.afterRevision && { afterRevision: true as const }),
  };
}

/** The step judge's accepted or cut-short verdict as a row — each step's position and tool only. */
export function stepsUnfinishedRowFrom(verdict: {
  readonly turn: number;
  readonly iteration: number;
  readonly skillId: string;
  readonly remaining: readonly { readonly index: number; readonly tool: string }[];
  readonly total: number;
  readonly action: 'accepted' | 'cut-short';
}): StepsUnfinishedRow {
  return {
    kind: 'steps-unfinished',
    turn: verdict.turn,
    iteration: verdict.iteration,
    skillId: verdict.skillId,
    remaining: verdict.remaining.map((s) => ({ index: s.index, tool: s.tool })),
    total: verdict.total,
    action: verdict.action,
  };
}

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Whether a value read from a stored checkpoint is a witness row this library
 * could have written: the kind, a numeric `turn` and `iteration`, and every
 * other field in its own shape. The checkpoint door's two arms
 * (`core/runCheckpoint.ts`). An older runtime refuses a checkpoint that
 * carries either kind.
 */
export function witnessRowIsWellFormed(r: Readonly<Record<string, unknown>>): boolean {
  if (typeof r.turn !== 'number' || typeof r.iteration !== 'number') return false;
  if (r.kind === 'grounded') {
    return (
      typeof r.posture === 'string' &&
      (POSTURES as readonly string[]).includes(r.posture) &&
      isCount(r.candidates) &&
      isCount(r.lookedUp) &&
      (r.afterRevision === undefined || r.afterRevision === true)
    );
  }
  if (r.kind === 'script-shown') {
    const unmatched = r.label === 'unmatched';
    return (
      isCount(r.block) &&
      (unmatched || (SCRIPT_LABELS as readonly unknown[]).includes(r.label)) &&
      (unmatched
        ? typeof r.reason === 'string' &&
          (UNMATCHED_REASONS as readonly string[]).includes(r.reason) &&
          r.toolCallId === undefined &&
          r.dispatch === undefined
        : r.reason === undefined &&
          typeof r.toolCallId === 'string' &&
          typeof r.tool === 'string' &&
          Number.isInteger(r.dispatch) &&
          (r.dispatch as number) >= 1) &&
      (r.exitCode === undefined || Number.isInteger(r.exitCode))
    );
  }
  if (r.kind === 'steps-unfinished') {
    return (
      typeof r.skillId === 'string' &&
      isCount(r.total) &&
      (r.action === 'accepted' || r.action === 'cut-short') &&
      Array.isArray(r.remaining) &&
      r.remaining.every(
        (s: unknown) =>
          s !== null &&
          typeof s === 'object' &&
          isCount((s as { index?: unknown }).index) &&
          typeof (s as { tool?: unknown }).tool === 'string',
      )
    );
  }
  return false;
}
