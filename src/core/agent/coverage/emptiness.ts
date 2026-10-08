/**
 * emptiness — the ONE reader of "what came back?" for a finished tool result.
 *
 * Pattern: typed routes over two inputs — the value the MODEL read, and the
 *          door the RECORD says the call returned — and never a guess.
 * Role:    core/ layer, pure. It imports the recognizers only
 *          (`coverage/recognize.ts`; the artifact ref grammar and the
 *          placement ticket's guard, `artifacts/naming.ts`,
 *          `artifacts/placement.ts`), never a mint, so a post-hoc reader
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
 * | the library's placement ticket (`placedToolResult`) — the whole result is in the store | `unknown`, said: the ticket counts bytes, never rows | — |
 * | an object whose key the app declared in `rowsAt` | `undeclared-empty` or `non-empty` | app |
 * | an object whose `rowsAt` rows went to the store — the dataset ticket left in their place | the ticket's whole-number `rows`: `undeclared-empty` (0) or `non-empty`; no count → `unknown`, said | app |
 * | an object with no list and no ticket at the declared `rowsAt` | `unknown`, said: the declared key holds no list | — |
 * | anything else | `unknown` — the record cannot read it | — |
 *
 * ## Rows that travel by reference
 *
 * A projection may move a rowset out of the value the model reads and leave a
 * TICKET to the artifact store in its place — `withDatasetArtifacts` /
 * `stageDatasetArtifacts` stage the rows, and a projection (or an after-tool
 * `allow(replacement)`) keeps the ticket and drops the rows. The library's
 * spelling of that ticket, the one this reader counts:
 *
 * ```ts
 * { …, datasets: { rows: { ref: 'art_…', kind: 'dataset/rows', rows: 2, sourceField: 'rows' } },
 *      dataset: { ref: 'art_…', kind: 'dataset/rows', rows: 2, sourceField: 'rows' } } // the principal one
 * ```
 *
 * `ref` is a store ref (`isArtifactRef`), `rows` the whole-number row count,
 * `sourceField` the result key the rows came from. The ticket is read only for
 * the key the APP declared (`rowsAt`), only when that key is gone from the
 * value (moved, not merely beside it), and only when the ticket names it —
 * keyed under `datasets[rowsAt]` (a `sourceField`, when present, agreeing) or
 * the principal `dataset` with `sourceField: rowsAt`. Two declarations meet
 * there: the app's key and the ticket's field. A ticket with no whole-number
 * `rows` is never guessed: whether the result was empty cannot be told, and
 * the reading says why (`rowsUnread`). The library's own placement ticket
 * (`artifacts/placement.ts`) puts the WHOLE result in the store and counts
 * bytes, so it reads the same way. Take 4 of the demo video: a ticketed
 * `pscale_client_health` (2 rows, `sourceField: 'rows'`, the app's `rowsAt:
 * 'rows'`) read as "its shape is not declared", and the account's tone stayed
 * unknown.
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

import { isArtifactRef } from '../../../artifacts/naming.js';
import { isPlacedToolResult } from '../../../artifacts/placement.js';
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
  /**
   * For a reader of a record SERVED under a redaction policy (an agent's
   * `redact`): whether a value is the policy's placeholder. The app's rows key
   * holding one reads as kept out (`rowsUnread: 'redacted'`), never as "no
   * list". Absent — the live run, or a record no policy covered — every
   * value is read as the value it is.
   */
  readonly keptOut?: (value: unknown) => boolean;
}

