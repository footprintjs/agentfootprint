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
  type DefineSkillOptions,
} from '../../../src/doors/context.js';
import * as context from '../../../src/doors/context.js';

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

  it('preserves supported skill metadata without forwarding the facade discriminant', () => {
    const opts = {
      id: 'refund',
      title: 'Refund guidance',
      description: 'How to issue a refund.',
      body: 'Review the order before refunding.',
      surfaceMode: 'both',
      autoActivate: 'currentSkill',
      produces: ['refund/receipt'],
      consumes: ['order/details'],
      model: 'review-model',
      cache: 'never',
    } satisfies DefineSkillOptions;
    const input = Object.freeze({ type: 'skill' as const, ...opts });
    const injection = defineInjection(input);
    expect(injection).toEqual(defineSkill(opts));
    expect(injection).not.toHaveProperty('type');
    expect(injection.metadata).not.toHaveProperty('type');
    expect(input.type).toBe('skill');
  });

  it('keeps class/prototype getters bound to the original options instance', () => {
    class SkillOptions {
      readonly type = 'skill';
      readonly id = 'refund';
      readonly description = 'How to issue a refund.';
      #body = 'Review the order before refunding.';
      get body() {
        return this.#body;
      }
      get surfaceMode(): 'both' {
        return 'both';
      }
    }
    const input = Object.freeze(new SkillOptions());
    expect(defineInjection(input)).toEqual(
      defineSkill({
        id: input.id,
        description: input.description,
        body: input.body,
        surfaceMode: input.surfaceMode,
      }),
    );
  });
});

describe('defineInjection — Functional: flavor tagging', () => {
  it('tags each flavor correctly', () => {
    expect(defineInjection({ type: 'instruction', id: 'a', prompt: 'x' }).flavor).toBe(
      'instructions',
    );
    expect(defineInjection({ type: 'steering', id: 'b', prompt: 'x' }).flavor).toBe('steering');
    expect(defineInjection({ type: 'fact', id: 'c', data: 'x' }).flavor).toBe('fact');
    expect(defineInjection({ type: 'skill', id: 'd', description: 'x', body: 'y' }).flavor).toBe(
      'skill',
    );
  });

  it('returns a frozen Injection', () => {
    const inj = defineInjection({ type: 'instruction', id: 'a', prompt: 'x' });
    expect(Object.isFrozen(inj)).toBe(true);
  });
});

describe('defineInjection — Security/validation: pass-through', () => {
  const skill = { type: 'skill' as const, id: 'refund', description: 'd', body: 'b' };

  it('propagates the named factory validation (empty id throws)', () => {
    expect(() => defineInjection({ type: 'instruction', id: '', prompt: 'x' })).toThrow();
    expect(() => defineInjection({ type: 'instruction', id: 'a', prompt: '' })).toThrow();
  });

  it.each(['refreshPolicy', 'viaToolName', 'surfaceMod'])(
    'refuses unsupported skill option %s',
    (key) => {
      const input = { ...skill, [key]: 'PRIVATE' };
      expect(() => defineInjection(input)).toThrow(`unsupported option ${key}.`);
    },
  );

  it.each([true, false])(
    'refuses inherited unsupported options without reading them (enumerable=%s)',
    (enumerable) => {
      let reads = 0;
      const prototype = Object.defineProperty({}, 'surfaceMod', {
        enumerable,
        get() {
          reads += 1;
          throw new Error('must not evaluate an unsupported option');
        },
      });
      const input = Object.assign(Object.create(prototype), skill);
      expect(() => defineInjection(input)).toThrow('unsupported option surfaceMod.');
      expect(reads).toBe(0);
    },
  );

  it('refuses non-enumerable own unsupported getters without evaluating them', () => {
    let reads = 0;
    const input = Object.defineProperty({ ...skill }, 'extra', {
      get() {
        reads += 1;
        throw new Error('must not evaluate an unsupported option');
      },
    });
    expect(() => defineInjection(input)).toThrow('unsupported option extra.');
    expect(reads).toBe(0);
  });

  it('refuses symbol options and keeps the named factory vocabulary closed', () => {
    const symbol = Symbol('extra');
    expect(() => defineInjection({ ...skill, [symbol]: true })).toThrow(
      'unsupported option Symbol(extra).',
    );
    expect(() => defineSkill(skill)).toThrow('unsupported option type.');
  });

  it('does not publish the internal facade through the context door', () => {
    expect(context).not.toHaveProperty('defineSkillInjection');
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
      expect(defineInjection({ type: c.type, ...(c.opts as any) })).toEqual(
        (c.named as any)(c.opts),
      );
    }
  });
});
