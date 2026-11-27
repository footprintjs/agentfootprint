import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  isPaused,
  pauseHere,
} from '../../src/index.js';
import { activeTimeReadings } from '../../src/core/agent/honesty/timeInputs.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import { provenLookback } from '../../src/time/provenForms/proof.js';
import { rulerTool } from './fixtures/rulerTool.js';

const now = '2026-11-01T09:30:00Z';
const bounds = { from: '2026-11-01T07:30:00Z', to: now };

function fixture(
  skipProvenConfirmation?: boolean,
  pause = false,
  commitValues: 'full' | 'delta' = 'full',
  protectedInput = false,
) {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const callsToRequest = pause ? ['confirm', 'ruler'] : ['ruler'];
  let requestCount = 0;
  const provider = {
    name: 'ruler-script',
    async complete(_request: LLMRequest): Promise<LLMResponse> {
      const name = callsToRequest[requestCount++];
      return {
        content: name === undefined ? 'The ruler returned its rows.' : '',
        toolCalls: name === undefined ? [] : [{ id: name, name, args: {} }],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const options = {
    zone: 'UTC',
    reader: englishTimeReader(),
    ...(skipProvenConfirmation !== undefined && { skipProvenConfirmation }),
  };
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 4,
    commitValues,
    ...(protectedInput && { redact: { keys: ['userMessage'] } }),
  })
    .time(options)
    .tool(rulerTool({ onCall: (args) => calls.push(args) }));
  if (pause)
    builder.tool(
      defineTool({
        name: 'confirm',
        description: 'Pause before the ruler.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => pauseHere({ question: 'Go ahead?' }),
      }),
    );
  return { agent: builder.build(), calls };
}

function useTimeRuntime(tz = provenLookback.runtime.tz as string) {
  const base = globalThis.process;
  vi.stubGlobal(
    'process',
    Object.create(base, {
      versions: { value: { ...base.versions, ...provenLookback.runtime, tz } },
    }),
  );
}

describe('T4 standalone look-back at the native time and dispatch stages', () => {
  beforeEach(() => {
    const format = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
      return format(locales, { timeZone: 'UTC', ...options });
    });
    useTimeRuntime();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('keeps confirmation when the host leaves the option out', async () => {
    const { agent, calls } = fixture();
    const result = await agent.run({ message: 'last 2 hours', time: { now } });
    expect(isInputPause(result)).toBe(true);
    expect(calls).toEqual([]);
    expect(agent.findings().some((row) => 'qualifiedLookback' in row)).toBe(false);
  });

  it('dispatches the confirmed-shape UTC window without a person-answer row for an eligible opt-in', async () => {
    const { agent, calls } = fixture(true);
    const result = await agent.run({ message: 'last 2 hours', time: { now } });
    const ledger = agent.findings() as readonly { kind: string }[];
    expect(ledger).toContainEqual(
      expect.objectContaining({
        kind: 'time-reading',
        qualifiedLookback: { receipt: provenLookback.receipt, inputPosition: 0, clockNow: now },
      }),
    );
    expect(isPaused(result)).toBe(false);
    expect(result).toContain(
      'Window: 2026-11-01T07:30:00Z to 2026-11-01T09:30:00Z (end excluded).',
    );
    expect(calls).toEqual([bounds]);
    expect(ledger.every((row) => row.kind !== 'time-answer')).toBe(true);
  });

  it.each(['2026-11-13 2:00 PM to 4:15 PM UTC', 'last 2 hours before the outage'])(
    'keeps confirmation for %s',
    async (message) => {
      const { agent, calls } = fixture(true);
      expect(isInputPause(await agent.run({ message, time: { now } }))).toBe(true);
      expect(calls).toEqual([]);
    },
  );

  it('keeps confirmation when the native run protects the input', async () => {
    const { agent, calls } = fixture(true, false, 'full', true);
    const result = await agent.run({ message: 'last 2 hours', time: { now } });
    expect(isInputPause(result)).toBe(true);
    expect(calls).toEqual([]);
    expect(agent.findings().some((row) => 'qualifiedLookback' in row)).toBe(false);
  });

  it('does not allow duplicate, stale, unbound or wrong-position proof to settle a reading', async () => {
    const { agent } = fixture(true);
    await agent.run({ message: 'last 2 hours', time: { now } });
    const ledger = agent.findings();
    const saved = ledger.find((row) => row.kind === 'time-reading');
    if (saved === undefined) throw new Error('Expected the real reading row.');
    const active = {
      findingsLedger: ledger,
      turnNumber: 1,
      userMessage: 'last 2 hours',
      history: [{ role: 'user', content: 'last 2 hours' }],
    };
    expect(activeTimeReadings(active)[0]?.choice?.by).toBe('only');
    const variants = [
      { ...active, history: [] },
      { ...active, userMessage: 'last 1 minute' },
      { ...active, history: [{ role: 'assistant', content: active.userMessage }] },
      { ...active, findingsLedger: [...ledger, saved] },
      { ...active, findingsLedger: [saved] },
      { ...active, turnNumber: 2 },
      {
        ...active,
        findingsLedger: [
          ...ledger.filter((row) => row !== saved),
          {
            ...saved,
            qualifiedLookback: { ...saved.qualifiedLookback, inputPosition: 1 },
          },
        ],
      },
    ];
    for (const scope of variants) {
      expect(activeTimeReadings(scope).some((row) => row.choice?.by === 'only')).toBe(false);
    }
  });

  it.each(['full', 'delta'] as const)(
    'reuses the saved %s interval after a runtime identity change',
    async (commitValues) => {
      const { agent, calls } = fixture(true, true, commitValues);
      const paused = await agent.run({ message: 'last 2 hours', time: { now } });
      if (!isPaused(paused)) throw new Error('Expected the independent pause before the ruler.');
      expect(calls).toEqual([]);
      useTimeRuntime('2027a');
      const result = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), 'yes', {
        time: { now: '2026-11-02T09:30:00Z' },
      });
      expect(isPaused(result)).toBe(false);
      expect(result).toContain(
        'Window: 2026-11-01T07:30:00Z to 2026-11-01T09:30:00Z (end excluded).',
      );
      expect(calls).toEqual([bounds]);
      const fresh = fixture(true);
      expect(isInputPause(await fresh.agent.run({ message: 'last 2 hours', time: { now } }))).toBe(
        true,
      );
      expect(fresh.calls).toEqual([]);
    },
  );
});
