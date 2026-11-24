import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, InvalidRunInputError } from '../../src/index.js';
import { completeClock, draftClock, readRunTime, type RunTime } from '../../src/time/clock.js';
import { comparisonForTool } from '../../src/time/comparisonSelection.js';
import { answersOf, clockOf, timeAnswerRow, timeRowIsWellFormed } from '../../src/time/rows.js';
import { clockOnResumeRow, clockRow } from '../../src/time/rowsBuild.js';
import type { TurnWindow, TurnWindows } from '../../src/time/windows.js';

const NOW = '2026-10-09T15:40:00Z';
const RANGE = { from: '2026-10-09T10:00:00Z', to: '2026-10-09T12:00:00Z' };
const LATER_RANGE = { ...RANGE, to: '2026-10-09T13:00:00Z' };
const TOOLS = ['ruler_east', 'ruler_west'] as const;
const AT = { turn: 2, iteration: 1 };
const NONE: TurnWindows = { windows: [], mentions: 0 };

function read(input: RunTime) {
  const admitted = readRunTime(input);
  if ('problem' in admitted) throw new Error(admitted.problem);
  return admitted.value;
}

function stamp(input: RunTime = { comparison: { tools: TOOLS } }) {
  const draft = draftClock(read({ now: NOW, zone: 'UTC', ...input }), {});
  return clockRow(completeClock(draft, 0), AT, draft.window);
}

function answer(range = RANGE, turn = AT.turn) {
  return timeAnswerRow(
    { comparison: true, mention: 0, range, zone: 'UTC', how: 'edited' },
    { turn, iteration: 1 },
  );
}

function windowsOf(...windows: TurnWindow[]): TurnWindows {
  return { windows, mentions: windows.length };
}

function agentBuilder() {
  const complete = vi.fn(async () => ({
    content: 'done',
    toolCalls: [],
    usage: { input: 0, output: 0 },
  }));
  return {
    builder: Agent.create({ provider: { name: 'comparison-mock', complete }, model: 'mock' }).time({
      zone: 'UTC',
    }),
    complete,
  };
}

const toolsForAgent = () =>
  TOOLS.map((name) =>
    defineTool({
      name,
      description: 'A named comparison source.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'unused',
    }),
  );

