import { describe, expect, it } from 'vitest';
import { resolveOutputEnforcement, type OutputEnforcementPort } from './enforcement.js';

function declaration(): OutputEnforcementPort {
  return {
    outputSchemaParser: { parse: (value: unknown) => value },
    outputSchemaStrategy: 'instruct',
    outputSchemaRetries: 0,
    registry: [],
    injectionList: [],
    opts: {},
  };
}

describe('output transport resolution', () => {
  it('keeps a declared zero-retry contract mounted without a retry branch', () => {
    const receiver = declaration();
    const resolved = resolveOutputEnforcement(receiver, undefined);
    expect(resolved?.parser).toBe(receiver.outputSchemaParser);
    expect(resolved?.retries).toBe(0);
    expect(resolved?.schemaTool).toBeUndefined();
    expect(resolved?.outputFormat).toBeUndefined();
  });

  it('names incompatible self-explain tools before trying to read the schema', () => {
    const receiver = declaration();
    receiver.outputSchemaStrategy = 'tool-forced';
    receiver.selfExplainConfig = {};
    Object.defineProperty(receiver, 'outputSchemaJson', {
      get() {
        throw new Error('schema was read');
      },
    });
    expect(() => resolveOutputEnforcement(receiver, undefined)).toThrow('has .selfExplain()');
  });

  it('keeps auto transport on instruction when the parser supplies no JSON schema', () => {
    const receiver = declaration();
    receiver.outputSchemaStrategy = 'auto';
    expect(resolveOutputEnforcement(receiver, undefined)?.outputFormat).toBeUndefined();
    receiver.outputSchemaStrategy = 'native';
    expect(() => resolveOutputEnforcement(receiver, undefined)).toThrow('does not offer one');
  });
});
