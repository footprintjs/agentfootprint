/**
 * Pipeline types — what a memory pipeline preset returns to the wire layer.
 *
 * The wire layer (Layer 5) mounts these two flowcharts as subflows inside
 * the agent's main flowchart:
 *   - `read` runs beforeTurn — produces `scope.formatted` for injection
 *   - `write` runs afterTurn — persists `scope.newMessages`
 *
 * Having BOTH returned as a bundle keeps the two sides coupled to a
 * single store/config choice: you can't accidentally use
 * `.memoryPipeline(preset1.read)` with `preset2.write` and end up
 * writing to a different store than you read from.
 */
import type { FlowChart } from 'footprintjs';
import type { MemoryState } from '../stages';

/**
 * The two flowcharts that together form a memory pipeline. Either may be
 * `undefined` for one-sided pipelines (e.g. `ephemeral` has no `write`).
 */
export interface MemoryPipeline {
  /**
   * Read subflow — runs before each agent turn to populate
   * `scope.formatted` with memory content to inject.
   */
  readonly read: FlowChart<MemoryState>;

  /**
   * Write subflow — runs after each turn to persist `scope.newMessages`.
   * Optional: `ephemeral` and `readonly` pipelines omit this.
   */
  readonly write?: FlowChart<MemoryState>;
}
