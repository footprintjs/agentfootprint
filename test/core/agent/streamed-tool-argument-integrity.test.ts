/**
 * A provider's repaired argument placeholder is not a model-authored call.
 *
 * Public Agent regressions: all three ReAct modes, every schema-validation mode,
 * pre-dispatch side effects, recovery, and the forced-output contract. The
 * adapter tests own actual stream fragments; this file starts at their port.
 * All providers, credentials and tools here are synthetic and local.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  OutputSchemaError,
  RunCheckpointError,
  SCHEMA_TOOL_NAME,
  allow,
  ask,
  askHuman,
  defineTool,
  isPaused,
  type AskOrAssume,
} from '../../../src/index.js';
import type { AgentfootprintEvent } from '../../../src/events.js';
import {
  mock,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
} from '../../../src/providers.js';
import { recordRun } from '../../../src/doors/observe.js';
import { bearer, conversationRedaction } from '../../../src/doors/security.js';

const REASONS = ['invalid-json', 'incomplete-stream', 'invalid-argument-shape'] as const;
type FailureReason = (typeof REASONS)[number];
const MODES = ['off', 'warn', 'enforce'] as const;
const REACT_MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
const TOOL = 'read_saved_item';
const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

/** Structural extra field keeps this RED test valid against the pre-fix port. */
function repairedCall(id: string, reason: FailureReason, name = TOOL) {
  return { id, name, args: {}, argumentsFailure: { reason } };
}

function scripted(replies: readonly Partial<LLMResponse>[]) {
  const requests: LLMRequest[] = [];
  const provider = mock({
    thinkingMs: 0,
    chunkDelayMs: 0,
    respond: (request) => {
      const reply = replies[requests.length];
      requests.push(request);
      if (reply === undefined) throw new Error('Unexpected extra mock request');
      return reply;
    },
  });
  return { provider, requests };
}

function observe(agent: Agent) {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (event) => events.push(event));
  return events;
}

