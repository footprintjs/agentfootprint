/**
 * envelope — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * One rule under test: a format this runtime does not know is refused BY NAME,
 * never guessed at. A store outlives the code that wrote to it, so an older
 * reader WILL meet a newer payload one day; the only honest thing it can do is
 * say which format it found, which ones it knows, and stop.
 */

import { describe, expect, it } from 'vitest';

import { readEnvelope, toEnvelope } from '../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../src/index.js';

const conversation: AgentRunCheckpoint = {
  version: 1,
  runId: 'run-1',
  history: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ],
  lastCompletedIteration: 1,
  originalInput: { message: 'hello' },
  checkpointedAt: 1_700_000_000_000,
};

describe('toEnvelope', () => {
  it('names the format and stamps when it was packed', () => {
    const packed = toEnvelope(conversation);
    expect(packed.format).toBe('conversation-v1');
    expect(packed.data).toBe(conversation);
    expect(typeof packed.savedAt).toBe('number');
  });

  it('produces something a store can actually hold (JSON round trip)', () => {
    const packed = toEnvelope(conversation);
    expect(JSON.parse(JSON.stringify(packed))).toEqual(packed);
    expect(structuredClone(packed)).toEqual(packed);
  });
});

describe('readEnvelope', () => {
  it('unpacks what toEnvelope packed, losslessly', () => {
    expect(readEnvelope(toEnvelope(conversation))).toEqual(conversation);
  });

  it('survives the trip through a real store (JSON both ways)', () => {
    const wire = JSON.stringify(toEnvelope(conversation));
    expect(readEnvelope(JSON.parse(wire))).toEqual(conversation);
  });

  it('refuses an unknown format BY NAME, and says what it can read', () => {
    const future = { format: 'conversation-v2', data: conversation, savedAt: 1 };
    expect(() => readEnvelope(future)).toThrow(/unknown checkpoint format 'conversation-v2'/);
    expect(() => readEnvelope(future)).toThrow(/reads: conversation-v1/);
    expect(() => readEnvelope(future)).toThrow(TypeError);
  });

  it('refuses a missing format rather than assuming the only one it knows', () => {
    expect(() => readEnvelope({ data: conversation, savedAt: 1 })).toThrow(
      /unknown checkpoint format 'undefined'/,
    );
  });

  it.each([
    ['null', null],
    ['a string', 'conversation-v1'],
    ['a number', 7],
    ['an array', []],
  ])('refuses %s as an envelope', (_label, value) => {
    expect(() => readEnvelope(value)).toThrow(TypeError);
  });

  it('refuses a known format whose conversation is malformed', () => {
    expect(() => readEnvelope({ format: 'conversation-v1', data: {}, savedAt: 1 })).toThrow(
      /unsupported checkpoint version/,
    );
    expect(() =>
      readEnvelope({ format: 'conversation-v1', data: { version: 1 }, savedAt: 1 }),
    ).toThrow(/missing required fields/);
  });

  it('never returns a partially-restored conversation on refusal', () => {
    // The refusal path throws; there is no half-value to accidentally use.
    let escaped: unknown = 'nothing';
    try {
      escaped = readEnvelope({ format: 'conversation-v9', data: conversation, savedAt: 1 });
    } catch {
      /* expected */
    }
    expect(escaped).toBe('nothing');
  });
});
