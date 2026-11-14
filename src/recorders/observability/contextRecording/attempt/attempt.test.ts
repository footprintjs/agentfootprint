import { expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { attemptExport } from './index.js';
import type { ContextExportResult, ContextExportState } from '../chartTypes.js';

it('keeps an adapter exception and its payload out of the formatter log', async () => {
  const result: ContextExportResult = {};
  const chart = flowChart<ContextExportState>(
    'Attempt',
    attemptExport(async () => {
      throw new Error('SECRET adapter payload');
    }, result),
    'attempt',
  ).build();
  const record = await chart.run({});
  expect(result.failure?.message).toBe('Context recording refused: invalid-record');
  expect(JSON.stringify(record)).not.toContain('SECRET');
  expect((record as { state: { refused: boolean } }).state.refused).toBe(true);
});
