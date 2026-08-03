/**
 * LAW: what the recording calls injected into the messages slot is what
 * the provider was actually sent.
 *
 * ── Read this before changing it ──────────────────────────────────────
 * This test is REFUSAL-SHAPED today and is meant to be turned
 * ACCEPTANCE-SHAPED by the delivery feature.
 *
 * Today the messages slot is the observability projection of the
 * conversation, not a wire: `stages/callLLM.ts` assembles the request from
 * `scope.history`. So every `context.injected` the slot emits corresponds
 * to a message that is genuinely on the wire, and content declared for the
 * slot is refused at the declaration site
 * (`lib/injection-engine/messagesSlotRefusal.ts`) rather than recorded as
 * injected and dropped — which is what 7.19.1 fixed.
 *
 * When the slot gains a wire (a wire-carrying key out of the slot, a
 * per-provider notion of which roles a provider can carry, and a
 * message-sequence rule), the refusal becomes acceptance. At that point
 * DO NOT weaken the law below: keep the same assertion — every recorded
 * messages-slot injection appears in the captured request — and delete the
 * `refuses` case in favour of a case that declares an injection and finds
 * it on the wire. The law is the point; the refusal is only today's way of
 * keeping it true.
 *
 * Test types (Convention 3): functional (a real Agent run, provider
 * captured) / regression (the 7.19.1 gap) / security-adjacent (a recording
 * that overstates what the model saw is evidence nobody can trust).
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js';
import { defineFact, defineInstruction } from '../../../src/injection-engine.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** A provider that answers once and keeps every request it was handed. */
function capturingProvider(): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push(req);
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
  readonly contentSummary: string;
}

describe('messages slot — the recording and the wire agree', () => {
  it('every recorded messages-slot injection is present in the request', async () => {
    const { provider, requests } = capturingProvider();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You are a support assistant.')
      // Both flavors, in the placement that IS delivered.
      .fact(defineFact({ id: 'turn-time', data: 'Current time: noon' }))
      .instruction(defineInstruction({ id: 'concise', prompt: 'Answer in one sentence.' }))
      .build();

    const injected: InjectedPayload[] = [];
    agent.on('agentfootprint.context.injected', (e) =>
      injected.push(e.payload as unknown as InjectedPayload),
    );

    expect(await agent.run({ message: 'where is my order?' })).toBe('ok');

    const request = requests[0];
    expect(request).toBeDefined();
    const wire = (request!.messages ?? []).map((m) => m.content).join('\n');

    const messagesSlot = injected.filter((r) => r.slot === 'messages');
    // The user's turn at minimum — an empty list would pass the law
    // vacuously and prove nothing.
    expect(messagesSlot.length).toBeGreaterThan(0);
    for (const record of messagesSlot) {
      const content = record.rawContent ?? record.contentSummary;
      expect(
        wire.includes(content),
        `recorded as injected into the messages slot but absent from the request: ${content}`,
      ).toBe(true);
    }

    // The system-prompt slot keeps its own promise on the same run: what it
    // recorded is in the request's system field.
    for (const record of injected.filter((r) => r.slot === 'system-prompt')) {
      expect(request!.systemPrompt ?? '').toContain(record.rawContent ?? record.contentSummary);
    }
  });

  it('refuses the declaration it cannot deliver, instead of recording it', async () => {
    const { provider, requests } = capturingProvider();

    // The pre-7.19.1 declaration. It used to build, run, emit
    // `context.injected` with this content, and never send it.
    expect(() =>
      defineFact({ id: 'turn-time', data: 'Current time: noon', slot: 'messages' as never }),
    ).toThrow(/does not reach the model/);

    // And the run that would have carried it is a normal run, unchanged.
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You are a support assistant.')
      .build();
    expect(await agent.run({ message: 'hi' })).toBe('ok');
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
