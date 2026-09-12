import { expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor, type EmitEvent, type TypedScope } from 'footprintjs';
import type { AgentState } from '../../src/core/agent/types.js';
import {
  Agent,
  AnswerValidationError,
  MessageDeniedError,
  allow,
  defineTool,
  deny,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { CredentialConsentRequiredError } from '../../src/identity.js';
import { isPaused, pauseHere } from '../../src/core/pause.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
} from '../../src/memory/index.js';
import type { LLMRequest } from '../../src/adapters/types.js';
import {
  prepareFinalStage,
  prepareFinalWithValidationStage,
} from '../../src/core/agent/stages/prepareFinal.js';

// A real chart boundary: a break must skip the downstream memory writer,
// not merely set a flag a final-result getter happens to reject later.
async function capture(over: Record<string, unknown> = {}, protectedDelivery = true) {
  const emitted: EmitEvent[] = [];
  let memoryWrites = 0;
  const chart = flowChart<Record<string, unknown>>(
    'Seed',
    (scope) => {
      const values = {
        iteration: 2,
        llmLatestContent: '{"count":1}',
        userMessage: 'Count the groups.',
        totalInputTokens: 4,
        totalOutputTokens: 2,
        turnStartMs: Date.now(),
        ...over,
      };
      for (const [key, value] of Object.entries(values)) scope.$setValue(key, value);
    },
    'seed',
  )
    .addFunction(
      'Capture',
      (scope) =>
        (protectedDelivery ? prepareFinalWithValidationStage : prepareFinalStage)(
          scope as unknown as TypedScope<AgentState>,
        ),
      'capture',
    )
    .addFunction(
      'Memory',
      () => {
        memoryWrites++;
      },
      'memory',
    )
    .build();
  const executor = new FlowChartExecutor(chart);
  executor.attachEmitRecorder({
    id: 'answer-validation-delivery-test',
    onEmit(event) {
      emitted.push(event);
    },
  });
  await executor.run({});
  return { emitted, memoryWrites, state: executor.getSnapshot().sharedState };
}

it('a missing or blocked validation never captures a final answer or reaches memory', async () => {
  for (const over of [
    {},
    {
      answerValidationBlocked: true,
      answerValidation: { mode: 'observe', status: 'passed', schemaAccepted: true },
    },
  ]) {
    const out = await capture(over);
    expect(out.memoryWrites).toBe(0);
    expect(out.state.finalContent).toBeUndefined();
    expect(out.state.newMessages).toBeUndefined();
    expect(out.emitted).toEqual([]);
  }
});

it('enforcement requires both a passed report and schema acceptance', async () => {
  for (const report of [
    { mode: 'enforce', status: 'failed', schemaAccepted: true },
    { mode: 'enforce', status: 'unverified', schemaAccepted: true },
    { mode: 'enforce', status: 'passed', schemaAccepted: false },
  ]) {
    const out = await capture({ answerValidation: report });
    expect(out.memoryWrites).toBe(0);
    expect(out.emitted).toEqual([]);
  }
});

it('validated final capture emits only the canonical answer once before turn end', async () => {
  const answer = '{"count":1}';
  const out = await capture({
    answerValidation: { mode: 'enforce', status: 'passed', schemaAccepted: true },
  });
  expect(out.memoryWrites).toBe(1);
  expect(out.state.finalContent).toBe(answer);
  expect(out.state.newMessages).toEqual([
    { role: 'user', content: 'Count the groups.' },
    { role: 'assistant', content: answer },
  ]);
  expect(out.state.answerValidationCommitted).toBe(true);
  const token = out.emitted.filter((event) => event.name === 'agentfootprint.stream.token');
  expect(token).toHaveLength(1);
  expect(token[0].payload).toEqual({ iteration: 2, tokenIndex: 0, content: answer });
  expect(
    out.emitted.findIndex((event) => event.name === 'agentfootprint.stream.token'),
  ).toBeLessThan(out.emitted.findIndex((event) => event.name === 'agentfootprint.agent.turn_end'));
});

it('observe may deliver a flagged raw candidate while preserving the failed report', async () => {
  const report = { mode: 'observe', status: 'failed', schemaAccepted: false };
  const out = await capture({ answerValidation: report, llmLatestContent: 'not JSON' });
  expect(out.memoryWrites).toBe(1);
  expect(out.state.finalContent).toBe('not JSON');
  expect(out.state.answerValidation).toEqual(report);
  expect(out.emitted.filter((event) => event.name === 'agentfootprint.stream.token')).toHaveLength(
    1,
  );
});

it('existing output or evidence denial cannot be released even under observation', async () => {
  for (const refusal of [
    { messageDeniedReason: 'withheld' },
    { unsupportedValues: { refused: true } },
  ]) {
    const out = await capture({
      ...refusal,
      answerValidation: { mode: 'observe', status: 'passed', schemaAccepted: true },
    });
    expect(out.memoryWrites).toBe(0);
    expect(out.emitted).toEqual([]);
  }
});

