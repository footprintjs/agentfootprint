/**
 * LAW: the two events that describe a memory recall, and the request the
 * provider was handed, name the SAME slot.
 *
 * Three surfaces, one truth:
 *   1. `agentfootprint.context.memory.injected` — the memory stage's own
 *      emit, fired by `memory/stages/formatDefault.ts`.
 *   2. `agentfootprint.context.injected` (`source: 'memory'`) — the slot
 *      composer's record of the same bytes.
 *   3. the captured `LLMRequest` — where those bytes actually are.
 *
 * ── Read this before changing it ──────────────────────────────────────
 * Until 7.20.0 surface 1 said `slot: 'messages'` while surfaces 2 and 3
 * said system-prompt. Two events described one piece of content and
 * disagreed, so a consumer branching on the first was branching on a lie.
 * Nothing about delivery changed in 7.20.0 — only the claim did.
 *
 * The law is deliberately written as an EQUALITY between the surfaces
 * rather than as `expect(slot).toBe('system-prompt')`. If role-differentiated
 * recall ever ships (see `memory/asRoleRefusal.ts`), some recall will land
 * somewhere else, and this test should then fail only if the surfaces stop
 * agreeing — not merely because the answer changed.
 *
 * Test types (Convention 3): functional (a real two-turn Agent run, provider
 * captured) / regression (the 7.20.0 disagreement) / security-adjacent (a
 * recording that misplaces what the model saw is evidence nobody can trust).
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder, EmitEvent } from 'footprintjs';
import { Agent } from '../../../src/index.js';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../../src/memory/index.js';
import { InMemoryStore } from '../../../src/memory/store/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** A provider that answers once per call and keeps every request it was handed. */
function capturingProvider(reply: string): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push(req);
      return Promise.resolve({
        content: reply,
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
  readonly source: string;
  readonly rawContent?: string;
  readonly contentSummary: string;
}

interface MemoryInjectedPayload {
  readonly slot: string;
  readonly role: string;
  readonly count: number;
}

/**
 * `agentfootprint.context.memory.injected` is a raw footprintjs emit — no
 * EmitBridge forwards it to `agent.on`, so it is captured at the channel
 * it is actually fired on.
 */
function emitCapture(out: EmitEvent[]): CombinedRecorder {
  return {
    id: 'memory-slot-truth-capture',
    onEmit(event: EmitEvent): void {
      if (event.name === 'agentfootprint.context.memory.injected') out.push(event);
    },
  } as CombinedRecorder;
}

describe('memory recall — the two events and the wire agree on the slot', () => {
  it('memory.injected slot === context.injected slot === where the request carries it', async () => {
    const { provider, requests } = capturingProvider('ok');
    const store = new InMemoryStore();
    const emits: EmitEvent[] = [];

    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You remember the user.')
      .memory(
        defineMemory({
          id: 'chat',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
          store,
        }),
      )
      .watch(emitCapture(emits))
      .build();

    const injected: InjectedPayload[] = [];
    agent.on('agentfootprint.context.injected', (e) =>
      injected.push(e.payload as unknown as InjectedPayload),
    );

    const identity = { conversationId: 'slot-truth' };
    // Turn 1 seeds the store; turn 2 is the one with recall to describe.
    await agent.run({ message: 'My favourite colour is vermilion.', identity });
    injected.length = 0;
    emits.length = 0;
    requests.length = 0;
    await agent.run({ message: 'What is my favourite colour?', identity });

    // Surface 1 — the memory stage's own emit. An empty list would pass
    // every assertion below vacuously and prove nothing.
    expect(emits.length).toBeGreaterThan(0);
    const memoryEmit = emits[0]!.payload as unknown as MemoryInjectedPayload;
    expect(memoryEmit.count).toBeGreaterThan(0);

    // Surface 2 — the slot composer's record of the same bytes.
    const memoryRecords = injected.filter((r) => r.source === 'memory');
    expect(memoryRecords.length).toBeGreaterThan(0);

    // THE LAW: one piece of content, one slot name, whoever is describing it.
    for (const record of memoryRecords) {
      expect(
        record.slot,
        `context.injected says '${record.slot}' for content that ` +
          `context.memory.injected calls '${memoryEmit.slot}'`,
      ).toBe(memoryEmit.slot);
    }

    // Surface 3 — the request. The slot both events name is the field the
    // recall is actually in, and it is NOT in the other one.
    const request = requests[0];
    expect(request).toBeDefined();
    const systemPrompt = request!.systemPrompt ?? '';
    const wireMessages = (request!.messages ?? []).map((m) => m.content ?? '').join('\n');

    expect(memoryEmit.slot).toBe('system-prompt');
    for (const record of memoryRecords) {
      const content = record.rawContent ?? record.contentSummary;
      expect(
        systemPrompt.includes(content),
        `recorded in the ${record.slot} slot but absent from request.systemPrompt: ${content}`,
      ).toBe(true);
      expect(wireMessages.includes(content)).toBe(false);
    }

    // And the recall really is the prior turn — the run under test is not
    // agreeing about an empty string.
    expect(systemPrompt).toContain('vermilion');
  });
});
