/**
 * The one-past law, demonstrated in the GROUPED chart shape.
 *
 * ── Why this shape gets its own test ─────────────────────────────────
 * `reactMode: 'dynamic-grouped'` wraps the whole LLM turn in an `sf-llm-call`
 * subflow, and until 7.21.0 `history` crossed that boundary as a READ-ONLY
 * input: it went in through the inputMapper, no stage inside could write it
 * (`ScopeFacade.setValue` throws on an inputMapper key), and it was not in the
 * outputMapper. Delivery had to write it, so `history` now takes the same
 * `prior*` round-trip the token accumulators take — in as `priorHistory`,
 * seeded to a writable key, bubbled back out.
 *
 * That makes this the first release in which a stage inside `sf-llm-call`
 * edits the window, which is precisely the thing worth pinning: the window
 * that iteration N SENT has to be the window iteration N+1 CONTINUES. If the
 * bubble-out were dropped, delivery would appear to work (the request carries
 * it) while the outer scope silently kept the pre-delivery window — the model
 * and the recording would diverge across the boundary, one iteration late.
 *
 * Test types (Convention 3): integration (grouped chart × delivery × the
 * ReAct loop) / regression (the boundary round-trip) / functional.
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { defineFact } from '../../../src/injection-engine.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';

function scriptedProvider(replies: readonly Partial<LLMResponse>[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  let i = 0;
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const next = replies[Math.min(i, replies.length - 1)] ?? {};
      i++;
      return Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
        ...next,
      } as LLMResponse);
    },
  };
  return { provider, requests };
}

const weather = defineTool({
  name: 'weather',
  description: 'Look up the weather.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => Promise.resolve('sunny'),
});

describe('grouped chart — the window that was sent is the window that continues', () => {
  it('bubbles a delivery out of sf-llm-call so the next iteration extends it', async () => {
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({
      provider,
      model: 'm',
      maxIterations: 4,
      reactMode: 'dynamic-grouped',
    })
      .system('bot')
      .tool(weather)
      .fact(
        defineFact({ id: 'tier', data: 'Account tier: gold', slot: 'messages', role: 'assistant' }),
      )
      .build();

    expect(await agent.run({ message: 'is it raining?' })).toBe('done');

    // Iteration 1 delivered it.
    expect(requests[0]!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'is it raining?'],
      ['assistant', 'Account tier: gold'],
    ]);

    // Iteration 2 CONTINUES that window rather than rebuilding the one from
    // before delivery: the delivered message is still there, in place, and the
    // tool round-trip is appended after it.
    const second = requests[1]!.messages;
    expect(second[0]!.content).toBe('is it raining?');
    expect(second[1]!.content).toBe('Account tier: gold');
    expect(second.length).toBeGreaterThan(2);
    // Delivered ONCE — the ledger round-tripped too, so the second pass knows.
    expect(second.filter((m) => m.content === 'Account tier: gold')).toHaveLength(1);

    // And the committed OUTER window agrees with what was sent — this is the
    // half that a dropped outputMapper entry would silently break.
    const state = agent.getSnapshot()?.sharedState as {
      history?: readonly LLMMessage[];
      messagesDelivery?: { delivered: readonly { injectionId: string }[] };
    };
    expect(state.history!.some((m) => m.injectedBy?.injectionId === 'tier')).toBe(true);
    expect(state.history!.map((m) => m.content).slice(0, 2)).toEqual([
      'is it raining?',
      'Account tier: gold',
    ]);
  });

  it('surfaces the delivery record where its own docs say to look', async () => {
    // `messagesDelivery` documents itself as readable from
    // `snapshot.sharedState` — which is the OUTER scope. In this shape the
    // stage that writes it runs INSIDE sf-llm-call, so the record has to be
    // bubbled like `history` and the ledger are. A record that exists only
    // inside the subflow answers the question everywhere except where the
    // library tells you to ask it.
    const { provider } = scriptedProvider([{ content: 'done' }]);
    const agent = Agent.create({
      provider,
      model: 'm',
      maxIterations: 2,
      reactMode: 'dynamic-grouped',
    })
      .system('bot')
      .fact(
        defineFact({ id: 'tier', data: 'Account tier: gold', slot: 'messages', role: 'assistant' }),
      )
      .build();

    await agent.run({ message: 'hi' });
    const delivery = (
      agent.getSnapshot()?.sharedState as {
        messagesDelivery?: { delivered: readonly { injectionId: string; wireIndex: number }[] };
      }
    )?.messagesDelivery;
    expect(delivery).toBeDefined();
    expect(delivery!.delivered.map((d) => d.injectionId)).toEqual(['tier']);
  });

  it('refuses an uncarriable role at run start in this shape too', async () => {
    const { provider, requests } = scriptedProvider([{ content: 'done' }]);
    const agent = Agent.create({
      provider,
      model: 'm',
      maxIterations: 2,
      reactMode: 'dynamic-grouped',
    })
      .system('bot')
      .fact(defineFact({ id: 'tier', data: 'gold', slot: 'messages', role: 'system' }))
      .build();

    await expect(agent.run({ message: 'hi' })).rejects.toThrow(
      /which carries `user` and `assistant`/,
    );
    expect(requests).toHaveLength(0);
  });
});