export interface EmptinessReading {
  readonly emptiness: Emptiness;
  /** Rows counted in the value the model read (a counted rowset only). */
  readonly rows?: number;
  /** `app` when the count rests on the app's declared `rowsAt`. */
  readonly source?: 'library' | 'app';
  /** The rows key the reading used (the app's `rowsAt`), when it used one. */
  readonly rowsAt?: string;
  /**
   * Where in the value read the count was taken (path segments; `[]` the value
   * itself; `result` for each declared boundary read through): the rowset, or
   * the `rows` of the dataset ticket standing for it.
   */
  readonly countedAt?: readonly string[];
  /** A described result's data, per kind. */
  readonly described?: DescribedCounts;
  /** Read through a declared `coverage()` boundary. */
  readonly bounded?: true;
  /** An object result with no declared shape — whether it was empty cannot be told. */
  readonly undeclaredShape: boolean;
  /**
   * Why the rows could not be counted when the shape IS known — so a reader
   * never says "not declared" of a declared key:
   * - `no-list` — the app declared `rowsAt`, and the value holds neither a list
   *   there nor a ticket standing for it;
   * - `uncounted-ticket` — the rows went to the artifact store and the ticket
   *   left in their place carries no whole-number count (a dataset ticket
   *   without `rows`, or the library's placement ticket, which counts bytes);
   * - `redacted` — the result itself is kept out of the record: a redaction
   *   policy (an agent's `redact`) left its placeholder where the value was,
   *   so nothing about the rows can be read. Set by the answer account's call
   *   reader (`lib/answer-account/facts/calls.ts`), which never hands a
   *   placeholder to this reader as if it were a result.
   */
  readonly rowsUnread?: 'no-list' | 'uncounted-ticket' | 'redacted';
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

/** A count of rows: `undeclared-empty` at zero, `non-empty` above it. */
function counted(
  rows: number,
  source: 'library' | 'app',
  countedAt: readonly string[],
  rowsAt?: string,
): EmptinessReading {
  return {
    emptiness: rows === 0 ? 'undeclared-empty' : 'non-empty',
    rows,
    source,
    ...(rowsAt !== undefined && { rowsAt }),
    countedAt,
    undeclaredShape: false,
  };
}

const UNCOUNTED_TICKET: EmptinessReading = Object.freeze({
  emptiness: 'unknown',
  undeclaredShape: false,
  rowsUnread: 'uncounted-ticket',
});

/** A ticket to the artifact store: an object whose `ref` is a store ref. */
const isTicket = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isArtifactRef(value.ref);

/**
 * The dataset ticket standing for the declared rows key — `datasets[rowsAt]`
 * (its `sourceField`, when present, naming that key) or the principal
 * `dataset` with `sourceField: rowsAt` — with where it sits. See "Rows that
 * travel by reference" in the header.
 */
function ticketFor(
  data: Record<string, unknown>,
  rowsAt: string,
): { readonly ticket: Record<string, unknown>; readonly at: readonly string[] } | undefined {
  const all = data.datasets;
  if (isRecord(all) && Object.hasOwn(all, rowsAt)) {
    const ticket = all[rowsAt];
    if (isTicket(ticket) && (ticket.sourceField === undefined || ticket.sourceField === rowsAt)) {
      return { ticket, at: ['datasets', rowsAt] };
    }
  }
  const principal = data.dataset;
  return isTicket(principal) && principal.sourceField === rowsAt
    ? { ticket: principal, at: ['dataset'] }
    : undefined;
}

/**
 * A bare rowset: a top-level array (library-counted), the app's `rowsAt` key
 * or the dataset ticket left where those rows were (app-counted).
 */
function rowsetReading(
  data: unknown,
  rowsAt: string | undefined,
  keptOut: ((value: unknown) => boolean) | undefined,
): EmptinessReading {
  if (Array.isArray(data)) return counted(data.length, 'library', []);
  // The whole value kept out of a served record: nothing about its rows can be read.
  if (keptOut?.(data) === true)
    return { emptiness: 'unknown', undeclaredShape: false, rowsUnread: 'redacted' };
  if (!isRecord(data)) return { emptiness: 'unknown', undeclaredShape: false };
  // The library's own placement: the whole result is in the store, and its ticket counts bytes.
  if (isPlacedToolResult(data)) return UNCOUNTED_TICKET;
  if (rowsAt === undefined) return { emptiness: 'unknown', undeclaredShape: true };
  // Own keys only. A key set to `undefined` is gone too — its JSON (the history, a saved
  // recording) drops it, and the live value must read the same.
  const rows = Object.hasOwn(data, rowsAt) ? data[rowsAt] : undefined;
  if (Array.isArray(rows)) return counted(rows.length, 'app', [rowsAt], rowsAt);
  // The declared rows kept out of a served record — not "no list".
  if (rows !== undefined && keptOut?.(rows) === true) {
    return { emptiness: 'unknown', rowsAt, undeclaredShape: false, rowsUnread: 'redacted' };
  }
  // Moved, not merely beside: a key still in the value is read as the value holds it.
  const found = rows === undefined ? ticketFor(data, rowsAt) : undefined;
  if (found === undefined) {
    return { emptiness: 'unknown', rowsAt, undeclaredShape: false, rowsUnread: 'no-list' };
  }
  const n = found.ticket.rows;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
    ? counted(n, 'app', [...found.at, 'rows'], rowsAt)
    : { ...UNCOUNTED_TICKET, rowsAt };
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
  keptOut: ((value: unknown) => boolean) | undefined,
): EmptinessReading {
  // Only a boundary the door holds is read through: a marker the run did not recognize is data.
  const covered = door.bounded ? readCoverageLedger(data) : undefined;
  if (covered === undefined) return rowsetReading(data, rowsAt, keptOut);
  if (depth >= MAX_BOUND_DEPTH) return { emptiness: 'unknown', undeclaredShape: false };
  const read = boundedReading(covered.result, door, rowsAt, depth + 1, keptOut);
  // The count sits under the boundary's `result`.
  const inner: EmptinessReading =
    read.countedAt !== undefined ? { ...read, countedAt: ['result', ...read.countedAt] } : read;
  // An empty rowset inside a declared boundary is a declared absence — the same meaning, the same reading.
  if (inner.emptiness === 'undeclared-empty') {
    const { undeclaredShape: _shape, ...rest } = inner;
    void _shape;
    return { ...rest, emptiness: 'declared-absent', bounded: true, undeclaredShape: false };
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
  return boundedReading(data, door, context.rowsAt, 0, context.keptOut);
}
