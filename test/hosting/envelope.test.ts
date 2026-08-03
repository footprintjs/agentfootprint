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

import {
  checkEnvelope,
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
} from '../../src/hosting/index.js';
import type { PausedRun } from '../../src/hosting/index.js';
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

const pausedRun: PausedRun = {
  checkpoint: {
    sharedState: { history: [{ role: 'user', content: 'hello' }] },
    executionTree: {},
    pausedStageId: 'tool-calls',
    subflowPath: [],
    subflowStates: {},
    pausedAt: 1_700_000_000_000,
  },
  conversation,
  pending: { tool: 'approve_refund', question: 'ok?', pauseData: { question: 'ok?' } },
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

// ─── 'flowchart-v1' — the format the version field was kept for ──────

describe('toPausedEnvelope', () => {
  it('names the format and stamps when it was packed', () => {
    const packed = toPausedEnvelope(pausedRun);
    expect(packed.format).toBe('flowchart-v1');
    expect(packed.data).toBe(pausedRun);
    expect(typeof packed.savedAt).toBe('number');
  });

  it('survives the trip through a real store (JSON both ways)', () => {
    const wire = JSON.stringify(toPausedEnvelope(pausedRun));
    expect(readPausedRun(JSON.parse(wire))).toEqual(pausedRun);
  });
});

describe('readPausedRun', () => {
  it('unpacks what toPausedEnvelope packed, losslessly', () => {
    expect(readPausedRun(toPausedEnvelope(pausedRun))).toEqual(pausedRun);
  });

  it('refuses an unknown format BY NAME, and says what it can read', () => {
    const future = { format: 'flowchart-v9', data: pausedRun, savedAt: 1 };
    expect(() => readPausedRun(future)).toThrow(/unknown checkpoint format 'flowchart-v9'/);
    expect(() => readPausedRun(future)).toThrow(/reads: conversation-v1, flowchart-v1/);
  });

  it.each([
    ['no checkpoint', { conversation, pending: {} }, /missing required field: checkpoint/],
    [
      'a checkpoint with no cursor',
      { checkpoint: { sharedState: {} }, conversation, pending: {} },
      /missing required fields \(pausedStageId, sharedState\)/,
    ],
    [
      'no subflowPath',
      {
        checkpoint: { pausedStageId: 'x', sharedState: {} },
        conversation,
        pending: {},
      },
      /missing required field: subflowPath/,
    ],
    [
      'no pending ask',
      { checkpoint: { pausedStageId: 'x', sharedState: {}, subflowPath: [] }, conversation },
      /missing required field: pending/,
    ],
  ])('refuses a paused run with %s, naming it', (_label, data, pattern) => {
    expect(() => readPausedRun({ format: 'flowchart-v1', data, savedAt: 1 })).toThrow(pattern);
  });
});

// ─── the two readers refuse each other, and say which to use ─────────

describe('readEnvelope / readPausedRun — symmetric refusals', () => {
  it('readEnvelope refuses a paused run rather than half-restoring it', () => {
    const packed = toPausedEnvelope(pausedRun);
    expect(() => readEnvelope(packed)).toThrow(/holds a PAUSED RUN \('flowchart-v1'\)/);
    expect(() => readEnvelope(packed)).toThrow(/readPausedRun/);
  });

  it('readPausedRun refuses a plain conversation, and points back', () => {
    const packed = toEnvelope(conversation);
    expect(() => readPausedRun(packed)).toThrow(/holds a conversation \('conversation-v1'\)/);
    expect(() => readPausedRun(packed)).toThrow(/readEnvelope/);
  });
});

// ─── checkEnvelope — what a STORE wants ──────────────────────────────

describe('checkEnvelope', () => {
  it('accepts either format and hands it back unchanged', () => {
    const a = toEnvelope(conversation);
    const b = toPausedEnvelope(pausedRun);
    expect(checkEnvelope(a)).toBe(a);
    expect(checkEnvelope(b)).toBe(b);
  });

  it('still refuses an unknown format by name', () => {
    expect(() => checkEnvelope({ format: 'session-v4', data: {}, savedAt: 1 })).toThrow(
      /unknown checkpoint format 'session-v4'/,
    );
  });

  it('refuses a malformed payload behind a known format', () => {
    expect(() => checkEnvelope({ format: 'flowchart-v1', data: {}, savedAt: 1 })).toThrow(
      /missing required field: checkpoint/,
    );
  });
});
