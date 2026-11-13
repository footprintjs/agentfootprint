import { describe, expect, it } from 'vitest';
import { read } from './read.js';
import type { ReadCall, StorePorts } from '../../call.js';
import { hydrateChart } from '../../chart.js';
import { execute } from '../../execute.js';

function call(ports: Pick<StorePorts, 'open' | 'readRow'>): ReadCall {
  return {
    failed: false,
    sessionId: 'session',
    verb: 'hydrate a session',
    operation: 'reading a session',
    ports: ports as StorePorts,
  };
}

describe('read stage boundary', () => {
  it('refuses a closed store before any read and preserves the exact refusal', async () => {
    const error = new Error('closed store');
    let reads = 0;
    const input = call({
      open: () => {
        throw error;
      },
      readRow: async () => {
        reads++;
        return {};
      },
    });
    await expect(execute(hydrateChart, input)).rejects.toBe(error);
    expect(reads).toBe(0);
  });

  it('keeps an absent row distinct from a failed read', async () => {
    const absent = call({ open: () => undefined, readRow: async () => undefined });
    await expect(execute(hydrateChart, absent)).resolves.toBeUndefined();
    const failure = new Error('read could not complete');
    const failed = call({
      open: () => undefined,
      readRow: async () => {
        throw failure;
      },
    });
    const records: unknown[] = [];
    await expect(execute(hydrateChart, failed, (record) => records.push(record))).rejects.toBe(
      failure,
    );
    expect(JSON.stringify(records)).not.toContain('"present":false');
  });

  it('passes the exact session and operation to its reader without changing the row', async () => {
    const row = { envelope: 'bytes' };
    const requests: string[][] = [];
    const input = call({
      open: () => undefined,
      readRow: async (session, operation) => {
        requests.push([session, operation]);
        return row;
      },
    });
    await read(input);
    expect(input.row).toBe(row);
    expect(requests).toEqual([['session', 'reading a session']]);
  });
});
