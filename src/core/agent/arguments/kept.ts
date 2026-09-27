/**
 * arguments/kept — the person's answers a call could not use, kept for the
 * call the model proposes next.
 *
 * Pattern: Map leaf, pure. The kept answer's shape and the functions that read
 *          and change the list: ToolCalls keeps and drops entries
 *          (`stages/toolCalls.ts`), the layer's mount hands this turn's
 *          entries to `sf-inputs` (`honesty/mounts.ts`), and the layer's one
 *          table fills from them (`resolve.ts` · `verifyPlan`).
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). On every
 *          armed agent's graph (ToolCalls imports it), so it imports types
 *          only.
 * Emits:   N/A.
 *
 * ## Why an answer is kept
 *
 * The batch that asked resumes with the person's answer, and that resume has
 * no second pause to give (one human question per resume): a call of the batch
 * that needs a person again — its check-in, a middleware `ask`, a credential
 * consent, the tool's own pause — is refused by name. The model may propose
 * the call again, and it leaves the `ask` argument out, as the served schema
 * tells it to. Were the answer dropped, the library would ask the person the
 * SAME question again and refuse the second step again, every batch, until the
 * iterations ran out. So the refused call's answered values are KEPT
 * (`AgentState.argumentAnswersKept`), and the next call of the same tool that
 * leaves the same argument out, this turn, runs with the person's answer —
 * filed `answered`, no second question — and its own step pauses then, in a
 * batch that asked nothing.
 *
 * A kept answer is used ONCE: the batch whose calls filled from it drops it,
 * and only another refusal by the same law keeps it again. Every other batch
 * asks as the layer always asks — once per batch — so an answer is never
 * stretched over calls the person was not asked about.
 *
 * Working state, the class of `argumentResolutions`: it holds the RAW value,
 * because the call must run with it — never a row, an event or a lens view.
 * Written only when a call carrying an answer is refused by that law, so a run
 * that never meets the case never writes the key: the mount hands it to the
 * layer only when it holds an answer of this turn, and ToolCalls reads it only
 * when it keeps an answer or drops one it filled from.
 */

import type { InputValue } from '../../inputRequest.js';

/** One answer kept for the next call of its (tool, argument), this turn. */
export interface KeptAnswer {
  /** `AgentState.turnNumber` when the answer was kept — never read in another turn. */
  readonly turn: number;
  readonly toolName: string;
  readonly argument: string;
  /** The person's answer, raw, in this argument's own spelling. */
  readonly value: InputValue;
}

const isInputValue = (value: unknown): value is InputValue =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

function isKeptAnswer(entry: unknown): entry is KeptAnswer {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.turn === 'number' &&
    typeof e.toolName === 'string' &&
    typeof e.argument === 'string' &&
    isInputValue(e.value)
  );
}

/** The kept answers of `turn`, detached — an entry of another turn, or of an unknown shape, is never read. */
export function keptThisTurn(kept: unknown, turn: number): KeptAnswer[] {
  if (!Array.isArray(kept)) return [];
  return kept
    .filter((entry): entry is KeptAnswer => isKeptAnswer(entry) && entry.turn === turn)
    .map((entry) => ({ ...entry }));
}

/** The kept answer for one (tool, argument), if any. */
export function keptAnswerFor(
  kept: readonly KeptAnswer[] | undefined,
  toolName: string,
  argument: string,
): KeptAnswer | undefined {
  return kept?.find((a) => a.toolName === toolName && a.argument === argument);
}

/**
 * This turn's list with a refused call's answered values kept — each replacing
 * an entry kept earlier for the same (tool, argument), so the list holds one
 * answer per pair. Entries of another turn are dropped.
 */
export function withKept(
  kept: unknown,
  turn: number,
  toolName: string,
  answers: readonly { readonly argument: string; readonly value: InputValue }[],
): KeptAnswer[] {
  const others = keptThisTurn(kept, turn).filter(
    (a) => !(a.toolName === toolName && answers.some((f) => f.argument === a.argument)),
  );
  return [
    ...others,
    ...answers.map((f) => ({ turn, toolName, argument: f.argument, value: f.value })),
  ];
}

/**
 * This turn's list without the (tool, argument) pairs a batch filled from —
 * `undefined` when nothing is left, so the key is cleared rather than left
 * holding an empty list.
 */
export function withoutUsed(
  kept: unknown,
  turn: number,
  used: readonly { readonly toolName: string; readonly argument: string }[],
): KeptAnswer[] | undefined {
  const left = keptThisTurn(kept, turn).filter(
    (a) => !used.some((u) => u.toolName === a.toolName && u.argument === a.argument),
  );
  return left.length > 0 ? left : undefined;
}
