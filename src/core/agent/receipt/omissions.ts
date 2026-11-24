import type { AttemptRef } from 'footprintjs';
import type { ToolNameChannel } from '../../../events/payloads.js';

/** What a budget dropped before the request was composed — the window's
 *  evictions at this iteration's head. */
export interface ReceiptAttentionOmission {
  readonly count: number;
  /** One hash per dropped turn — the turn's own `messages.entries[].hash`, so
   *  it pairs with the receipt that last served it. See the first law for why
   *  not the text. */
  readonly hashes: readonly string[];
}

export interface ReceiptToolSelection {
  readonly consumer: AttemptRef;
  readonly absent: readonly {
    readonly name: string;
    readonly reason: 'top-N' | 'skill-scope' | 'ledger';
  }[];
  /** One visible losing implementation per row in merge order. The winner offered
   * this name on the accepted request. Party channels describe roles, not durable IDs. */
  readonly shadowed?: readonly {
    readonly name: string;
    readonly wonBy: ToolNameChannel;
    readonly lostBy: ToolNameChannel;
  }[];
  /** Role-visible skill IDs excluded when the tree withheld its read_skill catalog.
   * Count covers the retained names within this request's shared omission budget. */
  readonly skillCatalog?: {
    readonly names: readonly string[];
    readonly count: number;
    readonly reason: 'tree-routed';
  };
  /** Additional visible entries could not be retained within the turn or label budget. */
  readonly bounded?: true;
}
