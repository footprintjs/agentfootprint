import { describe, expect, it } from 'vitest';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import {
  captureDatasetLimit,
  recordServedLimits,
  type LibraryResultLimit,
  type PendingDatasetLimits,
} from '../honesty/libraryResultLimits.js';
import { toolTurnEvidenceFrom, admitToolTurnEvidence } from './toolTurnCheckpoint.js';
import type { AgentState } from '../types.js';

const call = { toolName: 'read', toolCallId: 'id', callOccurrenceKey: [1, 2, 3, 4, 0] as const };
const cut = { totalChars: 100, keptChars: 0, maxChars: 5 };
const first: LibraryResultLimit = { ...call, turn: 1, kind: 'result-cut', ...cut };

describe('result-limit receipts at the tool and checkpoint boundaries', () => {
  it('preserves the bounded evidence from a failed request and refuses an oversized checkpoint', () => {
    const full = Array<LibraryResultLimit>(MAX_ENTERED_TOOL_CALLS).fill(first);
    const state: Partial<AgentState> = { turnNumber: 1, libraryResultLimits: full };
    recordServedLimits(
      state as Parameters<typeof recordServedLimits>[0],
      call,
      true,
      undefined,
      cut,
    );
    expect(state.libraryResultLimits).toBe(full);
    expect(state.libraryResultLimitsIncomplete).toBe(true);
    const toolTurnEvidence = toolTurnEvidenceFrom(state);
    expect(admitToolTurnEvidence({ toolTurnEvidence })).toEqual({
      libraryResultLimits: full,
      libraryResultLimitsIncomplete: true,
    });
    expect(() =>
      admitToolTurnEvidence({ toolTurnEvidence: { libraryResultLimits: [...full, first] } }),
    ).toThrow(/malformed/);
  });

  it('links each visible ticket once and ignores partial refs and other mints in the same call', () => {
    const state: Partial<AgentState> = { turnNumber: 1 };
    const scope = state as Parameters<typeof recordServedLimits>[0];
    const pending: PendingDatasetLimits = {};
    const ticket = `art_${'a'.repeat(22)}`;
    const scratch = `art_${'b'.repeat(22)}`;
    const foreign = `art_${'c'.repeat(22)}`;
    captureDatasetLimit(pending, ticket, 3);
    captureDatasetLimit(pending, scratch, 40);
    const served = JSON.stringify([ticket, ticket, foreign, scratch + 'x', 'other_' + scratch]);
    recordServedLimits(scope, call, true, undefined, undefined, pending, served);
    expect(state.libraryResultLimits).toEqual([
      { ...call, turn: 1, kind: 'times-without-zone', ref: ticket, naiveCount: 3 },
    ]);
  });

  it('requires whole tickets even beside Unicode identifier characters', () => {
    const state: Partial<AgentState> = { turnNumber: 1 };
    const scope = state as Parameters<typeof recordServedLimits>[0];
    const pending: PendingDatasetLimits = {};
    const ref = `art_${'r'.repeat(22)}`;
    captureDatasetLimit(pending, ref, 2);
    recordServedLimits(
      scope,
      call,
      true,
      undefined,
      undefined,
      pending,
      JSON.stringify([`變${ref}`, `${ref}é`, `${ref}\u0301`, '$' + ref, `${ref}\u200d`]),
    );
    expect(state.libraryResultLimits).toBeUndefined();
    recordServedLimits(scope, call, true, undefined, undefined, pending, `“${ref}”`);
    expect(state.libraryResultLimits?.[0]).toMatchObject({ ref, naiveCount: 2 });
  });

  it('retains proof of a native ticket in a capped prefix across resume', () => {
    const state: Partial<AgentState> = { turnNumber: 1 };
    const ref = `art_${'t'.repeat(22)}`;
    const pending: PendingDatasetLimits = {};
    captureDatasetLimit(pending, ref, 2);
    recordServedLimits(
      state as Parameters<typeof recordServedLimits>[0],
      call,
      true,
      undefined,
      { keptChars: ref.length, maxChars: 200, totalChars: 500 },
      pending,
      JSON.stringify({ truncated: true, head: ref }),
    );
    const toolTurnEvidence = toolTurnEvidenceFrom(state);
    const recovered = admitToolTurnEvidence(JSON.parse(JSON.stringify({ toolTurnEvidence })));
    expect(recovered?.libraryResultLimits?.[1]).toEqual({
      ...call,
      turn: 1,
      kind: 'times-without-zone',
      ref,
      naiveCount: 2,
      nativeRefInCut: true,
    });
  });

  it('marks overflow only when a visible ticket could have fallen outside the bound', () => {
    const state: Partial<AgentState> = { turnNumber: 1 };
    const scope = state as Parameters<typeof recordServedLimits>[0];
    const pending: PendingDatasetLimits = {};
    let last = '';
    for (let i = 0; i <= MAX_ENTERED_TOOL_CALLS; i++) {
      last = `art_${i.toString(36).padStart(22, '0')}`;
      captureDatasetLimit(pending, last, i + 1);
    }
    expect(pending.unzonedDatasets).toHaveLength(MAX_ENTERED_TOOL_CALLS);
    recordServedLimits(scope, call, true, undefined, undefined, pending, 'ok');
    expect(state).toEqual({ turnNumber: 1 });
    recordServedLimits(scope, call, true, undefined, undefined, pending, last);
    expect(state).toEqual({ turnNumber: 1, libraryResultLimitsIncomplete: true });
  });

  it('keeps failed and withheld calls out of the receipts and hides the source of a rewrite', () => {
    const state: Partial<AgentState> = { turnNumber: 1 };
    const scope = state as Parameters<typeof recordServedLimits>[0];
    const pending = {
      unzonedDatasets: [
        { kind: 'times-without-zone' as const, naiveCount: 3, ref: `art_${'a'.repeat(22)}` },
      ],
    };
    recordServedLimits(scope, call, false, undefined, cut, pending);
    recordServedLimits(scope, call, true, 'withheld', cut, pending);
    expect(state).toEqual({ turnNumber: 1 });
    recordServedLimits(scope, call, true, 'rewritten', cut, pending);
    expect(state.libraryResultLimits).toEqual([first]);
  });
});
