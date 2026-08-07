/**
 * buildToolsSlot — slot-cap overflow is LOUD (7.6.1).
 *
 * Reported by an external tester: the tools slot composed 2447 chars
 * against a cap of 2000 and said nothing. `headroomChars` clamps to 0 and
 * `droppedCount` stays 0, so an over-budget slot read as "everything fit".
 * Nothing truncates tool definitions (the full schemas always reach the
 * LLM) — the silent failure is that the budget signal was unreliable.
 *
 * The fix feeds the previously-documented-but-never-fired
 * `agentfootprint.context.budget_pressure` event with `planAction: 'none'`
 * plus one deduped `console.warn` per built chart.
 *
 * Test types (Convention 3): functional / integration / property /
 * regression / unit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import { buildToolsSlot } from '../../../src/core/slots/buildToolsSlot.js';
import { slotOverflow } from '../../../src/core/slots/helpers.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';
import { ContextRecorder } from '../../../src/recorders/core/ContextRecorder.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { LLMToolSchema } from '../../../src/adapters/types.js';
import type { BudgetPressureRecord, SlotComposition } from '../../../src/recorders/core/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────

/** Tool descriptions long enough that 11 of them blow a 2000-char cap. */
function makeTools(count: number, descriptionLength: number): LLMToolSchema[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${String(i).padStart(2, '0')}`,
    description: `d${i}`.padEnd(descriptionLength, 'x'),
    inputSchema: { type: 'object', properties: {} },
  }));
}

/** The slot measures `${name}: ${description}` per tool — mirror it. */
function charsOf(tools: readonly LLMToolSchema[]): number {
  return tools.reduce((sum, t) => sum + `${t.name}: ${t.description}`.length, 0);
}

interface HarnessState {
  [k: string]: unknown;
}

/**
 * Mount the real slot as the `sf-tools` SUBFLOW — the ContextRecorder
 * attributes writes from their `runtimeStageId` path, so a bare root-level
 * chart would not be recognised as a slot.
 */
function harness(tools: readonly LLMToolSchema[], budgetCap?: number) {
  return flowChart<HarnessState>(
    'Seed',
    (scope: TypedScope<HarnessState>) => {
      scope.iteration = 1;
    },
    'seed',
  )
    .addSubFlowChartNext(
      SUBFLOW_IDS.TOOLS,
      buildToolsSlot({ tools, ...(budgetCap !== undefined && { budgetCap }) }),
      'Tools',
      {
        inputMapper: (parent: HarnessState) => ({ iteration: parent.iteration }),
        outputMapper: (sf: HarnessState) => ({
          toolSchemas: sf.toolSchemas,
          slotCompositions: sf.slotCompositions,
          slotBudgetPressures: sf.slotBudgetPressures,
        }),
      },
    )
    .build();
}

interface RunResult {
  pressures: readonly BudgetPressureRecord[];
  composition: SlotComposition | undefined;
  toolSchemas: readonly LLMToolSchema[];
  events: BudgetPressureRecord[];
}

async function run(chart: ReturnType<typeof harness>): Promise<RunResult> {
  const dispatcher = new EventDispatcher();
  const events: BudgetPressureRecord[] = [];
  dispatcher.on('agentfootprint.context.budget_pressure', (e) => events.push(e.payload));

  const executor = new FlowChartExecutor(chart);
  executor.attachCombinedRecorder(
    new ContextRecorder({
      dispatcher,
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: ['test'],
        turnIndex: 0,
        iterIndex: 1,
      }),
    }),
  );
  await executor.run();

  const state = (executor.getSnapshot()?.sharedState ?? {}) as {
    slotBudgetPressures?: readonly BudgetPressureRecord[];
    slotCompositions?: SlotComposition;
    toolSchemas?: readonly LLMToolSchema[];
  };
  return {
    pressures: state.slotBudgetPressures ?? [],
    composition: state.slotCompositions,
    toolSchemas: state.toolSchemas ?? [],
    events,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Functional — the loud surface ─────────────────────────────────

describe('buildToolsSlot — overflow loudness', () => {
  it('writes a budget-pressure record AND dispatches the typed event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 11 tools, mirroring the tester's report (cap 2000, used > 2000).
    const tools = makeTools(11, 213);
    const used = charsOf(tools);
    expect(used).toBeGreaterThan(2000);

    const result = await run(harness(tools));

    const expected: BudgetPressureRecord = {
      slot: 'tools',
      capTokens: 2000,
      projectedTokens: used,
      overflowBy: used - 2000,
      planAction: 'none',
      // 8.14.0 — the honest trio, written beside the two historical names.
      // A slot counts CHARACTERS; a window strategy emits this same event
      // name counting TOKENS, and `unit` is the only thing that tells a
      // subscriber which one it is holding.
      unit: 'chars',
      cap: 2000,
      projected: used,
    };
    expect(result.pressures).toEqual([expected]);
    expect(result.events).toEqual([expected]);
  });

  // ─── Regression — the silence this release removes ──────────────

  it('nothing is truncated: every registered schema still reaches the LLM byte-for-byte', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = makeTools(11, 213);

    const result = await run(harness(tools));

    // Overflow happened…
    expect(result.pressures).toHaveLength(1);
    // …and the full definitions went out anyway. `planAction: 'none'` is
    // the honest statement of exactly this.
    expect(result.toolSchemas).toEqual(tools);
    expect(result.composition?.droppedCount).toBe(0);
  });

  // ─── Integration — one warning per built chart ──────────────────

  it('warns exactly once per built chart while the typed event fires every iteration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = makeTools(11, 213);
    const used = charsOf(tools);
    // ONE built chart — the dedup latch lives in its closure. A
    // 20-iteration ReAct loop must not print 20 identical warnings.
    const chart = harness(tools);

    const first = await run(chart);
    const second = await run(chart);

    // Machine channel: per-iteration truth, both times.
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    // Human channel: once.
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('[agentfootprint]');
    expect(message).toContain('tools slot over budget');
    expect(message).toContain(`${used}/2000 chars (+${used - 2000})`);
    expect(message).toContain('11 tool definition(s)');
    expect(message).toContain('Nothing was truncated');
    // 8.11.0: the remedy names a knob a consumer can actually reach.
    // `budgetCap` was internal to this file — the warning used to point at
    // something no public door exposed.
    expect(message).toContain('Raise contextBudget.tools');
    expect(message).not.toContain('Raise budgetCap');
  });

  // ─── Property — no new noise for healthy agents ─────────────────

  it('stays completely silent under the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = makeTools(3, 20);
    expect(charsOf(tools)).toBeLessThan(2000);

    const result = await run(harness(tools));

    expect(result.pressures).toEqual([]);
    expect(result.events).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    // The healthy signal is unchanged.
    expect(result.composition?.budget.headroomChars).toBeGreaterThan(0);
  });
});

// ─── Unit — the detector itself ────────────────────────────────────

describe('slotOverflow', () => {
  const composition = (cap: number, used: number): SlotComposition => ({
    slot: 'messages',
    iteration: 1,
    budget: { cap, used, headroomChars: Math.max(0, cap - used) },
    sourceBreakdown: {},
    droppedCount: 0,
    droppedSummaries: [],
  });

  it('treats cap 0 as the "no budget" sentinel — never overflows', () => {
    // buildMessageApiChart emits `{ cap: 0, used: 0 }` deliberately; a
    // future caller with cap 0 and real content must not be flagged.
    expect(slotOverflow(composition(0, 0))).toBeNull();
    expect(slotOverflow(composition(0, 5000))).toBeNull();
    expect(slotOverflow(composition(-1, 5000))).toBeNull();
  });

  it('returns null at exactly the cap and a record one char over', () => {
    expect(slotOverflow(composition(100, 100))).toBeNull();
    expect(slotOverflow(composition(100, 101))).toEqual({
      slot: 'messages',
      capTokens: 100,
      projectedTokens: 101,
      overflowBy: 1,
      planAction: 'none',
      unit: 'chars',
      cap: 100,
      projected: 101,
    });
  });
});
