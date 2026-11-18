import { describe, expect, it } from 'vitest';
import { preparedArgumentWitness } from './preparedArgumentWitness.js';

describe('the prepared argument witness', () => {
  it('keeps independent evidence of the complete prepared data', () => {
    const prepared = { selected: { name: 'sample', count: 3 }, flags: ['summary'] };
    const matches = preparedArgumentWitness(prepared);
    expect(matches(structuredClone(prepared))).toBe(true);
    prepared.selected.count = 4;
    expect(matches(prepared)).toBe(false);
  });

  it('compares binary data, view bounds, and time values', () => {
    const colors = Uint8Array.of(7, 9, 11);
    const viewing = new Uint8Array(colors.buffer, 1, 1);
    const saved = { colors, viewing, start: new Date('2025-04-05T10:00:00Z') };
    const matches = preparedArgumentWitness(saved);
    expect(matches(structuredClone(saved))).toBe(true);
    expect(matches({ ...saved, viewing: new Uint8Array(colors.buffer, 1, 2) })).toBe(false);
    colors[1] = 12;
    expect(matches(saved)).toBe(false);
  });

  it('preserves references and compares standard collection entries', () => {
    const token = { label: 'sample' };
    const data = { selected: token, known: new Map([[token, new Set([token])]]) };
    const matches = preparedArgumentWitness(data);
    expect(matches(structuredClone(data))).toBe(true);
    expect(matches({ ...data, selected: { ...token } })).toBe(false);
  });
});
