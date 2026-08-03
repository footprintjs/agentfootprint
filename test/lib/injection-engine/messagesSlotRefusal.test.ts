/**
 * The messages-slot refusals — what is still refused now that the slot
 * delivers (7.21.0), and where each refusal lives.
 *
 * ── The arc ──────────────────────────────────────────────────────────
 * 7.19.1 refused `slot: 'messages'` outright, because the declaration was
 * recorded as injected and never sent. 7.21.0 delivers it, so a blanket
 * refusal would now be the false statement. What survives are the refusals
 * the WIRE imposes, and they live at different sites on purpose:
 *
 *   • `role: 'tool'` — refused at DECLARATION, on every provider. A tool
 *     message answers a specific call and an injection has no call to
 *     answer; no capability could make it valid.
 *   • a role THIS provider does not carry — refused at RUN START, because
 *     the answer depends on a provider the factory has never seen.
 *   • a role with nowhere to sit this iteration — DEFERRED, not refused,
 *     and recorded (see delivery-sequence.test.ts).
 *
 * Pinned here: each refusal fires at its own site, fires nowhere else, and
 * says something a reader can act on.
 *
 * Test types (Convention 3): unit (each factory) / functional (the builder
 * funnel + a real run) / regression (the accepted-then-dropped declaration)
 * / security (an Injection cannot smuggle an undeliverable role past the
 * funnel by being hand-built).
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js';
import {
  defineFact,
  defineInjection,
  defineInstruction,
  defineSkill,
  defineSteering,
} from '../../../src/injection-engine.js';
import type { Injection } from '../../../src/injection-engine.js';
import {
  messagesRoleRefusal,
  messagesToolRoleRefusal,
} from '../../../src/lib/injection-engine/messagesSlotRefusal.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** A minimal provider with no declared capability → the user/assistant floor. */
function floorProvider(name = 'third-party'): LLMProvider {
  return {
    name,
    complete: (_req: LLMRequest): Promise<LLMResponse> =>
      Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      } as LLMResponse),
  };
}

describe('the refusal sentences', () => {
  it('the role refusal names the site, the role, the provider and what it carries', () => {
    const text = messagesRoleRefusal({
      site: "defineFact('turn-time')",
      role: 'system',
      providerName: 'anthropic',
      carries: ['user', 'assistant'],
    });
    expect(text).toContain("defineFact('turn-time')");
    expect(text).toContain("`role: 'system'`");
    expect(text).toContain("'anthropic'");
    expect(text).toContain('`user` and `assistant`');
    // And it teaches the ways out.
    expect(text).toContain("slot: 'system-prompt'");
    expect(text).toContain('tool result');
    expect(text).toContain('who appears to speak is your decision');
  });

  it('the tool-role refusal explains why no provider could take it', () => {
    const text = messagesToolRoleRefusal("defineInstruction('x')");
    expect(text).toContain("defineInstruction('x')");
    expect(text).toContain('answer to a specific tool call');
    expect(text).toContain("Use `'user'` or `'assistant'`");
  });
});

describe('refused at DECLARATION — the pairs no wire can take', () => {
  it('defineFact requires a role for the messages slot, with no default', () => {
    expect(() => defineFact({ id: 'turn-time', data: 'noon', slot: 'messages' } as never)).toThrow(
      /defineFact\('turn-time'\): `slot: 'messages'` requires a `role`/,
    );
  });

  it('defineInstruction requires a role for the messages slot, with no default', () => {
    expect(() =>
      defineInstruction({ id: 'be-brief', prompt: 'Be brief.', slot: 'messages' } as never),
    ).toThrow(/defineInstruction\('be-brief'\): `slot: 'messages'` requires a `role`/);
  });

  it("refuses role: 'tool' in both factories and through defineInjection", () => {
    expect(() =>
      defineFact({ id: 'f', data: 'x', slot: 'messages', role: 'tool' } as never),
    ).toThrow(/`role: 'tool'` cannot be injected/);
    expect(() =>
      defineInstruction({ id: 'i', prompt: 'x', slot: 'messages', role: 'tool' } as never),
    ).toThrow(/`role: 'tool'` cannot be injected/);
    expect(() =>
      defineInjection({
        type: 'fact',
        id: 'f2',
        data: 'x',
        slot: 'messages',
        role: 'tool',
      } as never),
    ).toThrow(/`role: 'tool'` cannot be injected/);
  });

  it('Agent.injection() catches a hand-built tool-role Injection going around the factories', () => {
    const smuggled: Injection = {
      id: 'hand-built',
      flavor: 'custom',
      trigger: { kind: 'always' },
      inject: { messages: [{ role: 'tool', content: 'read this first' }] },
    };
    expect(() =>
      Agent.create({ provider: new MockProvider({ reply: 'ok' }) as never, model: 'm' }).injection(
        smuggled,
      ),
    ).toThrow(/Agent\.injection\('hand-built'\): `role: 'tool'` cannot be injected/);
  });

  it('the sugar aliases funnel into the same declaration refusal', () => {
    const build = () => Agent.create({ provider: new MockProvider() as never, model: 'm' });
    const withToolRole = (id: string): Injection => ({
      id,
      flavor: 'custom',
      trigger: { kind: 'always' },
      inject: { messages: [{ role: 'tool', content: 'x' }] },
    });
    expect(() => build().instruction(withToolRole('a'))).toThrow(/cannot be injected/);
    expect(() => build().fact(withToolRole('b'))).toThrow(/cannot be injected/);
    expect(() => build().steering(withToolRole('c'))).toThrow(/cannot be injected/);
    expect(() => build().skill(withToolRole('d'))).toThrow(/cannot be injected/);
  });

  it('an EMPTY messages array is not a declaration, and is not refused', () => {
    const empty: Injection = {
      id: 'empty',
      flavor: 'custom',
      trigger: { kind: 'always' },
      inject: { systemPrompt: 'real content', messages: [] },
    };
    expect(() =>
      Agent.create({ provider: new MockProvider() as never, model: 'm' }).injection(empty),
    ).not.toThrow();
  });
});

describe('refused at RUN START — the role this provider cannot carry', () => {
  it('builds fine, then names the provider and its roles when the run begins', async () => {
    const agent = Agent.create({ provider: floorProvider('third-party'), model: 'm' })
      .system('bot')
      .fact(defineFact({ id: 'note', data: 'noon', slot: 'messages', role: 'system' }))
      .build();

    await expect(agent.run({ message: 'hi' })).rejects.toThrow(
      /Agent injection 'note'.*'third-party' provider, which carries `user` and `assistant`/s,
    );
  });

  it("does not refuse a role the provider DOES carry — MockProvider carries 'system'", async () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }) as never, model: 'm' })
      .system('bot')
      .fact(defineFact({ id: 'note', data: 'noon', slot: 'messages', role: 'system' }))
      .build();
    expect(await agent.run({ message: 'hi' })).toBe('ok');
  });
});

describe('everything that worked still works', () => {
  it('the default and the explicit system-prompt slot both build and run', async () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }) as never, model: 'm' })
      .system('bot')
      .fact(defineFact({ id: 'f-default', data: 'a fact' }))
      .fact(defineFact({ id: 'f-explicit', data: 'another', slot: 'system-prompt' }))
      .instruction(defineInstruction({ id: 'i', prompt: 'Be brief.', slot: 'system-prompt' }))
      .steering(defineSteering({ id: 's', prompt: 'JSON only' }))
      .skill(defineSkill({ id: 'sk', description: 'billing help', body: 'how to refund' }))
      .build();

    expect(await agent.run({ message: 'hi' })).toBe('ok');
  });
});
