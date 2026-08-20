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
 *
 * ## 9.57.0 narrowed WHEN it fires, and these fixtures moved with it
 *
 * The first two cases used to reach this refusal through an ordinary agent
 * run — `keepRecentTurns: 1`, tiny tool results, the request pinned at the
 * head. That turned out to be the defect, not the feature: the notice was
 * being authored (and its size allowed to veto the drop) even though the
 * message that would become the head was the request itself, already a user
 * turn, so the wire needed nothing. See `window-drop-ladder.test.ts`.
 *
 * The refusal is still real, and still correct, in the shape it was always
 * about: the removal would leave an ASSISTANT at the head, so a notice IS
 * owed, and none of them is smaller than the span. That is what these two now
 * exercise — through the same shared mechanic (`dropOldestSpan`), which is why
 * both strategies still have to be checked.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, slidingWindow, tokenBudget } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMMessage, LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';
import { answeredCallIds, planRemoval, segmentTurns } from '../../src/core/agent/window/turns.js';
import { removalFacts } from '../../src/core/agent/window/removal.js';
import type { WindowStrategyInput } from '../../src/core/agent/window/strategy.js';

/**
 * A window the wire really does need a notice for: no user message anywhere,
 * so removing the oldest turn leaves an assistant at the head. The oldest
 * turn is two characters, so no notice can be smaller than it.
 */
const WIRE_OWED: readonly LLMMessage[] = [
  { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'look', args: {} }] },
  { role: 'tool', content: 'ok', toolCallId: 'a1', toolName: 'look' },
  { role: 'assistant', content: 'thinking about it' },
  { role: 'assistant', content: 'still thinking' },
  { role: 'assistant', content: 'the latest thing said' },
];

function inputFor(history: readonly LLMMessage[]): WindowStrategyInput {
  const turns = segmentTurns(history);
  const origins = history.map((_, i) => ({ stageId: `tool-calls#${i}`, bornAtMs: 0 }));
  return {
    history,
    turns,
    measured: { input: 999_999, output: 10 },
    iteration: 4,
    runId: 'run-1',
    agentModel: 'm',
    providerName: 'mock',
    signal: undefined,
    now: () => 1_000,
    planRemoval: (keep, isExistingSummary) =>
      planRemoval(turns, keep, { answeredCallIds: answeredCallIds(history) }, isExistingSummary),
    removalFacts: (indices, at) => removalFacts(origins, indices, at),
  };
}

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
    const res = await slidingWindow({ keepRecentTurns: 2 }).plan(inputFor(WIRE_OWED));
    const reasons = (res?.record.refusals ?? []).map((r) => r.reason);
    expect(res?.record.removedMessageCount).toBe(0);
    expect(reasons).toContain('replacement-not-smaller');
    expect(reasons).not.toContain('summary-not-smaller');
  });

  it('tokenBudget does the same', async () => {
    const res = await tokenBudget({ thresholdTokens: 10, keepRecentTurns: 2 }).plan(
      inputFor(WIRE_OWED),
    );
    const reasons = (res?.record.refusals ?? []).map((r) => r.reason);
    expect(res?.record.removedMessageCount).toBe(0);
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
