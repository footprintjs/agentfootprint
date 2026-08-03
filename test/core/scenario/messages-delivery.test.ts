/**
 * Messages-slot delivery, end to end (7.21.0).
 *
 * The wire-truth test pins the LAW (recorded ⇒ sent). This file pins the
 * MECHANISM around it — the parts that decide when a declaration lands, when
 * it waits, and how many times it lands at all:
 *
 *   • deferral — a colliding role waits, says why, delivers at the next
 *     boundary, and never reorders anything to make room;
 *   • once — an always-on injection is delivered ONCE, not re-appended every
 *     iteration;
 *   • replay — a run rebuilt from a checkpoint does not deliver twice, because
 *     the ledger is unioned with the markers already in the restored window;
 *   • the pair law — nothing lands between a tool_use and its tool_result.
 *
 * Test types (Convention 3): functional (real Agent runs, provider captured)
 * / regression (the 7.19.1 gap and the duplicate-on-replay hazard) /
 * integration (delivery × the ReAct loop × tool calls).
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { defineFact, defineInstruction } from '../../../src/injection-engine.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type { MessagesDelivery } from '../../../src/core/agent/delivery/types.js';

/** A provider that plays a script of replies and keeps every request. */
function scriptedProvider(replies: readonly Partial<LLMResponse>[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  let i = 0;
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      // Snapshot the message list per call — the request object itself is
      // rebuilt each iteration, but its arrays are live scope references.
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

function deliveryOf(agent: Agent): MessagesDelivery | undefined {
  return (agent.getSnapshot()?.sharedState as { messagesDelivery?: MessagesDelivery } | undefined)
    ?.messagesDelivery;
}

const weather = defineTool({
  name: 'weather',
  description: 'Look up the weather.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => Promise.resolve('sunny'),
});

describe('messages delivery — the sequence rule', () => {
  it('defers a colliding role with a named note, and never reorders', async () => {
    const { provider, requests } = scriptedProvider([{ content: 'done' }]);
    // Iteration 1's window is `[user]`, so a `user`-role injection has nowhere
    // to sit: two user turns in a row is what providers reject.
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('bot')
      .fact(
        defineFact({ id: 'nudge', data: 'PS: I am in a hurry', slot: 'messages', role: 'user' }),
      )
      .build();

    expect(await agent.run({ message: 'where is my order?' })).toBe('done');

    // Not sent — and not silently: the record says which injection waited and
    // why, in a sentence.
    expect(requests[0]!.messages).toEqual([{ role: 'user', content: 'where is my order?' }]);
    const delivery = deliveryOf(agent);
    expect(delivery?.delivered).toEqual([]);
    expect(delivery?.deferred).toHaveLength(1);
    expect(delivery!.deferred[0]!.injectionId).toBe('nudge');
    expect(delivery!.deferred[0]!.reason).toBe('role-collision');
    expect(delivery!.deferred[0]!.note).toContain('held back this iteration');
    expect(delivery!.deferred[0]!.note).toContain('`user`');
    // The note teaches the way out rather than leaving the reader guessing.
    expect(delivery!.deferred[0]!.note).toContain('use `assistant`');
  });

  it('an assistant role lands on the same window the user role could not', async () => {
    const { provider, requests } = scriptedProvider([{ content: 'done' }]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('bot')
      .instruction(
        defineInstruction({
          id: 'note',
          prompt: 'Noted: the customer is a premium member.',
          slot: 'messages',
          role: 'assistant',
        }),
      )
      .build();

    expect(await agent.run({ message: 'where is my order?' })).toBe('done');
    expect(requests[0]!.messages).toEqual([
      { role: 'user', content: 'where is my order?' },
      { role: 'assistant', content: 'Noted: the customer is a premium member.' },
    ]);
    const delivery = deliveryOf(agent);
    expect(delivery?.deferred).toEqual([]);
    expect(delivery!.delivered[0]).toMatchObject({
      injectionId: 'note',
      flavor: 'instructions',
      role: 'assistant',
      wireIndex: 1,
    });
  });

  it('delivers at a LATER boundary once the collision clears, still in order', async () => {
    // Turn 1 ends on the user's message (collision for a user role). After the
    // tool round-trip the window ends on tool results — which fold to `user`
    // too, so this one keeps deferring. An `assistant` note declared alongside
    // it lands immediately. Neither jumps the other: order is by declaration.
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 3 })
      .system('bot')
      .tool(weather)
      .fact(defineFact({ id: 'nudge', data: 'PS: hurry', slot: 'messages', role: 'user' }))
      .instruction(
        defineInstruction({
          id: 'ack',
          prompt: 'Checking the weather now.',
          slot: 'messages',
          role: 'assistant',
        }),
      )
      .build();

    expect(await agent.run({ message: 'is it raining?' })).toBe('done');

    // Iteration 1: `ack` lands after the user turn; `nudge` waits.
    expect(requests[0]!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'is it raining?'],
      ['assistant', 'Checking the weather now.'],
    ]);
    // Iteration 2: the tool round-trip is appended AFTER the delivered note —
    // nothing was moved to make room for anything.
    const second = requests[1]!.messages.map((m) => m.role);
    expect(second.slice(0, 2)).toEqual(['user', 'assistant']);
    expect(second).toContain('tool');
    // `ack` is delivered once, not once per iteration.
    expect(
      requests[1]!.messages.filter((m) => m.content === 'Checking the weather now.'),
    ).toHaveLength(1);
    // `nudge` still waits, and still says so.
    const delivery = deliveryOf(agent);
    expect(delivery!.deferred.map((d) => d.injectionId)).toEqual(['nudge']);
  });

  it('never lands between a tool_use and its tool_result', async () => {
    // The pausable tool path leaves the window holding an unanswered call.
    // Everything is refused there, whatever its role — the same unbreakable
    // pair the window family protects from the other side.
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 3 })
      .system('bot')
      .tool(weather)
      .instruction(
        defineInstruction({
          id: 'ack',
          prompt: 'Checking now.',
          slot: 'messages',
          role: 'assistant',
        }),
      )
      .build();

    await agent.run({ message: 'is it raining?' });
    // In every request, an assistant turn with toolCalls is immediately
    // followed by the tool result — nothing was inserted between them.
    for (const req of requests) {
      req.messages.forEach((m, i) => {
        if ((m.toolCalls?.length ?? 0) > 0) {
          expect(req.messages[i + 1]?.role, 'a message was inserted into a tool pair').toBe('tool');
        }
      });
    }
  });
});

