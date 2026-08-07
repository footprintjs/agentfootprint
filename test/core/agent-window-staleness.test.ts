/**
 * A window strategy stands DOWN when the provider stops counting (8.14.0).
 *
 * Regression seed: the audit probe. A provider reports `{ input: 99999 }` on
 * call #1 and malformed usage on every call after. Through 8.13.0 the meter
 * kept handing 99999 back forever, and the window strategy went on evicting
 * real messages on it — iteration after iteration, from a count taken once,
 * before most of the conversation existed.
 *
 * "Counted, never guessed" has to mean counted RECENTLY, or it means counted
 * once and guessed thereafter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent, tokenBudget } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';

// `vi.spyOn` on an ALREADY-spied method hands back the existing spy, calls
// and all — so without this every test in the file would read the previous
// tests' warnings as its own.
afterEach(() => {
  vi.restoreAllMocks();
});

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  execute: () => `RESULT ${'x'.repeat(300)}`,
} as never);

/** Reports a huge count ONCE, then answers without counting. */
function goesDark(reportUntilCall: number, toolCallsUntil: number): LLMProvider {
  let call = 0;
  return {
    name: 'goes-dark',
    complete: async (): Promise<LLMResponse> => {
      call++;
      const wantsTool = call <= toolCallsUntil;
      return {
        content: wantsTool ? '' : 'FINAL',
        toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
        usage:
          call <= reportUntilCall
            ? { input: 99_999, output: 10 }
            : ({ input: undefined, output: undefined } as never),
        stopReason: 'end_turn',
      };
    },
  };
}

function recordsOf(agent: Agent): WindowRecord[] {
  return ((agent.getLastSnapshot()?.sharedState as { compactions?: WindowRecord[] })?.compactions ??
    []) as WindowRecord[];
}

describe('window strategies — a stale reading is no reading (8.14.0)', () => {
  it('does not decide twice on one count: no record quotes a number from a dead call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: goesDark(1, 3), model: 'm' })
      .tool(looker as never)
      .window(tokenBudget({ thresholdTokens: 1000, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();

    const answer = await agent.run({ message: 'hi' });
    expect(answer).toBe('FINAL');

    const records = recordsOf(agent) as (WindowRecord & { measuredTokens?: number })[];
    // Through 8.13.0 this produced THREE records at iterations 2, 3 and 4,
    // every one of them reading `measuredTokens: 99999` — one count, three
    // decisions, six evicted messages.
    const quoting = records.filter((r) => r.measuredTokens === 99_999);
    expect(quoting.length).toBeLessThanOrEqual(1);
  });

  it('nothing is evicted on a count that was never taken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: goesDark(1, 3), model: 'm' })
      .tool(looker as never)
      .window(tokenBudget({ thresholdTokens: 1000, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    const records = recordsOf(agent);
    // At most the ONE boundary that had a live reading may remove anything.
    const removing = records.filter((r) => r.removedMessageCount > 0);
    expect(removing.length).toBeLessThanOrEqual(1);
  });

  it('says so — once — instead of going quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: goesDark(1, 4), model: 'm' })
      .tool(looker as never)
      .window(tokenBudget({ thresholdTokens: 1000, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    // A strategy that silently declines at every boundary is indistinguishable
    // from a window that is simply under budget — which is why standing down
    // has to be audible.
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('stopped reporting token usage'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('token-budget');
    expect(lines[0]).toMatch(/standing down/);
  });

  it('a provider that keeps counting is completely unaffected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let call = 0;
    const healthy: LLMProvider = {
      name: 'healthy',
      complete: async (): Promise<LLMResponse> => {
        call++;
        const wantsTool = call <= 3;
        return {
          content: wantsTool ? '' : 'FINAL',
          toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
          usage: { input: 5000, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider: healthy, model: 'm' })
      .tool(looker as never)
      .window(tokenBudget({ thresholdTokens: 100, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    const records = recordsOf(agent);
    // Every boundary after the first has a live count, so every one of them
    // engages — the staleness stamp costs a healthy run nothing.
    expect(records.length).toBeGreaterThan(1);
    expect(records.some((r) => r.removedMessageCount > 0)).toBe(true);
  });
});
