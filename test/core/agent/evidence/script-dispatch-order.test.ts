/**
 * `rows.ts` · `scriptRowsOfTurn` — the reader the match and the attachment
 * share reads one row per DISPATCH (the last one filed), in the order those
 * last rows were filed: execution order. A provider id names nothing here.
 */

import { describe, expect, it } from 'vitest';

import { scriptRowsOfTurn } from '../../../../src/core/agent/scripts/rows.js';
import type { ScriptRow } from '../../../../src/core/agent/scripts/types.js';

const row = (dispatch: number, toolCallId: string, extra: Partial<ScriptRow> = {}): ScriptRow => ({
  kind: 'script',
  toolCallId,
  dispatch,
  tool: 'run_code',
  argument: 'code',
  bytes: 1,
  lines: 1,
  text: `p${dispatch}`,
  outcome: 'returned',
  turn: 1,
  iteration: 1,
  ...extra,
});

describe('scriptRowsOfTurn', () => {
  it('one row per dispatch — two dispatches that share a provider id are two calls', () => {
    const turn = scriptRowsOfTurn([row(1, 'a'), row(2, 'b'), row(3, 'a')], 1);
    expect(turn.current.map((r) => [r.dispatch, r.toolCallId])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'a'],
    ]);
  });

  it('the last row of a dispatch wins, and the dispatch sits where that row was filed', () => {
    // Dispatch 1 paused (no text), dispatch 2 ran, then dispatch 1 settled.
    const paused = row(1, 'a', { outcome: 'submitted', text: undefined });
    const turn = scriptRowsOfTurn([paused, row(2, 'b'), row(1, 'a')], 1);
    expect(turn.current.map((r) => [r.dispatch, r.outcome])).toEqual([
      [2, 'returned'],
      [1, 'returned'],
    ]);
  });

  it('earlier turns are counted by dispatch, never compared', () => {
    const turn = scriptRowsOfTurn(
      [row(1, 'a', { turn: 1 }), row(2, 'a', { turn: 1 }), row(1, 'a', { turn: 2 })],
      2,
    );
    expect(turn.current).toHaveLength(1);
    expect(turn.earlier).toBe(2);
  });
});
