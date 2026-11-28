/** The in-memory explanation input. First slice: no recording index or writer uses it. */
export interface AccountEventEvidence {
  /** Zero-based position in the retained recording, not the native hook order. */
  readonly index: number;
  readonly event: {
    readonly type: string;
    readonly meta: Readonly<Record<string, unknown>>;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

export type AccountEvidenceGap =
  | 'no-start'
  | 'no-terminal-commit'
  | 'multiple-runs'
  | 'retained-events-dropped'
  | 'redaction'
  | 'tool-results'
  | 'resumed-state'
  | 'unsupported-evidence'
  | 'budget';

export interface AnswerAccountEvidence {
  readonly version: 1;
  readonly gaps: readonly AccountEvidenceGap[];
  readonly firstRetainedIndex: number;
  readonly events: readonly AccountEventEvidence[];
  readonly state?: Readonly<Record<string, unknown>>;
}
