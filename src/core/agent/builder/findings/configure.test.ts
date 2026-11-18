import { describe, expect, it } from 'vitest';
import { LOCAL_SOURCE } from '../../../../recipes/provenance.js';
import { configureFindings, type FindingsPort } from './configure.js';

function declaration(): FindingsPort {
  return {
    injectionList: [],
    injectionSources: new Map(),
    currentSource: () => LOCAL_SOURCE,
  };
}

describe('findings declaration', () => {
  it('keeps source opt-in data and records the instruction before provenance lookup', () => {
    const receiver = declaration();
    const sourceIds: string[] = [];
    receiver.currentSource = () => {
      sourceIds.push(receiver.injectionList[0]?.id ?? 'missing');
      return LOCAL_SOURCE;
    };
    expect(
      configureFindings(receiver, { argumentSources: true, answerAsk: 'quote-facts' }, receiver),
    ).toBe(receiver);
    expect(receiver.findingsValue?.argumentSources).toBe(true);
    expect(receiver.findingsValue?.answerAsk).toBe('quote-facts');
    expect(sourceIds).toEqual(['findings-ledger']);
    expect(receiver.injectionSources.get('findings-ledger')).toBe(LOCAL_SOURCE);
  });

  it('refuses invalid option data before mutating the declaration', () => {
    const receiver = declaration();
    const bad = { answerAsk: 'other' } as unknown as Parameters<typeof configureFindings>[1];
    expect(() => configureFindings(receiver, bad, receiver)).toThrow('answerAsk must be');
    expect(receiver.findingsValue).toBeUndefined();
    expect(receiver.injectionList).toHaveLength(0);
    expect(receiver.injectionSources.size).toBe(0);
  });
});
