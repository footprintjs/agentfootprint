/**
 * column-types — the tool declared what its rows contain, and the rows say
 * otherwise. Filed at the WRITE seam, at the moment the tool answers.
 *
 * Pattern: pure function over (one declaration, one finished rowset); the
 *          SHAPE check, one storey below `empty-lookup` — that one asks
 *          whether the answer had any rows, this one asks what is in them.
 * Role:    the decidable fragment of "is this rowset the rowset it claims to
 *          be?".
 *
 * ── THE MEASURED FAILURES. Three, and they are one shape ────────────────
 *
 *  1. A mapping report wrote `str(m.get("logical_unit_number") or "")`. LUN 0
 *     is falsy, so on 2,094 mappings LUN 0 was stored as an EMPTY STRING —
 *     and a host group missing the LUN an initiator probes first became
 *     indistinguishable from one that had it. The column was numeric; the
 *     value was `''`; nothing anywhere disagreed.
 *  2. A capacity view rendered `round(mib / 1024, 1)`, so an 8 MiB disk came
 *     out as `0.0 GB` — which reads as NO DISK, i.e. a provisioning failure,
 *     during a live desktop-fleet incident.
 *  3. Earlier in the same application, a whole family of tools returned their
 *     numbers as quoted strings (`"1240"`). Every chart silently went blank,
 *     because nothing downstream could tell a measure from a label.
 *
 * All three are "a number became something else, and nothing noticed at the
 * seam". The library already lets a tool declare what its result IS
 * (`resultKind`, 9.70.0). It did not let a tool declare what its result
 * CONTAINS, so there was nothing for a rowset to be wrong against.
 *
 * ── THE CEILING, and case 2 is the whole argument for stating it ────────
 * This judges TYPE, never MEANING. It can see that a column declared
 * `number` holds a string. It can NEVER see that the string should have been
 * `0`, or that `0.0` should have been `0.0078`. Case 2 above passes this
 * check cleanly — `0.0` is a perfectly good number — and the check says so
 * out loud rather than letting a green row imply otherwise. The ceiling ships
 * as {@link COLUMN_TYPE_CEILING} and is quoted verbatim into every finding,
 * the `EMPTY_LOOKUP_CEILING` law: one owner for the bound, so it cannot drift
 * out of a message and leave a reader believing the library knows more than
 * it does.
 *
 * ── TWO FINDINGS, because the field bug turned on the difference ────────
 *   • `column-type-mismatch` — the column is THERE and holds the wrong thing.
 *     Cases 1 and 3.
 *   • `missing-column` — the column the author declared is in NO row of the
 *     result. Nothing to type-check; the promise was broken one level up.
 * Collapsing them would recreate the exact ambiguity the LUN report died of:
 * "the value is not what it should be" and "the value is not there" send a
 * person to two different files, and a checker that says only "something is
 * off with logical_unit_number" has helped with neither.
 *
 * ── DECLARED, NEVER INFERRED ────────────────────────────────────────────
 * A tool is this check's subject only because its author wrote
 * `resultColumns`. Nothing here sniffs a type off the data — sniffing is
 * precisely what the consumers do today, and precisely what produced the
 * failures above: one stray `''` demotes a numeric column to text, and the
 * demotion is silent.
 *
 * ── WHAT IS NOT JUDGED ──────────────────────────────────────────────────
 * See {@link readRowset}. A result is read only when it is an array of plain
 * objects with at least one row. Everything else — prose, a `null`, a bespoke
 * `{ rows: [...] }` wrapper, a claim ticket, AND the zero-row result — is
 * `not-applicable`, filed as a ROW. The zero-row case belongs to the
 * neighbour (`empty-lookup`) and is deliberately not stolen: an empty result
 * has no columns to be wrong about, and filing `missing-column` for every
 * declared column of an empty answer would turn one honest emptiness into a
 * pile of false accusations.
 */

import { MAX_QUOTED_CHARS, clipValue } from '../argumentLeaves.js';
import type { SubjectRef } from '../assertion/types.js';
import type { Disposition } from '../disposition/types.js';
import type { ContextError } from '../finding/types.js';
import { normalizeColumns, type ColumnType, type ToolResultColumns } from './types.js';

/**
 * THE CEILING, as one string with one owner.
 *
 * Quoted verbatim into every finding's message, into this folder's README and
 * into the docs page, so the bound cannot drift out of one of them.
 */
