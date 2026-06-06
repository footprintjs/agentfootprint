/**
 * agent-classic-react.test.ts
 *
 * Proves `reactMode: 'classic'` — textbook ReAct where context is engineered
 * ONCE and only the messages rebuild each turn — vs the default `'dynamic'`,
 * where all three slots (system-prompt ‖ messages ‖ tools) are re-engineered
 * every turn.
 *
 * The chart is IDENTICAL in both modes (same loop → InjectionEngine, same
 * Context selector with the 3 slot branches — so the slots stay drawn). The
 * WHOLE difference is what the Context selector SELECTS each turn:
 *   • dynamic — all 3 slots, every turn.
 *   • classic — all 3 on turn 1; only Messages afterwards. The static slots'
 *     turn-1 outputs persist in scope (the flat builder has no per-turn reset),
 *     so skipping them reuses (caches) them — only the message list rebuilds.
 *
 * 7-pattern coverage:
 *   • Unit (back-compat) — default mode is Dynamic; loop target unchanged.
 *   • Unit (structure) — Classic keeps the SAME chart: tool-calls still loops to
 *     the InjectionEngine, and the Context selector + 3 slot branches still exist.
 *   • Functional — a Classic agent runs to completion through a tool call.
 *   • Integration (multi-iter, THE difference) — Classic re-runs ONLY Messages
 *     each turn; system-prompt + tools run exactly once. Dynamic re-runs all.
 *   • Property (parity) — Classic and Dynamic produce the IDENTICAL answer for a
 *     static agent.
 *   • Robustness — Classic tool askHuman pauses + resumes.
 *   • Discoverability — the chart description tags the mode for the Lens.
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder, FlowSubflowEvent } from 'footprintjs';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { defineTool } from '../../../src/core/tools.js';
import { askHuman, isPaused } from '../../../src/core/pause.js';

/** A tool the LLM can call, to drive the ReAct loop for >1 iteration. */
const weatherTool = defineTool({
  name: 'get_weather',
  description: 'weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  execute: () => '{"temp":72}',
});

/** Count subflow-body entries per subflowId — proves which slots re-run. */
function subflowEntryCounter(): { recorder: CombinedRecorder; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const recorder: CombinedRecorder = {
    id: 'test.classic.sf-count',
    onSubflowEntry(event: FlowSubflowEvent): void {
      if (event.subflowId) counts.set(event.subflowId, (counts.get(event.subflowId) ?? 0) + 1);
    },
  };
  return { recorder, counts };
}

type SpecNode = {
  id?: string;
  name?: string;
  loopTarget?: string;
  hasSelector?: boolean;
  children?: SpecNode[];
  next?: SpecNode;
  subflowStructure?: SpecNode;
};
function findById(node: SpecNode | undefined, id: string): SpecNode | undefined {
  if (!node) return undefined;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return findById(node.next, id) ?? findById(node.subflowStructure, id);
}

/** A 3-LLM-turn script: two tool calls, then a final answer. */
const twoToolCallScript = () =>
  new MockProvider({
    replies: [
      { toolCalls: [{ id: 'c1', name: 'get_weather', args: { city: 'A' } }] },
      { toolCalls: [{ id: 'c2', name: 'get_weather', args: { city: 'B' } }] },
      { content: 'final' },
    ],
  });