it('unconfigured final capture preserves the original event path', async () => {
  const out = await capture({}, false);
  expect(out.memoryWrites).toBe(1);
  expect(out.state.finalContent).toBe('{"count":1}');
  expect(out.state.answerValidationCommitted).toBeUndefined();
  expect(out.emitted.map((event) => event.name)).toEqual([
    'agentfootprint.agent.iteration_end',
    'agentfootprint.agent.turn_end',
  ]);
});

for (const mode of ['enforce', 'observe'] as const) {
  it(`${mode} preserves the original output refusal before validation and delivery`, async () => {
    let checked = 0;
    const agent = Agent.create({ provider: mock({ reply: '{"count":1}' }), model: 'mock' })
      .messageMiddleware({
        name: 'withhold',
        onMessage: (message) => (message.phase === 'output' ? deny('restricted') : allow()),
      })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'count',
        version: '1',
        mode,
        validate() {
          checked++;
          return { checks: [{ id: 'count', disposition: 'checked-pass' }] };
        },
      })
      .build();
    const delivered: string[] = [];
    agent.on('agentfootprint.stream.token', (event) => delivered.push(event.payload.content));
    agent.on('agentfootprint.agent.turn_end', (event) =>
      delivered.push(event.payload.finalContent),
    );
    const failure = await agent.run('count').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MessageDeniedError);
    expect(failure).toMatchObject({
      reason: 'restricted',
      phase: 'output',
      middleware: 'withhold',
    });
    expect(checked).toBe(0);
    expect(delivered).toEqual([]);
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'prior-refusal',
    });
    expect(agent.getLastSnapshot()?.sharedState.answerValidationCommitted).toBeUndefined();
  });

  it(`${mode} preserves the consent URL for the caller while withholding an unperformed answer`, async () => {
    let ran = 0;
    let checked = 0;
    const url = 'https://id.example.test/consent?state=synthetic-capability';
    const tool = defineTool({
      name: 'read_inventory',
      description: 'Read a restricted inventory.',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'inventory', mode: 'user' },
      execute: async () => {
        ran++;
        return { count: 1 };
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: '', toolCalls: [{ id: 'read-1', name: 'read_inventory', args: {} }] },
          { content: '{"count":1}', toolCalls: [] },
        ],
      }),
      model: 'mock',
      credentials: {
        id: 'consent-fixture',
        getCredential: async () => ({
          status: 'authorization-required',
          authorizationUrl: url,
          sessionId: 'consent-1',
        }),
      },
      onAuthorizationRequired: 'tell-model',
    })
      .tools([tool])
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'count',
        version: '1',
        mode,
        validate() {
          checked++;
          return { checks: [{ id: 'count', disposition: 'checked-pass' }] };
        },
      })
      .build();
    const delivered: string[] = [];
    agent.on('agentfootprint.stream.token', (event) => delivered.push(event.payload.content));
    agent.on('agentfootprint.agent.turn_end', (event) =>
      delivered.push(event.payload.finalContent),
    );
    const failure = await agent.run('read the inventory').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialConsentRequiredError);
    expect(failure).toMatchObject({
      authorizationUrl: url,
      sessionId: 'consent-1',
      service: 'inventory',
    });
    expect(ran).toBe(0);
    expect(checked).toBe(0);
    expect(delivered).toEqual([]);
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'prior-refusal',
    });
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain(url);
  });
}

