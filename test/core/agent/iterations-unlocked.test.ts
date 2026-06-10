/**
 * #16 — iterations unlocked. The silent clampIterations(50) existed because
 * footprintjs's recursion walled around iteration 71; footprintjs 9's
 * trampoline removed the wall, so the cap is gone and the Agent gives the
 * engine's loop-iteration limit headroom above its own budget.
 */

import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../../src/index.js';
import { clampIterations } from '../../../src/core/agent/validators.js';

describe('#16 — maxIterations unlocked (footprintjs 9 trampoline)', () => {
  it('clampIterations no longer caps at 50', () => {
    expect(clampIterations(200)).toBe(200);
    expect(clampIterations(1000)).toBe(1000);
    expect(clampIterations(0)).toBe(1); // lower bound stays
    expect(clampIterations(2.5)).toBe(1);
  });

  it('a 200-iteration agent run completes (was: clamp@50 + engine wall ≈71)', async () => {
    let toolRuns = 0;
    const tick = defineTool({
      name: 'tick',
      description: 'count a step',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        toolRuns++;
        return `tick ${toolRuns}`;
      },
    });
    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls < 200) {
          return {
            content: `step ${calls}`,
            toolCalls: [{ id: `c${calls}`, name: 'tick', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: 'done after 200',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 250 })
      .tools([tick])
      .build();
    const answer = await agent.run({ message: 'count to 200' });
    expect(String(answer)).toContain('done after 200');
    expect(toolRuns).toBe(199);
    expect(calls).toBe(200);
  }, 60_000);
});