export const COLUMN_TYPE_CEILING =
  'This judges TYPE, never MEANING — it can see that a column declared `number` holds a ' +
  'string, and it can never see that the string should have been 0, or that a 0.0 should ' +
  'have been an 8; a column whose every value has its declared type passes here and can ' +
  'still be wrong.';

/** How the boundary was told to act on what this finds. */
export type ColumnCheckMode = 'warn' | 'enforce';

/**
 * What the library could read about a finished result: the rows, or nothing.
 *
 * Deliberately thin. The check needs the rows and nothing else, and a reading
 * that carried a verdict would be this file judging in two places.
 */
export interface RowsetReading {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/**
 * READ a finished result as a rowset, or decline to.
 *
 * The one readable shape, and why only this one: an ARRAY OF PLAIN OBJECTS
 * with at least one row. That is what a rowset is on this wire, it is what
 * every consumer named in the docs page already expects, and it is the same
 * `Array.isArray` law the neighbouring check reads by — the two must never
 * disagree about what a rowset is.
 *
 * `undefined` (⇒ `not-applicable`, a ROW) for everything else:
 *   • a non-array — prose, a `null`, a `{ rows: [...] }` wrapper, a ticket;
 *   • an array holding anything that is not a plain object — a list of
 *     strings has no columns, and inventing some is how a checker starts
 *     lying;
 *   • an array of ZERO rows — an empty answer has no columns to be wrong
 *     about, and it is the neighbour's subject, not this one's.
 */
export function readRowset(value: unknown): RowsetReading | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined;
  }
  return { rows: value as readonly Readonly<Record<string, unknown>>[] };
}

/** One finished call to a tool whose author declared its result's columns. */
export interface ColumnTypesCall {
  readonly toolName: string;
  /** The provider's id for this call — what the witness points a reader at. */
  readonly toolCallId: string;
  /** `Tool.resultColumns`, exactly as the author wrote it. */
  readonly columns: ToolResultColumns;
  /** What the library could read of the result — `undefined` = not a rowset. */
  readonly reading: RowsetReading | undefined;
  /** What the boundary will do with a finding — carried so the message can
   *  say what actually happened rather than guess. */
  readonly mode: ColumnCheckMode;
}

/** One declared column the rows disagreed with. */
export interface ColumnViolation {
  readonly column: string;
  readonly declared: ColumnType;
  /** How many rows hold something that is not the declared type. */
  readonly rows: number;
  /** Total rows read, so a reader can see 3-of-4 rather than a bare 3. */
  readonly ofRows: number;
  /** The first offending value, rendered and clipped — what a person recognizes. */
  readonly sample: string;
  /** What that first offending value actually is (`string`, `null`, `missing`, …). */
  readonly got: string;
}

/** One encounter's outcome: the findings, the ledger row, and — under
 *  `enforce` — the sentence that replaces the payload. */
export interface ColumnTypesEncounter {
  readonly findings: readonly ContextError[];
  /** Computed HERE, beside the rules that decide it, so "the library refused
   *  to judge this shape" is provable without a live agent. */
  readonly disposition: Disposition;
  /**
   * The teaching refusal, present ONLY under `mode: 'enforce'` with at least
   * one finding. The `applyResultCeiling` idiom, for the same reason: the
   * model reads a sentence that says what was wrong and how to fix it, never
   * a stack trace and never a truncated result that reads as complete.
   */
  readonly refusal?: string;
}

/** Most columns named in one refusal sentence — a 200-column declaration
 *  must not be able to write the context window. */
const MAX_NAMED_IN_REFUSAL = 5;

/**
 * Judge one finished call to a tool that declared its result's columns.
 *
 * @param call the call, the declaration, and what the library could read of
 *   the result. The caller has already established the tool declared
 *   `resultColumns` and that the dial is on; nothing here re-decides arming.
 * @param epoch the run iteration, stamped on every witness.
 */
