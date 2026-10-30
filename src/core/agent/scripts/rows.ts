/**
 * scripts/rows — the `script` row: built from one call, filed through ONE
 * writer, read back per turn, and bounded.
 *
 * Pattern: Map + one writer (the `findings/ledger.ts` · `recordFindings`
 *          twin for this kind): `scriptRowFor` builds, `recordScriptRow` is
 *          the only thing that writes a `script` row, `scriptRowsOfTurn` is
 *          the one reader the match and the attachment share.
 * Role:    core/ layer leaf. Called by the dispatch loop (`stages/toolCalls.ts`)
 *          at each place a call of a declared code-running tool pauses or
 *          settles; read by the Route decider's judge and the final branch.
 * Emits:   N/A — the row is state; the runner's facts already rode
 *          `agentfootprint.tools.code_run`, which never carries the code.
 *
 * ## One unit, and the bounds (design § 4.4)
 *
 * UTF-8 payload bytes of the program, measured at record time
 * (`lib/utf8.ts` · `utf8Length`) — never characters: 32,768 characters of a
 * 3-byte character are 98,304 bytes.
 *
 * - **Per script.** A program over {@link MAX_SCRIPT_BYTES} keeps a row with
 *   `bytes`, `lines` and the outcome, and no `text`: it can be neither matched
 *   nor attached.
 * - **Per turn.** {@link MAX_SCRIPT_ROWS} calls keep a row; a further call of
 *   the turn files none and is counted in `AgentState.scriptsDropped`.
 * - **Eligible text.** A row's `text` lives for its own turn: the seed stage's
 *   restore drops it from every earlier turn's row (`withoutEarlierScriptText`),
 *   so the text the ledger holds is at most 16 × 32,768 bytes = 512 KiB before
 *   serialization, whatever the conversation's length. That bounds eligible
 *   text only — prior turns' metadata, history and the answers that carried an
 *   attached script are outside it.
 *
 * ## Append only, last wins
 *
 * A call PAUSED before it settles (a check-in, a consent, an ask, a tool that
 * asked a person) files a `submitted` row at the pause, WITHOUT its text: the
 * settled row filed when the call resumes is the one that carries it, so a
 * program is never held twice. A reader takes the LAST row per call of the
 * turn (the ledger's own law). A row that never settles stays `submitted`.
 */

import { utf8Length } from '../../../lib/utf8.js';
import type { ToolScript } from '../../../tools/script.js';
import type { FindingsLedger, FindingsRow } from '../findings/types.js';
import {
  exitCodeFits,
  SCRIPT_LABELS,
  scriptLabelOf,
  type CallSettlement,
  type RunnerOutcome,
} from './label.js';
import type { ScriptRow } from './types.js';

/** A program longer than this (UTF-8 bytes) keeps a row with no text. Design § 4.4. */
export const MAX_SCRIPT_BYTES = 32_768;
/** Calls per turn that keep a row; the rest are counted. Design § 4.4. */
export const MAX_SCRIPT_ROWS = 16;

/** Lines of a program: LF-separated, `0` for an empty one. */
export function linesOf(program: string): number {
  if (program.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < program.length; i++) if (program.charCodeAt(i) === 0x0a) lines++;
  return program.charCodeAt(program.length - 1) === 0x0a ? lines - 1 : lines;
}

/** One call of a declared code-running tool, as the dispatch loop knows it. */
export interface ScriptCall {
  readonly script: ToolScript;
  /** The name the model called. */
  readonly tool: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** `AgentState.turnNumber`. */
  readonly turn: number;
  /**
   * The declared argument's VALUE as the model proposed it — read once, as
   * the call arrived, before any before-tool rule ran (`programIn`). A string
   * is immutable: no code that runs later can change what was captured.
   */
  readonly proposed: unknown;
  /**
   * The declared argument's value as handed to `execute` — read once, just
   * before the tool ran, after every rule. Absent: the call never got there,
   * and the proposal stands.
   */
  readonly submitted?: unknown;
  readonly settlement: CallSettlement;
  /** The runner's facts, when the tool filed them. */
  readonly facts?: RunnerOutcome;
  /** The tool's own ceiling replaced the delivered result. */
  readonly withheld?: boolean;
  /** A pause: the row is filed without its text (the settled row carries it). */
  readonly paused?: boolean;
}

