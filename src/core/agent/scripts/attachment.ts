/**
 * scripts/attachment — `.scriptTravelsWithTheAnswer()`: the recorded program
 * itself, under the answer, labelled from the execution record.
 *
 * Pattern: composed by the FRAMEWORK, never requested from the model (the
 *          `.limitsTravelWithTheAnswer()` precedent, `semantics/coverage/
 *          answer.ts`). Pure: rows in, data and text out.
 * Role:    core/ layer. Read by the final branch (`stages/prepareFinal.ts`):
 *          the data rides `turn_end.scripts` on every answer under the arm;
 *          the text is appended to a PROSE answer through the one composer
 *          (`composeAnswerWithCoverage`), after the standing line and the
 *          limits block. A typed answer gets the data only — its bytes are
 *          never edited.
 * Emits:   N/A.
 *
 * ## Why the library attaches it
 *
 * An app's rule "always show the script" is a rule the model can break, and
 * the cheapest revision that passes a names-and-numbers check is to delete
 * the script. The attachment needs no cooperation from the model: the program
 * comes from the record (the row's `text` — what was SUBMITTED to the tool),
 * so there is nothing to retype and nothing to check. When the model also
 * showed a matched copy, the attachment is still appended: the model's copy
 * never decides whether the authoritative one is delivered.
 *
 * ## What is attached (design § 4.1, § 4.4)
 *
 * - `which: 'last'` (default): the last call of the turn that REACHED the tool
 *   (its label is not `submitted`); `'all'`: every such call, at most
 *   {@link MAX_ATTACHED_SCRIPTS}, the rest counted in `omitted`.
 * - `maxBytes` (default 4,000 UTF-8 bytes) bounds each program shown, cut at a
 *   code-point boundary; a cut says so — `[incomplete: showing N of M bytes —
 *   not the whole program]` and `truncated.shownBytes` — and is never
 *   advertised as a complete, reproducible program.
 * - A program over `MAX_SCRIPT_BYTES` has no text on its row: it is counted in
 *   `omitted` and the text says "one script of N bytes is over the bound and
 *   is not shown". Calls past `MAX_SCRIPT_ROWS` have no row: counted too.
 *
 * Every line is library-authored and past tense, names the CALL (never a
 * destination), and uses the label's words (`label.ts` · `labelWords`).
 *
 * @example
 * ```ts
 * const data = scriptsOfAnswer(scriptRowsOfTurn(ledger, turn).current, { which: 'last', maxBytes: 4000 });
 * scriptsBlock(data);
 * // Script submitted to run_code on call c1 — completed, exit 0. Attached by the library from the run record:
 * //
 * // ```python
 * // print(41 + 1)
 * // ```
 * ```
 */

import { utf8Length, utf8Prefix } from '../../../lib/utf8.js';
import { codeRegionsOf } from '../evidence/codeRegions.js';
import { inertCode } from './inert.js';
import { exitCodeFits, labelWords, SCRIPT_LABELS } from './label.js';
import { MAX_SCRIPT_BYTES } from './rows.js';
import type {
  ResolvedScriptTravel,
  ScriptLabel,
  ScriptRow,
  ScriptTravelOptions,
  ShownScript,
  TurnEndScripts,
} from './types.js';
import { wrapProgram } from './wrapper.js';

/** Scripts attached under `which: 'all'`; the rest are counted (`omitted`). Design § 4.1. */
export const MAX_ATTACHED_SCRIPTS = 8;
/** Default UTF-8 bytes of each program shown. Design § 4.1. */
export const DEFAULT_ATTACHED_BYTES = 4_000;

const DOOR = 'AgentBuilder.scriptTravelsWithTheAnswer';

/**
 * Check `.scriptTravelsWithTheAnswer()`'s options once, at the call site, into
 * the arm the chart carries. Refusals name the option and the fix.
 */
