/**
 * emptiness — the ONE reader of "what came back?" for a finished tool result.
 *
 * Pattern: typed routes over two inputs — the value the MODEL read, and the
 *          door the RECORD says the call returned — and never a guess.
 * Role:    core/ layer, pure. It imports the recognizers only
 *          (`coverage/recognize.ts`), never a mint, so a post-hoc reader
 *          loads it without the tool-name checks and refusal sentences.
 * Callers: the `/observe` answer account (`lib/answer-account/facts/calls.ts`
 *          for this run's calls, `lib/answer-account/facts/inView.ts` for an
 *          earlier answer's result) and the standing fold
 *          (`core/agent/assessment/assess.ts` · `assessAnswer`). One rule, so
 *          the person's account and the answer's standing read the same bytes
 *          the same way; they differ only where they hold a different door
 *          (the list under "The door decides" below).
 * Emits:   N/A.
 *
 * ## The routes, in order
 *
 * | What the record says came back | Reading | Rows counted by |
 * |---|---|---|
 * | an absence — bare, inside a `coverage()`, or the delivered status `'absent'` | `declared-absent` | — |
 * | a `describedResult()` with data | `non-empty`, with a count per kind | library |
 * | a `describedResult()` with only `clarify` | `clarify` — a question handed back, no data | — |
 * | a `coverage()` envelope | its wrapped `result`, read by these same routes, marked `bounded`; an empty wrapped rowset reads `declared-absent` | library or app |
 * | a bare top-level array | `undeclared-empty` or `non-empty` | library |
 * | an object whose key the app declared in `rowsAt` | `undeclared-empty` or `non-empty` | app |
 * | anything else | `unknown` — the record cannot read it | — |
 *
 * ## The door decides, when the record holds one
 *
 * A marker in the bytes is not a declaration: an envelope a tool returned as
 * JSON TEXT (an `mcpClient` in its default text mode) reaches the model and
 * the history byte-for-byte like a recognized one, but the run never
 * recognized it — no delivered status, no coverage row, no limits block. So
 * when the caller holds the call's door (`EmptinessContext.door` — this run's
 * calls, read from the coverage rows or events), the door alone says whether
 * an absence or a boundary was declared, and a marker the door does not vouch
 * for is read as plain data. Only when the caller holds NO door for the result
 * is the door read off the value itself, by the rule the run's own recognizer
 * applies (`declaredByValue`, mirroring `coverage/read.ts` ·
 * `readCoverageResult`) — the only evidence left, and the same answer the run
 * would have filed for an object. Which caller holds a door:
 *
 * - the answer account, for this run's calls — its EVENTS are the door
 *   (`lib/answer-account/facts/calls.ts`), and a call's `tool_end` is always
 *   in the record, so a JSON-text envelope the run never recognized reads as
 *   data in "It found";
 * - the standing fold, only for a call that has a committed coverage row
 *   (`core/agent/assessment/assess.ts` · `readTurnResults`). Committed state
 *   can LOSE a row the run filed (a history restored by `resumeOnError` does
 *   not carry `coverageDeclared`; a trimmed recording drops it), so for a call
 *   with no row the fold passes no door and the envelope in the committed
 *   history is read — never read as silence. For a JSON-text envelope the run
 *   never recognized (an `mcpClient` in text mode) the fold then says more
 *   than "It found" does: it may over-report, it never hides;
 * - nobody, for an earlier answer's result (`facts/inView.ts`).
 *
 * Recognizing JSON-text envelopes at run time belongs at the execute boundary,
 * with one owner, not in a reader.
 */

import { readAbsence, readCoverageLedger } from './recognize.js';

/**
 * Whether the result the model read came back empty, and who says so.
 *
 * - `declared-absent` — the tool declared that nothing matched (an absence, or
 *   an empty rowset inside a declared boundary);
 * - `undeclared-empty` — an empty rowset that did not say what it searched;
 * - `non-empty` — rows, or described data, came back;
 * - `clarify` — a described result handed back a question and no data;
 * - `unknown` — the record cannot read it (a shape nobody declared, a
 *   decorated or non-JSON string, an error text).
 */
export type Emptiness =
  | 'declared-absent'
  | 'undeclared-empty'
  | 'non-empty'
  | 'clarify'
  | 'unknown';

/** A described result's data, counted per kind by the library from the recorded envelope. */
export interface DescribedCounts {
  readonly facts?: number;
  readonly series?: number;
  readonly edges?: number;
}

