import { expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import { defineTool } from '../../../../tools/tools.js';
import type { AgentState } from '../../types.js';
import { recordToolSelection } from './recordToolSelection.js';

const consumer = { series: 'native-call', attempt: 1 };
const tool = defineTool({
  name: 'fixture',
  description: 'private description',
  execute: () => 'ok',
});
const preparation = { boundary: 'provider-adapter', phase: 'prepared', omittedBlocks: 1 } as const;

function step(names: string[], budget: { remainingToolOmissions?: number }, receiptEpoch = 1) {
  const scope = {
    receipt: { basis: { epoch: receiptEpoch }, replayPreparations: [preparation] },
  } as unknown as TypedScope<AgentState>;
  recordToolSelection(
    scope,
    { consumer, iteration: 1, rows: names.map((name) => ({ kind: 'ledger', name, tool })) },
    budget,
  );
  return scope.receipt;
}

it('spends one position per distinct name and decision, across the entire turn', () => {
  const budget = { remainingToolOmissions: 2 };
  expect(step(['first', 'first'], budget)?.toolSelection).toEqual({
    consumer,
    absent: [{ name: 'first', reason: 'ledger' }],
  });
  expect(step(['second', 'overflow'], budget)?.toolSelection).toEqual({
    consumer,
    absent: [{ name: 'second', reason: 'ledger' }],
    bounded: true,
  });
  expect(step(['third'], budget)?.toolSelection).toEqual({ consumer, absent: [], bounded: true });
  expect(budget.remainingToolOmissions).toBe(0);
});

it('preserves other receipt annotations and withholds rows with unknown headroom or a different epoch', () => {
  const budget = { remainingToolOmissions: 1 };
  expect(step(['one'], {})?.toolSelection).toBeUndefined();
  expect(step(['one'], budget, 2)?.toolSelection).toBeUndefined();
  expect(budget.remainingToolOmissions).toBe(1);
  const result = step(['深'.repeat(400), 'x'.repeat(1025), 'one'], budget);
  expect(result?.replayPreparations).toEqual([preparation]);
  expect(result?.toolSelection).toEqual({
    consumer,
    absent: [{ name: 'one', reason: 'ledger' }],
    bounded: true,
  });
  expect(JSON.stringify(result)).not.toContain('private description');
});