/**
 * The declared argument's value in `args` — the one read a call's program is
 * captured with. Read it at the boundary it names (as the call arrives; just
 * before `execute`) and keep the value: never the arguments object, which app
 * code may edit after it was handed over.
 */
export function programIn(
  script: ToolScript,
  args: Readonly<Record<string, unknown>> | undefined,
): unknown {
  return args === undefined ? undefined : args[script.argument];
}

/** A row before the writer gives it its dispatch identity. */
export type ScriptRowDraft = Omit<ScriptRow, 'dispatch'>;

/**
 * The row for one call, or `undefined` when the call carried no program — the
 * declared argument is not a string (an argument check refuses such a call;
 * there is nothing to record as "the program submitted").
 */
export function scriptRowFor(call: ScriptCall): ScriptRowDraft | undefined {
  const program = call.submitted !== undefined ? call.submitted : call.proposed;
  if (typeof program !== 'string') return undefined;
  const bytes = utf8Length(program);
  const outcome = call.paused
    ? { label: 'submitted' as const }
    : scriptLabelOf({
        settlement: call.settlement,
        ...(call.facts !== undefined && { facts: call.facts }),
      });
  const rewritten = call.submitted !== undefined && call.submitted !== call.proposed;
  return {
    kind: 'script',
    toolCallId: call.toolCallId,
    tool: call.tool,
    argument: call.script.argument,
    ...(call.script.language !== undefined && { language: call.script.language }),
    bytes,
    lines: linesOf(program),
    ...(call.paused !== true && bytes <= MAX_SCRIPT_BYTES && { text: program }),
    outcome: outcome.label,
    ...(outcome.exitCode !== undefined && { exitCode: outcome.exitCode }),
    ...(outcome.serviceError === true && { serviceError: true as const }),
    ...(call.withheld === true && { resultWithheld: 'over-ceiling' as const }),
    ...(rewritten && { rewritten: true as const }),
    turn: call.turn,
    iteration: call.iteration,
  };
}

/** The scope surface the writer needs. Structurally a `TypedScope<AgentState>`. */
export interface ScriptScope {
  findingsLedger?: FindingsLedger;
  scriptsDropped?: number;
}

const isScriptRow = (row: unknown): row is ScriptRow =>
  row !== null && typeof row === 'object' && (row as { kind?: unknown }).kind === 'script';

/**
 * THE ONE WRITER of a `script` row, and the one place a call gets its
 * DISPATCH identity: the 1-based order of the actual dispatch within its turn.
 * A call is a dispatch, never a provider id: a later call that reuses an id is
 * a new dispatch. `options.dispatch` names a dispatch that already has a row
 * (a paused call, settling): its row joins that dispatch.
 *
 * Appended, unless the turn already holds {@link MAX_SCRIPT_ROWS} other
 * dispatches — then the call files nothing and `scriptsDropped` counts it
 * (value-conditional: absent until a call is dropped). A dispatch that already
 * has a row is never dropped, and a PAUSE is never counted (`paused`): its call
 * is counted once, when it settles. Returns the dispatch the row was filed
 * under, `undefined` when it was dropped. Synchronous: one read, one write, no
 * await between.
 */
