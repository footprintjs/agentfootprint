import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, allow, defineTool, deny, describedResult, isInputPause } from '../../src/index.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import { assessAnswer } from '../../src/core/agent/assessment/assess.js';
import { timeLimitsArg } from '../../src/core/agent/honesty/timeLimitsInput.js';
import { renderTimeLimits } from '../../src/semantics/coverage/timeLimits.js';
import type { DeclaredPeriod } from '../../src/semantics/coverage/period.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

const now = '2026-11-13T15:00:00Z';
const window = { from: '2026-11-13T10:00:00Z', to: '2026-11-13T12:00:00Z' };
const exact = { from: window.from, to: '2026-11-13T11:59:59.999Z' };
const first = 'first_source';
const second = 'second_source';
const reusedId = 'reused';

async function run(
  later: DeclaredPeriod | undefined,
  options: {
    readonly answered?: boolean;
    readonly denied?: boolean;
    readonly ordinary?: boolean;
    readonly rewritten?: boolean;
    readonly typed?: boolean;
  } = {},
) {
  const requests: LLMRequest[] = [];
  const received: object[] = [];
  const source = (name: string, period?: DeclaredPeriod) =>
    defineTool({
      name,
      description: 'Read the selected interval from a synthetic store.',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
      },
      period: {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'from', as: 'iso' },
            to: { argument: 'to', as: 'iso', edge: 'exclusive' },
          },
        ],
      },
      askOrAssume: { from: { ask: 'From when?' }, to: { ask: 'Until when?' } },
      execute(args) {
        received.push({ ...args });
        return period === undefined
          ? 'Read complete.'
          : describedResult({
              facts: [{ entity: 'item', count: 1 }],
              provenance: { measuredAt: now, source: 'fixture' },
              period,
            });
      },
    });
  const builder = Agent.create({
    model: 'mock',
    provider: {
      name: 'offline-comparison-results',
      async complete(req) {
        const name = [first, second][requests.length];
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        return {
          content: name === undefined ? (options.typed ? '{"message":"Done."}' : 'Done.') : '',
          toolCalls: name === undefined ? [] : [{ id: reusedId, name, args: { ...window } }],
          usage: { input: 0, output: 0 },
        };
      },
    },
  })
    .time({ zone: 'UTC' })
    .tool(source(first, { queried: exact, held: exact }))
    .tool(source(second, later))
    .limitsTravelWithTheAnswer();
  builder.answerLayer(options.answered ? { standingLine: true } : false);
  if (options.typed) builder.outputSchema(z.object({ message: z.string() }));
  if (options.denied || options.rewritten) {
    builder.toolMiddleware({
      name: 'admit-public-result',
      onToolResult({ toolName }) {
        if (toolName !== second) return allow();
        return options.denied ? deny('Publication blocked.') : allow('Public summary.');
      },
    });
  }
  const agent = builder.build();
  const periodEvents: unknown[] = [];
  const turnEnds: unknown[] = [];
  agent.on('agentfootprint.findings.period', ({ payload }) =>
    periodEvents.push({ ...payload, callOccurrenceKey: undefined }),
  );
  agent.on('agentfootprint.agent.turn_end', ({ payload }) => turnEnds.push(payload));
  const input = {
    message: 'Compare both stores.',
    time: {
      now,
      window,
      ...(!options.ordinary && { comparison: { tools: [first, second] } }),
    },
  };
  const result = options.typed ? await agent.runTyped(input) : await agent.run(input);
  expect(isInputPause(result)).toBe(false);
  const snapshot = agent.getLastSnapshot()!;
  return {
    result: String(result),
    requests,
    received,
    snapshot,
    shared: snapshot.sharedState,
    periodEvents,
    turnEnds,
    rows: agent.findings()?.filter(({ kind }) => kind === 'period') ?? [],
  };
}

