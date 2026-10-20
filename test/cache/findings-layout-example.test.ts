import { expect, it } from 'vitest';
import { run } from '../../examples/features/105-findings-stable-cache-layout.js';
it('runs the documented findings layout without network or paid cache claims', async () => {
  expect(await run()).toEqual({
    calls: 3,
    stableTools: true,
    stableSystem: true,
    beforeData: true,
    liveCalls: 0,
    cacheSavings: 'not measured',
  });
});
