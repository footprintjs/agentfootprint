/**
 * Performance — what the results layer costs, measured (never claimed in
 * advance). The first test prints the numbers of the day, so a run of this
 * file IS the measurement; the assertions are the load-insensitive forms of
 * `test/helpers/perf.ts` plus structural facts.
 *
 * Test types (Convention 3):
 *   - PERFORMANCE — commit-log bytes over a 50-iteration run with a tool whose
 *                   results declare a period, armed against the same run
 *                   unarmed; the per-iteration cost of the mount (a ratio
 *                   against the unarmed twin); the verdict over 1,000 periods
 *                   against 100 scales linearly;
 *   - LOAD        — ONE ledger write per batch across the 50 iterations and
 *                   one verdict per call — never a rescan of earlier batches —
 *                   and a 200-call batch filed in one merge.
 */

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { Agent, absent, defineTool, type Tool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { periodVerdict, type DeclaredPeriod } from '../../../../src/core/agent/coverage/period.js';
import { expectScalesLinearly, expectWithinTimes } from '../../../helpers/perf.js';

const PERIOD: DeclaredPeriod = {
  queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
  held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
};

function backupRuns(): Tool {
  return defineTool({
    name: 'backup_runs',
    description: 'Failed backup runs for one host.',
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute: (args: Record<string, unknown>) =>
      absent({ what: `runs for ${String(args.host)}`, checked: ['the export'], period: PERIOD }),
  }) as Tool;
}

/** `calls` iterations of `width` calls each, then an answer. */
function provider(calls: number, width = 1) {
  let i = 0;
  return {
    name: 'perf-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      i += 1;
      return i <= calls
        ? {
            content: '',
            toolCalls: Array.from({ length: width }, (_, k) => ({
              id: `c${i}-${k}`,
              name: 'backup_runs',
              args: { host: `h${k}` },
            })),
            usage: { input: 0, output: 0 },
          }
        : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
}

async function run(armed: boolean, calls: number, width = 1) {
  let builder = Agent.create({
    provider: provider(calls, width) as never,
    model: 'm',
    maxIterations: calls + 5,
  }).tool(backupRuns());
  if (armed) builder = builder.resultsLayer();
  const agent = builder.build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

const ledgerWrites = (snapshot: { commitLog: readonly { trace: unknown }[] }) =>
  snapshot.commitLog.filter((b) =>
    (b.trace as readonly { path: string }[]).some((t) => t.path === 'findingsLedger'),
  ).length;

describe('performance — the results layer, measured', () => {
  it(
    'commit-log bytes over a 50-iteration run: armed vs unarmed (printed), one merge per batch',
    { timeout: 60_000 },
    async () => {
      // The unarmed twin warns once (a period nobody judges) — quiet it here.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const armed = await run(true, 49);
        const unarmed = await run(false, 49);
        const armedBytes = JSON.stringify(armed.commitLog).length;
        const unarmedBytes = JSON.stringify(unarmed.commitLog).length;
        const ledgerBytes = JSON.stringify(armed.sharedState.findingsLedger).length;
        // eslint-disable-next-line no-console
        console.info(
          `[results-layer perf] 50 iterations (49 batches): commit log ${armedBytes} B armed vs ` +
            `${unarmedBytes} B unarmed (+${armedBytes - unarmedBytes} B, ` +
            `${((armedBytes / unarmedBytes - 1) * 100).toFixed(
              1,
            )}%); final ledger ${ledgerBytes} B, ` +
            `${armed.commitLog.length} vs ${unarmed.commitLog.length} bundles`,
        );
        expect(ledgerWrites(armed)).toBe(49);
        expect((armed.sharedState.findingsLedger as unknown[]).length).toBe(49);
        expect(ledgerWrites(unarmed)).toBe(0);
        expect(armedBytes).toBeGreaterThan(unarmedBytes);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('a 200-call batch: 200 verdicts in ONE merge', { timeout: 60_000 }, async () => {
    const armed = await run(true, 1, 200);
    expect(ledgerWrites(armed)).toBe(1);
    expect((armed.sharedState.findingsLedger as unknown[]).length).toBe(200);
  });

  it(
    'the per-iteration cost of the mount stays within 3× of the unarmed twin',
    { timeout: 120_000, retry: 2 },
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await expectWithinTimes({
          subject: () => run(true, 5),
          baseline: () => run(false, 5),
          times: 3,
          why:
            'the armed run adds one subflow of four small stages per iteration and one ledger ' +
            'merge per batch; 3× bounds it well above that and still trips on a per-call rescan',
        });
      } finally {
        warn.mockRestore();
      }
    },
  );

  it(
    'the verdict scales linearly (100 → 1,000 periods)',
    { timeout: 120_000, retry: 2 },
    async () => {
      const periods = (n: number) => Array.from({ length: n }, () => PERIOD);
      const small = periods(100);
      const large = periods(1000);
      await expectScalesLinearly({
        small: () => {
          for (const p of small) periodVerdict(p);
        },
        large: () => {
          for (const p of large) periodVerdict(p);
        },
        scale: 10,
        why: 'one verdict parses four instants and compares them — constant per period',
      });
    },
  );
});