describe('confirmed comparison coverage', () => {
  it('keeps reused provider ids separate, including a one-millisecond extra query sample', async () => {
    const extra = { from: exact.from, to: window.to };
    const { result, shared, rows, requests, received } = await run({ queried: extra, held: extra });
    expect(received).toEqual([window, window]);
    expect(rows).toMatchObject([
      { toolName: first, verdict: 'covered', toolCallId: reusedId, comparison: true },
      {
        toolName: second,
        verdict: 'covered',
        toolCallId: reusedId,
        comparison: true,
        differs: {
          source: 'declared',
          missing: [],
          extra: [{ from: window.to, to: '2026-11-13T12:00:00.001Z' }],
        },
      },
    ]);
    expect(rows[0]).not.toHaveProperty('differs');
    expect(shared.settledToolCalls?.map(readCallOccurrenceKey)).toEqual(
      rows.map(readCallOccurrenceKey),
    );
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[1])).not.toContain('included extra time');
    expect(JSON.stringify(requests[1])).not.toContain(
      'Comparison coverage could not be established',
    );
    expect(JSON.stringify(requests[2])).toContain(
      "second_source's reported query included extra time",
    );
    expect(result).toContain("second_source's reported query included extra time");
  });

  it('reports missing query time independently from unknown held coverage', async () => {
    const short = { from: exact.from, to: '2026-11-13T10:59:59.999Z' };
    const { shared, result, snapshot } = await run(
      { queried: short, held: 'unknown' },
      { answered: true },
    );
    const { timeLimits } = timeLimitsArg(shared);
    const lines = renderTimeLimits(timeLimits, 'model');
    expect(lines?.period).toEqual([
      expect.stringContaining("second_source's reported query missed"),
    ]);
    expect(lines?.coverageUnknown).toEqual([
      'second_source reported that the period held by its source is unknown',
    ]);
    expect(result).toContain('period held by its source is unknown');
    expect(assessAnswer({ snapshot }).reasons.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining(['period-differs-from-asked', 'period-unknown']),
    );
  });

  it('reports shorter held coverage independently from an exact returned query', async () => {
    const held = { ...exact, to: '2026-11-13T10:59:59.999Z' };
    const { shared, rows } = await run({ queried: exact, held });
    const { timeLimits } = timeLimitsArg(shared);
    expect(rows[1]).toMatchObject({ verdict: 'partly-held', held: { queried: exact, held } });
    expect(rows[1]).not.toHaveProperty('differs');
    expect(renderTimeLimits(timeLimits, 'model')).toMatchObject({
      period: [],
      held: [expect.stringContaining('which covers only part of that time')],
    });
  });

  it('distinguishes absent declarations from covered time and preserves the ordinary path', async () => {
    const comparison = await run(undefined);
    const ordinary = await run(undefined, { ordinary: true });
    expect(comparison.received).toEqual(ordinary.received);
    expect(comparison.rows[1]).toMatchObject({ toolName: second, verdict: 'undeclared' });
    expect(comparison.rows[1]).not.toHaveProperty('differs');
    expect(comparison.result).toContain(
      'second_source did not declare the period its result covers',
    );
    expect(ordinary.rows[1]).not.toHaveProperty('comparison');
    expect(ordinary.result).not.toContain('did not declare');
  });

  it.each([{ denied: true }, { rewritten: true }])(
    'keeps a private returned period out of every public projection after result policy %j',
    async (policy) => {
      const hiddenFirst = { from: '2026-11-01T01:02:03Z', to: '2026-11-01T04:05:06Z' };
      const hiddenSecond = { from: '2026-11-02T07:08:09Z', to: '2026-11-02T10:11:12Z' };
      const options = { ...policy, answered: true };
      const a = await run({ queried: hiddenFirst, held: hiddenFirst }, options);
      const b = await run({ queried: hiddenSecond, held: hiddenSecond }, options);
      expect(a.result).toEqual(b.result);
      expect(a.result).toContain('Comparison coverage could not be established');
      expect(a.result).not.toContain('2026-11-01');
      expect(a.requests).toEqual(b.requests);
      expect(a.periodEvents).toEqual(b.periodEvents);
      expect(JSON.stringify(a.turnEnds)).not.toContain('2026-11-01');
      expect(JSON.stringify(b.turnEnds)).not.toContain('2026-11-02');
      expect(a.rows[1]).toMatchObject({ toolName: second, verdict: 'unknown' });
      expect(a.rows[1]).not.toHaveProperty('held');
      expect(a.rows[1]).not.toHaveProperty('differs');
      const saved = (value: typeof a.snapshot): typeof a.snapshot =>
        JSON.parse(JSON.stringify(value));
      const aSaved = assessAnswer({ snapshot: saved(a.snapshot) });
      const bSaved = assessAnswer({ snapshot: saved(b.snapshot) });
      expect(aSaved.reasons.map(({ reason }) => reason)).toEqual(
        bSaved.reasons.map(({ reason }) => reason),
      );
      const reasons = aSaved.reasons;
      expect(reasons.map(({ reason }) => reason)).not.toContain('period-unknown');
      expect(reasons.map(({ reason }) => reason)).not.toContain('period-differs-from-asked');
    },
  );

  it('applies the same admission to typed limits beside the answer', async () => {
    const native = await run({ queried: exact, held: exact }, { typed: true });
    const denied = await run({ queried: exact, held: exact }, { typed: true, denied: true });
    expect(native.shared.answerCoverage?.periods?.map(({ toolName }) => toolName)).toEqual([
      first,
      second,
    ]);
    expect(denied.shared.answerCoverage?.periods?.map(({ toolName }) => toolName)).toEqual([first]);
  });

  it('withholds a saved period warning when its settlement is missing or ambiguous', async () => {
    const extra = { from: exact.from, to: window.to };
    const { shared, snapshot } = await run({ queried: extra, held: extra }, { answered: true });
    const [a, b] = shared.settledToolCalls ?? [];
    if (a === undefined || b === undefined) throw new Error('Expected two native settlements');
    const retained = [[a], [a, b, b], undefined];
    for (const settledToolCalls of retained) {
      const saved = { ...shared, settledToolCalls };
      const { timeLimits } = timeLimitsArg(saved);
      expect(renderTimeLimits(timeLimits, 'model')).toMatchObject({
        period: [],
        coverageUnknown: ['Comparison coverage could not be established'],
      });
      expect(assessAnswer({ snapshot: { ...snapshot, sharedState: saved } }).reasons).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ reason: 'period-differs-from-asked' })]),
      );
    }
  });
});