describe('T1b comparison admission', () => {
  it('refuses a disabled inputs layer or an unknown static tool before calling the model', async () => {
    const unarmed = agentBuilder();
    const withoutInputs = unarmed.builder.tools(toolsForAgent()).build();
    await expect(
      withoutInputs.run({ message: 'compare', time: { comparison: { tools: TOOLS } } }),
    ).rejects.toThrow('time.comparison needs the inputs layer');
    expect(unarmed.complete).not.toHaveBeenCalled();

    const armed = agentBuilder();
    const withInputs = armed.builder.tools(toolsForAgent()).inputsLayer().build();
    await expect(
      withInputs.run({
        message: 'compare',
        time: { comparison: { tools: [TOOLS[0], 'unregistered'] } },
      }),
    ).rejects.toThrow(InvalidRunInputError);
    expect(armed.complete).not.toHaveBeenCalled();
    await withInputs.run({ message: 'compare', time: { comparison: { tools: TOOLS } } });
    expect(clockOf(withInputs.findings())?.comparison).toEqual({ tools: TOOLS });
    await withInputs.followUp('continue normally');
    expect(clockOf(withInputs.findings())?.comparison).toBeUndefined();
  });

  it('permits named sources whose catalog is dynamically admitted', async () => {
    const { builder, complete } = agentBuilder();
    const agent = builder.toolProvider({ list: toolsForAgent }).inputsLayer().build();
    await agent.run({ message: 'compare', time: { comparison: { tools: TOOLS } } });
    expect(clockOf(agent.findings())?.comparison).toEqual({ tools: TOOLS });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('copies the names at admission and keeps the original names through JSON and resume', () => {
    const tools = [...TOOLS];
    const draft = draftClock(read({ now: NOW, comparison: { tools } }), {});
    tools.splice(0, 2, 'new_east', 'new_west');
    const clock = clockRow(completeClock(draft, 0), AT);
    const restored = JSON.parse(JSON.stringify(clock)) as typeof clock;
    expect(timeRowIsWellFormed({ ...restored })).toBe(true);
    expect(restored.comparison).toEqual({ tools: TOOLS });
    const note = clockOnResumeRow({ comparison: { tools } }, restored, AT);
    expect(note).toMatchObject({
      kind: 'clock-on-resume',
      passed: { comparison: { tools } },
      kept: { comparison: { tools: TOOLS } },
    });
    expect(timeRowIsWellFormed(JSON.parse(JSON.stringify(note)))).toBe(true);
    expect(
      clockOnResumeRow({ comparison: { tools: [...TOOLS].reverse() } }, restored, AT),
    ).toBeUndefined();
    expect(comparisonForTool(restored, AT.turn, 'new_east', NONE)).toBeUndefined();
    expect(comparisonForTool(restored, AT.turn, TOOLS[0], NONE)).toEqual({});
  });

  it('refuses malformed scopes and does not invoke accessors', () => {
    const getter = vi.fn(() => TOOLS);
    const toolArray = [...TOOLS];
    Object.defineProperty(toolArray, 0, { get: getter });
    const malformed = [
      null,
      { tools: [] },
      { tools: TOOLS.slice(0, 1) },
      { tools: [TOOLS[0], TOOLS[0]] },
      { tools: [TOOLS[0], '  '] },
      { tools: [TOOLS[0], 1] },
      { tools: [TOOLS[0], 'x'.repeat(257)] },
      { tools: new Array<string>(257).fill('x') },
      { tools: new Array<string>(2) },
      { tools: toolArray },
      { tools: TOOLS, extra: 'prefix' },
      { tools: TOOLS, [Symbol('extra')]: true },
      Object.create({ tools: TOOLS }),
      Object.defineProperty({}, 'tools', { get: getter }),
    ];
    for (const comparison of malformed) {
      expect(readRunTime({ comparison })).toEqual({
        problem: expect.stringContaining('time.comparison'),
      });
      expect(timeRowIsWellFormed({ ...stamp(), comparison })).toBe(false);
    }
    expect(readRunTime(Object.defineProperty({}, 'comparison', { get: getter }))).toEqual({
      problem: expect.stringContaining('time.comparison'),
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('preserves host control, rejects an unselected tool, and ends with the admitted turn', () => {
    const clock = stamp({ window: RANGE, comparison: { tools: TOOLS } });
    const evidence = { answers: [answer(LATER_RANGE)] };
    expect(comparisonForTool(clock, AT.turn, TOOLS[0]!, NONE, evidence)).toMatchObject({
      window: { source: 'control', range: RANGE, endpoint: { cutoff: RANGE.to, end: 'exclusive' } },
    });
    expect(comparisonForTool(clock, AT.turn, 'helper', NONE, evidence)).toBeUndefined();
    expect(comparisonForTool(clock, AT.turn + 1, TOOLS[0]!, NONE, evidence)).toBeUndefined();
    expect(comparisonForTool(stamp({ window: RANGE }), AT.turn, TOOLS[0]!, NONE)).toBeUndefined();
  });

  it('waits for one human answer and retains a bound answer across a later batch', () => {
    const clock = stamp();
    const reading: TurnWindow = { source: 'derived-from-reading', zone: 'UTC', range: RANGE };
    const confirmed: TurnWindow = { source: 'answered', zone: 'UTC', range: RANGE, mention: 1 };
    const changed = { ...confirmed, range: LATER_RANGE, mention: 2 };
    const first = (windows: TurnWindows) => comparisonForTool(clock, AT.turn, TOOLS[0]!, windows);
    expect(first(windowsOf(reading))).toEqual({});
    expect(first(windowsOf(confirmed, changed))).toEqual({});
    expect(first(windowsOf(reading, confirmed))).toEqual({ window: confirmed });
    expect(
      comparisonForTool(clock, AT.turn, TOOLS[1]!, windowsOf(changed), {
        boundWindow: confirmed,
        answers: [answer(LATER_RANGE)],
      }),
    ).toEqual({ window: confirmed });
  });

  it('restores the first explicit same-turn comparison answer independently of ordinary readings', () => {
    const clock = stamp();
    const admitted = answer();
    const stale = answer(LATER_RANGE, AT.turn - 1);
    const later = answer(LATER_RANGE);
    const rows = JSON.parse(JSON.stringify([stale, admitted, later])) as (typeof admitted)[];
    expect(rows.every((row) => timeRowIsWellFormed({ ...row }))).toBe(true);
    expect(timeRowIsWellFormed({ ...admitted, comparison: false })).toBe(false);
    expect(answersOf(rows, AT.turn)).toEqual([]);
    const comparisonAnswers = answersOf(rows, AT.turn, { includeComparison: true });
    expect(comparisonAnswers).toEqual([admitted, later]);
    expect(comparisonForTool(clock, AT.turn, TOOLS[0]!, NONE, { answers: [stale] })).toEqual({});
    for (const tool of TOOLS) {
      expect(comparisonForTool(clock, AT.turn, tool, NONE, { answers: rows })).toEqual({
        window: { source: 'answered', range: RANGE, mention: 0, zone: 'UTC', answer: 'edited' },
      });
    }
  });
});
