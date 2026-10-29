/**
 * One request's series, written down — at the series' own level, where a case
 * the agent cannot reach on purpose can be set up exactly.
 *
 *   P2 Boundary — cancelled before any attempt started: nothing is sent, so the
 *                 record has no rows and its end has no `during`
 *   P1 Unit     — a record the runner made for a cut attempt is a `cancelled`
 *                 row, never dropped
 */

import { describe, expect, it } from 'vitest';
import type { AttemptRecord } from 'footprintjs';

import { RequestLedger } from '../../src/mcp/requestLedger.js';
import { ledgeredFetch, retryingFetch, type ThrottleFetch } from '../../src/mcp/throttleRetry.js';
import { rowOf } from '../../src/mcp/seriesEvidence.js';
import type { RequestEvidence } from '../../src/tools/requestEvidence.js';

const URL_ = 'http://mcp.example.test/mcp';

/** A series over `fetch`, behind a watched stand-in transport — the shape `mcpClient` builds. */
function seriesOver(fetch: ThrottleFetch) {
  const ledger = new RequestLedger();
  const series = ledgeredFetch(retryingFetch(fetch, true) as ThrottleFetch, ledger);
  expect(series, 'the fetch runs a series').toBeDefined();
  const transport = ledger.watch({
    send: async (message: unknown): Promise<unknown> =>
      (series as ThrottleFetch)(URL_, { method: 'POST', body: JSON.stringify(message) }),
  });
  expect(transport).toBeDefined();
  return { ledger, send: (message: unknown) => transport!.send(message) };
}

describe('series evidence — P2 nothing started, nothing sent', () => {
  it('a call already cancelled when its series starts: no rows, no `during`, no request', async () => {
    let sent = 0;
    const { ledger, send } = seriesOver(async () => {
      sent += 1;
      return new Response('{}');
    });
    const filed: RequestEvidence[] = [];
    const params = { name: 'search_tickets', arguments: {} };
    ledger.issue(params, {
      sink: { file: (evidence) => filed.push(evidence) },
      signal: AbortSignal.abort(new Error('the run ended')),
    });

    await expect(send({ jsonrpc: '2.0', method: 'tools/call', id: 1, params })).rejects.toThrow(
      'the run ended',
    );

    expect(sent).toBe(0);
    expect(filed).toEqual([
      {
        origin: 'http://mcp.example.test',
        attempts: [],
        omitted: 0,
        end: { outcome: 'cancelled', reason: 'cancelled' },
      },
    ]);
  });
});

describe('series evidence — P1 a cut attempt the runner recorded', () => {
  it('an `aborted` record is a `cut` row — it was sent, so it is counted, and may have run', () => {
    const record = {
      attempt: 2,
      outcome: 'aborted',
      next: 'stop',
      reason: 'aborted',
      category: 'unknown',
    } as unknown as AttemptRecord;
    expect(rowOf(record, undefined)).toEqual({
      attempt: 2,
      outcome: 'cut',
      reason: 'cancelled',
      remote: 'unknown',
    });
  });
});
