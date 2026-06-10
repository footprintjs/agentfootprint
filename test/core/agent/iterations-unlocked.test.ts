/**
 * #16 — iterations unlocked. The silent clampIterations(50) existed because
 * footprintjs's recursion walled around iteration 71; footprintjs 9's
 * trampoline removed the wall, so the cap is gone and the Agent gives the
 * engine's loop-iteration limit headroom above its own budget.
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  mock,
  defineTool,
  defineSkill,
  defineSteering,
  defineFact,
} from '../../../src/index.js';
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
    // #17 — the cross-repo limits test: a FULL-FEATURE agent (all three
    // context slots populated: steering→system-prompt, fact→system-prompt,
    // skill→tools) sustained for 200 iterations against the PINNED
    // footprintjs version. This test runs in CI on every build, so the two
    // libraries' limits stay co-engineered instead of drifting apart.
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 250 })
      .system('You are a counting agent.')
      .steering(defineSteering({ id: 'terse', prompt: 'Be terse.' }))
      .fact(defineFact({ id: 'env', data: 'Environment: test rig.' }))
      .skill(
        defineSkill({
          id: 'counting',
          description: 'How to count.',
          body: 'Use the tick tool repeatedly.',
          tools: [tick],
        }),
      )
      .build();
    const rssBefore = process.memoryUsage().rss;
    const answer = await agent.run({ message: 'count to 200' });
    const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024;
    expect(String(answer)).toContain('done after 200');
    expect(toolRuns).toBe(199);
    expect(calls).toBe(200);
    // Memory budget, re-derived 2026-06-10 against footprintjs 9.3.0
    // (#13b staging-release) + the Agent's readTracking 'summary' default:
    // worst observed RSS delta over 5 local runs was 210MB (was ~560MB+
    // retained heap pre-#13b, hence the old 1.5GB ceiling). Budget =
    // 1.6× worst observed ≈ 335MB, rounded up to 350MB for CI variance.
    // Residual growth is the #13c quadratic (commitLog + _stageWrites
    // clones) — if this trips after a footprintjs bump, re-measure with
    // a fresh bench run (see the readTracking measurement table in the
    // CHANGELOG) before raising.
    expect(rssDeltaMb).toBeLessThan(350);
  }, 60_000);
});
