/**
 * scripts/types — the row a call of a code-running tool files, and the
 * attachment's options. The vocabulary the event payloads share (the label,
 * the block verdict, the attached script) lives in `lib/scriptRecord.ts` and
 * is re-exported here.
 *
 * Pattern: plain row and verdict types, no logic (`label.ts` decides a label,
 *          `rows.ts` files a row, `match.ts` judges a block, `attachment.ts`
 *          composes what travels).
 * Role:    core/ layer leaf of the script record (design:
 *          docs/design/2026-10-script-artifact.md).
 * Emits:   N/A.
 *
 * FOUR FACTS, KEPT APART. F1 "this is the script submitted" and F2 "this
 * script ran" are facts about a CALL, on one `script` row per call. F3 "a tool
 * returned this value" is the evidence gate's verdict, from `role: 'tool'`
 * results only — nothing here ever enters the evidence or exempt corpus. F4
 * "this claim holds" has no row. No sentence joins them.
 */

import type { ScriptLabel } from '../../../lib/scriptRecord.js';

// The vocabulary the agent and the event payloads share lives in the lib leaf.
export type {
  ScriptBlockVerdict,
  ScriptLabel,
  ScriptsVerdict,
  ShownScript,
  TurnEndScripts,
  UnmatchedReason,
} from '../../../lib/scriptRecord.js';

/**
 * One call of a declared code-running tool (`Tool.script`), on the findings
 * ledger — F1 (the program submitted) and F2 (what its execution record
 * proves), and nothing about any value.
 *
 * Filed by the dispatch loop (`stages/toolCalls.ts`) while
 * `.namesAndNumbersFromEvidence({ code: 'match' })` or
 * `.scriptTravelsWithTheAnswer()` is on, through ONE writer (`rows.ts` ·
 * `recordScriptRow`): the call's row is KEPT CURRENT — its outcome is written
 * when the call settles, and a row that never settles stays `submitted`. At
 * the next turn boundary (seed) the row keeps its facts and loses its `text`.
 */
export interface ScriptRow {
  readonly kind: 'script';
  readonly toolCallId: string;
  /** The name the model called. */
  readonly tool: string;
  /** The declared argument that carried the program. */
  readonly argument: string;
  /** The declared language, when the tool declared one. */
  readonly language?: string;
  /** UTF-8 bytes of the program submitted to the tool. */
  readonly bytes: number;
  /** Lines of that program (LF-separated; `0` for an empty program). */
  readonly lines: number;
  /**
   * The program submitted to the tool, byte for byte. ABSENT over
   * `MAX_SCRIPT_BYTES`, and after the row's turn ended.
   */
  readonly text?: string;
  readonly outcome: ScriptLabel;
  /** Exactly the runner's exit code, only when it supplied one. */
  readonly exitCode?: number;
  /** The runner's failure verdict was the service's, with no exit code. */
  readonly serviceError?: true;
  /** The tool's own `resultCeiling` replaced the delivered result. */
  readonly resultWithheld?: 'over-ceiling';
  /** A before-tool rule changed the program before dispatch; the earlier text is on no row. */
  readonly rewritten?: true;
  /** `AgentState.turnNumber` when the call was made. */
  readonly turn: number;
  readonly iteration: number;
}

/** `.scriptTravelsWithTheAnswer()` options. */
export interface ScriptTravelOptions {
  /**
   * `'last'` (default) — the last call of the turn that reached the tool;
   * `'all'` — every call of the turn that reached it, at most
   * `MAX_ATTACHED_SCRIPTS`, the rest counted as `omitted`.
   */
  readonly which?: 'last' | 'all';
  /**
   * UTF-8 bytes of each program shown (default 4,000). A longer program is
   * cut at a code-point boundary and says it is incomplete.
   */
  readonly maxBytes?: number;
}

/** The resolved arm the chart carries. @internal */
export interface ResolvedScriptTravel {
  readonly which: 'last' | 'all';
  readonly maxBytes: number;
}