describe('Agent reactMode — Classic caches static slots; Dynamic re-engineers them', () => {
  it('unit (back-compat): default mode is Dynamic — tool-calls loops to the InjectionEngine', () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'done' }) as never, model: 'm' })
      .system('bot')
      .tool(weatherTool)
      .build();
    const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;
    expect(findById(root, 'tool-calls')!.loopTarget).toBe('sf-injection-engine');
  });

  it('unit (structure): Classic keeps the SAME chart — same loop target + the Context selector with all 3 slot branches', () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'done' }) as never,
      model: 'm',
      reactMode: 'classic',
    })
      .system('bot')
      .tool(weatherTool)
      .build();
    const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;

    // Same loop shape as Dynamic — Classic is NOT a chart restructure.
    expect(findById(root, 'tool-calls')!.loopTarget).toBe('sf-injection-engine');
    expect(findById(root, 'sf-route')!.loopTarget).toBeUndefined();

    // The Context selector + all 3 slot branches are still present (so they
    // stay drawn in both modes — Classic just won't re-SELECT the static ones).
    const ctx = findById(root, 'context');
    expect(ctx?.hasSelector).toBe(true);
    expect(findById(root, 'sf-system-prompt')).toBeDefined();
    expect(findById(root, 'sf-messages')).toBeDefined();
    expect(findById(root, 'sf-tools')).toBeDefined();
  });

  it('functional: a Classic agent runs to completion through a tool call', async () => {
    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'get_weather', args: { city: 'NYC' } }] },
        { content: 'It is 72°F in NYC.' },
      ],
    });
    const agent = Agent.create({ provider: provider as never, model: 'm', reactMode: 'classic' })
      .system('bot')
      .tool(weatherTool)
      .build();

    const answer = await agent.run({ message: 'weather in NYC?' });
    expect(answer).toBe('It is 72°F in NYC.');
  });

  it('integration (THE difference): Classic re-runs ONLY Messages each turn; system-prompt + tools run once', async () => {
    const { recorder, counts } = subflowEntryCounter();
    const agent = Agent.create({ provider: twoToolCallScript() as never, model: 'm', reactMode: 'classic' })
      .system('bot')
      .tool(weatherTool)
      .build();
    agent.attach(recorder as never);

    await agent.run({ message: 'go' }); // 3 LLM turns

    // Messages rebuilds every turn; the static slots are engineered exactly once.
    expect(counts.get('sf-messages')).toBe(3);
    expect(counts.get('sf-system-prompt')).toBe(1);
    expect(counts.get('sf-tools')).toBe(1);
  });

  it('integration (contrast): Dynamic re-runs ALL three slots every turn', async () => {
    const { recorder, counts } = subflowEntryCounter();
    const agent = Agent.create({ provider: twoToolCallScript() as never, model: 'm' /* dynamic default */ })
      .system('bot')
      .tool(weatherTool)
      .build();
    agent.attach(recorder as never);

    await agent.run({ message: 'go' }); // 3 LLM turns

    expect(counts.get('sf-messages')).toBe(3);
    expect(counts.get('sf-system-prompt')).toBe(3);
    expect(counts.get('sf-tools')).toBe(3);
  });

  it('property (parity): Classic and Dynamic give the IDENTICAL answer for a static agent', async () => {
    const script = () =>
      new MockProvider({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'get_weather', args: { city: 'NYC' } }] },
          { content: 'It is 72°F in NYC.' },
        ],
      });

    const classic = await Agent.create({ provider: script() as never, model: 'm', reactMode: 'classic' })
      .system('bot')
      .tool(weatherTool)
      .build()
      .run({ message: 'weather?' });

    const dynamic = await Agent.create({ provider: script() as never, model: 'm', reactMode: 'dynamic' })
      .system('bot')
      .tool(weatherTool)
      .build()
      .run({ message: 'weather?' });

    expect(classic).toBe(dynamic);
  });

  it('robustness: a Classic tool askHuman pauses and resumes correctly', async () => {
    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'approve_action', args: { action: 'delete' } }] },
        { content: 'approved and done' },
      ],
    });
    const approvalTool = defineTool({
      name: 'approve_action',
      description: 'Request human approval',
      inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
      execute: () => {
        askHuman({ question: 'Approve?' });
      },
    });
    const agent = Agent.create({ provider: provider as never, model: 'm', reactMode: 'classic' })
      .tool(approvalTool)
      .build();

    const result = await agent.run({ message: 'delete the thing' });
    expect(isPaused(result)).toBe(true);
    if (!isPaused(result)) throw new Error('expected pause');

    const finalAnswer = await agent.resume(result.checkpoint, 'yes, approved');
    expect(finalAnswer).toBe('approved and done');
  });

  it('discoverability: the chart description tags the mode for the Lens', () => {
    const classic = Agent.create({
      provider: new MockProvider({ reply: 'done' }) as never,
      model: 'm',
      reactMode: 'classic',
    })
      .system('bot')
      .build();
    const dynamic = Agent.create({ provider: new MockProvider({ reply: 'done' }) as never, model: 'm' })
      .system('bot')
      .build();

    const descOf = (a: typeof classic) =>
      (a.getSpec().buildTimeStructure as unknown as { description?: string }).description ?? '';
    expect(descOf(classic)).toContain('Agent:'); // taxonomy prefix preserved
    expect(descOf(classic)).toContain('Classic');
    expect(descOf(dynamic)).toContain('Agent:');
    expect(descOf(dynamic)).not.toContain('Classic');
  });
});
