/**
 * contextLedger — every answer carries its basis (footprintjs 9.33.0 basis twins).
 *
 * What is being pinned:
 * 1. A real agent run whose every read is exact records NO `basis` key — the
 *    field is additive and absent when there is nothing to say (flat + grouped).
 * 2. A non-exact answer says why: a redacted `history` is counted under
 *    `basis.history = ['redacted']`, never as if it were data; a key the
 *    chart never wrote says `'never-written'`.
 * 3. `activeByslot` — written by the injection-engine subflow's outputMapper
 *    merge-back ONLY through rows inside the key (`activeByslot␟systemPrompt`,
 *    …). Before footprintjs 9.33.0 every key query answered "never written";
 *    now the writer is the MOUNT (9.34.0 records the merge-back under it) and
 *    both twins say the answer rests on nested rows — and, read with the run's
 *    `initialState`, nothing else (no false 'from-initial-state').
 *
 * Test types (Convention 3): unit (hand-built chart) / integration (real
 * agent runs) / regression (the activeByslot answer).
 */

import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { commitValueAtWithBasis, findLastWriterWithBasis } from 'foottrace';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { contextLedger } from '../../../src/lib/context-ledger/index.js';

async function runEchoAgent(reactMode?: 'dynamic-grouped') {
  const echo = defineTool({
    name: 'echo',
    description: 'echo',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'echoed',
  });
  let calls = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: () => {
      calls++;
      if (calls === 1)
        return {
          content: 'step 1',
          toolCalls: [{ id: 'c1', name: 'echo', args: {} }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      return {
        content: 'done',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  });
  const agent = Agent.create({
    provider,
    model: 'mock',
    readTracking: 'full',
    ...(reactMode ? { reactMode } : {}),
  })
    .system('test')
    .tool(echo)
    .build();
  await agent.run({ message: 'go' });
  return agent;
}

describe('contextLedger — basis (INTEGRATION)', () => {
  it.each([undefined, 'dynamic-grouped'] as const)(
    'an all-exact run records no basis key (reactMode %s)',
    async (reactMode) => {
      const recorded = contextLedger().recordRun(await runEchoAgent(reactMode));
      expect(recorded).toBeDefined();
      expect(recorded!.offeredPieces).toContain('tool:echo');
      expect('basis' in recorded!).toBe(false);
    },
  );
});

describe('contextLedger — basis (UNIT, hand-built chart)', () => {
  it('a redacted history is reported as redacted, not counted as data', async () => {
    type S = Record<string, unknown>;
    const chart = flowChart<S>(
      'Seed',
      (s) => {
        s.userMessage = 'hi';
        s.history = [{ role: 'user', content: 'hi' }];
        s.activeInjections = [{ id: 'fact-a', flavor: 'fact' }];
      },
      'seed',
    )
      .addFunction(
        'Call',
        (s) => {
          s.totalInputTokens = 10;
          s.history = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', toolCalls: [{ name: 'lookup' }] },
          ];
        },
        'call-llm',
      )
      .build();
    const executor = new FlowChartExecutor(chart);
    executor.setRedactionPolicy({ keys: ['history'] });
    await executor.run();

    const ledger = contextLedger();
    const recorded = ledger.recordRun(executor.getSnapshot());
    expect(recorded?.basis).toEqual({
      history: ['redacted'],
      // This chart never writes it — the ledger says so instead of reading an empty list.
      activatedInjectionIds: ['never-written'],
    });
    // The placeholder is not data: no tool call is read out of it.
    expect(ledger.row('tool', 'lookup')).toBeUndefined();
    expect(ledger.row('injection', 'fact-a')?.offered).toBe(1);
  });
});

describe('activeByslot — answered from nested rows (REGRESSION)', () => {
  it('the writer is the injection-engine mount; both twins say nested-rows', async () => {
    const agent = await runEchoAgent();
    const snapshot = agent.getSnapshot()!;
    const log = snapshot.commitLog;

    const writer = findLastWriterWithBasis(log, 'activeByslot');
    expect(writer.writer?.runtimeStageId).toMatch(/^sf-injection-engine#\d+$/);
    expect(writer.basis).toEqual(['nested-rows']);
    // Every row of that bundle is INSIDE the key — no row names it exactly.
    const rows = writer.writer!.trace.filter((t) => t.path.startsWith('activeByslot'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.path !== 'activeByslot')).toBe(true);

    // With the run's fold base, nothing seeded the key before the run, so the answer is
    // NOT partial: only 'nested-rows' (without initialState the twin cannot know that and
    // adds 'from-initial-state' — the readers always pass the base they have).
    const read = commitValueAtWithBasis(log, log.length - 1, 'activeByslot', {
      initialState: snapshot.initialState,
    });
    expect(read.value).toEqual({ systemPrompt: [], messages: [], tools: [] });
    expect(read.basis).toEqual(['nested-rows']);
  });
});
