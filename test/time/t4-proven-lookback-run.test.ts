import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  allow,
  defineTool,
  englishTimeReader,
  isInputPause,
  isPaused,
  pauseHere,
} from '../../src/index.js';
import { activeTimeReadings } from '../../src/core/agent/honesty/timeInputs.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import {
  defineMemory,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/InMemoryStore.js';
import { defaultTimeAskMessages } from '../../src/locales/timeAsk.js';
import { timeAskOf } from '../../src/time/readingAsk.js';
import { timeRowIsWellFormed, type TimeReadingRow } from '../../src/time/rows.js';
import { isOpenForPerson, turnWindowsOf } from '../../src/time/windows.js';
import { provenLookback } from '../../src/time/provenForms/proof.js';
import { rulerTool } from './fixtures/rulerTool.js';

const now = '2026-11-01T09:30:00Z';
const bounds = { from: '2026-11-01T07:30:00Z', to: now };

function fixture(
  skipProvenConfirmation?: boolean,
  pause = false,
  commitValues: 'full' | 'delta' = 'full',
  protectedInput: boolean | 'finalContent' = false,
  firstReplyOnly = false,
  rewrite?: (text: string) => string,
  typedOutput = false,
  modelBounds: Readonly<Record<string, string>> = {},
  memory?: MemoryDefinition,
  anotherRulerBounds?: Readonly<Record<string, string>>,
) {
  const requests: LLMRequest[] = [];
  const calls: Readonly<Record<string, unknown>>[] = [];
  const callsToRequest = firstReplyOnly
    ? [undefined, 'ruler']
    : pause
    ? ['confirm', 'ruler']
    : ['ruler'];
  let requestCount = 0;
  const provider = {
    name: 'ruler-script',
    async complete(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      const name = callsToRequest[requestCount++];
      return {
        content: name === undefined ? 'The ruler returned its rows.' : '',
        toolCalls:
          name === undefined
            ? []
            : [
                { id: name, name, args: name === 'ruler' ? modelBounds : {} },
                ...(name === 'ruler' && anotherRulerBounds !== undefined
                  ? [{ id: 'ruler-second', name, args: anotherRulerBounds }]
                  : []),
              ],
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
    ...(protectedInput && {
      redact: { keys: [protectedInput === true ? 'userMessage' : protectedInput] },
    }),
  })
    .time(options)
    .tool(rulerTool({ onCall: (args) => calls.push(args) }));
  if (memory !== undefined) builder.memory(memory);
  if (typedOutput) builder.outputSchema(z.object({ answer: z.string() }));
  if (pause)
    builder.tool(
      defineTool({
        name: 'confirm',
        description: 'Pause before the ruler.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => pauseHere({ question: 'Go ahead?' }),
      }),
    );
  if (rewrite !== undefined)
    builder.messageMiddleware({
      name: 'normalize-input',
      onMessage: ({ phase, content }) =>
        phase === 'input' ? allow(rewrite(content), 'Normalized input.') : allow(),
    });
  return { agent: builder.build(), calls, requests };
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
        choice: { by: 'proven', candidate: 0 },
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

  it('asks when the literal is a later turn after a prior conversation', async () => {
    const { agent, calls } = fixture(true, false, 'full', false, true);
    const first = await agent.run({ message: 'The outage began yesterday.', time: { now } });
    expect(isPaused(first)).toBe(false);
    const continueFrom = agent.checkpoint();
    if (continueFrom === undefined) throw new Error('Expected the prior conversation.');
    expect(
      isInputPause(await agent.run({ message: 'last 2 hours', continueFrom, time: { now } })),
    ).toBe(true);
    expect(calls).toEqual([]);
    expect(agent.findings().some((row) => 'qualifiedLookback' in row)).toBe(false);
  });

  it('asks when the accepted literal differs from the text the person sent', async () => {
    const { agent, calls } = fixture(true, false, 'full', false, false, () => 'last 2 hours');
    expect(isInputPause(await agent.run({ message: 'Last 2 hours?', time: { now } }))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('still qualifies a byte-identical input after middleware', async () => {
    const { agent, calls } = fixture(true, false, 'full', false, false, (text) => text);
    const result = await agent.run({ message: 'last 2 hours', time: { now } });
    expect(isPaused(result)).toBe(false);
    expect(calls).toEqual([bounds]);
  });

  it.each([true, 'finalContent'] as const)(
    'asks when protected key %s prevents stating its window',
    async (key) => {
      const { agent, calls } = fixture(true, false, 'full', key);
      const result = await agent.run({ message: 'last 2 hours', time: { now } });
      expect(isInputPause(result)).toBe(true);
      expect(calls).toEqual([]);
      expect(agent.findings().some((row) => 'qualifiedLookback' in row)).toBe(false);
    },
  );

  it('keeps input confirmation when a fresh agent recalls earlier context', async () => {
    const identity = { conversationId: 't4-memory' };
    const memory = defineMemory({
      id: 't4-memory',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    const writer = fixture(false, false, 'full', false, true, undefined, false, {}, memory);
    await writer.agent.run({ identity, message: 'The outage ended yesterday.', time: { now } });
    const readOnly = { ...memory, store: undefined, write: undefined };
    const reader = fixture(true, false, 'full', false, false, undefined, false, {}, readOnly);
    const result = await reader.agent.run({ identity, message: 'last 2 hours', time: { now } });
    expect(JSON.stringify(reader.requests[0])).toContain('The outage ended yesterday.');
    expect(isInputPause(result)).toBe(true);
    expect(reader.calls).toEqual([]);
  });

  it('does not qualify another runner’s composed text', async () => {
    const { agent, calls } = fixture(true);
    const result = await agent.run({
      message: 'last 2 hours',
      messageFrom: 'composed',
      time: { now },
    });
    expect(isInputPause(result)).toBe(true);
    expect(calls).toEqual([]);
    expect(agent.findings().some((row) => 'qualifiedLookback' in row)).toBe(false);
  });

  it.each(['full', 'delta'] as const)(
    'uses current final-content protection on a %s resume',
    async (values) => {
      const { agent, calls } = fixture(true, true, values);
      const first = await agent.run({ message: 'last 2 hours', time: { now } });
      if (!isPaused(first)) throw new Error('Expected a pause before the ruler.');
      const result = await agent.resume(JSON.parse(JSON.stringify(first.checkpoint)), true, {
        redact: { patterns: [/^finalContent$/] },
      });
      expect(isInputPause(result)).toBe(true);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ['full', 'yes'],
    ['delta', 'yes'],
    ['full', 'yes, but I meant the 2 hours before yesterday’s 3 PM outage'],
    ['delta', 'yes, but I meant the 2 hours before yesterday’s 3 PM outage'],
  ] as const)('withdraws the %s proof after a free-text pause answer', async (values, input) => {
    const { agent, calls } = fixture(true, true, values);
    const first = await agent.run({ message: 'last 2 hours', time: { now } });
    if (!isPaused(first)) throw new Error('Expected the independent pause before the ruler.');
    const result = await agent.resume(JSON.parse(JSON.stringify(first.checkpoint)), input);
    expect(isInputPause(result)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('asks before dispatch when the model supplies a different interval', async () => {
    const suggested = { from: '2026-11-01T08:30:00Z', to: now };
    const { agent, calls } = fixture(
      true,
      false,
      'full',
      false,
      false,
      undefined,
      false,
      suggested,
    );
    const paused = await agent.run({ message: 'last 2 hours', time: { now } });
    if (!isInputPause(paused)) throw new Error('Expected a native window confirmation.');
    expect(calls).toEqual([]);
    const field = paused.awaitingInput.fields[0]!;
    const offer = field.enum?.[0];
    if (offer === undefined) throw new Error('Expected the read interval as the offered choice.');
    const reply = await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { [field.id]: offer },
    });
    expect(isPaused(reply)).toBe(false);
    expect(calls).toEqual([bounds]);
  });

  it.each(['full', 'delta'] as const)(
    'applies one corrected interval to the whole %s batch',
    async (values) => {
      const suggested = { from: '2026-11-01T08:30:00Z', to: now };
      const corrected = { from: '2026-11-01T06:30:00Z', to: now };
      const { agent, calls } = fixture(
        true,
        false,
        values,
        false,
        false,
        undefined,
        false,
        bounds,
        undefined,
        suggested,
      );
      const paused = await agent.run({ message: 'last 2 hours', time: { now } });
      if (!isInputPause(paused)) throw new Error('Expected one native window confirmation.');
      expect(calls).toEqual([]);
      const field = paused.awaitingInput.fields.find((f) => f.format === 'time-range')!;
      const result = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
        requestId: paused.awaitingInput.requestId,
        values: { [`${field.id}-correction`]: `${corrected.from}/${corrected.to}` },
      });
      expect(isPaused(result)).toBe(false);
      expect(calls).toEqual([corrected, corrected]);
      expect(result).not.toContain('Window:');
    },
  );

  it('does not state a window when the model answers without calling the ruler', async () => {
    const { agent, calls } = fixture(true, false, 'full', false, true);
    const result = await agent.run({ message: 'last 2 hours', time: { now } });
    expect(isPaused(result)).toBe(false);
    expect(result).not.toContain('Window:');
    expect(calls).toEqual([]);
  });

  it('keeps an exact saved proven decision pending outside the native run', async () => {
    const { agent } = fixture(true);
    await agent.run({ message: 'last 2 hours', time: { now } });
    const row = JSON.parse(
      JSON.stringify(agent.findings().find((r) => r.kind === 'time-reading')),
    ) as TimeReadingRow & Readonly<Record<string, unknown>>;
    expect(timeRowIsWellFormed(row)).toBe(true);
    expect(timeRowIsWellFormed({ ...row, qualifiedLookback: undefined })).toBe(false);
    expect(timeRowIsWellFormed({ ...row, choice: { by: 'proven', candidate: 1 } })).toBe(false);
    expect(isOpenForPerson(row)).toBe(true);
    expect(turnWindowsOf([row], undefined).windows).toEqual([]);
    expect(timeAskOf(row, defaultTimeAskMessages)?.field.enum).toHaveLength(1);
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
    expect(activeTimeReadings(active, true)[0]?.choice?.by).toBe('only');
    const variants = [
      { ...active, history: [] },
      { ...active, userMessage: 'last 1 minute' },
      { ...active, history: [{ role: 'assistant', content: active.userMessage }] },
      { ...active, findingsLedger: [...ledger, saved] },
      { ...active, findingsLedger: [saved] },
      { ...active, turnNumber: 2 },
      {
        ...active,
        turnNumber: 2,
        findingsLedger: ledger.map((row) => ({ ...row, turn: 2 })),
      },
      ...[{ receipt: '0'.repeat(64) }, { clockNow: '2026-11-01T09:31:00Z' }].map((changed) => ({
        ...active,
        findingsLedger: ledger.map((row) =>
          row === saved
            ? { ...saved, qualifiedLookback: { ...saved.qualifiedLookback, ...changed } }
            : row,
        ),
      })),
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
      expect(activeTimeReadings(scope, true).some((row) => row.choice?.by === 'only')).toBe(false);
    }
  });

  it.each([
    ['full', false],
    ['delta', false],
    ['full', true],
    ['delta', true],
  ] as const)(
    'asks when the current agent cannot use the saved %s proof (typed=%s)',
    async (values, typed) => {
      const original = fixture(true, true, values);
      const paused = await original.agent.run({ message: 'last 2 hours', time: { now } });
      if (!isPaused(paused)) throw new Error('Expected the independent pause before the ruler.');
      const current = fixture(typed, false, values, false, false, undefined, typed);
      const result = await current.agent.resume(
        JSON.parse(JSON.stringify(paused.checkpoint)),
        true,
      );
      expect(isInputPause(result)).toBe(true);
      expect(current.calls).toEqual([]);
    },
  );

  it.each(['full', 'delta'] as const)(
    'reuses the saved %s interval after a runtime identity change',
    async (commitValues) => {
      const { agent, calls } = fixture(true, true, commitValues);
      const paused = await agent.run({ message: 'last 2 hours', time: { now } });
      if (!isPaused(paused)) throw new Error('Expected the independent pause before the ruler.');
      expect(calls).toEqual([]);
      useTimeRuntime('2027a');
      const result = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), true, {
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