export function resolveScriptTravel(opts: ScriptTravelOptions = {}): ResolvedScriptTravel {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new Error(`${DOOR}: options must be an object ({ which?, maxBytes? }).`);
  }
  const unknown = Object.keys(opts).filter((k) => k !== 'which' && k !== 'maxBytes');
  if (unknown.length > 0) {
    throw new Error(
      `${DOOR}: unknown option(s) ${unknown.map((k) => `'${k}'`).join(', ')}. ` +
        "The options are which ('last' | 'all') and maxBytes (UTF-8 bytes shown per program).",
    );
  }
  const which = opts.which ?? 'last';
  if (which !== 'last' && which !== 'all') {
    throw new Error(
      `${DOOR}: which '${String(which)}' is not one this version has. Use 'last' (the last ` +
        "call of the turn that reached the tool — the default) or 'all' (every such call, at " +
        `most ${MAX_ATTACHED_SCRIPTS}).`,
    );
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_ATTACHED_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error(
      `${DOOR}: maxBytes must be a whole number of at least 1 — got ${String(opts.maxBytes)}. ` +
        `It bounds the UTF-8 bytes of each program shown (default ${DEFAULT_ATTACHED_BYTES}); ` +
        'a longer program is cut and says so.',
    );
  }
  return { which, maxBytes };
}

/** A call that reached the tool — the attachment's candidates. */
const reached = (row: ScriptRow): boolean => row.outcome !== 'submitted';

/** One row as an attached script, cut at `maxBytes`. */
function shownFrom(row: ScriptRow & { readonly text: string }, maxBytes: number): ShownScript {
  const cut = utf8Prefix(row.text, maxBytes);
  const shownBytes = cut === row.text ? row.bytes : utf8Length(cut);
  return {
    toolCallId: row.toolCallId,
    dispatch: row.dispatch,
    tool: row.tool,
    ...(row.language !== undefined && { language: row.language }),
    label: row.outcome,
    ...(row.exitCode !== undefined && { exitCode: row.exitCode }),
    ...(row.resultWithheld !== undefined && { resultWithheld: row.resultWithheld }),
    ...(row.rewritten === true && { rewritten: true as const }),
    bytes: row.bytes,
    lines: row.lines,
    ...(cut !== row.text && { truncated: { shownBytes } }),
    text: cut,
  };
}

/**
 * What travels with this turn's answer — the data form (`turn_end.scripts`).
 * `rows` is this turn's reading (`rows.ts` · `scriptRowsOfTurn`); fresh plain
 * objects, never a reference into the ledger.
 */
export function scriptsOfAnswer(
  rows: readonly ScriptRow[],
  travel: ResolvedScriptTravel,
  scriptsDropped = 0,
): TurnEndScripts & { readonly overSize: readonly ScriptRow[] } {
  const candidates = rows.filter(reached);
  const chosen = travel.which === 'last' ? candidates.slice(-1) : candidates;
  const shown: ShownScript[] = [];
  const overSize: ScriptRow[] = [];
  let omitted = scriptsDropped;
  for (const row of chosen) {
    if (row.text === undefined) {
      overSize.push(row);
      omitted += 1;
    } else if (shown.length < MAX_ATTACHED_SCRIPTS) {
      shown.push(shownFrom(row as ScriptRow & { readonly text: string }, travel.maxBytes));
    } else {
      omitted += 1;
    }
  }
  return { shown, omitted, overSize };
}

/** The call a line names, and what its record says — every dynamic value inert (`inert.ts`). */
function callSaid(script: ShownScript): string {
  const withheld =
    script.resultWithheld === 'over-ceiling'
      ? "; its result was withheld over the tool's ceiling"
      : '';
  const rewritten =
    script.rewritten === true ? '; a before-tool rule changed it before dispatch' : '';
  return (
    `Script submitted to ${inertCode(script.tool)} on call ${inertCode(script.toolCallId)} — ` +
    `${labelWords(script.label, script.exitCode)}${withheld}${rewritten}.`
  );
}

/** The label line of one attached script — library words, past tense, the call named. */
export function scriptLabelLine(script: ShownScript): string {
  return `${callSaid(script)} Attached by the library from the run record:`;
}

/** The line that stands for a script whose program is kept out of the text (`withheldFromText`). */
export function scriptWithheldLine(script: ShownScript): string {
  return (
    `${callSaid(script)} The program is not shown here: the formatting above could display ` +
    'part of it as ordinary text. It is kept on the run record.'
  );
}

