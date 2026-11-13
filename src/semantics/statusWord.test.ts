/**
 * The status word a tool writes is read ONCE (`toolOutcome.ts` ·
 * `readToolResultStatus`), and a word the library does not know is kept,
 * cleaned, to be told (`toolEffects.ts` · `unknownStatusOf`).
 */
import { describe, expect, it } from 'vitest';
import { readToolResultStatus, TOOL_RESULT_STATUSES } from './toolOutcome.js';
import {
  explainStatusOnlyNearMiss,
  readToolResultEnvelope,
  unknownStatusOf,
  unknownStatusWarning,
} from './toolEffects.js';
import { plainLineOf } from '../lib/plainLine.js';

describe('readToolResultStatus — one reading of a status word', () => {
  it('reads every known word as itself', () => {
    for (const word of TOOL_RESULT_STATUSES) expect(readToolResultStatus(word)).toBe(word);
  });

  it('a second spelling of a known word (case, surrounding spaces) is that word', () => {
    expect(readToolResultStatus('FAILURE')).toBe('failure');
    expect(readToolResultStatus(' Denied ')).toBe('denied');
    expect(readToolResultStatus('\tPartial\n')).toBe('partial');
  });

  it('anything else is no word', () => {
    expect(readToolResultStatus('oops')).toBeUndefined();
    expect(readToolResultStatus('fail ure')).toBeUndefined();
    expect(readToolResultStatus('')).toBeUndefined();
    expect(readToolResultStatus(404)).toBeUndefined();
    expect(readToolResultStatus(undefined)).toBeUndefined();
  });
});

describe('the envelope reads the word through it', () => {
  it("{ content, effects: [], status: 'FAILURE' } is an envelope with status 'failure'", () => {
    const read = readToolResultEnvelope({ content: 'x', effects: [], status: 'FAILURE' });
    expect(read?.status).toBe('failure');
    expect(read?.content).toBe('x');
  });

  it('an unknown word still makes the whole value data', () => {
    expect(readToolResultEnvelope({ content: 'x', effects: [], status: 'oops' })).toBeUndefined();
  });

  it('the near-miss diagnosis reads the same word, and names it as read', () => {
    const teaching = explainStatusOnlyNearMiss({ content: 'x', status: 'Denied' });
    expect(teaching).toContain("status: 'denied'");
  });
});

describe('unknownStatusOf — an envelope in every way but its word', () => {
  it('returns the word', () => {
    expect(unknownStatusOf({ content: 'x', effects: [], status: 'oops' })).toBe('oops');
    expect(unknownStatusOf({ content: 'x', effects: [], status: 503 })).toBe('503');
  });

  it('nothing for a known word, a value without the marker, or a domain object', () => {
    expect(unknownStatusOf({ content: 'x', effects: [], status: 'FAILURE' })).toBeUndefined();
    expect(unknownStatusOf({ content: 'x', status: 'draft' })).toBeUndefined();
    expect(unknownStatusOf({ content: 'x', effects: [], status: 'oops', rows: 1 })).toBeUndefined();
    expect(unknownStatusOf({ content: 'x', effects: [{ kind: 'mine' }], status: 'oops' })).toBe(
      undefined,
    );
    expect(unknownStatusOf({ content: 'x', effects: [] })).toBeUndefined();
    expect(unknownStatusOf({ content: 'x', effects: [], status: { a: 1 } })).toBeUndefined();
    expect(unknownStatusOf('oops')).toBeUndefined();
  });

  it('cleans the word: no control, separator or invisible format character; at most 40 characters', () => {
    expect(unknownStatusOf({ content: 'x', effects: [], status: 'a\u202Eb\u2028c\nd' })).toBe(
      'abcd',
    );
    expect(unknownStatusOf({ content: 'x', effects: [], status: 'y'.repeat(41) })).toBe(
      'y'.repeat(40) + '…',
    );
    // Nothing visible left: no word to tell.
    expect(unknownStatusOf({ content: 'x', effects: [], status: '\u200B' })).toBeUndefined();
  });

  it('the dev-mode warning names the word and the seven', () => {
    const warning = unknownStatusWarning('oops');
    expect(warning).toContain('"oops"');
    expect(warning).toContain("'absent'");
  });
});

describe('plainLineOf', () => {
  it('never splits a surrogate pair when it cuts', () => {
    expect(plainLineOf('😀😀😀', 2)).toBe('😀😀…');
  });
});
