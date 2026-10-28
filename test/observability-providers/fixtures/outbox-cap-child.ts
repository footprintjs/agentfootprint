/**
 * Run in a SEPARATE process by outbox-bounds.test.ts.
 *
 * For each cap that cannot take an item (0, NaN, -1), two ways in:
 *
 *   - `xray`   — `xrayObservability({ maxBatchSegments })`, one closed turn,
 *                `flush()`: the user's path. Before the shared queue this sent
 *                empty puts in a loop.
 *   - `outbox` — `createOutbox` directly, one item, `drain()`: the guard's path.
 *
 * Each must either REFUSE at construction or RETURN. If it spins instead, the
 * spin starves an in-process test's own timeout — which is why this runs in a
 * child the test can kill.
 *
 * Prints one JSON line: `{ "xray 0": "refused" | "returned", … }`.
 */

import { createOutbox } from '../../../src/adapters/observability/outbox.js';
import { xrayObservability } from '../../../src/adapters/observability/xray.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

type Outcome = 'refused' | 'returned';

const turnEvent = (type: string): AgentfootprintEvent =>
  ({ type, payload: {}, meta: { runId: 'r' } } as unknown as AgentfootprintEvent);

async function throughXray(cap: number): Promise<Outcome> {
  let strategy;
  try {
    strategy = xrayObservability({
      serviceName: 'svc',
      maxBatchSegments: cap,
      flushIntervalMs: 0,
      _client: { putTraceSegments: () => Promise.resolve() },
    });
  } catch {
    return 'refused';
  }
  strategy.exportEvent(turnEvent('agentfootprint.agent.turn_start'));
  strategy.exportEvent(turnEvent('agentfootprint.agent.turn_end'));
  await strategy.flush?.();
  return 'returned';
}

async function throughOutbox(cap: number): Promise<Outcome> {
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

const outcomes: Record<string, Outcome> = {};
for (const cap of [0, Number.NaN, -1]) {
  outcomes[`xray ${String(cap)}`] = await throughXray(cap);
  outcomes[`outbox ${String(cap)}`] = await throughOutbox(cap);
}
process.stdout.write(`${JSON.stringify(outcomes)}\n`);
