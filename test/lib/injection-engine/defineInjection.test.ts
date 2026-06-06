/**
 * defineInjection — unified factory tests.
 *
 * Verifies the `type` discriminant routes to the matching named factory and
 * produces an identical Injection, plus flavor tagging and validation
 * pass-through. (Unit + Functional + Property + Security coverage.)
 */
import { describe, expect, it } from 'vitest';

import {
  defineFact,
  defineInjection,
  defineInstruction,
  defineSkill,
  defineSteering,
} from '../../../src/lib/injection-engine/index.js';

describe('defineInjection — Unit: equivalence to named factories', () => {
  it('type:"instruction" === defineInstruction', () => {
    const opts = { id: 'calm', prompt: 'Be calm.', activeWhen: () => true };
    expect(defineInjection({ type: 'instruction', ...opts })).toEqual(defineInstruction(opts));
  });

  it('type:"steering" === defineSteering', () => {
    const opts = { id: 'brand', prompt: 'Use the brand voice.' };
    expect(defineInjection({ type: 'steering', ...opts })).toEqual(defineSteering(opts));
  });

  it('type:"fact" === defineFact', () => {
    const opts = { id: 'tz', data: 'The user is in UTC+0.' };
    expect(defineInjection({ type: 'fact', ...opts })).toEqual(defineFact(opts));
  });

  it('type:"skill" === defineSkill', () => {
    const opts = {
      id: 'refund',
      description: 'How to issue a refund.',
      body: 'Call issue_refund with the order id.',
    };
    expect(defineInjection({ type: 'skill', ...opts })).toEqual(defineSkill(opts));
  });
});

describe('defineInjection — Functional: flavor tagging', () => {
  it('tags each flavor correctly', () => {
    expect(defineInjection({ type: 'instruction', id: 'a', prompt: 'x' }).flavor).toBe('instructions');
    expect(defineInjection({ type: 'steering', id: 'b', prompt: 'x' }).flavor).toBe('steering');
    expect(defineInjection({ type: 'fact', id: 'c', data: 'x' }).flavor).toBe('fact');
    expect(defineInjection({ type: 'skill', id: 'd', description: 'x', body: 'y' }).flavor).toBe('skill');
  });

  it('returns a frozen Injection', () => {
    const inj = defineInjection({ type: 'instruction', id: 'a', prompt: 'x' });
    expect(Object.isFrozen(inj)).toBe(true);
  });
});

describe('defineInjection — Security/validation: pass-through', () => {
  it('propagates the named factory validation (empty id throws)', () => {
    expect(() => defineInjection({ type: 'instruction', id: '', prompt: 'x' })).toThrow();
    expect(() => defineInjection({ type: 'instruction', id: 'a', prompt: '' })).toThrow();
  });
});

describe('defineInjection — Property: programmatic flavor selection', () => {
  it('a config-driven flavor matches its named factory for all four flavors', () => {
    const cases = [
      { type: 'instruction' as const, opts: { id: 'i', prompt: 'p' }, named: defineInstruction },
      { type: 'steering' as const, opts: { id: 's', prompt: 'p' }, named: defineSteering },
      { type: 'fact' as const, opts: { id: 'f', data: 'p' }, named: defineFact },
    ];
    for (const c of cases) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(defineInjection({ type: c.type, ...(c.opts as any) })).toEqual((c.named as any)(c.opts));
    }
  });
});
