import type { ResultShapeCapture, ToolResultShape } from '../../../semantics/resultShape.js';

/** The in-memory explanation input. First slice: no recording index or writer uses it. */
export interface AccountEventEvidence {
  /** Zero-based position in the retained recording, not the native hook order. */
  readonly index: number;
  readonly toolResult?: ToolResultShape;
  readonly event: {
    readonly type: string;
    readonly meta: Readonly<Record<string, unknown>>;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

export const TOOL_REWRITE_DECISION = 'agentfootprint.middleware.decision';

export type CommittedToolRewrite =
  | { readonly kind: 'none' | 'unproven' }
  | {
      readonly kind: 'linked';
      readonly historyIndex?: number;
      readonly ledgerIndex: number;
      readonly decision: Readonly<Record<string, unknown>>;
    };

export interface CaptureToolEvidence {
  captureHistory(value: unknown): ResultShapeCapture;
  captureEvent(
    payload: Readonly<Record<string, unknown>>,
    budget: number,
    admitsRewrite: boolean,
  ): ResultShapeCapture & { readonly comparison?: string };
  projectDecision(payload: unknown): Readonly<Record<string, unknown>> | undefined;
  linkRewrite(
    events: readonly AccountEventEvidence[],
    snapshot: unknown,
    history: readonly unknown[],
    comparison: string | undefined,
    budget: number,
  ): CommittedToolRewrite;
}

export interface AccountHistoryResult {
  readonly index: number;
  readonly shape: ToolResultShape;
}

export type AccountEvidenceGap =
  | 'no-start'
  | 'no-terminal-commit'
  | 'multiple-runs'
  | 'retained-events-dropped'
  | 'observer-loss'
  | 'missing-answer-evidence'
  | 'missing-routing-evidence'
  | 'redaction'
  | 'tool-results'
  | 'tool-result-key-limit'
  | 'resumed-state'
  | 'unsupported-evidence'
  | 'budget';

export interface AnswerAccountEvidence {
  readonly version: 1;
  readonly gaps: readonly AccountEvidenceGap[];
  readonly firstRetainedIndex: number;
  readonly events: readonly AccountEventEvidence[];
  readonly historyResults?: readonly AccountHistoryResult[];
  readonly state?: Readonly<Record<string, unknown>>;
}
