/**
 * The messages-slot refusal (7.19.1).
 *
 * Before this, `slot: 'messages'` was accepted by two factories and by a
 * hand-built Injection, recorded as injected by the slot, routed by the
 * engine, and never sent: the request's message list is assembled from the
 * conversation. The declaration is now refused where it is written, and the
 * refusal names what to use instead — a refusal that does not teach just
 * moves the puzzle.
 *
 * What is pinned here is BOTH halves: the refusal fires everywhere the
 * declaration can be made, and it fires NOWHERE else (a system-prompt
 * injection, the default, is untouched).
 *
 * Test types (Convention 3): unit (each factory) / functional (the builder
 * funnel) / regression (the accepted-then-dropped declaration) / security
 * (an Injection cannot smuggle content past the funnel by being
 * hand-built).
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
import { messagesSlotRefusal } from '../../../src/lib/injection-engine/messagesSlotRefusal.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

/** `slot: 'messages'` no longer type-checks; a JS caller can still pass it. */
const MESSAGES = 'messages' as never;

describe('messagesSlotRefusal — the sentence', () => {
  it('names the site, the limitation, and the three placements that work', () => {
    const text = messagesSlotRefusal("defineFact('turn-time')");
    expect(text).toContain("defineFact('turn-time')");
    expect(text).toContain('does not reach the model');
    expect(text).toContain("slot: 'system-prompt'");
    expect(text).toContain("tool's return value");
    expect(text).toContain('agent.run({ message })');
  });
});

describe('messages-slot declarations are refused', () => {
  it('defineFact refuses it by name', () => {
    expect(() => defineFact({ id: 'turn-time', data: 'noon', slot: MESSAGES })).toThrow(
      /defineFact\('turn-time'\): the messages slot does not reach the model/,
    );
  });

  it('defineInstruction refuses it by name', () => {
    expect(() =>
      defineInstruction({ id: 'be-brief', prompt: 'Be brief.', slot: MESSAGES }),
    ).toThrow(/defineInstruction\('be-brief'\): the messages slot does not reach the model/);
  });

  it('defineInjection refuses it through either flavor it routes to', () => {
    expect(() => defineInjection({ type: 'fact', id: 'f', data: 'x', slot: MESSAGES })).toThrow(
      /does not reach the model/,
    );
    expect(() =>
      defineInjection({ type: 'instruction', id: 'i', prompt: 'x', slot: MESSAGES }),
    ).toThrow(/does not reach the model/);
  });

  it('Agent.injection() refuses a hand-built Injection that goes around the factories', () => {
    const smuggled: Injection = {
      id: 'hand-built',
      flavor: 'custom',
      trigger: { kind: 'always' },
      inject: { messages: [{ role: 'user', content: 'read this first' }] },
    };
    expect(() =>
      Agent.create({ provider: new MockProvider({ reply: 'ok' }) as never, model: 'm' }).injection(
        smuggled,
      ),
    ).toThrow(/Agent\.injection\('hand-built'\): the messages slot does not reach the model/);
  });

  it('the sugar aliases funnel into the same refusal', () => {
    const build = () => Agent.create({ provider: new MockProvider() as never, model: 'm' });
    const withMessages = (id: string): Injection => ({
      id,
      flavor: 'custom',
      trigger: { kind: 'always' },
      inject: { messages: [{ role: 'system', content: 'x' }] },
    });
    expect(() => build().instruction(withMessages('a'))).toThrow(/does not reach the model/);
    expect(() => build().fact(withMessages('b'))).toThrow(/does not reach the model/);
    expect(() => build().steering(withMessages('c'))).toThrow(/does not reach the model/);
    expect(() => build().skill(withMessages('d'))).toThrow(/does not reach the model/);
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