function assertRefusal(events: readonly AgentfootprintEvent[], id: string) {
  const invalid = events.filter(
    (event) =>
      event.type === 'agentfootprint.validation.args_invalid' && event.payload.toolCallId === id,
  );
  expect(invalid).toHaveLength(1);
  expect(invalid[0]).toMatchObject({
    payload: { toolCallId: id, toolName: TOOL, iteration: 1, enforced: true },
  });
  const entry = invalid[0];
  if (entry?.type !== 'agentfootprint.validation.args_invalid') {
    throw new Error('Expected a typed argument-validation event');
  }
  expect(entry.payload.issues.length).toBeGreaterThan(0);
  const ends = events.filter(
    (event) => event.type === 'agentfootprint.stream.tool_end' && event.payload.toolCallId === id,
  );
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({ payload: { toolCallId: id, error: true } });
  const end = ends[0];
  if (end?.type !== 'agentfootprint.stream.tool_end') throw new Error('Expected a tool end');
  expect(end.payload.notDispatched).toBeUndefined();
  expect(end.payload.notExecuted).toBeUndefined();
  expect(typeof end.payload.result).toBe('string');
  expect(String(end.payload.result)).toMatch(/not executed/i);
  expect(String(end.payload.result)).toMatch(/again|retry|resend/i);
  return end.payload.result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(REACT_MODES)('streamed argument integrity — %s', (reactMode) => {
  describe.each(MODES)(
    'schema mode %s does not disable transport integrity',
    (toolArgValidation) => {
      it.each(REASONS)(
        'refuses %s, permits its sibling, and recovers on the next turn',
        async (reason) => {
          const execute = vi.fn((_args: Record<string, unknown>) => 'saved item');
          const getCredential = vi.fn(async () => ({
            status: 'issued' as const,
            credential: bearer('synthetic-not-a-real-key'),
          }));
          const before: string[] = [];
          const after: string[] = [];
          const script = scripted([
            {
              toolCalls: [repairedCall('broken', reason), { id: 'sibling', name: TOOL, args: {} }],
            },
            { toolCalls: [{ id: 'corrected', name: TOOL, args: {} }] },
            { content: 'Recovered from the invalid call.' },
          ]);
          const agent = Agent.create({
            provider: script.provider,
            model: 'mock',
            reactMode,
            toolArgValidation,
            credentials: { id: 'local-test-vault', getCredential },
          })
            .tool(
              defineTool({
                name: TOOL,
                description: 'Read one saved synthetic item.',
                inputSchema: EMPTY_SCHEMA,
                needs: { credential: 'items' },
                execute,
              }),
            )
            .toolMiddleware({
              name: 'observe-dispatch',
              onToolCall: (call) => {
                before.push(call.toolCallId);
                return allow();
              },
              onToolResult: (call) => {
                after.push(call.toolCallId);
                return allow();
              },
            })
            .build();
          const events = observe(agent);

          await expect(agent.run({ message: 'Read the saved item.' })).resolves.toBe(
            'Recovered from the invalid call.',
          );

          expect(execute.mock.calls.map(([args]) => args)).toEqual([{}, {}]);
          expect(before).toEqual(['sibling', 'corrected']);
          expect(after).toEqual(['sibling', 'corrected']);
          expect(getCredential).toHaveBeenCalledTimes(2);
          const refusal = assertRefusal(events, 'broken');
          expect(script.requests).toHaveLength(3);
          expect(
            script.requests[1]?.messages.find((message) => message.toolCallId === 'broken')
              ?.content,
          ).toBe(refusal);
          expect(
            script.requests[1]?.messages.find((message) => message.toolCallId === 'sibling')
              ?.content,
          ).toBe('saved item');
          expect(
            events.filter((event) => event.type === 'agentfootprint.credential.requested'),
          ).toHaveLength(2);
          expect(events.filter((event) => event.type === 'agentfootprint.pause.request')).toEqual(
            [],
          );
        },
      );

      it('preserves genuine empty args and schema-owned argument names unchanged', async () => {
        const values = {
          argumentsFailure: { reason: 'invalid-json' },
          providerMeta: { retained: true },
          __parse_error: 'a schema-owned value',
        };
        const execute = vi.fn((_args: Record<string, unknown>) => 'saved item');
        const script = scripted([
          {
            toolCalls: [
              { id: 'empty', name: TOOL, args: {} },
              { id: 'owned', name: TOOL, args: values },
            ],
          },
          { content: 'done' },
        ]);
        const agent = Agent.create({
          provider: script.provider,
          model: 'mock',
          reactMode,
          toolArgValidation,
        })
          .tool(
            defineTool({
              name: TOOL,
              description: 'Read a synthetic record with caller-owned metadata.',
              inputSchema: {
                type: 'object',
                properties: {
                  argumentsFailure: {
                    type: 'object',
                    properties: { reason: { type: 'string' } },
                    additionalProperties: false,
                  },
                  providerMeta: {
                    type: 'object',
                    properties: { retained: { type: 'boolean' } },
                    additionalProperties: false,
                  },
                  __parse_error: { type: 'string' },
                },
                additionalProperties: false,
              },
              execute,
            }),
          )
          .build();
        const events = observe(agent);

        await expect(agent.run({ message: 'Read these saved items.' })).resolves.toBe('done');
        expect(execute.mock.calls.map(([args]) => args)).toEqual([{}, values]);
        expect(
          events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
        ).toEqual([]);
        expect(
          events.filter((event) => event.type === 'agentfootprint.stream.tool_end'),
        ).toHaveLength(2);
        for (const event of events) {
          if (event.type === 'agentfootprint.stream.tool_end') {
            expect(event.payload.error).toBeUndefined();
            expect(event.payload.result).toBe('saved item');
          }
        }
      });

      it('leaves ordinary schema mismatch governed by the selected mode', async () => {
        const execute = vi.fn((_args: Record<string, unknown>) => 'saved item');
        const script = scripted([
          { toolCalls: [{ id: 'schema-only', name: TOOL, args: {} }] },
          { content: 'done' },
        ]);
        const agent = Agent.create({
          provider: script.provider,
          model: 'mock',
          reactMode,
          toolArgValidation,
        })
          .tool(
            defineTool({
              name: TOOL,
              description: 'Read one named saved item.',
              inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
              execute,
            }),
          )
          .build();
        const events = observe(agent);
        await agent.run({ message: 'Read a saved item.' });
        expect(execute).toHaveBeenCalledTimes(toolArgValidation === 'enforce' ? 0 : 1);
        const invalid = events.filter(
          (event) => event.type === 'agentfootprint.validation.args_invalid',
        );
        if (toolArgValidation === 'off') expect(invalid).toEqual([]);
        else
          expect(invalid).toMatchObject([
            { payload: { enforced: toolArgValidation === 'enforce' } },
          ]);
      });
    },
  );

  describe.each(REASONS)('%s must not create work from a repaired placeholder', (reason) => {
    it.each(['input-ask', 'assumed-input', 'middleware-ask', 'credential-consent'] as const)(
      'refuses before %s without pausing or inventing argument values',
      async (seam) => {
        const execute = vi.fn((_args: Record<string, unknown>) => 'must not run');
        const getCredential = vi.fn(async () => ({
          status: 'authorization-required' as const,
          authorizationUrl: 'https://example.invalid/consent',
          sessionId: 'synthetic-session',
        }));
        const before = vi.fn(() => ask({ question: 'Approve this call?' }));
        const after = vi.fn(() => allow());
        const rules: AskOrAssume | undefined =
          seam === 'input-ask'
            ? { item: { ask: 'Which saved item?' } }
            : seam === 'assumed-input'
            ? { item: { assume: 'assumed-synthetic-item' } }
            : undefined;
        const script = scripted([
          { toolCalls: [repairedCall('broken', reason)] },
          { content: 'Please send a complete tool call.' },
        ]);
        const builder = Agent.create({
          provider: script.provider,
          model: 'mock',
          reactMode,
          toolArgValidation: 'off',
          credentials: { id: 'local-consent-vault', getCredential },
        })
          .inputsLayer()
          .tool(
            defineTool({
              name: TOOL,
              description: 'Read one synthetic item after any declared input/consent.',
              inputSchema: {
                type: 'object',
                properties: { item: { type: 'string' } },
                ...(rules !== undefined && { required: ['item'] }),
              },
              ...(rules !== undefined && { askOrAssume: rules }),
              ...(seam === 'credential-consent' && { needs: { credential: 'items' } }),
              execute,
            }),
          );
        if (seam === 'middleware-ask') {
          builder.toolMiddleware({ name: 'must-not-ask', onToolCall: before, onToolResult: after });
        }
        const agent = builder.build();
        const events = observe(agent);

        await expect(agent.run({ message: 'Read a saved item.' })).resolves.toBe(
          'Please send a complete tool call.',
        );
        expect(execute).not.toHaveBeenCalled();
        expect(before).not.toHaveBeenCalled();
        expect(after).not.toHaveBeenCalled();
        expect(getCredential).not.toHaveBeenCalled();
        expect(script.requests).toHaveLength(2);
        assertRefusal(events, 'broken');
        expect(events.filter((event) => event.type === 'agentfootprint.pause.request')).toEqual([]);
        expect(
          events.filter((event) => event.type === 'agentfootprint.credential.requested'),
        ).toEqual([]);
        expect(events.filter((event) => event.type === 'agentfootprint.findings.argument')).toEqual(
          [],
        );
        expect((agent.findings() ?? []).filter((row) => row.kind === 'argument')).toEqual([]);
      },
    );
  });

  describe.each(REASONS)('%s stays refused across public persistence doors', (reason) => {
    function expectFailureHistory(history: readonly LLMMessage[], result: unknown) {
      const proposal = history.find((message) => message.role === 'assistant')?.toolCalls;
      expect(proposal).toContainEqual(
        expect.objectContaining({
          id: 'broken',
          name: TOOL,
          args: {},
          argumentsFailure: { reason },
        }),
      );
      expect(history.find((message) => message.toolCallId === 'broken')).toMatchObject({
        role: 'tool',
        content: result,
        toolArgumentsFailure: { reason },
      });
    }

    it('retains the failed call through a native pause, JSON storage and fresh-agent resume', async () => {
      const execute = vi.fn((_args: Record<string, unknown>) => 'saved item');
      const pause = vi.fn(() => askHuman({ question: 'Continue to read the saved item?' }));
      const build = (provider: ReturnType<typeof mock>) =>
        Agent.create({ provider, model: 'mock', reactMode, toolArgValidation: 'off' })
          .tool(
            defineTool({
              name: TOOL,
              description: 'Read a saved synthetic item.',
              inputSchema: EMPTY_SCHEMA,
              execute,
            }),
          )
          .tool(
            defineTool({
              name: 'confirm_saved_item',
              description: 'Ask a synthetic confirmation.',
              inputSchema: EMPTY_SCHEMA,
              execute: pause,
            }),
          )
          .build();
      const first = scripted([
        {
          toolCalls: [
            repairedCall('broken', reason),
            { id: 'paused-sibling', name: 'confirm_saved_item', args: {} },
          ],
        },
      ]);
      const initial = build(first.provider);
      const initialEvents = observe(initial);
      const outcome = await initial.run({ message: 'Read after confirmation.' });
      if (!isPaused(outcome)) throw new Error('Expected the valid sibling to pause');
      expect(execute).not.toHaveBeenCalled();
      expect(pause).toHaveBeenCalledOnce();
      const refusal = assertRefusal(initialEvents, 'broken');
      const stored = JSON.parse(JSON.stringify(outcome.checkpoint)) as typeof outcome.checkpoint;
      expect(stored).toEqual(outcome.checkpoint);
      const second = scripted([
        { toolCalls: [{ id: 'corrected-after-pause', name: TOOL, args: {} }] },
        { content: 'Recovered after confirmation.' },
      ]);
      const fresh = build(second.provider);
      const resumedEvents = observe(fresh);

      await expect(fresh.resume(stored, 'Continue')).resolves.toBe('Recovered after confirmation.');
      expectFailureHistory(second.requests[0]?.messages ?? [], refusal);
      expect(
        second.requests[0]?.messages.find((message) => message.toolCallId === 'paused-sibling'),
      ).toMatchObject({ role: 'tool', content: 'Continue' });
      expect(execute.mock.calls.map(([args]) => args)).toEqual([{}]);
      expect(pause).toHaveBeenCalledOnce();
      expect(second.requests).toHaveLength(2);
      expect(
        resumedEvents.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toEqual([]);
      expect(
        resumedEvents.flatMap((event) =>
          event.type === 'agentfootprint.stream.tool_start' ? [event.payload.toolCallId] : [],
        ),
      ).toEqual(['corrected-after-pause']);
    });

    it('keeps the refusal in an error checkpoint and lets a fresh agent recover', async () => {
      const execute = vi.fn((_args: Record<string, unknown>) => 'saved item');
      const build = (provider: ReturnType<typeof mock>) =>
        Agent.create({ provider, model: 'mock', reactMode, toolArgValidation: 'off' })
          .tool(
            defineTool({
              name: TOOL,
              description: 'Read a saved synthetic item.',
              inputSchema: EMPTY_SCHEMA,
              execute,
            }),
          )
          .build();
      const requests: LLMRequest[] = [];
      const brokenProvider = mock({
        chunkDelayMs: 0,
        respond: (request) => {
          requests.push(request);
          if (requests.length > 1)
            throw new Error('Synthetic provider outage after the refused batch');
          return { toolCalls: [repairedCall('broken', reason)] };
        },
      });
      const initial = build(brokenProvider);
      const initialEvents = observe(initial);
      let failure: RunCheckpointError | undefined;
      try {
        await initial.run({ message: 'Read the saved item.' });
      } catch (error) {
        if (!(error instanceof RunCheckpointError)) throw error;
        failure = error;
      }
      if (failure === undefined) throw new Error('Expected a public error checkpoint');
      expect(failure.cause.message).toContain('Synthetic provider outage');
      expect(execute).not.toHaveBeenCalled();
      const refusal = assertRefusal(initialEvents, 'broken');
      const stored = JSON.parse(JSON.stringify(failure.checkpoint)) as typeof failure.checkpoint;
      expectFailureHistory(stored.history, refusal);
      const next = scripted([
        { toolCalls: [{ id: 'corrected-after-error', name: TOOL, args: {} }] },
        { content: 'Recovered after the outage.' },
      ]);
      const fresh = build(next.provider);
      const resumedEvents = observe(fresh);

      await expect(fresh.resumeOnError(stored)).resolves.toBe('Recovered after the outage.');
      expectFailureHistory(next.requests[0]?.messages ?? [], refusal);
      expect(execute.mock.calls.map(([args]) => args)).toEqual([{}]);
      expect(next.requests).toHaveLength(2);
      expect(
        resumedEvents.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toEqual([]);
      expect(
        resumedEvents.flatMap((event) =>
          event.type === 'agentfootprint.stream.tool_start' ? [event.payload.toolCallId] : [],
        ),
      ).toEqual(['corrected-after-error']);
      expect(stored).toEqual(failure.checkpoint);
    });

    it('redacts record content but retains the finite failure reason and error marker', async () => {
      const canary = 'private-streamed-argument-fragment-7f8e';
      const execute = vi.fn((_args: Record<string, unknown>) => 'must not run');
      const script = scripted([
        {
          content: canary,
          toolCalls: [{ ...repairedCall('broken', reason), providerMeta: { opaque: canary } }],
        },
        { content: 'No saved item was read.' },
      ]);
      const agent = Agent.create({
        provider: script.provider,
        model: 'mock',
        reactMode,
        redact: conversationRedaction(),
      })
        .tool(
          defineTool({
            name: TOOL,
            description: 'Read a saved synthetic item.',
            inputSchema: EMPTY_SCHEMA,
            execute,
          }),
        )
        .build();
      const recorder = recordRun(agent);
      const events = observe(agent);
      await expect(agent.run({ message: `Read ${canary}.` })).resolves.toBe(
        'No saved item was read.',
      );

      expect(execute).not.toHaveBeenCalled();
      const recording = recorder.toRecording();
      for (const served of [
        events,
        recording,
        agent.getLastSnapshot(),
        agent.getLastNarrativeEntries(),
      ]) {
        expect(JSON.stringify(served)).not.toContain(canary);
      }
      expect(
        events.filter((event) => event.type === 'agentfootprint.stream.tool_end'),
      ).toMatchObject([{ payload: { error: true } }]);
      expect(
        events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toMatchObject([
        { payload: { enforced: true, issues: [expect.objectContaining({ got: reason })] } },
      ]);
      const iteration = events.find(
        (event) =>
          event.type === 'agentfootprint.agent.iteration_end' &&
          event.payload.history !== undefined,
      );
      if (iteration?.type !== 'agentfootprint.agent.iteration_end')
        throw new Error('Expected recorded iteration history');
      // The established conversation policy masks history as a whole. The
      // value-free validation event remains visible; do not expose history
      // merely to retain a marker that the caller's checkpoint already owns.
      expect(iteration.payload.history).toBe('[REDACTED]');
      expect(JSON.stringify(recording)).toContain(reason);
      // The model and caller-owned checkpoint still hold the live conversation.
      expect(JSON.stringify(script.requests[1]?.messages)).toContain(canary);
      expect(
        agent
          .checkpoint()
          ?.history.some((message) => message.toolArgumentsFailure?.reason === reason),
      ).toBe(true);
    });
  });

  describe('synthetic forced-output calls use the output-contract failure path', () => {
    function emptyObjectParser() {
      return {
        parse: vi.fn((value: unknown) => {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.keys(value).length !== 0
          ) {
            throw new Error('Expected an empty object');
          }
          return {};
        }),
      };
    }

    it.each(REASONS)(
      'retries %s instead of accepting repaired {} as valid output',
      async (reason) => {
        const script = scripted([
          { content: '{}', toolCalls: [repairedCall('broken-output', reason, SCHEMA_TOOL_NAME)] },
          { toolCalls: [{ id: 'corrected-output', name: SCHEMA_TOOL_NAME, args: {} }] },
        ]);
        const parser = emptyObjectParser();
        const before = vi.fn(() => allow());
        const agent = Agent.create({ provider: script.provider, model: 'mock', reactMode })
          .toolMiddleware({ name: 'not-a-dispatch', onToolCall: before })
          .outputSchema(parser, { strategy: 'tool-forced', jsonSchema: EMPTY_SCHEMA, retries: 1 })
          .build();
        const events = observe(agent);

        await expect(agent.runTyped({ message: 'Return an empty object.' })).resolves.toEqual({});
        expect(script.requests).toHaveLength(2);
        expect(script.requests.map((request) => request.toolChoice)).toEqual([
          { type: 'tool', name: SCHEMA_TOOL_NAME },
          { type: 'tool', name: SCHEMA_TOOL_NAME },
        ]);
        expect(
          events.filter((event) => event.type === 'agentfootprint.agent.output_schema_retry'),
        ).toHaveLength(1);
        expect(agent.outputContractUnmet()).toBeUndefined();
        expect(before).not.toHaveBeenCalled();
        expect(events.filter((event) => event.type === 'agentfootprint.stream.tool_end')).toEqual(
          [],
        );
      },
    );

    describe.each(REASONS)('%s exhaustion', (reason) => {
      it.each([0, 1])('cannot satisfy the output contract with retries=%s', async (retries) => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const script = scripted(
          Array.from({ length: retries + 1 }, (_, index) => ({
            content: '{}',
            toolCalls: [repairedCall(`broken-output-${index}`, reason, SCHEMA_TOOL_NAME)],
          })),
        );
        const parser = emptyObjectParser();
        const agent = Agent.create({ provider: script.provider, model: 'mock', reactMode })
          .outputSchema(parser, { strategy: 'tool-forced', jsonSchema: EMPTY_SCHEMA, retries })
          .build();
        const events = observe(agent);

        await expect(agent.runTyped({ message: 'Return an empty object.' })).rejects.toBeInstanceOf(
          OutputSchemaError,
        );
        expect(script.requests).toHaveLength(retries + 1);
        expect(parser.parse).not.toHaveBeenCalled();
        expect(agent.outputContractUnmet()).toMatchObject({
          attempts: retries + 1,
          retriesSpent: retries,
          fallbackConfigured: false,
        });
        expect(
          events.filter((event) => event.type === 'agentfootprint.agent.output_contract_unmet'),
        ).toHaveLength(1);
        expect(
          events.filter((event) => event.type === 'agentfootprint.agent.output_schema_retry'),
        ).toHaveLength(retries);
        expect(events.filter((event) => event.type === 'agentfootprint.stream.tool_end')).toEqual(
          [],
        );
      });
    });

    it('accepts a genuinely empty forced-output argument object without retry', async () => {
      const script = scripted([
        { toolCalls: [{ id: 'empty-output', name: SCHEMA_TOOL_NAME, args: {} }] },
      ]);
      const agent = Agent.create({ provider: script.provider, model: 'mock', reactMode })
        .outputSchema(emptyObjectParser(), {
          strategy: 'tool-forced',
          jsonSchema: EMPTY_SCHEMA,
          retries: 1,
        })
        .build();
      const events = observe(agent);

      await expect(agent.runTyped({ message: 'Return an empty object.' })).resolves.toEqual({});
      expect(script.requests).toHaveLength(1);
      expect(agent.outputContractUnmet()).toBeUndefined();
      expect(
        events.filter((event) => event.type === 'agentfootprint.agent.output_schema_retry'),
      ).toEqual([]);
    });
  });
});
