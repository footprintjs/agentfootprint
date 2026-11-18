/** Authored observation options cannot smuggle executor/privacy controls or executable getters. */
import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { flowchartAsTool, runbookAsTool } from '../../src/index.js';

const chart = flowChart('No execution during definition', () => undefined, 'noop').build();
const builders = {
  flowchart: (observability: unknown) =>
    flowchartAsTool({
      name: 'strict_observation',
      description: 'Validate observation settings.',
      flowchart: chart,
      ...{ observability: observability as never },
    }),
  runbook: (observability: unknown) =>
    runbookAsTool({
      name: 'strict_observation',
      description: 'Validate observation settings.',
      procedure: () => chart,
      ...{ observability: observability as never },
    }),
};

describe.each(Object.entries(builders))('%s observation option admission', (_name, build) => {
  it('refuses non-record options and unrelated executor fields without echoing values', () => {
    for (const value of [
      null,
      [],
      new Date(),
      new Map(),
      Object.create({ readTracking: 'summary' }),
      'PRIVATE-OPTION-VALUE',
      7,
      () => undefined,
      { scopeFactory: 'PRIVATE-OPTION-VALUE' },
      { redact: { keys: ['secret'] } },
      { recorders: [] },
      { callback: () => undefined },
      { readSources: true },
      { captureOutputHandoff: true },
      { readTracking: 'PRIVATE-OPTION-VALUE' },
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('PRIVATE-OPTION-VALUE');
          },
        },
      ),
      { writeTracking: 'invalid' },
      { commitValues: 'summary' },
      { writeProvenance: 'full' },
    ]) {
      let failure: unknown;
      try {
        build(value);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TypeError);
      expect(String(failure)).toContain('strict_observation');
      expect(String(failure)).not.toContain('PRIVATE-OPTION-VALUE');
    }
  });

  it('rejects symbol, non-enumerable and accessor properties without invoking getters', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, 'readTracking', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('PRIVATE-GETTER');
      },
    });
    const hidden = Object.defineProperty({}, 'readTracking', { value: 'summary' });
    for (const value of [accessor, hidden, { [Symbol('private-option')]: 'summary' }]) {
      expect(() => build(value)).toThrow(TypeError);
    }
    expect(reads).toBe(0);
  });

  it('accepts only own plain data values, including explicit undefined', () => {
    expect(() => build(undefined)).not.toThrow();
    expect(() => build({})).not.toThrow();
    expect(() =>
      build({
        readTracking: undefined,
        writeTracking: 'summary',
        commitValues: 'full',
        writeProvenance: 'off',
      }),
    ).not.toThrow();
    expect(() =>
      build(Object.assign(Object.create(null), { readTracking: 'summary' })),
    ).not.toThrow();
  });
});
