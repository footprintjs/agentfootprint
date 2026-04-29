/**
 * Scenario tests — Conditional composition.
 */

import { describe, it, expect, vi } from 'vitest';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('Conditional — predicate routing', () => {
  it('runs the first matching branch', async () => {
    const cond = Conditional.create({ name: 'Triage' })
      .when('billing', (i) => i.message.toLowerCase().includes('bill'), llm('billing-response'))
      .when('technical', (i) => i.message.toLowerCase().includes('error'), llm('tech-response'))
      .otherwise('general', llm('general-response'))
      .build();

    expect(await cond.run({ message: 'I have a billing question' })).toBe('billing-response');
    expect(await cond.run({ message: 'I got an error' })).toBe('tech-response');
    expect(await cond.run({ message: 'hello' })).toBe('general-response');
  });

  it('evaluates predicates in registration order (first match wins)', async () => {
    const seen: string[] = [];
    const cond = Conditional.create()
      .when(
        'a',
        (i) => {
          seen.push('a');
          return i.message === 'x';
        },
        llm('A'),
      )
      .when(
        'b',
        (i) => {
          seen.push('b');
          return i.message === 'x';
        },
        llm('B'),
      )
      .otherwise('default', llm('DEFAULT'))
      .build();

    const out = await cond.run({ message: 'x' });
    expect(out).toBe('A');
    // Only 'a' was evaluated — evaluation short-circuits at first match.
    expect(seen).toEqual(['a']);
  });

  it('falls through to otherwise when no predicate matches', async () => {
    const cond = Conditional.create()
      .when('strict', () => false, llm('STRICT'))
      .otherwise('fallback', llm('FALLBACK'))
      .build();

    const out = await cond.run({ message: 'anything' });
    expect(out).toBe('FALLBACK');
  });
});

describe('Conditional — events', () => {
  it('emits route_decided with chosen id + rationale', async () => {
    const cond = Conditional.create()
      .when('premium', (i) => i.message.startsWith('PRO'), llm('pro'))
      .otherwise('standard', llm('std'))
      .build();

    const routes = vi.fn();
    cond.on('agentfootprint.composition.route_decided', routes);

    await cond.run({ message: 'PRO plan needed' });
    expect(routes).toHaveBeenCalledTimes(1);
    expect(routes.mock.calls[0][0].payload.chosen).toBe('premium');
    expect(routes.mock.calls[0][0].payload.rationale).toContain('premium');
  });

  it('route_decided rationale says "fell through" on fallback', async () => {
    const cond = Conditional.create()
      .when('a', () => false, llm('A'))
      .otherwise('default', llm('D'))
      .build();

    const routes = vi.fn();
    cond.on('agentfootprint.composition.route_decided', routes);
    await cond.run({ message: 'x' });
    expect(routes.mock.calls[0][0].payload.chosen).toBe('default');
    expect(routes.mock.calls[0][0].payload.rationale).toMatch(/fell through/);
  });

  it('emits composition.enter + exit once each', async () => {
    const cond = Conditional.create()
      .when('a', (i) => true, llm('A'))
      .otherwise('d', llm('D'))
      .build();

    const enters = vi.fn();
    const exits = vi.fn();
    cond.on('agentfootprint.composition.enter', enters);
    cond.on('agentfootprint.composition.exit', exits);

    await cond.run({ message: 'hi' });
    expect(enters).toHaveBeenCalledTimes(1);
    expect(exits).toHaveBeenCalledTimes(1);
    expect(enters.mock.calls[0][0].payload.kind).toBe('Conditional');
  });
});

describe('Conditional — validation', () => {
  it('rejects build() without .otherwise()', () => {
    expect(() =>
      Conditional.create()
        .when('a', () => true, llm('A'))
        .build(),
    ).toThrow(/missing \.otherwise/);
  });

  it('rejects duplicate branch ids', () => {
    expect(() =>
      Conditional.create()
        .when('same', () => true, llm('A'))
        .when('same', () => true, llm('B')),
    ).toThrow(/duplicate branch id/);
  });

  it('rejects two .otherwise() calls', () => {
    expect(() =>
      Conditional.create()
        .when('a', () => true, llm('A'))
        .otherwise('d1', llm('D1'))
        .otherwise('d2', llm('D2')),
    ).toThrow(/already registered/);
  });
});
