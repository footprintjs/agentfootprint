/**
 * findings/unsettled — "nothing was found" is not "ruled out".
 *
 * Pattern: one pure rule over (a standing the model just declared, the
 *          result the model was served for it, the coverage the dispatch
 *          door recorded); the sibling of `contingent.ts`. That one asks
 *          "did the model build on a result it had set aside?"; this one
 *          asks "did the model set something aside on a result that held
 *          nothing?".
 * Role:    core/ layer leaf. The two moments that file standings —
 *          `stages/toolCalls.ts` (a call's `_findings.previous`) and
 *          `stages/route.ts` (the answer's) — pass their standing rows
 *          through `withUnsettledRows` on the way to `ledger.ts ·
 *          recordFindings`, the one writer, so a derived row lands in the
 *          same write, immediately after the standing it is beside.
 * Emits:   N/A — and the writer emits nothing for the row either (the
 *          conflict row's precedent; see `ledger.ts · recordFindings`).
 *
 * ## The owner's ask, and the rule that answers it
 *
 * A model rules out an HBA path because an HBA lookup keyed on a storage
 * cluster's name found nothing — and the lookup's own envelope said it never
 * checked whether that name is a host at all. The model's `ruled-out` is its
 * word and stays its word: the library never writes a standing (round 1 of
 * the design re-filed it as `open`, which made the library a second writer
 * of the model's word — docs/design/2026-09-honest-answer-ledger.md § 14,
 * R12). What the library adds is a row BESIDE it:
 *
 *   a `ruled-out` standing whose ONLY witness is an absence gets an
 *   `unsettled-by-absence` row, keyed to the standing's `toolCallId`,
 *   carrying what the envelope says was not checked and its `try_instead`
 *   as printed.
 *
 * The fences, because they are the rule's honesty:
 * - TWO FACTS, TWO OWNERS, BOTH REQUIRED. "Did the tool return an absence?"
 *   has one owner: the dispatch door (`stages/toolCalls.ts ·
 *   declareCoverage`), which reads the value the tool RETURNED through the
 *   one recognizer (`coverage/read.ts · readCoverageResult`), delivers the
 *   status `'absent'`, emits `tools.absent` and files the call's rows on
 *   `AgentState.coverageDeclared`. This rule never re-reads a result to
 *   decide that: an envelope a tool returned as TEXT (an MCP server in its
 *   default text mode) was no absence at the door (no status, no event, no
 *   row), so it is none here either, and the record holds one answer, not
 *   two. "Was the model SERVED an absence?" has another owner: the result as
 *   the model was served it (`offer.ts · knownResults`, the identity source
 *   the standing itself resolved against). The door records the return
 *   BEFORE the after-tool chain, the tool's own ceiling and placement act,
 *   so an after-tool `deny` ("the model does not get to read this"), a
 *   ceiling's refusal, a placement ticket, a summary or an agent cap's cut
 *   leave the door's rows saying absence while the model read something
 *   else. A ruling-out rests on what the model READ: the row is filed only
 *   when both hold, and it never quotes a word the model was not served.
 * - THE ROW'S WORDS ARE WHAT THE MODEL WAS SERVED. The served string's
 *   LEADING JSON object — the dispatch loop serves the value's
 *   serialization and joins any framework note AFTER it (a step
 *   boundary's, a refused effect's, the repeated-call note) — read by the
 *   one recognizer, bare or bounded by `coverage()`. `notChecked` /
 *   `cannotCover` are that object's lists merged in the recognizer's order
 *   (a bounding ledger first, then the absence; repeats dropped), so a
 *   scrub the chain applied is honored; `tryInstead` is its absence's
 *   `try_instead`, carried byte for byte when it is a non-blank string —
 *   never parsed and never read for a tool name (a tool name found inside
 *   prose is an inference). Every item is read, never trusted: copied as
 *   `{ what, why? }`, and one that names no ground left out — a row the
 *   checkpoint door would refuse is never filed. The door's own copies are
 *   the witness that the tool returned an absence, and nothing more: they
 *   are never quoted.
 * - RULED-OUT ONLY. `open` is already unsettled in the model's own word, and
 *   `noise` says the result held nothing worth reading — which an absence
 *   is. Only a ruling-out claims more than its witness can hold.
 * - A RECORD OF A CHECK. The row is written once, at the standing's moment,
 *   and never recomputed (`types.ts · UnsettledByAbsenceRow`); which rows are
 *   CURRENT is the ledger's one fold (`ledger.ts · foldLedger`).
 * - TOTAL. Every reader here takes what other code wrote and refuses a shape
 *   it cannot read by filing nothing, never by throwing: a derived row must
 *   never fail the run.
 *
 * Not read, and named in the README so nobody reads it as covered: a zero-row
 * array (no door records a zero-row reading of the value a tool returned, and
 * counting the SERVED string would count a text `'[]'` that
 * `integrity/empty-lookup/check.ts · readLookupResult` declines — a second
 * answer), and a result whose door rows are not on this run's state — an
 * earlier turn of a continued conversation, or a run before `resumeOnError`
 * (`coverageDeclared` is per run and not on the `AgentRunCheckpoint`).
 *
 * `.findings()` must be armed for any of this to run — both call sites sit
 * inside the ledger's gate — and the door's key is read only for a
 * `ruled-out` standing whose result was SERVED as an absence, so a run whose
 * model rules out no such result records the bytes it always did.
 */

