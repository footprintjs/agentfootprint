/** Finite, value-free accounting for an explicitly declared final rowset. */
export type ToolRowsetCheckReason =
  | 'rows'
  | 'empty'
  | 'declared-absence'
  | 'unsupported-shape'
  | 'source-missing'
  | 'publication-unavailable'
  | 'publication-changed'
  | 'wrong-kind'
  | 'source-over-bound'
  | 'result-withheld'
  | 'result-capped'
  | 'source-aborted'
  | 'store-unavailable';

/** No result values, references, samples, counts or arbitrary error text travel here. */
export interface ToolRowsetCheckedPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The static producer-declared key, never a value inferred from result data. */
  readonly rowset: string;
  readonly source: 'inline' | 'published-dataset';
  readonly disposition: 'checked-pass' | 'checked-fail' | 'not-applicable' | 'unavailable';
  readonly reason: ToolRowsetCheckReason;
  readonly delivery: 'unchanged' | 'refused';
}
