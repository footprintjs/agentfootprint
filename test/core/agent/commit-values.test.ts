/**
 * #13c-B adoption — the Agent's executor defaults to `commitValues: 'delta'`
 * (the accepted design: the history-append workload is exactly what the
 * append verb exists for; reconstruction stays lossless via commitValueAt).
 */
import { describe, expect, it } from 'vitest';
import { commitValueAt } from 'footprintjs/trace';

import { Agent, defineTool, mock } from '../../../src/index.js';

function tickingProvider(turns: number) {
  let calls = 0;
  return mock({
    respond: () => {
      calls++;
      if (calls <= turns) {
        return {
          content: `step ${calls}`,
          toolCalls: [{ id: `c${calls}`, name: 'tick', args: {} }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use' as const,
        };
      }
      return {
        content: 'done',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn' as const,
      };
    },
  });
}

const tick = defineTool({
  name: 'tick',
  description: 'count a step',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'tock',
});

describe('#13c-B — Agent commitValues default', () => {
  it("defaults to 'delta': snapshot says so and history commits record tails, losslessly", async () => {
    const agent = Agent.create({ provider: tickingProvider(3), model: 'mock', maxIterations: 10 })
      .tool(tick)
      .build();
    await agent.run({ message: 'go' });
    const snapshot = agent.getSnapshot();
    expect(snapshot?.commitValues).toBe('delta');

    // Lossless reconstruction: the LAST history-touching commit's full value
    // via commitValueAt equals the live final history length.
    const log = snapshot!.commitLog;
    const historyTouches = log
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.trace.some((t) => t.path.endsWith('history')));
    expect(historyTouches.length).toBeGreaterThan(2);
    const last = historyTouches[historyTouches.length - 1];
    const key = last.b.trace.find((t) => t.path.endsWith('history'))!.path;
    const reconstructed = commitValueAt(log, last.i, key) as unknown[];
    expect(Array.isArray(reconstructed)).toBe(true);
    // At least one history commit is an APPEND (the tail-only encoding).
    const verbs = historyTouches.flatMap(({ b }) =>
      b.trace.filter((t) => t.path.endsWith('history')).map((t) => t.verb),
    );
    expect(verbs).toContain('append');
  });

  it("commitValues: 'full' override is honored", async () => {
    const agent = Agent.create({
      provider: tickingProvider(2),
      model: 'mock',
      maxIterations: 10,
      commitValues: 'full',
    })
      .tool(tick)
      .build();
    await agent.run({ message: 'go' });
    expect(agent.getSnapshot()?.commitValues).toBe('full');
  });
});
