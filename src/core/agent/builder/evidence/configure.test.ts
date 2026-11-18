import { describe, expect, it } from 'vitest';
import type { NamesAndNumbersOptions } from '../../evidence/types.js';
import { configureEvidence, type EvidencePort } from './configure.js';

describe('the builder evidence declaration', () => {
  it('refuses a bad posture at registration and still accepts a later valid gate', () => {
    const receiver: EvidencePort = {};
    const invalid = { posture: 'certain' } as unknown as NamesAndNumbersOptions;
    expect(() => configureEvidence(receiver, invalid, receiver)).toThrow(/posture 'certain'/);
    expect(receiver.evidenceGate).toBeUndefined();
    configureEvidence(receiver, { posture: 'guard', minDigits: 6, nudge: true }, receiver);
    expect(receiver.evidenceGate).toMatchObject({ posture: 'guard', minDigits: 6, nudge: true });
  });

  it('refuses a second gate before reading replacement options', () => {
    const receiver: EvidencePort = {};
    configureEvidence(receiver, undefined, receiver);
    const original = receiver.evidenceGate;
    const replacement: NamesAndNumbersOptions = {
      get posture(): never {
        throw new Error('replacement must not be read');
      },
    };
    expect(() => configureEvidence(receiver, replacement, receiver)).toThrow(/already set/);
    expect(receiver.evidenceGate).toBe(original);
  });
});
