import { describe, expect, it } from 'vitest';
import { configureClaims, type ClaimsPort } from './configure.js';

describe('the builder claim contract', () => {
  it('keeps declaration identity and refuses a duplicate before enumerating new fields', () => {
    const receiver: ClaimsPort = {};
    const contract = { answer: { entity: 'server', field: 'state' } };
    expect(configureClaims(receiver, contract, receiver)).toBe(receiver);
    expect(receiver.claimsContract).toBe(contract);
    const duplicate = new Proxy(contract, {
      ownKeys() {
        throw new Error('duplicate contract must not be enumerated');
      },
    });
    expect(() => configureClaims(receiver, duplicate, receiver)).toThrow(/already declared/);
  });

  it('refuses an empty or incomplete join without half-recording a valid prefix', () => {
    const receiver: ClaimsPort = {};
    expect(() => configureClaims(receiver, {}, receiver)).toThrow(/names no fields/);
    expect(() =>
      configureClaims(
        receiver,
        {
          first: { entity: 'server', field: 'state' },
          broken: { entity: '', field: 'state' },
        },
        receiver,
      ),
    ).toThrow(/'broken'.*non-empty entity and field/);
    expect(receiver.claimsContract).toBeUndefined();
  });
});
