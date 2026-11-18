/** A stored conversation's history at the checkpoint door (`checkpointHistory.ts`). */
import { describe, expect, it } from 'vitest';
import { admitStoredHistory } from './checkpointHistory.js';

describe('admitStoredHistory', () => {
  it('admits messages that carry text', () => {
    expect(() => admitStoredHistory([{ role: 'user', content: 'hi' }])).not.toThrow();
  });

  it('names the first entry that is not a message, or has no text', () => {
    expect(() => admitStoredHistory([null])).toThrow(/history\[0\] is not a message/);
    expect(() => admitStoredHistory([{ role: 'user', content: 'a' }, { role: 'user' }])).toThrow(
      /history\[1\] is missing text: `role` is string, `content` is missing/,
    );
  });
});
