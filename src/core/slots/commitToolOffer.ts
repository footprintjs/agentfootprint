import type { ToolParty } from '../../tools/toolParty.js';
import type { Tool } from '../../tools/tools.js';

/**
 * Private party metadata for the same wire Compose serves. Truncated history
 * closes uniqueness fallback; a later positive wire still proves its names.
 */
export interface ServedToolParties {
  /** Saved wire membership is closed until a fresh Compose replaces it. */
  restored?: true;
  truncated?: true;
  argumentAskPending?: boolean;
  currentProof?: ReadonlyMap<string, ToolParty>;
  lastProof?: ReadonlyMap<string, ToolParty>;
  /** Positive wire acquisition, including an actually empty offer. */
  wireReady?: true;
  pinned?: ReadonlyMap<string, ToolParty | null>;
  current: ReadonlyMap<string, ToolParty | null>;
  /** The exact visible callable behind this epoch's winning contract, under the choice arm. */
  currentImplementations?: ReadonlyMap<string, Tool>;
  /**
   * The party each name was LAST served under, across the epochs of one run
   * (cleared on iteration 1). The off-wire fallback reads it: a name that
   * left the wire may still be answered by the party the model last read it
   * under — never by a party the model was never shown under that name.
   */
  readonly lastServed: Map<string, ToolParty>;
}

/** Commit the winning offer and its provenance together for dispatch. */
export function commitToolOffer(
  servedTools: ServedToolParties,
  winners: ReadonlyMap<string, ToolParty>,
  winningTools: ReadonlyMap<string, Tool>,
  narrowedTo: ReadonlySet<string> | undefined,
  iteration: number,
): void {
  // Dispatch follows the OFFER: a name narrowed off this epoch's wire
  // was not served, so it is not on `current` and takes the off-wire
  // path (`toolResolver.ts · buildToolResolver`) — answered by the party the
  // model last read it under, and recorded as `tools.answered_off_wire`.
  const wireWinners =
    narrowedTo === undefined
      ? winners
      : new Map([...winners].filter(([name]) => narrowedTo.has(name)));
  servedTools.current = wireWinners;
  if (servedTools.currentImplementations !== undefined) {
    servedTools.currentImplementations = new Map(
      [...winningTools].filter(([name]) => wireWinners.has(name)),
    );
  }
  servedTools.currentProof = undefined;
  servedTools.restored = undefined;
  servedTools.wireReady = true;
  // The run's memory of who served what (read by the off-wire fallback).
  // Iteration 1 is a run's first epoch — `seed` sets it — so the memory
  // of a previous run on this same built chart is dropped here.
  if (iteration === 1) {
    servedTools.lastServed.clear();
    servedTools.lastProof = undefined;
  }
  for (const [name, party] of wireWinners) servedTools.lastServed.set(name, party);
}
