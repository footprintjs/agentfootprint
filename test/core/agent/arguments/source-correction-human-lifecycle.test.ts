import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type AgentOutput,
  type RunnerPauseOutcome,
} from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import {
  VM,
  TOOL,
  QUESTION,
  proposal,
  batch,
  jsonCopy,
  argumentsOf,
  stateOf,
} from './sourceCorrectionHarness.js';

function reply(
  agent: Agent,
  outcome: AgentOutput | RunnerPauseOutcome,
  value: (description: string | undefined) => string,
) {
  if (!isInputPause(outcome)) throw new Error('Expected an actual native input pause');
  return agent.resume(outcome.checkpoint, {
    requestId: outcome.awaitingInput.requestId,
    values: Object.fromEntries(
      outcome.awaitingInput.fields.map((field) => [field.id, value(field.description)]),
    ),
  });
}
const vmTool = (ran: unknown[]) =>
  defineTool({
    name: TOOL,
    description: 'Read one synthetic VM.',
    inputSchema: { type: 'object', properties: { vm: { type: 'string' } } },
    askOrAssume: { vm: { ask: 'Which synthetic VM?' } },
    execute(args) {
      ran.push(jsonCopy(args));
      return [];
    },
  });

describe.each(['dynamic', 'dynamic-grouped'] as const)(
  'native human/refusal settlement in %s',
  (mode) => {
    it('completes a genuine ordinary-value then time-meaning question without spending correction', async () => {
      const start = '2026-10-09T13:00:00Z',
        stop = '2026-10-09T15:00:00Z';
      const ran: unknown[] = [],
        timeRan: unknown[] = [];
      const timed = defineTool({
        name: 'one_partial_scope',
        description: 'One partial synthetic interval.',
        inputSchema: {
          type: 'object',
          properties: { start: { type: 'string' }, stop: { type: 'string' } },
        },
        askOrAssume: { start: { ask: 'From when?' }, stop: { ask: 'Until when?' } },
        period: {
          forms: [
            {
              kind: 'bounds',
              from: { argument: 'start', as: 'iso' },
              to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
            },
          ],
        },
        execute(args) {
          timeRan.push(jsonCopy(args));
          return [{ value: 1 }];
        },
      });
      let calls = 0;
      const agent = Agent.create({
        provider: mock({
          respond() {
            calls++;
            return calls === 1
              ? batch(proposal('vm-before-time', { vm: VM }), {
                  id: 'partial-time',
                  name: 'one_partial_scope',
                  args: {
                    start,
                    _findings: { from: [{ argument: 'start', source: 'app' }] },
                  },
                })
              : 'Done.';
          },
        }),
        model: 'mock',
        reactMode: mode,
        externalGrounds: () => [{ value: start, source: 'synthetic-comparison-basis' }],
      })
        .tool(vmTool(ran))
        .tool(timed)
        .time({ zone: 'UTC', reader: englishTimeReader(), policy: { year: 'current' } })
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        const ordinary = await agent.run({
          message: `${QUESTION} Show data in the last 2 hours.`,
          time: { now: '2026-10-09T16:00:00Z' },
        });
        expect(isInputPause(ordinary)).toBe(true);
        const meaning = await reply(agent, ordinary, (description) =>
          description === 'Until when?' ? stop : VM,
        );
        if (!isInputPause(meaning))
          throw new Error('Expected the actual separate native meaning question');
        expect(meaning.awaitingInput.fields.some((field) => field.format === 'time-range')).toBe(
          true,
        );
        expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
        expect(stateOf(agent).sourceDeclarationCorrectionSpent).not.toBe(true);
        const range = meaning.awaitingInput.fields.find((field) => field.format === 'time-range');
        const choice = range?.enum?.[0];
        if (range === undefined || typeof choice !== 'string')
          throw new Error('Expected the actual native range choice');
        expect(
          await agent.resume(meaning.checkpoint, {
            requestId: meaning.awaitingInput.requestId,
            values: { [range.id]: choice },
          }),
        ).toBe(
          'Done.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched; ' +
            'a tool did not say what time its result covers; a tool read a different stretch of time than the one asked about.',
        );
        expect(ran).toEqual([{ vm: VM }]);
        expect(timeRan).toEqual([{ start, stop }]);
        expect(calls).toBe(2);
        expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
        expect(stateOf(agent).sourceDeclarationCorrectionSpent).not.toBe(true);
        expect(argumentsOf(agent).some((row) => row.correction !== undefined)).toBe(false);
      } finally {
        await agent.shutdown();
      }
    });
    it('retains a deferred omission through the native32-field question and settles only its own later question', async () => {
      const ran: unknown[] = [],
        fieldsRan: unknown[] = [];
      const names = Array.from({ length: 32 }, (_, index) => `field_${index}`);
      const fields = defineTool({
        name: 'native_many_fields',
        description: 'Synthetic bounded human fields.',
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
        },
        askOrAssume: Object.fromEntries(names.map((name) => [name, { ask: `Choose ${name}` }])),
        execute(args) {
          fieldsRan.push(jsonCopy(args));
          return [];
        },
      });
      let calls = 0;
      const agent = Agent.create({
        provider: mock({
          respond() {
            calls++;
            return calls === 1
              ? batch(
                  { id: 'human-fields', name: 'native_many_fields', args: {} },
                  proposal('later-vm', { vm: VM }),
                )
              : 'Done.';
          },
        }),
        model: 'mock',
        reactMode: mode,
      })
        .tool(fields)
        .tool(vmTool(ran))
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        const first = await agent.run(QUESTION);
        if (!isInputPause(first)) throw new Error('Expected the first actual human question');
        expect(first.awaitingInput.fields).toHaveLength(32);
        expect(argumentsOf(agent, 'later-vm')).toEqual([]);
        expect(stateOf(agent).argumentSourceOmissionRows).toHaveLength(1);
        const second = await reply(agent, first, () => 'synthetic-human-value');
        if (!isInputPause(second)) throw new Error('Expected the deferred VM human question');
        expect(second.awaitingInput.fields).toHaveLength(1);
        expect(argumentsOf(agent, 'later-vm')).toEqual([
          expect.objectContaining({ asked: 'unverified' }),
        ]);
        expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
        expect(await reply(agent, second, () => VM)).toBe(
          'Done.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.',
        );
        expect(ran).toEqual([{ vm: VM }]);
        expect(fieldsRan).toHaveLength(1);
        expect(calls).toBe(2);
        expect(stateOf(agent).sourceDeclarationCorrectionSpent).not.toBe(true);
        expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
        expect(
          argumentsOf(agent, 'later-vm').filter((row) => row.asked !== undefined),
        ).toHaveLength(1);
        expect(argumentsOf(agent).some((row) => row.correction !== undefined)).toBe(false);
      } finally {
        await agent.shutdown();
      }
    });

    it.each(['none', 'verified', 'omitted'] as const)(
      'settles actual ambiguous time refusal before a %s sibling continues or asks',
      async (sibling) => {
        const start = '2026-10-09T13:00:00Z',
          siblingVm = 'synthetic-sibling-vm';
        const question = `Read ${VM} from ${start} in the last 2 hours. Also inspect ${siblingVm}.`;
        const ran: unknown[] = [],
          ambiguousRan: unknown[] = [],
          atNext: { pending: unknown; rows: unknown }[] = [];
        const ambiguous = defineTool({
          name: 'ambiguous_partial_scope',
          description: 'Two genuine partial period forms.',
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(
              ['vm', 'start', 'stop', 'from', 'until'].map((name) => [name, { type: 'string' }]),
            ),
          },
          askOrAssume: Object.fromEntries(
            ['vm', 'start', 'stop', 'from', 'until'].map((name) => [
              name,
              { ask: `Choose synthetic ${name}` },
            ]),
          ),
          period: {
            forms: [
              {
                kind: 'bounds',
                from: { argument: 'start', as: 'iso' },
                to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
              },
              {
                kind: 'bounds',
                from: { argument: 'from', as: 'iso' },
                to: { argument: 'until', as: 'iso', edge: 'exclusive' },
              },
            ],
          },
          execute(args) {
            ambiguousRan.push(jsonCopy(args));
            return [];
          },
        });
        let calls = 0;
        const initial = batch(
          {
            id: 'ambiguous',
            name: 'ambiguous_partial_scope',
            args: {
              vm: VM,
              start,
              from: start,
              _findings: {
                from: ['start', 'from'].map((argument) => ({
                  argument,
                  source: 'user',
                  quote: question,
                })),
              },
            },
          },
          ...(sibling === 'none'
            ? []
            : [
                proposal('sibling', {
                  vm: siblingVm,
                  ...(sibling === 'verified' && {
                    _findings: { from: [{ argument: 'vm', source: 'user', quote: question }] },
                  }),
                }),
              ]),
        );
        const agent: Agent = Agent.create({
          provider: mock({
            respond() {
              calls++;
              if (calls > 1)
                atNext.push(
                  jsonCopy({
                    pending: stateOf(agent).argumentSourceOmissionRows,
                    rows: argumentsOf(agent, 'ambiguous').filter((row) => row.argument === 'vm'),
                  }),
                );
              return calls === 1 ? initial : 'Done.';
            },
          }),
          model: 'mock',
          reactMode: mode,
        })
          .tool(ambiguous)
          .tool(vmTool(ran))
          .time({ zone: 'UTC', reader: englishTimeReader(), policy: { year: 'current' } })
          .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
          .answerLayer({ standingLine: false })
          .build();
        try {
          let result = await agent.run({
            message: question,
            time: { now: '2026-10-09T16:00:00Z' },
          });
          if (sibling === 'omitted') {
            expect(isInputPause(result)).toBe(true);
            expect(calls).toBe(1);
            expect(argumentsOf(agent, 'ambiguous').filter((row) => row.argument === 'vm')).toEqual([
              expect.objectContaining({ withheld: 'batch-preempted' }),
            ]);
            expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
            result = await reply(agent, result, () => siblingVm);
          }
          expect(result).toBe('Done.');
          expect(ambiguousRan).toEqual([]);
          expect(ran).toEqual(sibling === 'none' ? [] : [{ vm: siblingVm }]);
          const rows = argumentsOf(agent, 'ambiguous').filter((row) => row.argument === 'vm');
          expect(rows).toEqual([
            expect.objectContaining({ claimed: 'none', withheld: 'batch-preempted' }),
          ]);
          expect(rows[0]).not.toHaveProperty('asked');
          expect(rows[0]).not.toHaveProperty('correction');
          expect(stateOf(agent).sourceDeclarationCorrectionSpent).not.toBe(true);
          expect(atNext).toEqual([{ pending: [], rows }]);
          expect(stateOf(agent).argumentSourceOmissionRows).toEqual([]);
        } finally {
          await agent.shutdown();
        }
      },
    );
  },
);
