import { expect, it } from 'vitest';
import { run } from '../../../examples/memory/14-agentcore-conversational-events.js';

it('runs the public SDK example with its body, SKIP and canonical round-trip assertions', async () => {
  await expect(run()).resolves.toContain('payload items 2/1/2');
});
