/**
 * Performance — what the inputs layer costs, measured (never claimed in
 * advance). The numbers of the day are printed by the first test so a run of
 * this file IS the measurement the design asks for; the assertions are the
 * load-insensitive forms of `test/helpers/perf.ts` plus structural facts.
 *
 * Test types (Convention 3):
 *   - PERFORMANCE — commit-log bytes over a 50-iteration run with a ruled tool,
 *                   armed against the same run unarmed; the mounted stages and
 *                   earlier rows visited per batch against the unarmed twin; the
 *                   ledger merge at 1,000 rows scales linearly;
 *   - LOAD        — ONE ledger write per dispatching batch across the 50
 *                   iterations, never one per call.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, type Tool } from '../../../../src/index.js';
import type { LLMProvider } from '../../../../src/provider-contract/types.js';
import * as ledger from '../../../../src/core/agent/findings/ledger.js';
import { argumentRowOf } from '../../../../src/core/agent/arguments/rows.js';
import type { FindingsRow } from '../../../../src/core/agent/findings/types.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../../../src/lib/conventions.js';
import { countMountedStageRuns, observeMountRowReads } from '../../../helpers/mountWork.js';
import { expectScalesLinearly } from '../../../helpers/perf.js';

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

/** `batches` iterations of `width` calls without `window`, then an answer. */
function provider(batches: number, width: number): LLMProvider {
  let i = 0;
  return {
    name: 'perf-mock',
    complete: async () => {
      i += 1;
      return i <= batches
        ? {
            content: '',
            toolCalls: Array.from({ length: width }, (_, k) => ({
              id: `c${i}-${k}`,
              name: 'search_logs',
              args: { service: `s${i}-${k}` },
            })),
            usage: { input: 0, output: 0 },
            stopReason: 'tool_use',
          }
        : {
            content: 'done',
            toolCalls: [],
            usage: { input: 0, output: 0 },
            stopReason: 'end_turn',
          };
    },
  };
}

async function run(ruled: boolean, batches: number, width = 1) {
  const agent = Agent.create({
    provider: provider(batches, width),
    model: 'm',
    maxIterations: batches + 5,
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

  it.each([1, 4, 8])(
    'adds four stages per iteration and visits earlier findings once per %i-call batch',
    async (width) => {
      const stages = [
        STAGE_IDS.DECLARE_ARGUMENTS,
        STAGE_IDS.VERIFY_ARGUMENTS,
        STAGE_IDS.RECORD_ARGUMENTS,
        STAGE_IDS.RESOLVE_ARGUMENTS,
      ];
      const batches = 5;
      const earlierRows = (width * batches * (batches - 1)) / 2;
      const merge = vi.spyOn(ledger, 'appendRows');
      const work = observeMountRowReads(SUBFLOW_IDS.INPUTS);
      try {
        const unarmed = await run(false, batches, width);
        expect(merge).not.toHaveBeenCalled();
        for (const stage of stages)
          expect(countMountedStageRuns(unarmed, SUBFLOW_IDS.INPUTS, stage)).toBe(0);
        expect(work.reads().findingsLedger).toBe(0);

        const armed = await run(true, batches, width);
        expect(merge).toHaveBeenCalledTimes(batches);
        // Each stage runs once per model reply, including the final answer. The earlier
        // ledger has 0, 1, … batches of rows. Its reads grow with the width, so a scan
        // for each call would read width times the allowed rows.
        for (const stage of stages)
          expect(countMountedStageRuns(armed, SUBFLOW_IDS.INPUTS, stage)).toBe(batches + 1);
        expect(work.reads().findingsLedger, 'previous findings rows visited').toBe(earlierRows);
      } finally {
        work.restore();
        merge.mockRestore();
      }
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
          for (let k = 0; k < 20; k++) ledger.appendRows(small.prev, small.add);
        },
        large: () => {
          for (let k = 0; k < 20; k++) ledger.appendRows(large.prev, large.add);
        },
        scale: 10,
        why: 'appendRows copies and folds the ledger once — linear, never a rescan per row',
      });
    },
  );
});