import { readAbsence } from '../coverage/absent.js';
import { mergeItems } from '../coverage/items.js';
import { readCoverageLedger } from '../coverage/ledger.js';
import { readCoverageResult, type CoverageReading } from '../coverage/read.js';
import type { CoverageItem, DeclaredCoverage, ToolAbsence } from '../coverage/types.js';
import type { PreviousResult } from './ledger.js';
import type { FindingsRow, StandingRow, UnsettledByAbsenceRow } from './types.js';

/** A result as the model was served it, read as an absence — the row's only source of words. */
interface ServedAbsence {
  /** The one recognizer's reading of the served object: `status: 'absent'`, its lists in order. */
  readonly reading: CoverageReading;
  /** The absence inside it — bare, or the `result` a `coverage()` ledger bounds. */
  readonly absence: ToolAbsence;
}

/**
 * The rule for ONE standing: the derived row beside it, or nothing. Only a
 * `ruled-out` standing on a result the run identified (the same `known` list
 * `ledger.ts · standingRowsFrom` resolved it against) whose served string
 * reads as an absence AND whose call the door recorded as one (`declared` is
 * `AgentState.coverageDeclared`).
 */
export function unsettledRowOf(
  standing: StandingRow,
  known: readonly PreviousResult[],
  declared: readonly DeclaredCoverage[],
): UnsettledByAbsenceRow | undefined {
  if (!isReadByTheRule(standing)) return undefined;
  const served = servedAbsenceOf(standing.toolCallId, known);
  return served === undefined ? undefined : rowOf(standing, served, declared);
}

/**
 * The standings in declaration order, each followed immediately by its
 * derived row when the rule files one — what both moments hand to
 * `recordFindings`. The standing rows are the caller's objects, pushed
 * as they are: a batch the rule files nothing beside comes back row for row.
 *
 * `readDeclared` hands over `AgentState.coverageDeclared` and is called at
 * most once, and only for a standing the rule reads (a `ruled-out` on an
 * identified result) whose served result reads as an absence — a pure
 * reading of strings the moment already holds, taken first. A tracked read
 * is visible to every recorder (a narrative line, a `readKeys` entry under
 * `writeProvenance`), so an armed run whose model rules out only results
 * that held something reads nothing it did not read before (the
 * `contingent.ts · hasSetAsideStanding` gate's precedent).
 */
export function withUnsettledRows(
  standings: readonly StandingRow[],
  known: readonly PreviousResult[],
  readDeclared: () => readonly DeclaredCoverage[],
): FindingsRow[] {
  const rows: FindingsRow[] = [];
  let declared: readonly DeclaredCoverage[] | undefined;
  for (const standing of standings) {
    rows.push(standing);
    if (!isReadByTheRule(standing)) continue;
    const served = servedAbsenceOf(standing.toolCallId, known);
    if (served === undefined) continue;
    declared ??= readDeclared();
    const derived = rowOf(standing, served, declared);
    if (derived !== undefined) rows.push(derived);
  }
  return rows;
}