export function recordScriptRow(
  scope: ScriptScope,
  draft: ScriptRowDraft,
  options: { readonly paused?: boolean; readonly dispatch?: number } = {},
): number | undefined {
  const prev: FindingsRow[] = [...((scope.findingsLedger as FindingsLedger | undefined) ?? [])];
  const dispatches = new Set<number>();
  let highest = 0;
  for (const r of prev) {
    if (!isScriptRow(r) || r.turn !== draft.turn) continue;
    dispatches.add(r.dispatch);
    if (r.dispatch > highest) highest = r.dispatch;
  }
  const joins = options.dispatch !== undefined && dispatches.has(options.dispatch);
  if (!joins && dispatches.size >= MAX_SCRIPT_ROWS) {
    if (options.paused !== true) {
      scope.scriptsDropped = ((scope.scriptsDropped as number | undefined) ?? 0) + 1;
    }
    return undefined;
  }
  const dispatch = joins ? (options.dispatch as number) : highest + 1;
  const { kind, toolCallId, ...rest } = draft;
  scope.findingsLedger = [...prev, { kind, toolCallId, dispatch, ...rest }];
  return dispatch;
}

/** This turn's calls — the LAST row of each dispatch, in the order those rows were filed. */
export interface TurnScripts {
  readonly current: readonly ScriptRow[];
  /** Calls of EARLIER turns on the ledger: counted, never compared. */
  readonly earlier: number;
}

/**
 * The one reader of a turn's script rows: the last row per DISPATCH wins, and
 * a dispatch sits where its last row was filed — execution order, so a call
 * that settles after a later one ran is read after it. Earlier turns counted.
 */
export function scriptRowsOfTurn(
  ledger: readonly unknown[] | undefined,
  turn: number,
): TurnScripts {
  const latest = new Map<number, ScriptRow>();
  const earlier = new Set<string>();
  for (const row of ledger ?? []) {
    if (!isScriptRow(row)) continue;
    if (row.turn === turn) {
      latest.delete(row.dispatch);
      latest.set(row.dispatch, row);
    } else {
      earlier.add(`${row.turn}\u001f${row.dispatch}`);
    }
  }
  return { current: [...latest.values()], earlier: earlier.size };
}

/**
 * The restore door's half of the bound (seed): every `script` row of a turn
 * BEFORE `turn` keeps its facts — ids, counts, outcome — and loses its `text`.
 * The same reference when there is nothing to drop, so a ledger without
 * script text is restored byte for byte.
 */
export function withoutEarlierScriptText<T>(ledger: readonly T[], turn: number): readonly T[] {
  let changed = false;
  const out = ledger.map((row) => {
    if (!isScriptRow(row) || row.turn >= turn || row.text === undefined) return row;
    changed = true;
    const { text: _text, ...facts } = row;
    void _text;
    return facts as unknown as T;
  });
  return changed ? out : ledger;
}

const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Whether a value read from a stored checkpoint is a `script` row this library
 * could have written — the checkpoint door's arm (`core/runCheckpoint.ts`).
 * An older runtime refuses a checkpoint carrying one.
 */
export function scriptRowIsWellFormed(r: Readonly<Record<string, unknown>>): boolean {
  const label = r.outcome;
  return (
    r.kind === 'script' &&
    typeof r.toolCallId === 'string' &&
    Number.isInteger(r.dispatch) &&
    (r.dispatch as number) >= 1 &&
    typeof r.tool === 'string' &&
    typeof r.argument === 'string' &&
    (r.language === undefined || typeof r.language === 'string') &&
    isCount(r.bytes) &&
    isCount(r.lines) &&
    // The text is the program the row measured, within the bound.
    (r.text === undefined ||
      (typeof r.text === 'string' &&
        r.bytes === utf8Length(r.text) &&
        (r.bytes as number) <= MAX_SCRIPT_BYTES)) &&
    typeof label === 'string' &&
    (SCRIPT_LABELS as readonly string[]).includes(label) &&
    // An exit code rides exactly the two labels that one proves, as the label writes it.
    exitCodeFits(label, r.exitCode) &&
    (r.serviceError === undefined || (r.serviceError === true && label === 'outcome-unknown')) &&
    (r.resultWithheld === undefined || r.resultWithheld === 'over-ceiling') &&
    (r.rewritten === undefined || r.rewritten === true) &&
    typeof r.turn === 'number' &&
    typeof r.iteration === 'number'
  );
}
