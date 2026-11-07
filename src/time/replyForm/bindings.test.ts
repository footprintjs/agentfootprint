import { expect, it } from 'vitest';
import { hasDeclaredTimeReply, timeReplyPairs } from '../replyForm.js';

const request = () => ({
  fields: [
    { id: 'f1', type: 'string', required: false, format: 'time-range', enum: ['a/b'] },
    { id: 'f2', type: 'number', required: true },
    { id: 'f1-correction', type: 'string', required: false },
  ],
  context: {
    agentfootprint: {
      ask: 'arguments',
      fields: [{ id: 'f1', timeReply: { version: 1, correction: 'f1-correction' } }, { id: 'f2' }],
    },
  },
});
it('admits only a complete association without renumbering ordinary fields', () => {
  expect(timeReplyPairs(request())).toEqual([{ range: 'f1', correction: 'f1-correction' }]);
  expect(hasDeclaredTimeReply(request())).toBe(true);
});
it('a legacy marker or suffix alone admits no new role', () => {
  const legacy = request();
  delete (legacy.context.agentfootprint.fields[0] as { timeReply?: unknown }).timeReply;
  expect(timeReplyPairs(legacy)).toEqual([]);
  expect(timeReplyPairs({ fields: request().fields })).toEqual([]);
  const foreign = request();
  foreign.context.agentfootprint.ask = 'other';
  expect(timeReplyPairs(foreign)).toEqual([]);
});
it('does not invoke a getter to discover a binding', () => {
  let reads = 0;
  const context = {};
  Object.defineProperty(context, 'agentfootprint', {
    get() {
      reads++;
      return request().context.agentfootprint;
    },
  });
  expect(timeReplyPairs({ fields: request().fields, context })).toEqual([]);
  expect(reads).toBe(0);
});
for (const field of ['required', 'format', 'type'] as const)
  it(`refuses a changed ${field} on its saved range field`, () => {
    const changed = request();
    Object.assign(changed.fields[0], { [field]: field === 'required' ? true : 'changed' });
    expect(() => timeReplyPairs(changed)).toThrow('Malformed time reply field binding');
  });
it('refuses a missing sibling and a forged association to an ordinary field', () => {
  const missing = request();
  missing.fields.pop();
  expect(() => timeReplyPairs(missing)).toThrow();
  const forged = request();
  forged.context.agentfootprint.fields[0].timeReply!.correction = 'f2';
  expect(() => timeReplyPairs(forged)).toThrow();
});
