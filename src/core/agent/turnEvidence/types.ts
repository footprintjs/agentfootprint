import type { AgentfootprintEvent } from '../../../events/registry.js';

/**
 * The served snapshot and events collected for a turn by `recordRun`.
 * The source can be read in memory as soon as the turn finishes, before filing.
 */
export interface TurnEvidenceSource {
  readonly snapshot: unknown;
  readonly events: readonly AgentfootprintEvent[];
}
