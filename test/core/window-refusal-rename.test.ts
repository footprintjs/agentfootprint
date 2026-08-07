/**
 * `replacement-not-smaller` — the refusal reason renamed (8.14.0).
 *
 * `slidingWindow` and `tokenBudget` never call a summarizer. They cannot: a
 * drop makes no LLM call at all. And through 8.13.0 both of them reported
 *
 *     { reason: 'summary-not-smaller' }
 *
 * whenever the authored drop NOTICE came back no smaller than the turns it
 * would replace — naming a summary that does not exist anywhere on that path,
 * in a record whose entire job is to say truthfully why nothing left the
 * window.
 *
 * The type's own docstring already described the general case ("the
 * REPLACEMENT came back no smaller than the span it would replace"). Only the
 * name lagged. A runtime from 8.14.0 writes the new string and never the old
 * one; the old member survives in the union so 7.17–8.13 code still narrows.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, slidingWindow, tokenBudget } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';

/** Tool results short enough that the authored notice is the bigger string. */
const tiny = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'ok',
} as never);

function chatty(toolCallsUntil: number, inputTokens: number): LLMProvider {
  let call = 0;
  return {
    name: 'main',
    complete: async (): Promise<LLMResponse> => {
      call++;
      const wantsTool = call <= toolCallsUntil;
      return {
        content: wantsTool ? '' : 'FINAL',
        toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
        usage: { input: inputTokens, output: 5 },
        stopReason: 'end_turn',
      };
    },
  };
}

function reasonsOf(agent: Agent): string[] {
  const records = ((agent.getLastSnapshot()?.sharedState as { compactions?: WindowRecord[] })
    ?.compactions ?? []) as WindowRecord[];
  return records.flatMap((r) => r.refusals.map((x) => x.reason));
}

describe('drop strategies never name a summary they do not have', () => {
  it('slidingWindow reports replacement-not-smaller, never summary-not-smaller', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: chatty(4, 10), model: 'm' })
      .tool(tiny as never)
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    const reasons = reasonsOf(agent);
    expect(reasons).toContain('replacement-not-smaller');
    expect(reasons).not.toContain('summary-not-smaller');
  });

  it('tokenBudget does the same', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: chatty(4, 5000), model: 'm' })
      .tool(tiny as never)
      .window(tokenBudget({ thresholdTokens: 10, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    const reasons = reasonsOf(agent);
    expect(reasons).toContain('replacement-not-smaller');
    expect(reasons).not.toContain('summary-not-smaller');
  });

  it('no shipped strategy writes the old string anywhere in a run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: chatty(4, 5000), model: 'm' })
      .tool(tiny as never)
      .window(tokenBudget({ thresholdTokens: 10, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    // Both names are never written. One fact, one spelling — the deprecated
    // member is a TYPE affordance for old readers, not a second wire value.
    const serialized = JSON.stringify(agent.getLastSnapshot()?.sharedState ?? {});
    expect(serialized).not.toContain('summary-not-smaller');
  });

  it('the other refusal reasons are untouched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({ provider: chatty(4, 5000), model: 'm' })
      .tool(tiny as never)
      .window(tokenBudget({ thresholdTokens: 10, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
    await agent.run({ message: 'hi' });

    expect(reasonsOf(agent)).toContain('inside-keep-window');
  });
});