export function columnTypesOf(call: ColumnTypesCall, epoch: number): ColumnTypesEncounter {
  // A shape the library cannot read as a rowset is not a pass and not a
  // fail. It is the check meeting a subject that is out of its scope BY
  // RULE, which is what `not-applicable` was minted for.
  if (call.reading === undefined) return { findings: [], disposition: 'not-applicable' };

  const rows = call.reading.rows;
  const subject: SubjectRef = { kind: 'tool', id: call.toolName };
  const findings: ContextError[] = [];
  const violations: ColumnViolation[] = [];
  const missing: string[] = [];

  for (const column of normalizeColumns(call.columns)) {
    // ABSENT FROM EVERY ROW is its own finding, and it is checked FIRST so a
    // column nobody delivered can never also be reported as mistyped. The
    // two would be counting the same silence twice, and a reader chasing
    // both would find one bug.
    if (rows.every((row) => !(column.name in row))) {
      missing.push(column.name);
      findings.push({
        kind: 'missing-column',
        seam: 'write',
        subjects: [subject],
        // The column name IS the discriminator: two columns of one result
        // are two findings, exactly as two arguments of one call are at the
        // choice seam.
        predicate: column.name,
        witnesses: [
          {
            subject,
            predicate: column.name,
            value: `declared ${column.type}`,
            epoch,
            stratum: 'asserted',
            provenance: `Tool.resultColumns on '${call.toolName}', as its author wrote it`,
          },
          {
            subject,
            predicate: column.name,
            value: 'present in no row',
            epoch,
            stratum: 'asserted',
            provenance: `tool call ${call.toolCallId}: the result, as the tool returned it (${
              rows.length
            } row${rows.length === 1 ? '' : 's'})`,
          },
        ],
        epoch,
        message:
          `'${call.toolName}' declares a column '${column.name}' (${column.type}) that is in ` +
          `NONE of the ${rows.length} row${rows.length === 1 ? '' : 's'} it returned. This is ` +
          `not a mistyped value — the column is simply not there, so anything downstream that ` +
          `keys on it reads a rowset that cannot answer, and a row missing the column is ` +
          `indistinguishable from a row whose value is nothing. ${COLUMN_TYPE_CEILING} ` +
          `Call id ${call.toolCallId}. ${outcomeClause(call.mode)}`,
      });
      continue;
    }

    const violation = judgeColumn(rows, column.name, column.type, column.nullable);
    if (violation === undefined) continue;
    violations.push(violation);
    findings.push({
      kind: 'column-type-mismatch',
      seam: 'write',
      subjects: [subject],
      predicate: column.name,
      witnesses: [
        {
          subject,
          predicate: column.name,
          value: `declared ${column.type}${column.nullable ? ' (nullable)' : ''}`,
          epoch,
          stratum: 'asserted',
          provenance: `Tool.resultColumns on '${call.toolName}', as its author wrote it`,
        },
        {
          subject,
          predicate: column.name,
          value: `${violation.rows} of ${violation.ofRows} rows hold ${violation.got} — first: ${violation.sample}`,
          epoch,
          stratum: 'asserted',
          provenance: `tool call ${call.toolCallId}: the result, as the tool returned it`,
        },
      ],
      epoch,
      message:
        `'${call.toolName}' declares column '${column.name}' as ${column.type}, and ` +
        `${violation.rows} of ${violation.ofRows} row${violation.ofRows === 1 ? '' : 's'} hold ` +
        `something else — the first is ${violation.sample} (${violation.got}). ` +
        `${nullableHint(column.nullable, violation.got)}${COLUMN_TYPE_CEILING} ` +
        `Call id ${call.toolCallId}. ${outcomeClause(call.mode)}`,
    });
  }

  if (findings.length === 0) return { findings, disposition: 'checked-pass' };
  return {
    findings,
    disposition: 'checked-fail',
    ...(call.mode === 'enforce' && {
      refusal: refusalSentence(call.toolName, violations, missing),
    }),
  };
}

// ─── Judging one column ────────────────────────────────────────────

/**
 * Walk every row of one declared column and answer with the disagreement, or
 * `undefined` when there is none.
 *
 * COUNTED, not sampled: the row count is what turns "somebody's data is odd"
 * into "2,094 mappings are wrong", which is the sentence that got the field
 * bug fixed. The value ECHOED is the first offender only — one is enough to
 * recognize the shape, and echoing every one would put a tool's whole result
 * into a finding message.
 */
