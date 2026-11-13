import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps the contributor entry guide within 200 lines', () => {
  const text = readFileSync(resolve(__dirname, '../../CLAUDE.md'), 'utf8');
  expect(
    text.replace(/\r?\n$/, '').split(/\r?\n/).length,
    'Move detail to the scoped rule or local README',
  ).toBeLessThanOrEqual(200);
});

it('uses file and symbol references instead of source line numbers', () => {
  const text = readFileSync(resolve(__dirname, '../../CLAUDE.md'), 'utf8');
  expect(text.match(/\.(?:ts|mjs|cjs):\d+/g) ?? []).toEqual([]);
});
