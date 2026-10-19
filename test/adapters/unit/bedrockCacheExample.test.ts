import { expect, it } from 'vitest';
import { run } from '../../../examples/features/102-bedrock-prompt-cache.js';

it('runs the documented Bedrock cache example entirely against scripted SDK responses', async () => {
  expect(await run('next step')).toEqual({
    mode: 'scripted-sdk',
    calls: 2,
    reads: 1200,
    liveAwsCalls: 0,
  });
});
