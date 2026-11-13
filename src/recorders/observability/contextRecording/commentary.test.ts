import { expect, it } from 'vitest';
import { contextCallCommentary } from './commentary.js';
import type { ContextCallChange } from './types.js';

it('narrates an unchanged offer once, with source counts and no payloads', () => {
  const call = {
    call: 4,
    added: [],
    removed: [],
    unchanged: 30,
    counts: { steering: 12, tools: 18 },
  } as unknown as ContextCallChange;
  expect(contextCallCommentary(call)).toBe('Context unchanged since call 3 (12 rules, 18 tools).');
  expect(contextCallCommentary({ ...call, order: [1, 0] })).toBe(
    'Context order changed since call 3 (12 rules, 18 tools).',
  );
  expect(contextCallCommentary({ ...call, added: ['private-id'] })).toBe(
    'Context changed for call 4: 1 added, 0 removed, 30 unchanged (12 rules, 18 tools).',
  );
});