function judgeColumn(
  rows: readonly Readonly<Record<string, unknown>>[],
  name: string,
  type: ColumnType,
  nullable: boolean,
): ColumnViolation | undefined {
  let count = 0;
  let sample: string | undefined;
  let got = '';
  for (const row of rows) {
    const present = name in row;
    const value = present ? row[name] : undefined;
    // "No value" is one idea with three spellings, and they are judged
    // identically: an absent key, a `null` and an `undefined` all say the
    // row has nothing here. `nullable` is the author's word for "that is
    // fine"; without it, nothing is a violation like any other, because the
    // recorded failure was a value that went missing and left a placeholder.
    const empty = !present || value === null || value === undefined;
    if (empty) {
      if (nullable) continue;
      count += 1;
      if (sample === undefined) {
        sample = present ? String(value) : 'no such key';
        got = present ? (value === null ? 'null' : 'undefined') : 'missing';
      }
      continue;
    }
    if (matchesType(value, type)) continue;
    count += 1;
    if (sample === undefined) {
      sample = renderValue(value);
      got = typeName(value);
    }
  }
  if (count === 0 || sample === undefined) return undefined;
  return { column: name, declared: type, rows: count, ofRows: rows.length, sample, got };
}

/**
 * Does one value have the declared type?
 *
 * The bias is the evidence gate's bias, for the evidence gate's reason: a
 * missed mismatch is a miss, a false accusation costs a real person a real
 * investigation. So `date` accepts anything `Date.parse` accepts, which is
 * permissive enough that a `'2024'` passes — a known, stated false negative,
 * and the right direction to be wrong in.
 */
function matchesType(value: unknown, type: ColumnType): boolean {
  switch (type) {
    case 'number':
      // FINITE. `NaN` and the infinities are numbers that mean "no number",
      // they serialize to `null` over JSON, and an axis handed one draws
      // nothing — which is failure 3's symptom exactly.
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }
}

/** What a value IS, in the words a person would use. */
function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'an invalid Date';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : `the number ${value}`;
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/** One value, quoted the way a person would recognize it and clipped so a
 *  5 MB cell cannot ride a finding into the record. */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return `"${clipValue(value)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return `a Date`;
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_QUOTED_CHARS ? `${text.slice(0, MAX_QUOTED_CHARS - 1)}…` : text;
}

/**
 * The one-word fix, named in the message that reports the problem.
 *
 * Only when the offender is an ABSENCE — that is the case where the author
 * may simply have meant "this column can be empty", and a finding that
 * reports a legitimate null without naming the word that legitimizes it is
 * the noise that gets a check switched off.
 */
function nullableHint(nullable: boolean, got: string): string {
  if (nullable) return '';
  if (got !== 'null' && got !== 'undefined' && got !== 'missing') return '';
  return (
    'If this column may legitimately carry no value, say so once — ' +
    "`{ type: '…', nullable: true }` — and rows with nothing in them stop being violations. "
  );
}

/** What the boundary did, stated in the finding rather than assumed by it. */
function outcomeClause(mode: ColumnCheckMode): string {
  return mode === 'enforce'
    ? 'The result was REFUSED: the model reads a teaching sentence instead of these rows.'
    : 'Nothing here blocked the call, changed the result, or retried anything — the model reads the rows exactly as the tool returned them.';
}

/**
 * The teaching refusal, for `enforce`.
 *
 * The `applyResultCeiling` sentence shape, deliberately: what was wrong, what
 * to do about it, and "No data was returned" — because a model that is handed
 * a partial or truncated answer cannot tell the data ends where the cut
 * happened, and fabricates from the part it saw.
 */
function refusalSentence(
  toolName: string,
  violations: readonly ColumnViolation[],
  missing: readonly string[],
): string {
  const parts: string[] = [];
  for (const v of violations.slice(0, MAX_NAMED_IN_REFUSAL)) {
    parts.push(
      `'${v.column}' is declared ${v.declared} and ${v.rows} of ${v.ofRows} rows hold ` +
        `${v.got} (first: ${v.sample})`,
    );
  }
  for (const name of missing.slice(0, Math.max(0, MAX_NAMED_IN_REFUSAL - parts.length))) {
    parts.push(`'${name}' is declared but present in no row`);
  }
  const more = violations.length + missing.length - parts.length;
  const tail = more > 0 ? `, and ${more} more` : '';
  return (
    `Result rejected: ${toolName} returned rows that disagree with the columns it declares — ` +
    `${parts.join('; ')}${tail}. Fix the tool so the column holds what it declares, or change ` +
    `the declaration. No data was returned.`
  );
}
