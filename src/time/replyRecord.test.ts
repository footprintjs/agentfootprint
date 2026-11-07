import { expect, it } from 'vitest';
import { isTimeReplyEvidence } from './replyRecord.js';
import { isTimeRowKind, timeReplyRow, timeRowIsWellFormed } from './rows.js';

it('keeps only the bounded decision and rule in the existing time ledger', () => {
  const row = timeReplyRow(
    { decision: 'reask', rule: 'zone-corrected' },
    { turn: 1, iteration: 2 },
    0,
  );
  expect(row).toEqual({
    kind: 'time-reply',
    turn: 1,
    iteration: 2,
    mention: 0,
    decision: 'reask',
    rule: 'zone-corrected',
  });
  expect(isTimeRowKind(row.kind)).toBe(true);
  expect(timeRowIsWellFormed(row)).toBe(true);
  expect(timeRowIsWellFormed({ ...row, correction: 'private answer' })).toBe(false);
});

it('rejects invented decisions, rules, and raw fields', () => {
  for (const evidence of [
    { decision: 'executed', rule: 'range-confirmed' },
    { decision: 'hold', rule: 'guessed' },
    { decision: 'hold', rule: 'neither-filled', answer: 'private answer' },
  ])
    expect(isTimeReplyEvidence(evidence)).toBe(false);
});

it('never calls an accessor to read evidence', () => {
  let reads = 0;
  const evidence = { rule: 'zone-corrected' };
  Object.defineProperty(evidence, 'decision', {
    enumerable: true,
    get: () => {
      reads++;
      return 'reask';
    },
  });
  expect(isTimeReplyEvidence(evidence)).toBe(false);
  expect(reads).toBe(0);
});
