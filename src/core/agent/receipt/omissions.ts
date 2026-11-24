import type { AttemptRef } from 'footprintjs';

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
  /** Additional visible entries could not be retained within the turn or label budget. */
  readonly bounded?: true;
}
