import { describe, expect, it } from 'vitest';
import { Agent } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import { readInputsLayerOption } from '../../../../src/core/agent/honesty/armed.js';
import { argumentRowIsWellFormed } from '../../../../src/core/agent/arguments/rows.js';

const correction = { declarationCorrection: 'once' as const };
const create = () => Agent.create({ provider: mock(), model: 'mock' });

describe('source correction public configuration', () => {
  it('resolves either source door and preserves direct options through the builder', async () => {
    const builders = [
      create().inputsLayer({ argumentSources: true, ...correction }),
      create().findings({ argumentSources: true }).inputsLayer(correction),
      create().inputsLayer(correction).findings({ argumentSources: true }),
      Agent.create({ provider: mock(), model: 'mock', inputsLayer: correction }).inputsLayer({
        argumentSources: true,
      }),
      Agent.create({
        provider: mock(),
        model: 'mock',
        inputsLayer: { argumentSources: true },
      }).inputsLayer(correction),
    ];
    for (const builder of builders) {
      const agent = builder.build();
      await agent.shutdown();
    }
  });

  it('requires the resolved source arm and refuses malformed options before arming', () => {
    expect(() => create().inputsLayer(correction).build()).toThrow(/requires.*argumentSources/);
    for (const value of [false, true, 'twice', 1, null]) {
      expect(() => readInputsLayerOption({ declarationCorrection: value })).toThrow(/once/);
    }
    expect(() => readInputsLayerOption({ argumentSources: 'yes', ...correction })).toThrow(
      /true or false/,
    );
    const invalid = { argumentSources: 'yes' } as unknown as { argumentSources?: boolean };
    expect(() => create().findings({ argumentSources: true }).inputsLayer(invalid)).toThrow(
      /true or false/,
    );
    expect(() =>
      create()
        .inputsLayer({ argumentSources: true, ...correction })
        .inputsLayer(),
    ).toThrow(/already set/);
  });
});

const row = {
  kind: 'argument',
  turn: 1,
  iteration: 1,
  toolCallId: 'call',
  toolName: 'synthetic_read',
  argument: 'vm',
  rule: 'ask',
  claimed: 'none',
};

describe('closed native correction row vocabulary', () => {
  it.each([{ correction: 'source-declaration-required' }, { withheld: 'batch-preempted' }])(
    'admits a finite withheld proposal with no fictional source or human ask: %j',
    (outcome) => {
      expect(argumentRowIsWellFormed({ ...row, ...outcome })).toBe(true);
      for (const conflict of [
        { asked: 'unverified' },
        { source: 'model' },
        { claimed: 'user' },
        { correction: 'source-declaration-required', withheld: 'batch-preempted' },
      ])
        expect(argumentRowIsWellFormed({ ...row, ...outcome, ...conflict })).toBe(false);
    },
  );

  it('retains legacy combinations while rejecting unknown new outcomes', () => {
    expect(argumentRowIsWellFormed({ ...row, source: 'model', asked: 'unverified' })).toBe(true);
    expect(argumentRowIsWellFormed({ ...row, source: 'default', claimed: 'assumed' })).toBe(true);
    expect(argumentRowIsWellFormed({ ...row, correction: 'inferred' })).toBe(false);
    expect(argumentRowIsWellFormed({ ...row, withheld: 'try-again' })).toBe(false);
    expect(argumentRowIsWellFormed(row)).toBe(false);
  });
});
