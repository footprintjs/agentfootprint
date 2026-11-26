import { expect, it } from 'vitest';
import { columnTypesOf } from '../../../../../../integrity/column-types/check.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';
import { evidenceFromHistory } from '../../../../evidence/evidenceIndex.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../evidence/gate.js';
import { checkCitationColumn } from './checkColumn.js';

it('finds a requested field missing from the read schema despite passing value membership', () => {
  const rows = [{ region: 'North', amount: 1200 }];
  const history: LLMMessage[] = [
    { role: 'user', content: 'Average discount per region' },
    { role: 'tool', content: JSON.stringify(rows), toolCallId: '1', toolName: 'read_orders' },
  ];
  const membership = checkAnswer('The average was 1200.', {
    gate: resolveEvidenceGate(),
    evidence: evidenceFromHistory(history),
    exempt: new Set(),
  });
  expect(membership.unsupported).toEqual([]);
  expect(membership.grounded).toEqual([expect.objectContaining({ value: '1200' })]);

  const existing = columnTypesOf(
    {
      toolName: 'read_orders',
      toolCallId: '1',
      columns: { region: 'string', amount: 'number' },
      mode: 'warn',
      reading: { rows },
    },
    0,
  );
  expect(existing.findings).toEqual([]);
  expect(checkCitationColumn('discount', ['region', 'amount'])).toEqual({
    reason: 'ungrounded-entity',
    name: 'discount',
    nearestName: 'amount',
  });
});

it('requires a requested name and a complete authorized schema', () => {
  expect(checkCitationColumn(undefined, ['amount'])).toBeUndefined();
  expect(checkCitationColumn('discount', undefined)).toBeUndefined();
  expect(checkCitationColumn('amount', ['amount'])).toBeUndefined();
  expect(checkCitationColumn('discount', [])).toEqual({
    reason: 'ungrounded-entity',
    name: 'discount',
  });
});

it('suggests a unique nearest exact column name without treating it as present', () => {
  expect(checkCitationColumn('Discount', ['discount', 'amount', 'discount'])).toEqual({
    reason: 'ungrounded-entity',
    name: 'Discount',
    nearestName: 'discount',
  });
});

it('counts an astral character as one edit', () => {
  expect(checkCitationColumn('a😀', ['a😈b', 'a'])).toEqual({
    reason: 'ungrounded-entity',
    name: 'a😀',
    nearestName: 'a',
  });
});

it.each([
  ['cat', 'bat', 'amount'],
  ['amount', 'bat', 'cat'],
])('omits a suggestion when nearest names tie regardless of order', (...columns) => {
  expect(checkCitationColumn('hat', columns)).toEqual({
    reason: 'ungrounded-entity',
    name: 'hat',
  });
});

it('leaves a schema unknown when the list or a name exceeds the bound', () => {
  const limit = Array.from({ length: 128 }, (_, index) => `column_${index}`);
  expect(checkCitationColumn('other', limit)).toBeDefined();
  expect(checkCitationColumn('other', [...limit, 'over'])).toBeUndefined();
  expect(checkCitationColumn('x'.repeat(129), ['amount'])).toBeUndefined();
  expect(checkCitationColumn('discount', ['amount', 'x'.repeat(129)])).toBeUndefined();
});

it('keeps malformed, sparse and hidden-label lists from proving absence', () => {
  expect(checkCitationColumn('discount', ['amount', ''])).toBeUndefined();
  expect(checkCitationColumn('discount', ['amount', 'hidden\u202Ename'])).toBeUndefined();
  expect(checkCitationColumn('discount', new Array<string>(1))).toBeUndefined();
  expect(checkCitationColumn('invalid\nname', ['amount'])).toBeUndefined();

  let reads = 0;
  const schema = Object.defineProperty(['amount'], 0, {
    get() {
      reads += 1;
      return 'amount';
    },
  });
  expect(checkCitationColumn('discount', schema)).toBeUndefined();
  expect(reads).toBe(0);
});