/** A `ruled-out` standing on a result the run identified — the only standing the rule reads. */
function isReadByTheRule(standing: StandingRow): boolean {
  return standing.standing === 'ruled-out' && standing.unknownId !== true;
}

/**
 * The row, once the model was served an absence: filed only when the door
 * also recorded the call as one, and worded from what was SERVED — the lists
 * in the recognizer's order, the `try_instead` byte for byte.
 */
function rowOf(
  standing: StandingRow,
  served: ServedAbsence,
  declared: readonly DeclaredCoverage[],
): UnsettledByAbsenceRow | undefined {
  const door = declaredFor(standing.toolCallId, declared);
  if (!door.some((row) => row.kind === 'absence')) return undefined;
  const facts = served.reading.declared;
  const notChecked = mergeItems(facts.map((f) => itemsOf(f.coverage.notChecked)));
  const cannotCover = mergeItems(facts.map((f) => itemsOf(f.coverage.cannotCover)));
  const said: unknown = served.absence.try_instead;
  return {
    kind: 'unsettled-by-absence',
    toolCallId: standing.toolCallId,
    ...(notChecked.length > 0 && { notChecked }),
    ...(cannotCover.length > 0 && { cannotCover }),
    ...(isSaid(said) && { tryInstead: said }),
    iteration: standing.iteration,
  };
}

/**
 * The result the model was served for one call, read as an absence: the
 * served string's leading JSON object through the one recognizer
 * (`coverage/read.ts · readCoverageResult` — the door's own law, so the two
 * cannot disagree about what an absence looks like), and the absence it
 * holds, bare or inside the bounding ledger (the recognizer's own order).
 * `undefined` when the model was served no absence.
 */
function servedAbsenceOf(
  toolCallId: string,
  known: readonly PreviousResult[],
): ServedAbsence | undefined {
  const value = leadingObjectOf(known.find((r) => r.toolCallId === toolCallId)?.result);
  if (value === undefined) return undefined;
  const reading = readCoverageResult(value);
  if (reading?.status !== 'absent') return undefined;
  const absence = readAbsence(value) ?? readAbsence(readCoverageLedger(value)?.result);
  return absence === undefined ? undefined : { reading, absence };
}

/** The door's rows for one call, in the order it filed them; anything else skipped. */
function declaredFor(
  toolCallId: string,
  declared: readonly DeclaredCoverage[],
): readonly DeclaredCoverage[] {
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (row: unknown) =>
      typeof row === 'object' &&
      row !== null &&
      (row as { toolCallId?: unknown }).toolCallId === toolCallId,
  );
}

/**
 * One list, read and never trusted: `[]` for anything that is not an array,
 * each item copied as the vocabulary spells it — `{ what, why? }`, plain —
 * and an item whose `what` is not a non-blank string left out, as is a
 * `why` that says nothing (`coverage/items.ts · normalizeCoverageList`'s
 * own law of a well-formed item).
 */
function itemsOf(list: unknown): CoverageItem[] {
  if (!Array.isArray(list)) return [];
  const out: CoverageItem[] = [];
  for (const item of list as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { what, why } = item as { what?: unknown; why?: unknown };
    if (!isSaid(what)) continue;
    out.push({ what, ...(isSaid(why) && { why }) });
  }
  return out;
}

/**
 * The one parse: the JSON object that OPENS the served string, or nothing.
 * The dispatch loop serves `safeStringify(value)` and joins any framework
 * note after it, so the value's extent is found by the JSON grammar alone —
 * strings and their escapes skipped, brackets counted — and that span is
 * parsed once, guarded (the `ledger.ts · placedRefOf` precedent). A string
 * that does not open with `{` is never parsed at all.
 */
function leadingObjectOf(served: unknown): unknown {
  if (typeof served !== 'string' || served[0] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < served.length; i += 1) {
    const ch = served[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return parsedOf(served.slice(0, i + 1));
    }
  }
  return undefined;
}

/** `JSON.parse`, guarded: `undefined` for text that is not one JSON value. */
function parsedOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A string that says something — non-blank. */
function isSaid(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
