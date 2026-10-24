import { describe, expect, it, vi } from 'vitest';
import { Agent, type NegativeClaimsOptions } from '../../../src/index.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { resolveNegativeClaims } from '../../../src/core/agent/negativeClaims/config.js';

const builder = () => Agent.create({ provider: mock({ reply: 'Ready.' }), model: 'mock' });
const parser = { parse: (value: unknown) => value };

describe('standalone negative prose configuration', () => {
  it('needs neither a schema nor registered tools, and permits independent limits', () => {
    expect(resolveNegativeClaims({ prose: true })).toEqual({ mode: 'prose' });
    expect(() => builder().negativeClaims({ prose: true }).build()).not.toThrow();
    expect(() =>
      builder().negativeClaims({ prose: true }).limitsTravelWithTheAnswer().build(),
    ).not.toThrow();
  });

  it.each([
    { prose: false },
    { prose: undefined },
    { prose: 'true' },
    { prose: true, field: 'negatives' },
    { prose: true, tools: [] },
    { prose: true, unestablished: 'withhold' },
    { prose: true, field: undefined },
    { prose: true, tools: undefined },
    { prose: true, unestablished: undefined },
  ])('refuses a mixed or ambiguous arm %#', (options) => {
    expect(() => resolveNegativeClaims(options as NegativeClaimsOptions)).toThrow(
      /prose must be true/,
    );
  });

  it.each(['strictProse', 'enforceProse'])(
    'does not expose prose enforcement through %s',
    (key) => {
      expect(() => resolveNegativeClaims({ prose: true, [key]: false })).toThrow(/not available/);
    },
  );

  it('does not execute getters or accept unknown configuration', () => {
    const getter = vi.fn(() => true);
    const options = Object.defineProperty({}, 'prose', { enumerable: true, get: getter });
    expect(() => resolveNegativeClaims(options as NegativeClaimsOptions)).toThrow(/plain data/);
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      resolveNegativeClaims({ prose: true, typo: true } as NegativeClaimsOptions),
    ).toThrow(/accept only/);
  });

  it('detaches custom phrase data for both arms and pins an effective grammar version', () => {
    const none = ['lacks incidents'];
    const prose = resolveNegativeClaims({ prose: true, phrases: { none } });
    const typed = resolveNegativeClaims({
      field: 'negatives',
      tools: ['lookup'],
      phrases: { none },
    });
    none[0] = 'silently changed';
    expect(prose.phrases).toEqual(typed.phrases);
    expect(JSON.stringify(prose.phrases)).toContain('lacks');
    expect(JSON.stringify(prose.phrases)).not.toContain('silently changed');
    expect(prose.phrases?.version).not.toBe('1');
    expect(Object.isFrozen(prose.phrases)).toBe(true);
  });

  it('cannot stand in for the typed answer-validation check', () => {
    expect(() =>
      builder()
        .outputSchema(parser)
        .negativeClaims({ prose: true })
        .answerValidation({
          id: 'app',
          version: '1',
          agentChecks: ['negative-claims'],
          validate: () => ({ checks: [] }),
        })
        .build(),
    ).toThrow(/requires typed/);
  });

  it.each([true, false])(
    'refuses fallback substitution regardless of declaration order (%s)',
    (first) => {
      const b = builder().outputSchema(parser);
      if (first) b.negativeClaims({ prose: true });
      b.outputFallback({ fallback: () => ({ text: 'No incidents exist.' }) });
      if (!first) b.negativeClaims({ prose: true });
      expect(() => b.build()).toThrow(/does not support .outputFallback/);
    },
  );
});