/** What the RECORD says one call returned. */
export interface ReturnedDoor {
  /** The call returned an absence — bare, inside a `coverage()`, or with the delivered status `'absent'`. */
  readonly absent: boolean;
  /** The call declared a `coverage()` boundary (a `ledger` coverage row / a `tools.coverage_declared` event). */
  readonly bounded: boolean;
  /**
   * The `describedResult()` / `semantic()` envelope as the record keeps it —
   * the `tools.semantics_declared` event's `semantics`. The model read only its
   * projection, which carries no marker, so without this the reader cannot
   * tell a described result from any other object. Committed state does not
   * keep it (the projection replaces it at the dispatch door), so the standing
   * fold never has it.
   */
  readonly described?: unknown;
}

export interface EmptinessContext {
  /** Where the APP says an object result of this tool keeps its rows — a top-level key. */
  readonly rowsAt?: string;
  /**
   * What the record says the call returned. ABSENT when the record holds no
   * door for this result — an earlier answer's result, whose run is not in
   * this record, or (for the standing fold) a call with no committed coverage
   * row — and the strict recognizers then read the value itself
   * (`declaredByValue`).
   */
  readonly door?: ReturnedDoor;
}

export interface EmptinessReading {
  readonly emptiness: Emptiness;
  /** Rows counted in the value the model read (a counted rowset only). */
  readonly rows?: number;
  /** `app` when the count rests on the app's declared `rowsAt`. */
  readonly source?: 'library' | 'app';
  /** The rows key the reading used (the app's `rowsAt`), when it used one. */
  readonly rowsAt?: string;
  /** A described result's data, per kind. */
  readonly described?: DescribedCounts;
  /** Read through a declared `coverage()` boundary. */
  readonly bounded?: true;
  /** An object result with no declared shape — whether it was empty cannot be told. */
  readonly undeclaredShape: boolean;
}

/** How deep `coverage(coverage(…))` is read before the reading gives up (`unknown`). */
const MAX_BOUND_DEPTH = 8;

/**
 * The ONE rule for an app's declared rows key: a non-empty TOP-LEVEL key of the
 * object result — no `/` and no `.`, so it can never be read as a path. Returns
 * what is wrong with a value (`'empty'`, `'nested'`), or `undefined` when it
 * keeps the rule. Both readers' declarations are checked by it (the answer
 * account's `lib/answer-account/declarations.ts` · `validateDeclarations`, the
 * standing fold's `core/agent/assessment/assess.ts` · `assessAnswer`), so the
 * two cannot accept different keys.
 */
export function rowsAtProblem(rowsAt: unknown): 'empty' | 'nested' | undefined {
  if (typeof rowsAt !== 'string' || rowsAt.length === 0) return 'empty';
  return /[/.]/.test(rowsAt) ? 'nested' : undefined;
}

/** JSON text that is an object or array is read as data; anything else as found. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DECLARED_ABSENT: EmptinessReading = Object.freeze({
  emptiness: 'declared-absent',
  undeclaredShape: false,
});

/** A bare rowset: a top-level array (library-counted) or the app's `rowsAt` key (app-counted). */
function rowsetReading(data: unknown, rowsAt: string | undefined): EmptinessReading {
  if (Array.isArray(data)) {
    return data.length === 0
      ? { emptiness: 'undeclared-empty', rows: 0, source: 'library', undeclaredShape: false }
      : { emptiness: 'non-empty', rows: data.length, source: 'library', undeclaredShape: false };
  }
  if (isRecord(data)) {
    const rows = rowsAt !== undefined ? data[rowsAt] : undefined;
    if (rowsAt !== undefined && Array.isArray(rows)) {
      return rows.length === 0
        ? { emptiness: 'undeclared-empty', rows: 0, source: 'app', rowsAt, undeclaredShape: false }
        : {
            emptiness: 'non-empty',
            rows: rows.length,
            source: 'app',
            rowsAt,
            undeclaredShape: false,
          };
    }
    return { emptiness: 'unknown', undeclaredShape: true };
  }
  return { emptiness: 'unknown', undeclaredShape: false };
}

/** The data a recorded described envelope carries, per kind — or `undefined` when it cannot be read. */
function describedReading(envelope: unknown): EmptinessReading | undefined {
  if (!isRecord(envelope)) return undefined;
  const counts: { facts?: number; series?: number; edges?: number } = {};
  for (const kind of ['facts', 'series', 'edges'] as const) {
    const list = envelope[kind];
    if (Array.isArray(list) && list.length > 0) counts[kind] = list.length;
  }
  if (Object.keys(counts).length > 0) {
    return { emptiness: 'non-empty', source: 'library', described: counts, undeclaredShape: false };
  }
  return isRecord(envelope.clarify) ? { emptiness: 'clarify', undeclaredShape: false } : undefined;
}

