/**
 * scriptRecord — the vocabulary of a code call on the record: the label its
 * execution record earns, the verdict on a fenced block an answer shows, and
 * the attachment that travels with an answer.
 *
 * Pattern: types only — the words two layers must agree on and cannot import
 *          each other for: the agent's script record (`core/agent/scripts/`,
 *          which re-exports every name here) and the event payloads that carry
 *          it (`events/payloads.ts` · `AgentEvidenceCheckedPayload`, `AgentTurnEndPayload`).
 * Role:    lib/ leaf (L0). No runtime code.
 *
 * Design: docs/design/2026-10-script-artifact.md. FOUR FACTS, KEPT APART:
 * "this is the script submitted" and "this script ran" are facts about a CALL;
 * "a tool returned this value" is the evidence gate's, from `role: 'tool'`
 * results only; "this claim holds" has no record. No type here joins them.
 */

/**
 * What the record proves about one call of a code-running tool — read from
 * the runner's EXECUTION evidence first, then from the call's SETTLEMENT, and
 * never from result delivery (`core/agent/scripts/label.ts` · `scriptLabelOf`):
 *
 * - `submitted` — the program is on the record and the call has not returned
 *   (never dispatched, refused before `execute`, or still open). Never "did
 *   not run".
 * - `returned` — the tool returned and the record holds no execution evidence:
 *   the tool filed no runner facts, or facts that report no outcome. The call
 *   completed; nothing proves the program ran.
 * - `reported-success` / `reported-failure` — the runner's bare verdict, with
 *   no exit code: no claim that the program ran to an exit.
 * - `completed` — an explicit exit code 0.
 * - `completed-with-failure` — an explicit non-zero exit code: the program
 *   reached an exit; what it did before is not known from the exit.
 * - `outcome-unknown` — no runner facts after a timeout, a cancellation or a
 *   thrown error, or a service error with no exit code.
 *
 * A reader must not promote a label to its neighbour.
 */
export type ScriptLabel =
  | 'submitted'
  | 'returned'
  | 'reported-success'
  | 'reported-failure'
  | 'completed'
  | 'completed-with-failure'
  | 'outcome-unknown';

/** Why a shown block matched no submission. */
export type UnmatchedReason =
  /** Its content equals no program a call of THIS turn submitted. */
  | 'no-submission-this-turn'
  /** Its content is over `MAX_SCRIPT_BYTES`: no row keeps a program that long. */
  | 'over-size'
  /** A reader of a redacted record: the rows' text is kept out. Never in the run. */
  | 'kept-out';

/** The verdict on one fenced block of the answer, under `code: 'match'`. */
export type ScriptBlockVerdict =
  | {
      /** 1-based position among the answer's fenced blocks that were read. */
      readonly block: number;
      /** The matched call's own label — F2, never a fixed "executed". */
      readonly label: ScriptLabel;
      readonly exitCode?: number;
      readonly toolCallId: string;
      readonly tool: string;
      /** Other calls of this turn that submitted byte-identical programs (the latest is named). */
      readonly alsoMatches?: number;
    }
  | {
      readonly block: number;
      readonly label: 'unmatched';
      readonly reason: UnmatchedReason;
    };

/** What the match says about one judged answer — on the verdict and `evidence_checked`. */
export interface ScriptsVerdict {
  /** One entry per fenced block read, in answer order. Never the code. */
  readonly blocks: readonly ScriptBlockVerdict[];
  /** Script rows of EARLIER turns on the ledger — counted, never compared. */
  readonly earlierTurnRows: number;
  /** Fenced blocks past `MAX_CODE_REGIONS`: read as prose, never matched. */
  readonly regionsDropped: number;
  /**
   * Calls of this turn past `MAX_SCRIPT_ROWS` (`AgentState.scriptsDropped`):
   * they filed no row, so a block showing one of them cannot match. Absent
   * when none was dropped.
   */
  readonly scriptsDropped?: number;
}

/** One attached script, as `turn_end.scripts.shown` carries it. */
export interface ShownScript {
  readonly toolCallId: string;
  /** The name the model called. */
  readonly tool: string;
  /** As declared. */
  readonly language?: string;
  readonly label: ScriptLabel;
  /** Only when the runner supplied one. */
  readonly exitCode?: number;
  readonly resultWithheld?: 'over-ceiling';
  /** A before-tool rule changed the program before dispatch. */
  readonly rewritten?: true;
  /** UTF-8 bytes of the whole program. */
  readonly bytes: number;
  readonly lines: number;
  /** Present when `text` is a cut: how many bytes of `bytes` it holds. */
  readonly truncated?: { readonly shownBytes: number };
  /** The program, cut at `maxBytes` — a model-written string. */
  readonly text: string;
}

/** `turn_end.scripts` — present only under `.scriptTravelsWithTheAnswer()`. */
export interface TurnEndScripts {
  readonly shown: readonly ShownScript[];
  /**
   * Calls of this turn not attached: past `MAX_ATTACHED_SCRIPTS`, a program
   * over `MAX_SCRIPT_BYTES` (no text on its row), or a call past
   * `MAX_SCRIPT_ROWS` (no row).
   */
  readonly omitted: number;
}
