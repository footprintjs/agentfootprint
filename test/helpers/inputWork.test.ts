import { expect, it } from 'vitest';
import { countArrayReads } from './inputWork.js';

it('counts actual indexed reads while preserving array iteration and values', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  const probe = countArrayReads(rows);
  expect(Array.isArray(probe.input)).toBe(true);
  expect(probe.input.length).toBe(2);
  expect(probe.reads()).toBe(0);
  expect(probe.input[1]).toBe(rows[1]);
  expect(probe.reads()).toBe(1);
  expect([...probe.input]).toEqual(rows);
  expect(probe.reads()).toBe(3);
  expect(probe.input.map((row) => row.id)).toEqual(['a', 'b']);
  expect(probe.reads()).toBe(5);
});