/** One attached script as text: its label line, then the program in the library's fence. */
export function shownScriptBlock(script: ShownScript): string {
  const body = `${scriptLabelLine(script)}\n\n${wrapProgram(script.text, script.language)}`;
  if (script.truncated === undefined) return body;
  return (
    `${body}\n[incomplete: showing ${script.truncated.shownBytes} of ${script.bytes} bytes — ` +
    'not the whole program]'
  );
}

/**
 * What the text BEFORE the attachment leaves open, as a CommonMark renderer
 * reads it — the rendering boundary (finding: a model answer that ends inside
 * an unfinished fence would take the library's programs in, and a fence line
 * inside a program would then close it, leaving the rest as prose).
 *
 * - `clean`: nothing the attachment could fall into.
 * - `closed`: a fence is still open; the attachment begins by closing it
 *   (`fence`, the same character and length).
 * - `unsettled`: the reader stopped (an indented fence, raw HTML, display
 *   math — `../evidence/codeRegions.ts`), so nothing says what a program would
 *   render inside. The programs stay out of the text; the data keeps them.
 *
 * `before` is exactly the text the attachment follows — the composer's
 * (`semantics/coverage/answer.ts` · `composeAnswerWithCoverage`). Read with a
 * line ending after it, as it is composed: an opening fence on its last line
 * opens there.
 */
export type AttachmentBoundary =
  | { readonly kind: 'clean' }
  | { readonly kind: 'closed'; readonly fence: string }
  | { readonly kind: 'unsettled' };

const CLEAN: AttachmentBoundary = { kind: 'clean' };

/** The boundary after `before` (see {@link AttachmentBoundary}). */
export function attachmentBoundary(before: string): AttachmentBoundary {
  if (before.length === 0) return CLEAN;
  const read = codeRegionsOf(`${before}\n`);
  if (read.stoppedAt !== undefined) return { kind: 'unsettled' };
  if (read.openFence !== undefined) return { kind: 'closed', fence: read.openFence };
  return CLEAN;
}

// ─── Reading a record back (the answer account) ───────────────────────
//
// A saved `turn_end.scripts` is JSON a reader is handed, not a value this
// library holds. ONE reader reads it ({@link recordedScripts}) for every
// reader of a record — the account's lines and its rebuild of the appended
// block alike — and it refuses exactly what no writer of this library files,
// so no reader trusts a field another reader checked differently.

export type RecordedBoundary =
  | { readonly kind: 'clean' }
  | { readonly kind: 'closed'; readonly char: 'backtick' | 'tilde'; readonly length: number }
  | { readonly kind: 'unsettled' };

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * The boundary a `turn_end.scripts` record states — `undefined` when the
 * record holds a value no writer of this library files: a `closedFence` that
 * is not `{ char: 'backtick' | 'tilde', length }` with a whole length of at
 * least 3 and at most `within` (the answer the closing fence was written into
 * — a fence longer than the text cannot be in it), a `withheldFromText` that
 * is not `true`, or both at once.
 */
function recordedBoundary(
  scripts: Readonly<Record<string, unknown>>,
  within: number,
): RecordedBoundary | undefined {
  const withheld = scripts.withheldFromText;
  const closed = scripts.closedFence;
  if (withheld !== undefined && withheld !== true) return undefined;
  if (closed === undefined) return withheld === true ? { kind: 'unsettled' } : { kind: 'clean' };
  if (withheld === true || !isObject(closed)) return undefined;
  const char = closed.char;
  if ((char !== 'backtick' && char !== 'tilde') || !isCount(closed.length)) return undefined;
  if (closed.length < 3 || closed.length > within) return undefined;
  return { kind: 'closed', char, length: closed.length };
}

/**
 * The boundary to rebuild a recorded text behind — `undefined` when its fence
 * is longer than `within`, the text it would have to be found in: the one
 * repetition a reader makes is bounded by what it reads.
 */
