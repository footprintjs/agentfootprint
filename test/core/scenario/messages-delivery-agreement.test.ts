/**
 * LAW: a delivered messages-slot injection says the same thing on every
 * surface that describes it.
 *
 * Extends the 7.20.0 agreement law (`memory-slot-truth.test.ts`) to the
 * content 7.21.0 delivers. Four surfaces, one truth:
 *   1. `context.injected` — the slot composer's record of the message;
 *   2. `messagesDelivery.delivered` — the delivery stage's own committed
 *      record, in `snapshot.sharedState` and therefore in the commit log;
 *   3. `scope.history` — the committed window;
 *   4. the captured `LLMRequest` — where the bytes actually went.
 *
 * The interesting agreements are the INDEX and the HASH. The index is what a
 * cache marker points at, so a delivery that reports position 3 while sitting
 * at position 2 makes every marker downstream a lie. The hash is what an
 * eviction will later name the same message by, so if delivery and the slot
 * hashed differently, "injected X" and "evicted X" would be different pieces
 * of context wearing one id.
 *
 * Test types (Convention 3): functional (a real Agent run) / integration
 * (three recorded surfaces × the wire) / security-adjacent (a recording that
 * disagrees with itself is evidence nobody can trust).
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js';
import { defineFact } from '../../../src/injection-engine.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import type { MessagesDelivery } from '../../../src/core/agent/delivery/types.js';

function capturingProvider(): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      return Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      } as LLMResponse);
    },
  };
  return { provider, requests };
}

interface InjectedPayload {
  readonly slot: string;
  readonly rawContent?: string;
  readonly contentHash: string;
  readonly position?: number;
  readonly source?: string;
  readonly sourceId?: string;
}

describe('messages delivery — one truth, four surfaces', () => {
  it('the injected event, the delivery commit, the window and the wire agree', async () => {
    const { provider, requests } = capturingProvider();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('bot')
      .fact(
        defineFact({
          id: 'tier',
          description: 'the customer tier the desk should assume',
          data: 'Account tier: gold',
          slot: 'messages',
          role: 'assistant',
        }),
      )
      .build();

    const injected: InjectedPayload[] = [];
    agent.on('agentfootprint.context.injected', (e) =>
      injected.push(e.payload as unknown as InjectedPayload),
    );

    expect(await agent.run({ message: 'where is my order?' })).toBe('ok');

    const state = agent.getSnapshot()?.sharedState as {
      messagesDelivery?: MessagesDelivery;
      history?: readonly LLMMessage[];
    };

    // ── Surface 2: the delivery stage's own record ───────────────────
    const delivery = state.messagesDelivery;
    expect(delivery?.delivered).toHaveLength(1);
    const row = delivery!.delivered[0]!;
    expect(row.injectionId).toBe('tier');
    expect(row.flavor).toBe('fact');
    expect(row.role).toBe('assistant');

    // ── Surface 3: the committed window, at the index the row claims ──
    const window = state.history!;
    expect(window[row.wireIndex]!.content).toBe('Account tier: gold');
    expect(window[row.wireIndex]!.injectedBy?.injectionId).toBe('tier');

    // ── Surface 4: the wire, at the SAME index ───────────────────────
    const wire = requests[0]!.messages;
    expect(wire).toHaveLength(window.length);
    expect(wire[row.wireIndex]!.content).toBe('Account tier: gold');
    expect(wire[row.wireIndex]!.role).toBe('assistant');

    // ── Surface 1: the injected event, same position and same hash ───
    const record = injected.find((r) => r.slot === 'messages' && r.sourceId === 'tier');
    expect(record).toBeDefined();
    expect(record!.rawContent).toBe('Account tier: gold');
    expect(record!.source).toBe('fact');
    expect(record!.position).toBe(row.wireIndex);
    expect(
      record!.contentHash,
      'the slot and the delivery stage hash the same message differently',
    ).toBe(row.contentHash);

    // And the recorded reason is the injection's own description, not a
    // baseline inference from the role.
    const full = injected.find((r) => r.sourceId === 'tier') as unknown as { reason: string };
    expect(full.reason).toBe('the customer tier the desk should assume');
  });
});
