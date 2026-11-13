/**
 * `semantics/toolRan.ts` — the one law of "did this call's tool run?", both
 * halves: the writer every `tool_end` passes and the reader every reader asks.
 *
 * Test types: UNIT (each row of the law), PROPERTY (writer → reader agree for
 * every bracket shape the dispatch can hand the door, enumerated exhaustively),
 * BOUNDARY (a success and a bracket another marker explains keep their bytes,
 * by reference; a saved leaf that is not a boolean proves nothing).
 */
import { describe, expect, it } from 'vitest';

import { toolRanOf, withEntered } from '../../src/semantics/toolRan.js';

describe('toolRanOf — the reader', () => {
  it('reads the markers that prove the tool never ran', () => {
    expect(toolRanOf({ notDispatched: { pausedCall: { toolCallId: 'p', toolName: 'q' } } })).toBe(
      'not-run',
    );
    expect(toolRanOf({ notExecuted: true })).toBe('not-run');
    expect(toolRanOf({ error: true, entered: false })).toBe('not-run');
    expect(toolRanOf({ entered: false })).toBe('not-run');
  });

  it('reads `entered: true` as ran, error or not', () => {
    expect(toolRanOf({ error: true, entered: true })).toBe('ran');
  });

  it('an error with no stamp is a record that does not say (written before `entered`)', () => {
    expect(toolRanOf({ error: true })).toBe('not-recorded');
  });

  it('a bracket without error or marker is a tool that returned', () => {
    expect(toolRanOf({})).toBe('ran');
  });
});

describe('withEntered — the writer', () => {
  it('a success keeps its bytes: the same object, nothing added', () => {
    const success = { toolCallId: 'c1', result: 'ok', durationMs: 3 };
    expect(withEntered(success, true)).toBe(success);
  });

  it('a bracket another marker explains keeps its bytes', () => {
    const refused = { toolCallId: 'c1', result: 'no', durationMs: 0, notExecuted: true as const };
    const settled = {
      toolCallId: 'c2',
      result: 'not run',
      durationMs: 0,
      notDispatched: { pausedCall: { toolCallId: 'p', toolName: 'q' } },
    };
    expect(withEntered(refused, false)).toBe(refused);
    expect(withEntered(settled, false)).toBe(settled);
  });

  it('stamps `entered: false` on a call that never ran, and `true` beside an error of one that did', () => {
    expect(withEntered({ error: true }, false)).toEqual({ error: true, entered: false });
    expect(withEntered({}, false)).toEqual({ entered: false });
    expect(withEntered({ error: true }, true)).toEqual({ error: true, entered: true });
  });

  it('PROPERTY — the reader gives back what the writer was told, for every bracket the door gets', () => {
    const flags = [false, true];
    let shapes = 0;
    for (const ran of flags)
      for (const error of flags)
        for (const refused of flags)
          for (const settled of flags) {
            // A rule refusal and a settlement never come with a run tool: the dispatch's own law.
            if (ran && (refused || settled)) continue;
            const bracket = {
              ...(error && { error: true }),
              ...(refused && { notExecuted: true as const }),
              ...(settled && { notDispatched: { pausedCall: { toolCallId: 'p', toolName: 'q' } } }),
            };
            expect(toolRanOf(withEntered(bracket, ran))).toBe(ran ? 'ran' : 'not-run');
            shapes += 1;
          }
    expect(shapes).toBe(10);
  });
});

describe('toolRanOf — a saved record is data', () => {
  it('a leaf that is not a boolean is a record that does not say: it never proves the tool ran', () => {
    expect(toolRanOf({ error: true, entered: 'true' })).toBe('not-recorded');
    expect(toolRanOf({ error: true, entered: 1 })).toBe('not-recorded');
    expect(toolRanOf({ error: 'yes', entered: 'no' })).toBe('not-recorded');
    expect(toolRanOf({ notExecuted: 'true', error: true })).toBe('not-recorded');
    // With no `error` at all, too: a placeholder or a hand-edited stamp is not "it returned".
    expect(toolRanOf({ entered: 'false' })).toBe('not-recorded');
    expect(toolRanOf({ entered: '[REDACTED]' })).toBe('not-recorded');
    expect(toolRanOf({ error: 'true' })).toBe('not-recorded');
    expect(toolRanOf({ notExecuted: 'true' })).toBe('not-recorded');
    // A boolean `false` leaf is a value a reader can read: it is not a gap.
    expect(toolRanOf({ error: false })).toBe('ran');
  });
});
