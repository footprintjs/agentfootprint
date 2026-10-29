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
import { labelWords } from './label.js';
import type {
  ResolvedScriptTravel,
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

/** The label line of one attached script — library words, past tense, the call named. */
export function scriptLabelLine(script: ShownScript): string {
  const withheld =
    script.resultWithheld === 'over-ceiling'
      ? "; its result was withheld over the tool's ceiling"
      : '';
  const rewritten =
    script.rewritten === true ? '; a before-tool rule changed it before dispatch' : '';
  return (
    `Script submitted to ${script.tool} on call ${script.toolCallId} — ` +
    `${labelWords(script.label, script.exitCode)}${withheld}${rewritten}. ` +
    'Attached by the library from the run record:'
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
 * The text form: one block per attached script, then one line per omission —
 * `''` when nothing travels (the composer then appends nothing). Every cut and
 * every omission is stated.
 */
export function scriptsBlock(
  scripts: TurnEndScripts & { readonly overSize?: readonly ScriptRow[] },
): string {
  const parts = scripts.shown.map(shownScriptBlock);
  const overSize = scripts.overSize ?? [];
  for (const row of overSize) {
    parts.push(
      `One script of ${row.bytes} bytes (${row.tool}, call ${row.toolCallId}) is over the bound ` +
        'and is not shown.',
    );
  }
  const others = scripts.omitted - overSize.length;
  if (others > 0) {
    parts.push(
      `${others} more script${others === 1 ? ' was' : 's were'} submitted this turn and ` +
        `${others === 1 ? 'is' : 'are'} not shown here.`,
    );
  }
  return parts.join('\n\n');
}

/** The data form as detached plain data — what `turn_end.scripts` carries. */
export function turnEndScriptsOf(scripts: TurnEndScripts): TurnEndScripts {
  return {
    shown: scripts.shown.map((s) => ({
      ...s,
      ...(s.truncated !== undefined && { truncated: { shownBytes: s.truncated.shownBytes } }),
    })),
    omitted: scripts.omitted,
  };
}
