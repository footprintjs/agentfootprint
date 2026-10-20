/** Existing collapsed-result protocol, shared without importing the ledger renderer. */
import type { Standing } from './types.js';

/** The ticket a collapsed tool message carries instead of its result. */
export interface CollapsedToolResult {
  /** Always `true`. The field a consumer branches on. */
  readonly collapsed: true;
  readonly standing: Standing;
  readonly toolCallId: string;
  /** The placement ref when the collapsed result was placed. */
  readonly ref?: string;
}

/** Type guard for a consumer reading a served tool message. */
export function isCollapsedToolResult(value: unknown): value is CollapsedToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { collapsed?: unknown }).collapsed === true &&
    typeof (value as { standing?: unknown }).standing === 'string' &&
    typeof (value as { toolCallId?: unknown }).toolCallId === 'string'
  );
}
