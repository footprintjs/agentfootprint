import { expect, it } from 'vitest';
import { Agent, defineTool, type PeriodForm } from '../../src/index.js';
import type { ControlWindowInput } from '../../src/time/windowEndpoint.js';
import { rulerRows } from './fixtures/rulerTool.js';

const from = '2026-11-13T18:00:00Z';
const to = '2026-11-13T18:45:00Z';
const mixed = {
  kind: 'bounds',
  from: { argument: 'from', as: 'epoch-ms' },
  to: { argument: 'to', as: 'iso', edge: 'inclusive' },
} as const;
const coarse = {
  ...mixed,
  from: { ...mixed.from, as: 'epoch-s' },
  to: { ...mixed.to, as: 'epoch-s', edge: 'exclusive' },
} as const;

async function recordCall(
  form: Extract<PeriodForm, { kind: 'bounds' }>,
  window: ControlWindowInput,
  args = {},
) {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const endSamples: string[] = [];
  let first = true;
  const tool = defineTool({
    name: 'range_ruler',
    description: 'Read the minute ticks in the requested UTC range.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'integer' },
        to: { type: form.to.as === 'iso' ? 'string' : 'integer' },
      },
    },
    askOrAssume: { from: { ask: 'From when?' }, to: { ask: 'Until when?' } },
    period: { forms: [form] },
    execute(args) {
      calls.push({ ...args });
      const from = new Date(
        Number(args.from) * (form.from.as === 'epoch-s' ? 1_000 : 1),
      ).toISOString();
      const to = typeof args.to === 'number' ? new Date(args.to * 1_000).toISOString() : args.to;
      const ticks = rulerRows({ from, to }, form.to.edge);
      if (ticks.at(-1) !== undefined) endSamples.push(ticks.at(-1)!);
      return JSON.stringify(ticks);
    },
  });
  const agent = Agent.create({
    model: 'mock',
    provider: {
      name: 'confirmed-bound-ruler',
      async complete() {
        const response = {
          content: first ? '' : 'Done.',
          toolCalls: first ? [{ id: 'ruler', name: 'range_ruler', args }] : [],
          usage: { input: 0, output: 0 },
        };
        first = false;
        return response;
      },
    },
  })
    .time({ zone: 'UTC' })
    .tool(tool)
    .build();
  try {
    await agent.run({
      message: 'Read the selected window.',
      time: { now: '2026-11-13T20:00:00Z', window },
    });
    return { calls, endSamples, rows: agent.findings() };
  } finally {
    await agent.shutdown();
  }
}

it.each([
  { args: {}, how: 'filled' },
  { args: { from: Date.parse(from), to }, how: 'bound' },
])(
  'keeps the confirmed inclusive point across mixed-bound $how dispatch',
  async ({ args, how }) => {
    const run = await recordCall(mixed, { from, to, end: 'inclusive', precision: 'minute' }, args);
    expect(run.calls).toEqual([{ from: Date.parse(from), to }]);
    expect(run.endSamples).toEqual(['R-2026-11-13T18:45Z']);
    expect(run.rows).toContainEqual(
      expect.objectContaining({
        kind: 'call-window',
        how,
        asked: { from, to: '2026-11-13T18:45:00.000000001Z' },
      }),
    );
  },
);

it('records widened epoch-second dispatch in the call window and returned period', async () => {
  const asked = { from: '2026-11-13T18:00:00.25Z', to: '2026-11-13T18:45:00.75Z' };
  const sent = { from, to: '2026-11-13T18:45:01Z' };
  const extra = [
    { from: sent.from, to: asked.from },
    { from: asked.to, to: sent.to },
  ];
  const run = await recordCall(coarse, asked);
  expect(run.calls).toEqual([
    { from: Date.parse(sent.from) / 1_000, to: Date.parse(sent.to) / 1_000 },
  ]);
  expect(run.rows).toContainEqual(
    expect.objectContaining({
      kind: 'call-window',
      how: 'filled',
      asked,
      sent,
      rounded: true,
      differs: { extra },
    }),
  );
  expect(run.rows).toContainEqual(
    expect.objectContaining({
      kind: 'period',
      verdict: 'undeclared',
      differs: expect.objectContaining({ source: 'sent', read: [sent], extra }),
    }),
  );
});
