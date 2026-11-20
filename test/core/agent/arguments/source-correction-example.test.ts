import { expect, it } from 'vitest';
import { meta, run } from '../../../../examples/features/122-source-declaration-correction.js';

it('runs the documented source-correction CodeFile with native free mocks', async () => {
  const result = (await run(meta.defaultInput ?? '')) as {
    answer: unknown;
    executions: number;
    ledger: readonly Record<string, unknown>[];
  };
  expect(result.answer).toBe(
    'The synthetic disk lookup completed.\n\n---\n\nNot sure — a call was refused.',
  );
  expect(result.executions).toBe(1);
  expect(result.ledger).toContainEqual(
    expect.objectContaining({
      kind: 'argument',
      toolCallId: 'omitted',
      claimed: 'none',
      correction: 'source-declaration-required',
    }),
  );
});