export function rebuildBoundary(
  recorded: RecordedBoundary,
  within: number,
): AttachmentBoundary | undefined {
  if (recorded.kind !== 'closed') return recorded;
  if (recorded.length > within) return undefined;
  return { kind: 'closed', fence: (recorded.char === 'tilde' ? '~' : '`').repeat(recorded.length) };
}

/** The label an attached script can carry: a call that never reached the tool is never attached (`reached`). */
export type AttachedLabel = Exclude<ScriptLabel, 'submitted'>;

/** An attached script as a reader gets it back: its label, by type, one an attached script can carry. */
export type RecordedScript = ShownScript & { readonly label: AttachedLabel };

/**
 * One `turn_end.scripts.shown` entry, checked against what `shownFrom` writes
 * — a fresh copy, or `undefined` when any field is one no writer of this
 * library files: a call that never reached the tool (`submitted` is never
 * attached), an exit code its label does not carry (`label.ts` ·
 * `exitCodeFits`), a program over `MAX_SCRIPT_BYTES`, or a text whose UTF-8
 * length is not the bytes it says it shows (`truncated.shownBytes` when cut,
 * and then fewer than `bytes`; else `bytes`).
 */
function shownScriptOf(value: unknown): RecordedScript | undefined {
  if (!isObject(value)) return undefined;
  const v = value;
  const { toolCallId, tool, text, bytes, lines, dispatch, label, exitCode } = v;
  if (typeof toolCallId !== 'string' || typeof tool !== 'string') return undefined;
  if (typeof text !== 'string' || !isCount(bytes) || !isCount(lines)) return undefined;
  if (!isCount(dispatch) || dispatch < 1) return undefined;
  if (label === 'submitted' || !(SCRIPT_LABELS as readonly unknown[]).includes(label)) {
    return undefined;
  }
  if (!exitCodeFits(label, exitCode)) return undefined;
  if (v.language !== undefined && typeof v.language !== 'string') return undefined;
  if (v.resultWithheld !== undefined && v.resultWithheld !== 'over-ceiling') return undefined;
  if (v.rewritten !== undefined && v.rewritten !== true) return undefined;
  if (bytes > MAX_SCRIPT_BYTES) return undefined;
  const cut = v.truncated;
  let shownBytes = bytes;
  if (cut !== undefined) {
    if (!isObject(cut) || !isCount(cut.shownBytes) || cut.shownBytes >= bytes) return undefined;
    shownBytes = cut.shownBytes;
  }
  // A UTF-8 encoding is never shorter than the string's length in code
  // units: a longer string is refused before it is measured.
  if (text.length > shownBytes || utf8Length(text) !== shownBytes) return undefined;
  return {
    toolCallId,
    dispatch,
    tool,
    ...(v.language !== undefined && { language: v.language as string }),
    label: label as AttachedLabel,
    ...(exitCode !== undefined && { exitCode: exitCode as number }),
    ...(v.resultWithheld !== undefined && { resultWithheld: 'over-ceiling' as const }),
    ...(v.rewritten !== undefined && { rewritten: true as const }),
    bytes,
    lines,
    ...(cut !== undefined && { truncated: { shownBytes } }),
    text,
  };
}

/** One attached script read back, at its position in the record's `shown`. */
export interface RecordedShown {
  readonly index: number;
  readonly script: RecordedScript;
}

/** A saved `turn_end.scripts`, read back. */
export interface RecordedScripts {
  /** The entries a writer of this library files, at their record position. */
  readonly shown: readonly RecordedShown[];
  /**
   * What no writer files, counted once each: an entry that does not read
   * back, every entry past `MAX_ATTACHED_SCRIPTS` (the writer attaches no
   * more), an `omitted` that is not a whole number, a boundary
   * ({@link RecordedBoundary}) that is not one a writer states, or a
   * `scripts` value that is not `{ shown: [...] }`. Zero means every field
   * was read back — only then can the attached text be rebuilt.
   */
  readonly unread: number;
  /** `omitted`, when the record's is a whole number. */
  readonly omitted?: number;
  /** The rendering boundary, when the record's is one a writer states. */
  readonly boundary?: RecordedBoundary;
}

