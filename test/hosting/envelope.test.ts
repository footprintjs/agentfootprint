/**
 * envelope — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Two rules under test, and they are the same rule at two depths.
 *
 * A format this runtime does not know is refused BY NAME, never guessed at. A
 * store outlives the code that wrote to it, so an older reader WILL meet a newer
 * payload one day; the only honest thing it can do is say which format it found,
 * which ones it knows, and stop.
 *
 * And one step earlier: bytes that are not an envelope AT ALL are refused by
 * name too, rather than reported as "no session". An unreadable stored
 * conversation and an absent one are different facts, and only one of them is
 * safe to answer with a fresh start.
 */

import { describe, expect, it } from 'vitest';

import {
  checkEnvelope,
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
  UnreadableEnvelopeError,
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

  it('names the session when the store passes one', () => {
    try {
      checkEnvelope('{format=conversation-v1, data={}}', 'c-1');
      expect.unreachable('checkEnvelope accepted bytes that are not an envelope');
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadableEnvelopeError);
      expect((err as UnreadableEnvelopeError).sessionId).toBe('c-1');
      expect((err as Error).message).toContain("session 'c-1'");
    }
  });
});

// ─── the law: PRESENT-but-unreadable is not ABSENT ───────────────────
//
// This is the half of the envelope law that a store gets wrong silently. An
// unknown FORMAT is at least an envelope, and refusing it was never in doubt.
// Bytes that are not an envelope at all — a store that kept its own encoding
// and handed back its host language's `toString()` of the object — used to be
// something a store could shrug at and answer `undefined` to, which reads as
// "new conversation" all the way out to the user.
//
// The law lives at `readFormat`, the one place a stored value is inspected, so
// every reader here and every store adapter that calls one inherits it —
// including adapters nobody has written yet. These tests are written against
// the READERS rather than against any adapter for exactly that reason.

describe('the reading path — unreadable is refused, never treated as absent', () => {
  /** The exact shape a field deployment got back: a Java-style toString, not JSON. */
  const MANGLED =
    '{format=conversation-v1, data={version=1, runId=run-7, history=[{role=user, ' +
    'content=hello}]}, savedAt=1754000000000}';

  it.each([
    ['checkEnvelope', (v: unknown) => checkEnvelope(v)],
    ['readEnvelope', (v: unknown) => readEnvelope(v)],
    ['readPausedRun', (v: unknown) => readPausedRun(v)],
  ])('%s refuses a mangled stored value BY NAME', (_label, read) => {
    expect(() => read(MANGLED)).toThrow(UnreadableEnvelopeError);
    expect(() => read(MANGLED)).toThrow(/present but unreadable/);
    expect(() => read(MANGLED)).toThrow(/different facts/);
    // The diagnosis a reader needs: this LOOKS like our envelope, stringified
    // by something that was not JSON.
    expect(() => read(MANGLED)).toThrow(/format=conversation-v1/);
  });

  it('carries the code a caller can branch on without matching prose', () => {
    try {
      checkEnvelope(MANGLED, 'c-1');
      expect.unreachable('a mangled envelope was accepted');
    } catch (err) {
      expect((err as UnreadableEnvelopeError).code).toBe('ERR_UNREADABLE_ENVELOPE');
    }
  });

  it('quotes a prefix only — the rest of those bytes is the conversation', () => {
    const secret = 'x'.repeat(400);
    const long = `{format=conversation-v1, data={history=[{role=user, content=${secret}}]}}`;
    try {
      checkEnvelope(long, 'c-1');
      expect.unreachable('a mangled envelope was accepted');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('format=conversation-v1');
      expect(message).not.toContain(secret);
      expect((err as UnreadableEnvelopeError).storedPreview.length).toBeLessThan(long.length / 4);
    }
  });

  it.each([
    ['a number', 7],
    ['a boolean', true],
    ['an array', [{ blob: 'x' }]],
    ['null', null],
  ])('refuses %s the same way — nothing here is a fresh start', (_label, value) => {
    expect(() => checkEnvelope(value)).toThrow(UnreadableEnvelopeError);
  });

  it('holds for a store adapter nobody has written yet', async () => {
    // The criterion for where the law lives: a NEW adapter gets it for free,
    // without knowing this rule exists, as long as it reads through the shared
    // path. This one keeps its sessions as text and forgets to decode.
    const someFutureStore = {
      raw: new Map<string, string>([['c-1', MANGLED]]),
      async hydrate(sessionId: string) {
        const stored = this.raw.get(sessionId);
        return stored === undefined ? undefined : checkEnvelope(stored, sessionId);
      },
    };
    await expect(someFutureStore.hydrate('c-1')).rejects.toThrow(UnreadableEnvelopeError);
    await expect(someFutureStore.hydrate('c-1')).rejects.toThrow(/session 'c-1'/);
    // …and a session it never wrote is still an ordinary absence.
    await expect(someFutureStore.hydrate('never-seen')).resolves.toBeUndefined();
  });

  it('is still a TypeError, so nothing that caught one before stops catching', () => {
    expect(() => readEnvelope(MANGLED)).toThrow(TypeError);
  });
});
