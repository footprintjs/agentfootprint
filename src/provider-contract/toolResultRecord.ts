/** Measured printed output retained when a native code runner clips either stream. */
export interface ToolOutputCounts {
  readonly kept: number;
  readonly total?: number;
  readonly unit: 'characters';
}

/** Engine failure kinds available on the framework-only part of a tool result. */
export type ToolFailureCategory =
  | 'timeout'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'auth'
  | 'permanent'
  | 'unknown';

/** An admitted declaration with advice that has passed the result's serving policy. */
export interface DeclaredToolFailureRecord {
  readonly origin: 'declared';
  readonly declaredCategory: ToolFailureCategory;
  readonly notChecked?: string | { readonly omitted: true };
  readonly tryInstead?: string | { readonly omitted: true };
}

/** Committed tool-result facts used by framework readers and kept off the provider wire. */
export interface ToolResultRecord {
  /**
   * Producer-owned notice origin, recorded only under findings admission.
   * `not-entered` means the producer refused before tool.execute; an error
   * thrown inside execute remains a result. `input-cancelled` is the host's
   * notice, not a completed result, and says nothing about prior tool entry.
   * `outcome-unknown` is the host's notice for a call left open by a run that
   * stopped after a person's decision was used (`hosting/answeredPause.ts`):
   * whether it entered is not known, and the notice is not its result.
   * Absent on old history: no missing origin is reconstructed from text.
   * JSON/checkpoint safe; stripFrameworkFields removes it before transport.
   */
  readonly toolResultOrigin?: 'not-entered' | 'input-cancelled' | 'outcome-unknown';
  /** A host's after-tool rule withheld or replaced this result. Kept off the provider wire. */
  readonly toolResultDisposition?: 'withheld' | 'rewritten';
  /**
   * Whether the tool was entered and returned. `returned-unserved` means a
   * framework refusal or cap replaced its return. Host rules are recorded
   * separately by `toolResultDisposition`. Artifact tickets carry the result.
   */
  readonly toolResultExecution?: 'not-entered' | 'threw' | 'returned' | 'returned-unserved';
  /** Printed output counts from an admitted native return. Kept off the provider wire. */
  readonly toolOutputCounts?: ToolOutputCounts;
  /** The engine category of a thrown tool failure, without the error text. */
  readonly toolFailureCategory?: ToolFailureCategory;
  readonly toolDeclaredFailure?: DeclaredToolFailureRecord;
}

/** Recording fields carried with the conversation and stripped before the provider port. */
export interface MessageRecord extends ToolResultRecord {
  /** Who supplied the accepted reply, including after an output-policy rewrite.
   * A mark from a checkpoint is its writer's declaration. Only the run's own
   * request and usage receipts can establish a provider call or its cost. */
  readonly replyOrigin?: { readonly kind: 'host' | 'model'; readonly runId: string };
}
