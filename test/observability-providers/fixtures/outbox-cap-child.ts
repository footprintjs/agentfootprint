/**
 * Run in a SEPARATE process by outbox-bounds.test.ts.
 *
 * For each per-delivery cap that cannot take an item (0, NaN, -1), build an
 * outbox, accept one item and drain it. The outbox must either REFUSE the cap
 * at construction or have `drain()` RETURN. If it spins instead, the spin is a
 * microtask loop that would starve an in-process test's own timeout — which
 * is why this runs in a child the test can kill.
 *
 * Prints one JSON line: `{ "0": "refused" | "returned", … }`.
 */

import { createOutbox } from '../../../src/adapters/observability/outbox.js';

async function outcomeFor(cap: number): Promise<'refused' | 'returned'> {
  let outbox;
  try {
    outbox = createOutbox<string>({
      name: 'xray',
      maxItems: cap,
      maxItemsPerDelivery: cap,
      flushIntervalMs: 0,
      timerHoldsProcess: false,
      deliver: () => Promise.resolve(),
      dropped: () => new Error('dropped'),
      report: () => undefined,
    });
  } catch {
    return 'refused';
  }
  outbox.add('segment');
  await outbox.drain();
  return 'returned';
}

const outcomes: Record<string, string> = {};
for (const cap of [0, Number.NaN, -1]) outcomes[String(cap)] = await outcomeFor(cap);
process.stdout.write(`${JSON.stringify(outcomes)}\n`);
