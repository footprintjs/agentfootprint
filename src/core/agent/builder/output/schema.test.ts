import { describe, expect, it } from 'vitest';
import { LOCAL_SOURCE } from '../../../../recipes/provenance.js';
import { configureOutputSchema, type OutputSchemaPort } from './schema.js';

describe('terminal schema declaration', () => {
  it('keeps the parser and resolves provenance after the instruction is registered', () => {
    const parser = { parse: (value: unknown) => value };
    const sourceCalls: string[] = [];
    const receiver: OutputSchemaPort = {
      outputSchemaRetries: 0,
      outputSchemaStrategy: 'auto',
      injectionList: [],
      injectionSources: new Map(),
      currentSource() {
        sourceCalls.push(receiver.injectionList[0]?.id ?? 'missing');
        return LOCAL_SOURCE;
      },
    };
    expect(
      configureOutputSchema(
        receiver,
        parser,
        {
          name: 'answer',
          instruction: 'Return the declared answer.',
          retries: 2,
          strategy: 'instruct',
        },
        receiver,
      ),
    ).toBe(receiver);
    expect(receiver.outputSchemaParser).toBe(parser);
    expect(receiver.outputSchemaRetries).toBe(2);
    expect(receiver.outputSchemaStrategy).toBe('instruct');
    expect(sourceCalls).toEqual(['answer']);
    expect(receiver.injectionSources.get('answer')).toBe(LOCAL_SOURCE);
  });

  it('refuses a duplicate before evaluating the incoming options', () => {
    const parser = { parse: (value: unknown) => value };
    const receiver: OutputSchemaPort = {
      outputSchemaParser: parser,
      outputSchemaRetries: 0,
      outputSchemaStrategy: 'auto',
      injectionList: [],
      injectionSources: new Map(),
      currentSource: () => LOCAL_SOURCE,
    };
    expect(() =>
      configureOutputSchema(
        receiver,
        parser,
        {
          get retries(): never {
            throw new Error('options were read');
          },
        },
        receiver,
      ),
    ).toThrow('already set');
    expect(receiver.injectionList).toHaveLength(0);
  });
});
