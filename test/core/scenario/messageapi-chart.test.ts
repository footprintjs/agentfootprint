/**
 * messageapi-chart.test.ts
 *
 * Proves Step 1 of the locked messageAPI merge-tree design (LLM-only):
 * Context (selector) → [sf-system-prompt, sf-messages] → messageAPI → Call-LLM.
 *
 * The keystone checks:
 *   - the chart runs end-to-end and returns the LLM answer;
 *   - the Context SELECTOR picks + runs BOTH slot subflows (the branches
 *     converge into messageAPI);
 *   - the slots are REAL subflows (sf-system-prompt / sf-messages fire);
 *   - messageAPI assembles the request bulk (system from the prompt slot,
 *     messages from history) BEFORE Call-LLM sends it.
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder, FlowSubflowEvent } from 'footprintjs';
import { FlowChartExecutor } from 'footprintjs';
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function subflowSpy(): { recorder: CombinedRecorder; entries: string[] } {
  const entries: string[] = [];
  const recorder: CombinedRecorder = {
    id: 'test.msgapi-spy',
    onSubflowEntry(e: FlowSubflowEvent): void {
      if (e.subflowId) entries.push(e.subflowId);
    },
  };
  return { recorder, entries };
}

describe('messageAPI merge-tree chart (LLM-only)', () => {
  it('functional: runs end-to-end and returns the LLM answer', async () => {
    const chart = buildMessageApiChart({
      provider: new MockProvider({ reply: 'Paris is the capital of France.' }) as never,
      model: 'mock',
      systemPrompt: 'You are a geography tutor.',
    });
    const executor = new FlowChartExecutor(chart);
    await executor.run({ input: { message: 'capital of France?' } });

    const answer = (executor.getSnapshot()?.sharedState as { answer?: string } | undefined)?.answer;
    expect(answer).toBe('Paris is the capital of France.');
  });

  it('keystone: the Context selector runs BOTH slot subflows (they converge into messageAPI)', async () => {
    const chart = buildMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 'sys',
    });
    const executor = new FlowChartExecutor(chart);
    const spy = subflowSpy();
    executor.attachCombinedRecorder(spy.recorder);

    await executor.run({ input: { message: 'hi' } });

    // Both slot subflows fired — the selector picked both.
    expect(spy.entries).toContain('sf-system-prompt');
    expect(spy.entries).toContain('sf-messages');
  });

  it('integration: messageAPI assembles system (from the prompt slot) + messages (from history)', async () => {
    const chart = buildMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 'You are helpful.',
    });
    const executor = new FlowChartExecutor(chart);
    await executor.run({ input: { message: 'hello there' } });

    const state = executor.getSnapshot()?.sharedState as {
      assembledSystem?: string;
      assembledMessages?: readonly { role: string; content: string }[];
    };
    // messageAPI pulled the system prompt out of the system-prompt slot…
    expect(state.assembledSystem).toBe('You are helpful.');
    // …and the conversation out of history (the user's message).
    expect(state.assembledMessages?.[0]?.content).toBe('hello there');
    expect(state.assembledMessages?.[0]?.role).toBe('user');
  });

  it('structure: the build-time chart has a selector node + messageAPI + call-llm stages', () => {
    const chart = buildMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 's',
    });
    // Serialize the build-time structure and assert the tree shape exists.
    const json = JSON.stringify(chart.buildTimeStructure);
    expect(json).toContain('"type":"selector"');
    expect(json).toContain('message-api');
    expect(json).toContain('call-llm');
    expect(json).toContain('sf-system-prompt');
    expect(json).toContain('sf-messages');
  });
});