/** What a value's OWN envelope declares — see {@link declaredByValue}. */
export interface ValueDeclaration {
  /** An absence — bare, or directly inside a `coverage()` boundary. */
  readonly absent: boolean;
  /** A `coverage()` boundary. */
  readonly bounded: boolean;
  /**
   * Ground the envelope says it did not check or can never cover — a
   * non-empty `not_checked` / `cannot_cover`, on the boundary or on the
   * absence it wraps.
   */
  readonly gap: boolean;
}

const listed = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * What a value's own envelope declares, read by the strict recognizers only and
 * by the rule the RUN's recognizer files rows for a value it is handed
 * (`coverage/read.ts` · `readCoverageResult`): a bare absence, or a boundary
 * with an absence directly inside it, and the gaps either lists. `undefined`
 * when the value is neither envelope. JSON text is parsed once, at the top.
 *
 * For a reader whose record holds no row for the call: an earlier answer's
 * result (its run is not in this record), or a result whose row was never
 * filed or was lost on the way here — a history restored by `resumeOnError`
 * carries no `coverageDeclared`, and a trimmed recording may drop it. The
 * envelope in the bytes is then the only evidence left, and reading it can
 * only ADD a declaration, never hide one.
 */
export function declaredByValue(value: unknown): ValueDeclaration | undefined {
  const data = parseMaybeJson(value);
  const ledger = readCoverageLedger(data);
  const absence =
    readAbsence(data) ?? (ledger !== undefined ? readAbsence(ledger.result) : undefined);
  if (ledger === undefined && absence === undefined) return undefined;
  return {
    absent: absence !== undefined,
    bounded: ledger !== undefined,
    gap:
      listed(absence?.not_checked) ||
      listed(absence?.cannot_cover) ||
      listed(ledger?.af_coverage.not_checked) ||
      listed(ledger?.af_coverage.cannot_cover),
  };
}

/** The door {@link declaredByValue} reads off the value — used only when the caller holds none. */
function doorOf(data: unknown): ReturnedDoor {
  const own = declaredByValue(data);
  return { absent: own?.absent === true, bounded: own?.bounded === true };
}

/** A declared boundary read through (nested ones too), then the bare rowset. */
function boundedReading(
  data: unknown,
  door: ReturnedDoor,
  rowsAt: string | undefined,
  depth: number,
): EmptinessReading {
  // Only a boundary the door holds is read through: a marker the run did not recognize is data.
  const covered = door.bounded ? readCoverageLedger(data) : undefined;
  if (covered === undefined) return rowsetReading(data, rowsAt);
  if (depth >= MAX_BOUND_DEPTH) return { emptiness: 'unknown', undeclaredShape: false };
  const inner = boundedReading(covered.result, door, rowsAt, depth + 1);
  // An empty rowset inside a declared boundary is a declared absence — the same meaning, the same reading.
  if (inner.emptiness === 'undeclared-empty') {
    const { undeclaredShape: _shape, ...counted } = inner;
    void _shape;
    return { ...counted, emptiness: 'declared-absent', bounded: true, undeclaredShape: false };
  }
  return { ...inner, bounded: true };
}

/**
 * Read one finished tool result. Typed routes only — see the header's table.
 *
 * @param value   the value the MODEL read — a history message's `content`, or
 *                `tool_end.modelResult ?? result`. JSON text is parsed once, at
 *                this top level (the library's own serialization boundary);
 *                strings inside the value are the tool's and are never parsed.
 * @param context the app's `rowsAt` for this tool, and the door the record
 *                holds for this call (absent for an earlier answer's result).
 */
export function readEmptiness(value: unknown, context: EmptinessContext = {}): EmptinessReading {
  const data = parseMaybeJson(value);
  // The record's door when it holds one; otherwise the door the run's recognizer files for these bytes.
  const door = context.door ?? doorOf(data);
  if (door.absent) {
    // Both rows filed means `coverage(absent(…))`: the absence inside a declared boundary.
    return door.bounded ? { ...DECLARED_ABSENT, bounded: true } : DECLARED_ABSENT;
  }
  if (door.described !== undefined) {
    const described = describedReading(door.described);
    if (described !== undefined) return described;
  }
  return boundedReading(data, door, context.rowsAt, 0);
}
