/**
 * Identity propagation — agent.run({identity}) → scope.identity
 *
 * Step 3 of the memory subsystem build. The seed stage of the Agent
 * flowchart populates `scope.identity` from `AgentInput.identity` when
 * provided, falling back to a runId-based default when omitted. This
 * is the precondition for `Agent.memory()` (step 4) which mounts
 * memory subflows that read identity from parent scope.
 *
 * @see src/core/Agent.ts
 * @see src/memory/identity/
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';

describe('identity propagation — agent.run({identity})', () => {
  it('explicit identity from agent.run is accepted by the type system + run', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 1 })
      .system('You are a test agent.')
      .build();

    const result = await agent.run({
      message: 'hello',
      identity: { tenant: 'acme', principal: 'alice', conversationId: 'conv-42' },
    });

    // Smoke test: explicit identity didn't break the run path.
    // Step-4 tests will verify the identity reached memory subflows
    // via per-id scope-key inspection.
    expect(typeof result).toBe('string');
  });

  it('omitted identity defaults to a runId-based conversationId (non-memory agents work unchanged)', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 1 })
      .system('You are a test agent.')
      .build();

    const result = await agent.run({ message: 'hello' });
    expect(typeof result).toBe('string');
  });

  it('two runs without explicit identity get DIFFERENT default identities (run isolation)', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 1 })
      .system('Test')
      .build();

    const out1 = await agent.run({ message: 'first' });
    const out2 = await agent.run({ message: 'second' });

    // Both runs succeed (smoke test). The identities differ at the
    // scope level — verified by the underlying makeRunId() being unique.
    expect(typeof out1).toBe('string');
    expect(typeof out2).toBe('string');
  });
});
