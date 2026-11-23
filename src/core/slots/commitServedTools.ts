import type { AttemptRef } from 'footprintjs';
import type { WireCollision } from './wireCollisions.js';
import type { Tool } from '../../tools/tools.js';
import type { ToolParty } from '../../tools/toolParty.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import {
  MAX_SELECTION_ROWS,
  visibleToolClaim,
  type DiscoveryOmissions,
} from './providerOmissions.js';

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
  /** Selection in the last successfully prepared tool slot of this component. */
  selection?: SlotSelection;
  pinned?: ReadonlyMap<string, ToolParty | null>;
  current: ReadonlyMap<string, ToolParty | null>;
  /**
   * The party each name was LAST served under, across the epochs of one run
   * (cleared on iteration 1). The off-wire fallback reads it: a name that
   * left the wire may still be answered by the party the model last read it
   * under — never by a party the model was never shown under that name.
   */
  readonly lastServed: Map<string, ToolParty>;
}

interface TopNOmission {
  readonly kind: 'top-N';
  readonly name: string;
  readonly tool: Tool;
  readonly party: ToolParty;
}

interface CollisionOmission {
  readonly kind: 'collision';
  readonly name: string;
  readonly tool: Tool;
  readonly party: ToolParty;
  readonly winner: { readonly tool: Tool; readonly party: ToolParty };
}

type SelectionRow = DiscoveryOmissions['rows'][number] | TopNOmission | CollisionOmission;

interface SlotSelection {
  /** Successful model response whose adapter attested the selected name did not reach its wire. */
  accepted?: Pick<SlotSelection, 'iteration' | 'rows'> & { readonly consumer: AttemptRef };
  readonly iteration: number;
  readonly rows: readonly SelectionRow[];
  readonly complete: boolean;
}

interface SlotCommit {
  readonly iteration: number;
  readonly collisions?: readonly WireCollision[];
  readonly narrowedTo?: ReadonlySet<string>;
  readonly omitted?: readonly string[];
  readonly winners: ReadonlyMap<string, ToolParty>;
  readonly winningTools: ReadonlyMap<string, Tool>;
  readonly claimants?: ReadonlyMap<string, readonly ToolClaim[]>;
  readonly hiddenSkillIds?: readonly string[];
  readonly discovered?: DiscoveryOmissions;
}

/** Join the actual pick to the original merge winners. This is a slot fact until an accepted request attests it. */
function slotSelection(input: SlotCommit): SlotSelection | undefined {
  const { iteration, discovered, omitted, claimants } = input;
  if (!claimants || discovered?.complete === false)
    return discovered && { iteration, ...discovered };
  const rows: SelectionRow[] = [...(discovered?.rows ?? [])];
  for (const { name, winner, competing } of input.collisions ?? []) {
    if (!winner.tool) continue;
    for (const loser of competing) {
      if (!loser.tool) continue;
      if (rows.length === MAX_SELECTION_ROWS) return { iteration, rows, complete: false };
      rows.push({
        kind: 'collision',
        name,
        tool: loser.tool,
        party: loser.party,
        winner: { tool: winner.tool, party: winner.party },
      });
    }
  }
  const hidden = input.hiddenSkillIds && new Set(input.hiddenSkillIds);
  for (const name of omitted ?? []) {
    const tool = input.winningTools.get(name);
    const party = input.winners.get(name);
    if (!tool || !party) continue;
    const claims = claimants.get(name);
    if (
      party.channel === 'skill' &&
      (party.id === undefined ||
        !hidden ||
        hidden.has(party.id) ||
        !claims?.some((c) => c.channel === 'skill' && c.id === party.id && c.tool === tool))
    )
      continue;
    if (!visibleToolClaim(claims, tool, hidden)) continue;
    if (rows.length === MAX_SELECTION_ROWS) return { iteration, rows, complete: false };
    rows.push({ kind: 'top-N', name, tool, party });
  }
  return rows.length ? { iteration, rows, complete: true } : undefined;
}

export function commitServedTools(servedTools: ServedToolParties, input: SlotCommit): void {
  const { winners, narrowedTo, iteration } = input;
  // Dispatch follows the OFFER: a name narrowed off this epoch's wire
  // was not served, so it is not on `current` and takes the off-wire
  // path (`toolResolver.ts · buildToolResolver`) — answered by the party the
  // model last read it under, and recorded as `tools.answered_off_wire`.
  const wireWinners =
    narrowedTo === undefined
      ? winners
      : new Map([...winners].filter(([name]) => narrowedTo.has(name)));
  servedTools.current = wireWinners;
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
  const selection = slotSelection(input);
  if (selection) servedTools.selection = selection;
  else delete servedTools.selection;
}
