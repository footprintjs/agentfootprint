/** Ask the installed native engine's public contract, without guessing from its version. */
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { stateAt } from 'foottrace';
import { expect } from 'vitest';

export async function nativeRetainsSafeBase(): Promise<boolean> {
  const executor = new FlowChartExecutor(
    flowChart('Untouched seed', () => {}, 'untouched').build(),
    {
      initialContext: { publicSeed: 'inherited public value', privateSeed: 'private-seed-fixture' },
    },
  );
  executor.setRedactionPolicy({ keys: ['privateSeed'] });
  await executor.run();
  const safe = executor.getSnapshot({ redact: true });
  expect(JSON.stringify(safe)).not.toContain('private-seed-fixture');
  expect(executor.getSnapshot().initialState).toEqual({
    publicSeed: 'inherited public value',
    privateSeed: 'private-seed-fixture',
  });
  if (safe.initialState === undefined) {
    expect(stateAt(safe, -1).basis).toBe('log-only');
    return false;
  }
  expect(safe.initialState).toEqual({
    publicSeed: 'inherited public value',
    privateSeed: 'REDACTED',
  });
  expect(stateAt(safe, -1).state).toEqual(safe.initialState);
  expect(stateAt(safe, -1).basis).toBe('initial+log');
  return true;
}