/**
 * A saved `turn_end.scripts` — THE reader of the shape for a reader of a
 * record. `undefined` when the event carries no scripts arm. `within` is the
 * length of the answer the block was appended to (a fence longer than it is
 * refused). Bounded by the writer's cap: no reader iterates more entries
 * than a writer attaches.
 */
export function recordedScripts(
  value: unknown,
  within: number = Number.MAX_SAFE_INTEGER,
): RecordedScripts | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || !Array.isArray(value.shown)) return { shown: [], unread: 1 };
  const all: readonly unknown[] = value.shown;
  const shown: RecordedShown[] = [];
  let unread = Math.max(0, all.length - MAX_ATTACHED_SCRIPTS);
  for (let index = 0; index < Math.min(all.length, MAX_ATTACHED_SCRIPTS); index++) {
    const script = shownScriptOf(all[index]);
    if (script === undefined) unread += 1;
    else shown.push({ index, script });
  }
  const omitted = isCount(value.omitted) ? value.omitted : undefined;
  if (omitted === undefined) unread += 1;
  const boundary = recordedBoundary(value, within);
  if (boundary === undefined) unread += 1;
  return {
    shown,
    unread,
    ...(omitted !== undefined && { omitted }),
    ...(boundary !== undefined && { boundary }),
  };
}

/**
 * The text form: one block per attached script, then one line per omission —
 * `''` when nothing travels (the composer then appends nothing). Every cut and
 * every omission is stated. Behind a `closed` boundary the block opens with
 * the closing fence; behind an `unsettled` one each script is its label line
 * alone (`scriptWithheldLine`) — the programs ride the data only.
 */
export function scriptsBlock(
  scripts: TurnEndScripts & { readonly overSize?: readonly ScriptRow[] },
  boundary: AttachmentBoundary = CLEAN,
): string {
  const parts =
    boundary.kind === 'unsettled'
      ? scripts.shown.map(scriptWithheldLine)
      : scripts.shown.map(shownScriptBlock);
  const overSize = scripts.overSize ?? [];
  for (const row of overSize) {
    parts.push(
      `One script of ${row.bytes} bytes (${inertCode(row.tool)}, call ${inertCode(
        row.toolCallId,
      )}) is over the bound and is not shown.`,
    );
  }
  const others = scripts.omitted - overSize.length;
  if (others > 0) {
    parts.push(
      `${others} more script${others === 1 ? ' was' : 's were'} submitted this turn and ` +
        `${others === 1 ? 'is' : 'are'} not shown here.`,
    );
  }
  if (parts.length === 0) return '';
  if (boundary.kind === 'closed') parts.unshift(boundary.fence);
  return parts.join('\n\n');
}

/**
 * The text form behind the boundary the text before it leaves — `''` when
 * nothing travels (no boundary is then taken). The second value is the
 * boundary the text was written behind: what `turn_end.scripts` records.
 */
export function scriptsBlockAfter(
  scripts: TurnEndScripts & { readonly overSize?: readonly ScriptRow[] },
  before: string,
): { readonly text: string; readonly boundary: AttachmentBoundary } {
  if (scriptsBlock(scripts) === '') return { text: '', boundary: CLEAN };
  const boundary = attachmentBoundary(before);
  return { text: scriptsBlock(scripts, boundary), boundary };
}

/** The data form as detached plain data — what `turn_end.scripts` carries. */
export function turnEndScriptsOf(
  scripts: TurnEndScripts,
  boundary: AttachmentBoundary = CLEAN,
): TurnEndScripts {
  return {
    shown: scripts.shown.map((s) => ({
      ...s,
      ...(s.truncated !== undefined && { truncated: { shownBytes: s.truncated.shownBytes } }),
    })),
    omitted: scripts.omitted,
    ...(boundary.kind === 'closed' && {
      closedFence: {
        char: boundary.fence.charCodeAt(0) === 0x7e ? ('tilde' as const) : ('backtick' as const),
        length: boundary.fence.length,
      },
    }),
    ...(boundary.kind === 'unsettled' && { withheldFromText: true as const }),
  };
}
