/**
 * Performance — what the answer layer costs, measured (never claimed in
 * advance). The first test prints the numbers of the day, so a run of this
 * file IS the measurement; the assertions are the load-insensitive forms of
 * `test/helpers/perf.ts` plus structural facts.
 *
 * Test types (Convention 3):
 *   - PERFORMANCE — the armed run's cost against its unarmed twin (a ratio);
 *                   the fold scales linearly with the record it reads (100 →
 *                   1,000 results and ledger rows) — one pass, never a rescan
 *                   per row;
 *   - LOAD        — the layer runs ONCE per answer: one stage, one event, no
 *                   matter how many iterations the turn took; the Route
 *                   decider files at most one witness row per verdict.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { assessAnswer } from '../../../../src/observe.js';
import { groundedRowFrom } from '../../../../src/core/agent/assessment/witness.js';
import { expectScalesLinearly, expectWithinTimes } from '../../../helpers/perf.js';

const lookup = defineTool({
  name: 'list_ports',
  description: 'ports of a switch',
  inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
  execute: (args: Record<string, unknown>) => [{ page: args.page ?? 0, port: 3 }],
});

/** `calls` iterations that each call the tool, then an answer. */
function provider(calls: number) {
  let i = 0;
  return {
    name: 'perf-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      i += 1;
      return i <= calls
        ? {
            content: '',
            toolCalls: [{ id: `c${i}`, name: 'list_ports', args: { page: i } }],
            usage: { input: 0, output: 0 },
          }
        : { content: 'Port 3 is down.', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
}

async function run(armed: boolean, calls: number) {
  const events: unknown[] = [];
  const b = Agent.create({
    provider: provider(calls) as never,
    model: 'm',
    maxIterations: calls + 5,
  })
    .tool(lookup)
    .namesAndNumbersFromEvidence({ posture: 'assist' });
  const agent = (armed ? b.answerLayer() : b).build();
  agent.on('agentfootprint.answer.assessed', (e) => events.push(e.payload));
  await agent.run({ message: 'which ports are down?' });
  return { snapshot: agent.getSnapshot()!, events };
}

describe('performance — the answer layer, measured', () => {
  it(
    'a 20-iteration turn: one stage and one event per answer; the commit-log delta printed',
    { timeout: 60_000 },
    async () => {
      const armed = await run(true, 19);
      const unarmed = await run(false, 19);
      const armedBytes = JSON.stringify(armed.snapshot.commitLog).length;
      const unarmedBytes = JSON.stringify(unarmed.snapshot.commitLog).length;
      // eslint-disable-next-line no-console
      console.info(
        `[answer-layer perf] 20 iterations: parent commit log ${armedBytes} B armed vs ` +
          `${unarmedBytes} B unarmed (+${armedBytes - unarmedBytes} B, ` +
          `${((armedBytes / unarmedBytes - 1) * 100).toFixed(1)}%); ` +
          `${armed.snapshot.commitLog.length} vs ${unarmed.snapshot.commitLog.length} bundles`,
      );
      expect(armed.events).toHaveLength(1);
      expect(unarmed.events).toHaveLength(0);
      // The parent log gains no bundle: the layer's stage is inside the final branch.
      expect(armed.snapshot.commitLog.length).toBe(unarmed.snapshot.commitLog.length);
      // …and the witness row: at most one per verdict — here the gate's one clean pass.
      const ledger = (armed.snapshot.sharedState.findingsLedger ?? []) as { kind: string }[];
      expect(ledger.filter((r) => r.kind === 'grounded')).toHaveLength(1);
    },
  );

  it(
    'the armed run stays within 2× of its unarmed twin',
    { timeout: 120_000, retry: 2 },
    async () => {
      await expectWithinTimes({
        subject: () => run(true, 5),
        baseline: () => run(false, 5),
        times: 2,
        why:
          'the armed run adds ONE stage per answer (one fold over the committed record) and one ' +
          'witness row per verdict; 2× bounds it well above that and still trips on a fold per iteration',
      });
    },
  );

  it(
    'the fold scales linearly with the record it reads (100 → 1,000 results and rows)',
    { timeout: 120_000, retry: 2 },
    async () => {
      const record = (n: number) => {
        const history: unknown[] = [{ role: 'user', content: 'q' }];
        for (let i = 0; i < n; i++) {
          history.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${i}` }] });
          history.push({ role: 'tool', toolCallId: `c${i}`, toolName: 't', content: '[]' });
        }
        const ledger = Array.from({ length: n }, (_, i) =>
          groundedRowFrom({
            turn: 1,
            iteration: i,
            posture: 'assist',
            candidates: 1,
            lookedUp: 1,
            afterRevision: false,
          }),
        );
        return { snapshot: { sharedState: { history, turnNumber: 1, findingsLedger: ledger } } };
      };
      const small = record(100);
      const large = record(1000);
      await expectScalesLinearly({
        small: () => {
          for (let k = 0; k < 10; k++) assessAnswer(small);
        },
        large: () => {
          for (let k = 0; k < 10; k++) assessAnswer(large);
        },
        scale: 10,
        why: 'assessAnswer reads each result and each row once — linear, never a rescan per row',
      });
    },
  );
});
