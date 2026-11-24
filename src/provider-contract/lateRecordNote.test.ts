import { describe, expect, it } from 'vitest';
import { LATE_RECORD_NOTE_ATTRIBUTION } from '../lib/saidByPerson.js';
import {
  beginLateRecordNote,
  carryLateRecordNoteResponse,
  lateRecordNoteRouter,
  trackLateRecordNote,
} from './lateRecordNote.js';
import { refuseObservedRequest, requestAttempt } from './requestObserver.js';
import type { LLMProvider, LLMResponse } from './types.js';

const text = `${LATE_RECORD_NOTE_ATTRIBUTION}\n[]`;
const request = { model: 'scripted', messages: [{ role: 'user', content: 'person' }] } as const;
const answer = (content = 'result'): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 0, output: 0 },
});
const target = (): LLMProvider => ({ name: 'scripted', complete: async () => answer() });

function submit(native: NonNullable<ReturnType<typeof beginLateRecordNote>>) {
  const block = { role: 'user', content: native.note };
  native.handoff([...request.messages, block], block);
}

describe('private late record note custody', () => {
  it('only attests the exact final block at an active leaf and its actual response', () => {
    const owner = trackLateRecordNote(text, false);
    const leaf = target();
    const attempt = requestAttempt(owner.hooks({}), request, leaf);
    const native = beginLateRecordNote(attempt.hooks, leaf, 'plain')!;
    const response = answer();
    expect(native.note).toBe(text);
    submit(native);
    native.accept(response);
    attempt.close('response');
    const receipt = { ordinal: 1, disposition: 'submitted' };
    expect(owner.receipt(response)).toEqual({ attempts: [receipt], accepted: receipt });
    expect(owner.receipt(answer())).toEqual({ attempts: [receipt] });
    expect(owner.receipt(carryLateRecordNoteResponse(response, { ...response })).accepted).toEqual(
      receipt,
    );
    expect(
      owner.receipt(carryLateRecordNoteResponse(response, answer('other'))).accepted,
    ).toBeUndefined();
    expect(JSON.stringify(owner.receipt(response))).not.toContain(text);
  });

  it('never gives opaque forwarding or a modified router a leaf capability', () => {
    const owner = trackLateRecordNote(text, false);
    const leaf = target();
    const opaque = target();
    const outer = requestAttempt(owner.hooks({}), request, opaque);
    expect(beginLateRecordNote(outer.hooks, leaf, 'plain')).toBeUndefined();
    const forwarded = requestAttempt(outer.hooks, request, leaf);
    expect(beginLateRecordNote(forwarded.hooks, leaf, 'plain')).toBeUndefined();
    outer.close();
    const changed = lateRecordNoteRouter(target());
    const wrapped = requestAttempt(owner.hooks({}), request, changed);
    Object.assign(changed, { complete: async () => answer() });
    expect(
      beginLateRecordNote(requestAttempt(wrapped.hooks, request, leaf).hooks, leaf, 'plain'),
    ).toBeUndefined();
    wrapped.close();
  });

  it('proves independent leaves under an owned router without borrowing a failed leaf', () => {
    const owner = trackLateRecordNote(text, false);
    const router = lateRecordNoteRouter(target());
    const plain = target();
    const signing = target();
    const outer = requestAttempt(owner.hooks({}), request, router);
    const first = requestAttempt(outer.hooks, request, plain);
    const sent = beginLateRecordNote(first.hooks, plain, 'plain')!;
    submit(sent);
    first.close('failed');
    const second = requestAttempt(outer.hooks, request, signing);
    const suppressed = beginLateRecordNote(second.hooks, signing, 'signing')!;
    expect(suppressed.note).toBeUndefined();
    suppressed.handoff(request.messages);
    const accepted = answer();
    suppressed.accept(accepted);
    second.close('response');
    outer.close('response');
    expect(owner.receipt(accepted)).toEqual({
      attempts: [
        { ordinal: 1, disposition: 'submitted' },
        { ordinal: 2, disposition: 'omitted' },
      ],
      accepted: { ordinal: 2, disposition: 'omitted' },
    });
  });

  it.each(['copy', 'edited', 'duplicated', 'not-last'] as const)(
    'does not credit a %s block',
    (fault) => {
      const leaf = target();
      const owner = trackLateRecordNote(text, false);
      const attempt = requestAttempt(owner.hooks({}), request, leaf);
      const native = beginLateRecordNote(attempt.hooks, leaf, 'plain')!;
      const block = { role: 'user', content: native.note };
      const rows =
        fault === 'copy'
          ? [{ ...block }]
          : fault === 'edited'
          ? [Object.assign(block, { content: 'changed' })]
          : fault === 'duplicated'
          ? [block, block]
          : [block, ...request.messages];
      native.handoff(rows, block);
      const response = answer();
      native.accept(response);
      attempt.close('response');
      expect(owner.receipt(response).accepted).toEqual({ ordinal: 1, disposition: 'unavailable' });
    },
  );

  it('keeps a bound continuation note-free and refuses a late witness after cancellation', () => {
    const leaf = target();
    const owner = trackLateRecordNote(text, true);
    const attempt = requestAttempt(owner.hooks({}), request, leaf);
    const native = beginLateRecordNote(attempt.hooks, leaf, 'plain')!;
    expect(native.note).toBeUndefined();
    refuseObservedRequest(attempt.hooks);
    attempt.close();
    native.handoff(request.messages);
    const response = answer();
    native.accept(response);
    expect(owner.receipt(response)).toEqual({
      attempts: [{ ordinal: 1, disposition: 'not-dispatched' }],
    });
  });
});
