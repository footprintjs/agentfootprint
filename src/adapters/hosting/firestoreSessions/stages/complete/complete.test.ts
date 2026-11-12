import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { completeStage } from './complete.js';
import { execute } from '../../execute.js';
import type { Facts, Outcome } from '../../call.js';

const chart = flowChart<Facts>('Complete', completeStage, 'complete').build();

describe('completion boundary', () => {
  it('returns the exact value without filing caller data into the run record', async () => {
    const value = { private: 'caller content canary' };
    const records: unknown[] = [];
    const input: Outcome = { failed: false, value, bytes: 12, reason: 'ready' };
    await expect(execute(chart, input, (record) => records.push(record))).resolves.toBe(value);
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('caller content canary');
  });

  it('preserves even an undefined refusal rather than confusing it with successful completion', async () => {
    await expect(execute(chart, { failed: true, error: undefined })).rejects.toBeUndefined();
  });
});
