/**
 * LAW: what the recording calls injected into the messages slot is what
 * the provider was actually sent.
 *
 * ── Read this before changing it ──────────────────────────────────────
 * This test was REFUSAL-SHAPED in 7.19.1 and is ACCEPTANCE-SHAPED since
 * 7.21.0. The law never moved; only the way of keeping it true did.
 *
 * 7.19.1: the messages slot was the observability projection of the
 * conversation, not a wire, so content declared for it was REFUSED at the
 * declaration site rather than recorded as injected and dropped.
 *
 * 7.21.0: the slot has a wire. A delivered injection enters `scope.history`
 * itself at the injection-engine boundary, so it is on the request for the
 * same reason every other message is. The refusals that remain are the ones
 * the wire imposes — a role this provider does not carry, a position that
 * would break alternation — and each of them refuses BEFORE anything is
 * recorded as injected.
 *
 * DO NOT weaken the assertion below. Every recorded messages-slot injection
 * must appear in the captured request. If a future change cannot keep that,
 * it must refuse the declaration, not soften the test.
 *
 * Test types (Convention 3): functional (a real Agent run, provider
 * captured) / regression (the 7.19.1 gap) / security-adjacent (a recording
 * that overstates what the model saw is evidence nobody can trust).
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js';
import { defineFact, defineInstruction } from '../../../src/injection-engine.js';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WireRole,
} from '../../../src/adapters/types.js';

/**
 * A provider that answers once and keeps every request it was handed.
 *
 * By default it declares NO `carriesInMessages`, which is the third-party
 * adapter case: treated as carrying the user/assistant floor and nothing more.
 */
function capturingProvider(carriesInMessages?: readonly WireRole[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'capture',
    ...(carriesInMessages !== undefined && { carriesInMessages }),
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
  readonly source?: string;
  readonly sourceId?: string;
}

describe('messages slot — the recording and the wire agree', () => {
  it('every recorded messages-slot injection is present in the request', async () => {
    const { provider, requests } = capturingProvider();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You are a support assistant.')
      // The declaration 7.19.1 refused, now delivered — as `assistant`, a role
      // this (capability-less) provider carries by the floor rule.
      .fact(
        defineFact({
          id: 'turn-time',
          data: 'Current time: noon',
          slot: 'messages',
          role: 'assistant',
        }),
      )
      // And the same flavor in the placement that was always delivered.
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

    // The delivered fact is on the wire, and the record naming it credits the
    // injection rather than inferring a baseline source from its role.
    expect(wire).toContain('Current time: noon');
    const deliveredRecord = messagesSlot.find((r) => r.rawContent === 'Current time: noon');
    expect(deliveredRecord).toBeDefined();
    expect(deliveredRecord!.source).toBe('fact');
    expect(deliveredRecord!.sourceId).toBe('turn-time');
    // ONE record for it, not two: the projection no longer counts a delivered
    // injection both as a message and as a pending declaration.
    expect(messagesSlot.filter((r) => r.rawContent === 'Current time: noon')).toHaveLength(1);

    // The marker is framework bookkeeping and never leaves the library.
    for (const m of request!.messages ?? []) {
      expect(m).not.toHaveProperty('injectedBy');
    }
    expect(JSON.stringify(request!.messages)).not.toContain('injectedBy');

    // The system-prompt slot keeps its own promise on the same run: what it
    // recorded is in the request's system field.
    for (const record of injected.filter((r) => r.slot === 'system-prompt')) {
      expect(request!.systemPrompt ?? '').toContain(record.rawContent ?? record.contentSummary);
    }
  });

  it('refuses the role the wire cannot carry, instead of recording it', async () => {
    const { provider, requests } = capturingProvider();

    // A declaration is fine on its own — the factory cannot know which
    // provider will be attached.
    const systemRoleFact = defineFact({
      id: 'turn-time',
      data: 'Current time: noon',
      slot: 'messages',
      role: 'system',
    });

    // The run is where the provider is known, so the run is where it refuses:
    // naming the provider and the roles it does carry.
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You are a support assistant.')
      .fact(systemRoleFact)
      .build();
    await expect(agent.run({ message: 'hi' })).rejects.toThrow(
      /cannot be delivered inside the message list by the 'capture' provider, which carries `user` and `assistant`/,
    );
    // Refused BEFORE the call — nothing was sent, so nothing can be recorded
    // as sent.
    expect(requests).toHaveLength(0);

    // The same declaration on a provider that carries `system` runs, and lands.
    const carrying = capturingProvider(['system', 'user', 'assistant']);
    const openAiLike = Agent.create({
      provider: carrying.provider,
      model: 'm',
      maxIterations: 1,
    })
      .system('You are a support assistant.')
      .fact(systemRoleFact)
      .build();
    expect(await openAiLike.run({ message: 'hi' })).toBe('ok');
    expect(carrying.requests[0]?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'Current time: noon' },
    ]);
  });

  it('an agent that declares nothing for the slot runs exactly as before', async () => {
    const { provider, requests } = capturingProvider();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You are a support assistant.')
      .build();
    expect(await agent.run({ message: 'hi' })).toBe('ok');
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    // No delivery stage, so no delivery record — the chart is the one it was.
    const snapshot = agent.getSnapshot();
    expect(
      (snapshot?.sharedState as { messagesDelivery?: unknown } | undefined)?.messagesDelivery,
    ).toBeUndefined();
  });
});
