/** Partial model bounds and the person's pending words are two separate scopes.
 * Public Agent regression: fixed clock, scripted provider and counting inert tools.
 * Functional/order negatives run in both ordinary and grouped charts. No model call.
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, englishTimeReader, isInputPause } from '../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';

const NOW = '2026-10-09T16:00:00Z';
const FROM = '2026-10-09T13:00:00Z';
const TO = '2026-10-09T15:00:00Z';
const PERSON = '2026-10-09T14:00:00Z/2026-10-09T16:00:00Z';
const MESSAGE = 'Show metric series and cache paths in the last 2 hours';
const NAMES = ['metric_series', 'cache_paths'] as const;
type Mode = 'dynamic' | 'dynamic-grouped';
type Completion = 'ordinary' | 'assume';
type Seen = { name: string; args: Record<string, unknown>; time: unknown };

function make(options: {
  mode: Mode;
  first: (typeof NAMES)[number];
  supplied?: 'start' | 'stop' | 'both';
  completion?: Completion;
  allComplete?: boolean;
  firstArgs?: Record<string, unknown>;
  secondArgs?: Record<string, unknown>;
  zone?: 'UTC' | null;
  batch?: boolean;
  batchBaseline?: boolean;
  maxRange?: '1h';
  optionalBounds?: boolean;
  redactIdentity?: true;
}) {
  const seen: Seen[] = [];
  const requests: LLMRequest[] = [];
  const second = NAMES.find((name) => name !== options.first)!;
  const supplied = options.supplied;
  const firstArgs = options.firstArgs ?? {
    ...(supplied === 'start' || supplied === 'both' ? { start: FROM } : {}),
    ...(supplied === 'stop' || supplied === 'both' ? { stop: TO } : {}),
  };
  const secondArgs = options.secondArgs ?? (options.allComplete ? { start: FROM, stop: TO } : {});
  const script = options.batch
    ? [
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: options.first, args: firstArgs },
            { id: 'c2', name: second, args: secondArgs },
            ...(options.batchBaseline
              ? [
                  {
                    id: 'c3',
                    name: options.first,
                    args: { start: '2026-10-08T13:00:00Z', stop: '2026-10-08T15:00:00Z' },
                  },
                ]
              : []),
          ],
        },
        { content: 'Done.', toolCalls: [] },
      ]
    : [
        { content: '', toolCalls: [{ id: 'c1', name: options.first, args: firstArgs }] },
        { content: '', toolCalls: [{ id: 'c2', name: second, args: secondArgs }] },
        { content: 'Done.', toolCalls: [] },
      ];
  let at = 0;
  const provider = {
    name: 'partial-window-script',
    complete: async (request: LLMRequest): Promise<LLMResponse> => {
      requests.push(request);
      const reply = script[at++];
      if (reply === undefined) throw new Error('unexpected extra provider request');
      return { ...reply, usage: { input: 0, output: 0 } };
    },
  };
  const tools = NAMES.map((name) =>
    defineTool({
      name,
      description: 'Read a synthetic interval.',
      inputSchema: {
        type: 'object',
        ...(options.optionalBounds !== true && { required: ['start', 'stop'] }),
        properties: { start: { type: 'string' }, stop: { type: 'string' } },
      },
      askOrAssume: {
        start: options.completion === 'assume' ? { assume: FROM } : { ask: 'From when?' },
        stop: options.completion === 'assume' ? { assume: TO } : { ask: 'Until when?' },
      },
      period: {
        ...(options.maxRange !== undefined && { maxRange: options.maxRange }),
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'start', as: 'iso' },
            to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
          },
        ],
      },
      execute: (args, ctx) => {
        seen.push({ name, args: { ...args }, time: ctx.time });
        return { rows: [{ value: 1 }] };
      },
    }),
  );
  const agent = Agent.create({
    provider,
    model: 'mock',
    reactMode: options.mode,
    maxIterations: 5,
    ...(options.redactIdentity && { redact: { keys: ['runIdentity'] } }),
  })
    .tools(tools)
    .time({
      ...(options.zone !== null && { zone: options.zone ?? 'UTC' }),
      reader: englishTimeReader(),
      policy: { year: 'current' },
    })
    .build();
  return { agent, seen, requests };
}

it('keeps private identity out of both partial-window pause ownership references', async () => {
  const principal = 'partial-principal-canary';
  const { agent } = make({
    mode: 'dynamic',
    first: 'metric_series',
    supplied: 'start',
    redactIdentity: true,
  });
  const outcome = await agent.run({
    message: MESSAGE,
    time: { now: NOW },
    identity: { conversationId: 'synthetic-conversation', principal },
  });
  expect(isInputPause(outcome)).toBe(true);
  expect(JSON.stringify(outcome)).toContain(principal);
  expect(JSON.stringify(agent.getSnapshot())).not.toContain(principal);
});

for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
  const reply = async (agent: Agent, outcome: unknown, value: unknown) => {
    if (!isInputPause(outcome)) throw new Error('expected a real native pause');
    return agent.resume(outcome.checkpoint, {
      requestId: outcome.awaitingInput.requestId,
      values: { [outcome.awaitingInput.fields[0].id]: value as string },
    });
  };
  const latest = (agent: Agent, id: string) =>
    (agent.findings() ?? [])
      .filter((row) => row.kind === 'call-window' && row.toolCallId === id)
      .at(-1);
  describe(`${mode}: partial-window acceptance`, () => {
    for (const corruption of [
      'ordinary-answer',
      'ordinary-target',
      'missing-fill-target',
      'duplicate-target',
      'relabeled-target',
      'progress-fill',
      'progress-refusal',
      'waiting-index',
      'waiting-request',
      'mirrored-ordinary-target',
      'mirrored-native-target',
      'missing-snapshot',
    ] as const) {
      it(`rejects inconsistent saved carrier ${corruption} before effects`, async () => {
        const { agent, seen, requests } = make({
          mode,
          first: 'metric_series',
          supplied: 'start',
          batch: true,
          optionalBounds: true,
        });
        try {
          let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
          pause = await reply(agent, pause, TO);
          if (!isInputPause(pause)) throw new Error('missing genuine native pause');
          expect(pause.awaitingInput.fields[0].format).toBe('time-range');
          expect(seen).toHaveLength(0);
          const checkpoint = JSON.parse(JSON.stringify(pause.checkpoint));
          let edits = 0;
          const visit = (value: any): void => {
            if (value === null || typeof value !== 'object') return;
            if (value.partial?.phase === 'confirm-meaning' && Array.isArray(value.fields)) {
              const ordinary = value.fields.findIndex((field: any) => field.window === undefined);
              const native = value.fields.findIndex(
                (field: any) => field.window?.role === 'confirm-meaning',
              );
              expect(ordinary).toBeGreaterThanOrEqual(0);
              expect(native).toBeGreaterThanOrEqual(0);
              if (corruption === 'ordinary-answer')
                value.progress[ordinary].answer = '2026-10-09T15:30:00Z';
              if (corruption === 'ordinary-target')
                value.fields[ordinary].members[0].argument = 'start';
              if (corruption === 'missing-fill-target')
                value.fields[native].members = value.fields[native].members.filter(
                  (member: any) => member.toolName !== 'cache_paths',
                );
              if (corruption === 'duplicate-target')
                value.fields[native].members.push(structuredClone(value.fields[native].members[0]));
              if (corruption === 'relabeled-target')
                value.fields[native].members[0].argument = 'other';
              if (corruption === 'progress-fill')
                value.progress[ordinary].fills = { c2: { values: { start: FROM, stop: TO } } };
              if (corruption === 'progress-refusal') value.progress[ordinary].exhausted = true;
              if (corruption === 'waiting-index') value.waiting.fieldIndexes = [ordinary];
              if (corruption === 'waiting-request') value.waiting.requestId += ':changed';
              if (corruption === 'mirrored-ordinary-target') {
                value.fields[ordinary].members[0].argument = 'start';
                value.partial.snapshot.fields[ordinary].members[0].argument = 'start';
              }
              if (corruption === 'mirrored-native-target') {
                value.fields[native].members = value.fields[native].members.filter(
                  (member: any) => member.toolName !== 'cache_paths',
                );
                value.partial.snapshot.fields[native].members = value.partial.snapshot.fields[
                  native
                ].members.filter((member: any) => member.toolName !== 'cache_paths');
              }
              if (corruption === 'missing-snapshot') delete value.partial.snapshot;
              edits++;
              return; // Do not also edit the writer's detached consistency snapshot.
            }
            for (const child of Object.values(value)) visit(child);
          };
          visit(checkpoint);
          expect(edits).toBeGreaterThan(0);
          const retained = JSON.stringify(checkpoint);
          await expect(
            agent.resume(checkpoint, {
              requestId: pause.awaitingInput.requestId,
              values: {
                [pause.awaitingInput.fields[0].id]: pause.awaitingInput.fields[0].enum![0],
              },
            }),
          ).rejects.toThrow();
          expect(seen).toHaveLength(0);
          expect(requests).toHaveLength(1);
          expect(timeAnswers(agent)).toHaveLength(0);
          expect(JSON.stringify(checkpoint)).toBe(retained);
        } finally {
          await agent.shutdown();
        }
      });
    }
    for (const [label, range, how] of [
      ['offered person range', PERSON, 'model-chosen'],
      ['edited person range', '2026-10-09T12:00:00Z/2026-10-09T14:00:00Z', 'model-chosen'],
      ['whole range matches', `${FROM}/${TO}`, 'bound'],
      ['only one endpoint matches', `${FROM}/2026-10-09T16:00:00Z`, 'model-chosen'],
    ] as const) {
      it(`${label}: preserves tool arguments and compares the complete interval`, async () => {
        const { agent, seen } = make({ mode, first: 'metric_series', supplied: 'start' });
        try {
          let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
          pause = await reply(agent, pause, TO);
          expect(seen).toHaveLength(0);
          // Confirmation means choosing the actual offered wire value. Equivalent ISO
          // spellings entered freely are edits under the existing native-ask contract.
          if (!isInputPause(pause)) throw new Error('missing native range');
          const suppliedRange =
            label === 'offered person range' ? pause.awaitingInput.fields[0].enum?.[0] : range;
          expect(suppliedRange).toBeDefined();
          await reply(agent, pause, suppliedRange);
          expect(seen[0].args).toEqual({ start: FROM, stop: TO });
          expect(latest(agent, 'c1')).toMatchObject({ how });
          expect(timeAnswers(agent)).toEqual([
            expect.objectContaining({ how: range === PERSON ? 'confirmed' : 'edited' }),
          ]);
          const rows = (agent.findings() ?? []).filter(
            (row) => row.kind === 'argument' && row.toolCallId === 'c1',
          );
          expect(rows).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ argument: 'stop', source: 'answered' }),
            ]),
          );
        } finally {
          await agent.shutdown();
        }
      });
    }
    it('asks the unknown zone before the range without treating the zone as confirmation', async () => {
      const { agent, seen, requests } = make({
        mode,
        first: 'metric_series',
        supplied: 'start',
        zone: null,
      });
      try {
        let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
        pause = await reply(agent, pause, TO);
        if (!isInputPause(pause)) throw new Error('missing zone pause');
        expect(pause.awaitingInput.fields[0].format).toBe('zone');
        pause = await reply(agent, pause, 'UTC');
        expect(timeAnswers(agent)).toHaveLength(0);
        expect(seen).toHaveLength(0);
        expect(requests).toHaveLength(1);
        if (!isInputPause(pause)) throw new Error('missing range after zone');
        expect(pause.awaitingInput.fields[0].format).toBe('time-range');
        await reply(agent, pause, PERSON);
        expect(seen).toHaveLength(2);
        expect(timeAnswers(agent)).toHaveLength(1);
      } finally {
        await agent.shutdown();
      }
    });
    it('keeps invalid and reversed native ranges pending without another model call', async () => {
      const { agent, seen, requests } = make({ mode, first: 'metric_series', supplied: 'start' });
      try {
        let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
        pause = await reply(agent, pause, TO);
        for (const value of ['not-a-range', `${TO}/${FROM}`]) {
          pause = await reply(agent, pause, value);
          expect(isInputPause(pause)).toBe(true);
          expect(seen).toHaveLength(0);
          expect(timeAnswers(agent)).toHaveLength(0);
          expect(requests).toHaveLength(1);
        }
        await reply(agent, pause, PERSON);
        expect(seen).toHaveLength(2);
      } finally {
        await agent.shutdown();
      }
    });
    it('keeps an ambiguous abbreviation pending until the zone and range are answered', async () => {
      const { agent, seen, requests } = make({ mode, first: 'metric_series', supplied: 'start' });
      try {
        let pause = await agent.run({
          message: 'Read 10/09/26 8 AM to 8:40 AM PST',
          time: { now: NOW },
        });
        pause = await reply(agent, pause, TO);
        if (!isInputPause(pause)) throw new Error('missing abbreviation question');
        expect(pause.awaitingInput.fields[0].format).toBe('zone');
        pause = await reply(agent, pause, 'America/Los_Angeles');
        expect(seen).toHaveLength(0);
        expect(requests).toHaveLength(1);
        expect(timeAnswers(agent)).toHaveLength(0);
        if (!isInputPause(pause)) throw new Error('missing offered readings');
        const choice = pause.awaitingInput.fields[0].enum?.[0];
        expect(choice).toBeDefined();
        await reply(agent, pause, choice);
        expect(seen[0].args).toEqual({ start: FROM, stop: TO });
        expect(timeAnswers(agent)).toHaveLength(1);
      } finally {
        await agent.shutdown();
      }
    });
    it('settles person meaning independently of whether a sibling tool can fill it', async () => {
      const { agent, seen } = make({
        mode,
        first: 'metric_series',
        supplied: 'start',
        maxRange: '1h',
      });
      try {
        let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
        pause = await reply(agent, pause, '2026-10-09T14:00:00Z');
        expect(seen).toHaveLength(0);
        await reply(agent, pause, PERSON);
        expect(timeAnswers(agent)).toHaveLength(1);
        expect(seen).toHaveLength(1);
        expect(seen[0].args).toEqual({ start: FROM, stop: '2026-10-09T14:00:00Z' });
        expect(latest(agent, 'c2')).toMatchObject({ how: 'refused' });
      } finally {
        await agent.shutdown();
      }
    });
    it('cancelling the native question never dispatches the waiting collectors', async () => {
      const { agent, seen } = make({ mode, first: 'cache_paths', supplied: 'stop' });
      try {
        const first = await agent.run({ message: MESSAGE, time: { now: NOW } });
        const meaning = await reply(agent, first, FROM);
        if (!isInputPause(meaning)) throw new Error('missing native pause');
        await expect(
          agent.resume(meaning.checkpoint, {
            requestId: meaning.awaitingInput.requestId,
            cancel: true,
          }),
        ).rejects.toThrow();
        expect(seen).toHaveLength(0);
        expect(timeAnswers(agent)).toHaveLength(0);
      } finally {
        await agent.shutdown();
      }
    });
    it('holds a mixed batch, fills only the all-missing sibling, and preserves the partial scope', async () => {
      const { agent, seen, requests } = make({
        mode,
        first: 'metric_series',
        supplied: 'start',
        batch: true,
        batchBaseline: true,
      });
      try {
        let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
        pause = await reply(agent, pause, TO);
        expect(seen).toHaveLength(0);
        expect(requests).toHaveLength(1);
        await reply(agent, pause, PERSON);
        expect(seen).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'metric_series', args: { start: FROM, stop: TO } }),
            expect.objectContaining({
              name: 'cache_paths',
              args: { start: '2026-10-09T14:00:00Z', stop: '2026-10-09T16:00:00Z' },
            }),
            expect.objectContaining({
              name: 'metric_series',
              args: { start: '2026-10-08T13:00:00Z', stop: '2026-10-08T15:00:00Z' },
            }),
          ]),
        );
        expect(seen).toHaveLength(3);
        expect(timeAnswers(agent)).toHaveLength(1);
      } finally {
        await agent.shutdown();
      }
    });
    it('preserves a complete baseline sibling while holding the partial member', async () => {
      const { agent, seen } = make({
        mode,
        first: 'metric_series',
        supplied: 'start',
        batch: true,
        secondArgs: { start: '2026-10-08T13:00:00Z', stop: '2026-10-08T15:00:00Z' },
      });
      try {
        let pause = await agent.run({ message: MESSAGE, time: { now: NOW } });
        pause = await reply(agent, pause, TO);
        expect(seen).toHaveLength(0);
        await reply(agent, pause, PERSON);
        expect(seen[1].args).toEqual({
          start: '2026-10-08T13:00:00Z',
          stop: '2026-10-08T15:00:00Z',
        });
        expect(latest(agent, 'c2')).toMatchObject({ how: 'model-chosen' });
      } finally {
        await agent.shutdown();
      }
    });
    it('keeps concurrent separate Agent confirmations and executed windows isolated', async () => {
      const a = make({ mode, first: 'metric_series', supplied: 'start' });
      const b = make({ mode, first: 'cache_paths', supplied: 'stop' });
      try {
        const [pa, pb] = await Promise.all([
          a.agent.run({ message: MESSAGE, time: { now: NOW } }),
          b.agent.run({ message: MESSAGE, time: { now: NOW } }),
        ]);
        const [ma, mb] = await Promise.all([reply(a.agent, pa, TO), reply(b.agent, pb, FROM)]);
        expect(a.seen).toHaveLength(0);
        expect(b.seen).toHaveLength(0);
        await Promise.all([reply(a.agent, ma, PERSON), reply(b.agent, mb, `${FROM}/${TO}`)]);
        expect(latest(a.agent, 'c1')).toMatchObject({ how: 'model-chosen' });
        expect(latest(b.agent, 'c1')).toMatchObject({ how: 'bound' });
        expect(timeAnswers(a.agent)).toHaveLength(1);
        expect(timeAnswers(b.agent)).toHaveLength(1);
      } finally {
        await a.agent.shutdown();
        await b.agent.shutdown();
      }
    });
    for (const [member, value] of [
      ['owner', 'another-owner'],
      ['version', 999],
      ['phase', 'unknown'],
    ] as const) {
      it(`refuses a corrupted saved ${member} before collector dispatch`, async () => {
        const { agent, seen, requests } = make({ mode, first: 'metric_series', supplied: 'start' });
        try {
          const first = await agent.run({ message: MESSAGE, time: { now: NOW } });
          const meaning = await reply(agent, first, TO);
          if (!isInputPause(meaning)) throw new Error('missing native question');
          const checkpoint = JSON.parse(JSON.stringify(meaning.checkpoint));
          let changed = 0;
          const corrupt = (value_: unknown) => {
            if (value_ === null || typeof value_ !== 'object') return;
            const record = value_ as Record<string, unknown>;
            if (record.phase === 'confirm-meaning' && Array.isArray(record.origins)) {
              record[member] = value;
              changed += 1;
            }
            for (const child of Object.values(record)) corrupt(child);
          };
          corrupt(checkpoint);
          expect(changed).toBeGreaterThan(0);
          await expect(
            agent.resume(checkpoint, {
              requestId: meaning.awaitingInput.requestId,
              values: { [meaning.awaitingInput.fields[0].id]: PERSON },
            }),
          ).rejects.toThrow(/partial-window/);
          expect(seen).toHaveLength(0);
          expect(requests).toHaveLength(1);
          expect(timeAnswers(agent)).toHaveLength(0);
        } finally {
          await agent.shutdown();
        }
      });
    }
  });
}

const timeAnswers = (agent: Agent) =>
  (agent.findings() ?? []).filter((row) => row.kind === 'time-answer');

for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
  for (const first of NAMES) {
    describe(`${mode}: ${first} first`, () => {
      for (const supplied of ['start', 'stop'] as const) {
        for (const completion of ['ordinary', 'assume'] as const) {
          it(`${supplied} only, ${completion}: no collector before separate native confirmation`, async () => {
            const { agent, seen, requests } = make({ mode, first, supplied, completion });
            try {
              let outcome = await agent.run({ message: MESSAGE, time: { now: NOW } });
              expect(isInputPause(outcome)).toBe(true);
              if (!isInputPause(outcome)) throw new Error('expected input pause');
              if (completion === 'ordinary') {
                expect(
                  outcome.awaitingInput.fields.every((field) => field.format === undefined),
                ).toBe(true);
                expect(seen).toHaveLength(0);
                outcome = await agent.resume(outcome.checkpoint, {
                  requestId: outcome.awaitingInput.requestId,
                  values: Object.fromEntries(
                    outcome.awaitingInput.fields.map((field) => [
                      field.id,
                      supplied === 'start' ? TO : FROM,
                    ]),
                  ),
                });
              }
              // The old runtime executes c1, then asks about the words for c2.
              // The no-ordinary-ask variant must hit this same barrier directly.
              expect(seen).toHaveLength(0);
              expect(requests).toHaveLength(1);
              expect(timeAnswers(agent)).toHaveLength(0);
              expect(isInputPause(outcome)).toBe(true);
              if (!isInputPause(outcome)) throw new Error('expected native time confirmation');
              expect(outcome.awaitingInput.fields).toHaveLength(2);
              expect(outcome.awaitingInput.fields[0].format).toBe('time-range');
              expect(outcome.awaitingInput.fields[0].required).toBe(false);
              expect(outcome.awaitingInput.fields[1]).toEqual({
                id: `${outcome.awaitingInput.fields[0].id}-correction`,
                type: 'string',
                required: false,
                description:
                  'Or say what should change, such as a time zone, yesterday, or a full interval.',
              });
              const final = await agent.resume(outcome.checkpoint, {
                requestId: outcome.awaitingInput.requestId,
                values: { [outcome.awaitingInput.fields[0].id]: PERSON },
              });
              expect(isInputPause(final)).toBe(false);
              expect(seen).toHaveLength(2);
              expect(seen[0].args).toEqual({ start: FROM, stop: TO });
              expect(timeAnswers(agent)).toHaveLength(1);
              const call = (agent.findings() ?? [])
                .filter((row) => row.kind === 'call-window' && row.toolCallId === 'c1')
                .at(-1);
              expect(call).toMatchObject({ how: 'model-chosen' });
            } finally {
              await agent.shutdown();
            }
          });
        }
      }
      it('unchanged: both absent confirms once and reuses the person window', async () => {
        const { agent, seen } = make({ mode, first });
        try {
          const outcome = await agent.run({ message: MESSAGE, time: { now: NOW } });
          if (!isInputPause(outcome)) throw new Error('expected time pause');
          expect(seen).toHaveLength(0);
          expect(outcome.awaitingInput.fields[0].format).toBe('time-range');
          const final = await agent.resume(outcome.checkpoint, {
            requestId: outcome.awaitingInput.requestId,
            values: { [outcome.awaitingInput.fields[0].id]: PERSON },
          });
          expect(isInputPause(final)).toBe(false);
          expect(seen).toHaveLength(2);
          expect(timeAnswers(agent)).toHaveLength(1);
        } finally {
          await agent.shutdown();
        }
      });
      it('unchanged: complete model scopes require no confirmation', async () => {
        const { agent, seen } = make({ mode, first, supplied: 'both', allComplete: true });
        try {
          const final = await agent.run({ message: MESSAGE, time: { now: NOW } });
          expect(isInputPause(final)).toBe(false);
          expect(seen.map((row) => row.args)).toEqual([
            { start: FROM, stop: TO },
            { start: FROM, stop: TO },
          ]);
          expect(timeAnswers(agent)).toHaveLength(0);
        } finally {
          await agent.shutdown();
        }
      });
    });
  }
}