const countSchema = {
  parse(value: unknown): { count: number } {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('count' in value) ||
      typeof value.count !== 'number'
    ) {
      throw new Error('count must be a number');
    }
    return { count: value.count };
  },
};
const owner = { tenant: 'synthetic', principal: 'operator', conversationId: 'inventory' };
const countMemory = (store: InMemoryStore) =>
  defineMemory({
    id: 'inventory-memory',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
    store,
  });

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  for (const accepted of [true, false]) {
    it(`${reactMode}: a ${
      accepted ? 'valid' : 'refused'
    } resumed answer is checked only after the resumed tool work`, async () => {
      const requests: LLMRequest[] = [];
      const store = new InMemoryStore();
      const checked: number[] = [];
      let reads = 0;
      const final = JSON.stringify({ count: accepted ? 1 : 99 });
      const provider = mock({
        chunkDelayMs: 0,
        respond(request) {
          requests.push(request);
          if (requests.length === 1)
            return {
              content: 'Waiting for confirmation.',
              toolCalls: [{ id: 'ask-1', name: 'confirm', args: {} }],
            };
          if (requests.length === 2)
            return {
              content: 'Reading the inventory.',
              toolCalls: [{ id: 'read-1', name: 'read_count', args: {} }],
            };
          if (requests.length === 3) return final;
          throw new Error('unexpected model call');
        },
      });
      const agent = Agent.create({ provider, model: 'mock', reactMode })
        .tools([
          defineTool({
            name: 'confirm',
            description: 'Ask for confirmation.',
            execute() {
              pauseHere({ question: 'Continue?' });
            },
          }),
          defineTool({
            name: 'read_count',
            description: 'Read the current count.',
            execute: async () => {
              reads++;
              return { count: 1 };
            },
          }),
        ])
        .outputSchema(countSchema)
        .answerValidation<{ count: number }>({
          id: 'inventory-count',
          version: '1',
          validate(candidate) {
            expect(reads).toBe(1);
            checked.push(candidate.count);
            return {
              checks: [
                {
                  id: 'observed-count',
                  disposition: candidate.count === 1 ? 'checked-pass' : 'checked-fail',
                },
              ],
            };
          },
        })
        .memory(countMemory(store))
        .build();
      const tokens: string[] = [];
      const ends: string[] = [];
      agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
      agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload.finalContent));
      const paused = await agent.run({
        message: 'Read the count after confirmation.',
        identity: owner,
      });
      expect(isPaused(paused)).toBe(true);
      if (!isPaused(paused)) return expect.fail('expected pause');
      expect(reads).toBe(0);
      expect(checked).toEqual([]);
      expect(tokens).toEqual([]);
      expect(ends).toEqual([]);
      expect((await store.list(owner)).entries).toEqual([]);
      expect(agent.answerValidation()).toBeUndefined();
      const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
      if (accepted) {
        await expect(agent.resume(checkpoint, 'confirmed')).resolves.toBe(final);
        expect(tokens).toEqual([final]);
        expect(ends).toEqual([final]);
        expect(JSON.stringify((await store.list(owner)).entries)).toContain(
          final.replaceAll('"', '\\"'),
        );
        expect(agent.checkpoint()?.history.at(-1)?.content).toBe(final);
      } else {
        await expect(agent.resume(checkpoint, 'confirmed')).rejects.toBeInstanceOf(
          AnswerValidationError,
        );
        expect(tokens).toEqual([]);
        expect(ends).toEqual([]);
        expect((await store.list(owner)).entries).toEqual([]);
        expect(agent.getLastSnapshot()?.sharedState.answerValidationCommitted).toBeUndefined();
      }
      expect(checked).toEqual([accepted ? 1 : 99]);
      expect(requests).toHaveLength(3);
      expect(
        requests[1].messages.some(
          (message) => message.role === 'tool' && message.content.includes('confirmed'),
        ),
      ).toBe(true);
      expect(
        requests[2].messages.some(
          (message) =>
            message.role === 'tool' &&
            message.toolCallId === 'read-1' &&
            message.content.includes('"count":1'),
        ),
      ).toBe(true);
    });
  }

  for (const accepted of [true, false]) {
    it(`${reactMode}: schema retry ${
      accepted
        ? 'validates only the accepted terminal candidate'
        : 'exhaustion withholds the invalid candidate without calling the validator'
    }`, async () => {
      const requests: LLMRequest[] = [];
      const checked: number[] = [];
      const store = new InMemoryStore();
      const invalid = '{"count":"one"}';
      const final = accepted ? '{"count":1}' : '{"count":null}';
      const agent = Agent.create({
        model: 'mock',
        reactMode,
        provider: mock({
          chunkDelayMs: 0,
          respond(request) {
            requests.push(request);
            if (requests.length === 1) return invalid;
            if (requests.length === 2) return final;
            throw new Error('unexpected model call');
          },
        }),
      })
        .outputSchema(countSchema, { retries: 1 })
        .answerValidation<{ count: number }>({
          id: 'inventory-count',
          version: '1',
          validate(candidate) {
            checked.push(candidate.count);
            return {
              checks: [
                {
                  id: 'observed-count',
                  disposition: candidate.count === 1 ? 'checked-pass' : 'checked-fail',
                },
              ],
            };
          },
        })
        .memory(countMemory(store))
        .build();
      const tokens: string[] = [];
      const ends: string[] = [];
      agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
      agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload.finalContent));
      if (accepted) {
        await expect(
          agent.runTyped({ message: 'Count the inventory.', identity: owner }),
        ).resolves.toEqual({ count: 1 });
        expect(checked).toEqual([1]);
        expect(tokens).toEqual([final]);
        expect(ends).toEqual([final]);
        expect((await store.list(owner)).entries.length).toBeGreaterThan(0);
      } else {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          await expect(
            agent.run({ message: 'Count the inventory.', identity: owner }),
          ).rejects.toBeInstanceOf(AnswerValidationError);
          const guidance = warn.mock.calls.flat().join(' ');
          expect(guidance).toContain('.answerValidation() boundary must approve');
          expect(guidance).not.toContain('run() hands back the raw answer');
        } finally {
          warn.mockRestore();
        }
        expect(checked).toEqual([]);
        expect(tokens).toEqual([]);
        expect(ends).toEqual([]);
        expect((await store.list(owner)).entries).toEqual([]);
        expect(agent.answerValidation()).toMatchObject({
          status: 'unverified',
          schemaAccepted: false,
          reason: 'schema-rejected',
        });
      }
      expect(requests).toHaveLength(2);
      expect(
        requests[1].messages.some(
          (message) => message.role === 'assistant' && message.content === invalid,
        ),
      ).toBe(true);
    });
  }
}
