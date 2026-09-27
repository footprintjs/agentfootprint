/**
 * Performance — what the inputs layer costs, measured (never claimed in
 * advance). The numbers of the day are printed by the first test so a run of
 * this file IS the measurement the design asks for; the assertions are the
 * load-insensitive forms of `test/helpers/perf.ts` plus structural facts.
 *
 * Test types (Convention 3):
 *   - PERFORMANCE — commit-log bytes over a 50-iteration run with a ruled tool,
 *                   armed against the same run unarmed; the per-iteration cost
 *                   of the mount (a ratio against the unarmed twin); the
 *                   ledger merge at 1,000 rows scales linearly;
 *   - LOAD        — ONE ledger write per dispatching batch across the 50
 *                   iterations, never one per call.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type Tool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { appendRows } from '../../../../src/core/agent/findings/ledger.js';
import { argumentRowOf } from '../../../../src/core/agent/arguments/rows.js';
import type { FindingsRow } from '../../../../src/core/agent/findings/types.js';
import { expectScalesLinearly, expectWithinTimes } from '../../../helpers/perf.js';

const SCHEMA = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string' },
    window: { type: 'string', enum: ['1h', '2h', '24h'] },
  },
} as const;

function logs(ruled: boolean): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service.',
    inputSchema: SCHEMA,
    ...(ruled && { askOrAssume: { window: { assume: '2h' } } }),
    execute: (args: Record<string, unknown>) => ({ service: args.service, errors: 0 }),
  }) as Tool;
}

/** `calls` iterations that each call the tool without `window`, then an answer. */
function provider(calls: number) {
  let i = 0;
  return {
    name: 'perf-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      i += 1;
      return i <= calls
        ? {
            content: '',
            // The unruled twin must still get a valid call: it is judged by
            // the author's schema, so it sends the value the layer would fill.
            toolCalls: [{ id: `c${i}`, name: 'search_logs', args: { service: `s${i}` } }],
            usage: { input: 0, output: 0 },
          }
        : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
}

async function run(ruled: boolean, calls: number) {
  const agent = Agent.create({
    provider: provider(calls) as never,
    model: 'm',
    maxIterations: calls + 5,
    // The unruled twin's calls lack a required argument; validation must not
    // be what differs between the two runs.
    toolArgValidation: 'off',
  })
    .tool(logs(ruled))
    .build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

describe('performance — the inputs layer, measured', () => {
  it(
    'commit-log bytes over a 50-iteration run: armed vs unarmed (printed), one merge per batch',
    { timeout: 60_000 },
    async () => {
      const armed = await run(true, 49);
      const unarmed = await run(false, 49);
      const armedBytes = JSON.stringify(armed.commitLog).length;
      const unarmedBytes = JSON.stringify(unarmed.commitLog).length;
      const ledgerBytes = JSON.stringify(armed.sharedState.findingsLedger).length;
      const ledgerWrites = armed.commitLog.filter((b) =>
        (b.trace as readonly { path: string }[]).some((t) => t.path === 'findingsLedger'),
      ).length;
      const resolutionWrites = armed.commitLog.filter((b) =>
        (b.trace as readonly { path: string }[]).some((t) => t.path === 'argumentResolutions'),
      ).length;
      // eslint-disable-next-line no-console
      console.info(
        `[inputs-layer perf] 50 iterations (49 dispatching): commit log ${armedBytes} B armed vs ` +
          `${unarmedBytes} B unarmed (+${armedBytes - unarmedBytes} B, ` +
          `${((armedBytes / unarmedBytes - 1) * 100).toFixed(
            1,
          )}%); final ledger ${ledgerBytes} B, ` +
          `${armed.commitLog.length} vs ${unarmed.commitLog.length} bundles`,
      );
      expect(ledgerWrites).toBe(49);
      expect(resolutionWrites).toBe(49);
      expect((armed.sharedState.findingsLedger as unknown[]).length).toBe(49);
      expect(armedBytes).toBeGreaterThan(unarmedBytes);
    },
  );

  it(
    'the per-iteration cost of the mount stays within 3× of the unarmed twin',
    { timeout: 120_000, retry: 2 },
    async () => {
      await expectWithinTimes({
        subject: () => run(true, 5),
        baseline: () => run(false, 5),
        times: 3,
        why:
          'the armed run adds one subflow of four small stages per iteration and one ledger ' +
          'merge per batch; 3× bounds it well above that and still trips on a per-call rescan',
      });
    },
  );

  it(
    'the merge scales linearly with the ledger (100 → 1,000 rows)',
    { timeout: 120_000, retry: 2 },
    async () => {
      const row = (i: number): FindingsRow =>
        argumentRowOf(
          {
            toolCallId: `c${i}`,
            toolName: 't',
            argument: 'w',
            rule: 'assume',
            source: 'default',
            shownValue: '2h',
          },
          { turn: 1, iteration: 1 },
        );
      const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));
      const small = { prev: rows(100), add: rows(100) };
      const large = { prev: rows(1000), add: rows(1000) };
      await expectScalesLinearly({
        small: () => {
          for (let k = 0; k < 20; k++) appendRows(small.prev, small.add);
        },
        large: () => {
          for (let k = 0; k < 20; k++) appendRows(large.prev, large.add);
        },
        scale: 10,
        why: 'appendRows copies and folds the ledger once — linear, never a rescan per row',
      });
    },
  );
});
