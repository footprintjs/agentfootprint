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
   *   reader (`answer-account/facts/calls.ts`), which never hands a
   *   placeholder to this reader as if it were a result.
   */
  readonly rowsUnread?: 'no-list' | 'uncounted-ticket' | 'redacted';
}

/**
 * Bounded readings of a plain tool result. The ordinary emptiness reader
 * makes each reading at capture. The app selects a field only at read time.
 */
export interface ToolResultShape {
  /** Present only for a proved event-level rewrite. History shapes have no channel. */
  readonly view?: 'model-result';
  readonly defaultReading: EmptinessReading;
  readonly absentKeyReading?: EmptinessReading;
  readonly keys: readonly (readonly [string, EmptinessReading])[];
}

export function readResultShape(shape: ToolResultShape, rowsAt?: string): EmptinessReading {
  if (rowsAt === undefined) return shape.defaultReading;
  const reading = shape.keys.find(([key]) => key === rowsAt)?.[1];
  if (reading !== undefined) return reading;
  return shape.absentKeyReading === undefined
    ? shape.defaultReading
    : { ...shape.absentKeyReading, rowsAt };
}

export type ResultShapeCapture =
  | { readonly kind: 'ready'; readonly shape: ToolResultShape }
  | { readonly kind: 'tool-result-key-limit' | 'tool-results' };
