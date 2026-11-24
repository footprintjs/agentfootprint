import type { ToolResultRecord } from './toolResultRecord.js';

/** Recording fields carried with the conversation and stripped before the provider port. */
export interface MessageRecord extends ToolResultRecord {
  /** Who supplied the accepted reply, including after an output-policy rewrite.
   * A mark from a checkpoint is its writer's declaration. Only the run's own
   * request and usage receipts can establish a provider call or its cost. */
  readonly replyOrigin?: { readonly kind: 'host' | 'model'; readonly runId: string };
}