describe('messages delivery — delivered once', () => {
  it('does not re-append an always-on injection every iteration', async () => {
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: '', toolCalls: [{ id: 'c2', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 5 })
      .system('bot')
      .tool(weather)
      .fact(
        defineFact({ id: 'ctx', data: 'Account tier: gold', slot: 'messages', role: 'assistant' }),
      )
      .build();

    expect(await agent.run({ message: 'is it raining?' })).toBe('done');
    expect(requests.length).toBeGreaterThanOrEqual(3);
    for (const req of requests) {
      expect(req.messages.filter((m) => m.content === 'Account tier: gold')).toHaveLength(1);
    }
    // Later iterations deliver nothing new — the ledger says it is already in.
    expect(deliveryOf(agent)!.delivered).toEqual([]);
  });

  it('keeps the keys it recovered from the window, even on an iteration that delivered nothing', async () => {
    // The ledger grows two ways: by delivering, and by RECOVERY — reading
    // markers out of a window a replay restored into a fresh scope. Persisting
    // only on the delivering branch would throw the recovered keys away every
    // pass until some unrelated injection happened to land, which would make
    // "is this already in?" depend on coincidence and let a later eviction
    // resurrect a message the run had already sent.
    const { provider } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 4 })
      .system('bot')
      .tool(weather)
      .fact(
        defineFact({ id: 'ctx', data: 'Account tier: gold', slot: 'messages', role: 'assistant' }),
      )
      .build();

    await agent.run({ message: 'is it raining?' });

    // Iteration 2 delivered nothing (the fact was already in). The ledger still
    // holds its key at the end of the run.
    const state = agent.getSnapshot()?.sharedState as {
      deliveredMessageKeys?: readonly string[];
      messagesDelivery?: { delivered: readonly unknown[] };
    };
    expect(state.messagesDelivery!.delivered).toEqual([]);
    expect(state.deliveredMessageKeys).toHaveLength(1);
  });

  it('a replayed run does not deliver a message that is already in the window', async () => {
    // THE replay hazard. `resumeOnError` restores the conversation into a
    // FRESH scope, so the run's delivery ledger is empty while the delivered
    // message is sitting right there in the restored history. A ledger-only
    // dedupe would append a second copy. Dedupe reads the window itself too,
    // so the resumed run recognises its own past.
    const { provider, requests } = scriptedProvider([{ content: 'done' }]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('bot')
      .fact(
        defineFact({ id: 'ctx', data: 'Account tier: gold', slot: 'messages', role: 'assistant' }),
      )
      .build();

    await agent.run({ message: 'hi' });
    expect(requests[0]!.messages.filter((m) => m.content === 'Account tier: gold')).toHaveLength(1);

    // The checkpoint carries the committed window — markers included, because
    // they are part of the state the run committed.
    const checkpoint = agent.checkpoint();
    expect(checkpoint).toBeDefined();
    expect(
      (checkpoint!.history as readonly { injectedBy?: unknown }[]).some(
        (m) => m.injectedBy !== undefined,
      ),
      'the delivery marker did not survive the checkpoint',
    ).toBe(true);

    expect(await agent.resumeOnError(checkpoint)).toBe('done');
    expect(
      requests[1]!.messages.filter((m) => m.content === 'Account tier: gold'),
      'the delivered message was duplicated on replay',
    ).toHaveLength(1);
  });
});
