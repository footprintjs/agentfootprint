import { HttpAgent } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, Sequence } from '../../src/index.js';
import { askHuman } from '../../src/core/pause.js';
import { readPausedRun } from '../../src/hosting/envelope.js';
import { mock } from '../../src/llm-providers.js';
import { agUiSerializer } from '../../src/ag-ui/serializer.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import { httpHost, type HttpWire } from '../../src/hosting/httpHost.js';
import { standingAgent } from '../../src/hosting/standingAgent.js';
import { memorySessions } from '../../src/hosting/memorySessions.js';
import { VerifierUnavailableError } from '../../src/hosting/errors.js';
import { beginIngress } from '../../src/hosting/ingressRecord.js';
import { protocolRoute } from '../../src/hosting/protocolRoute.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

const legacy: HttpWire = {
  readRequest: ({ body }) => ({
    input: String(body.input ?? ''),
    sessionId: String(body.sessionId ?? 'one'),
  }),
  health: () => ({ ok: true }),
  output: (output) => ({ output }),
  chunk: (text) => ({ text }),
  failure: (error, code) => ({ error, code }),
  awaiting: (pending) => ({ pending }),
};

async function events(
  url: string,
  message: string,
  runId: string,
  state: unknown = {},
  extra = {},
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${url}/ag-ui`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      threadId: 'one',
      runId,
      messages: [{ id: runId, role: 'user', content: message }],
      tools: [],
      context: [],
      state,
      ...extra,
    }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6))) as AgUiEvent[];
}

function hostFor(
  adapter = agUi(),
  limits: { maxEventBytes?: number; maxStreamBytes?: number } = {},
) {
  return httpHost({
    name: 'test',
    wire: legacy,
    invokePath: '/invoke',
    healthPath: '/health',
    port: 0,
    hostname: '127.0.0.1',
    protocols: [protocolRoute({ path: '/ag-ui', adapter, ...limits })],
  });
}

describe('AG-UI on the standing host', () => {
  it('uses one pooled agent and one server conversation across both wires; complete owns the answer', async () => {
    let builds = 0;
    const seen: LLMRequest[] = [];
    const base = httpHost({
      name: 'test',
      wire: legacy,
      invokePath: '/invoke',
      healthPath: '/health',
      port: 0,
      hostname: '127.0.0.1',
      protocols: [
        protocolRoute({
          path: '/ag-ui',
          adapter: agUi({
            accept: { state: (value) => value },
            custom: { 'app.done': (payload) => ({ stamp: payload.stamp }) },
          }),
        }),
      ],
    });
    const host = {
      ...base,
      serve: (handler: Parameters<typeof base.serve>[0]) =>
        base.serve((request, reply) =>
          handler(request, {
            ...reply,
            complete: () => {
              reply.custom?.('app.done', { stamp: 'checked', unlisted: 'not for the wire' });
              reply.complete('HOST CHECKED');
            },
          }),
        ),
    };
    const handle = await standingAgent({
      host,
      onIngressDecision: () => undefined,
      sessions: memorySessions(),
      agentFactory: () => {
        builds++;
        return Agent.create({
          model: 'm',
          provider: mock({
            chunkDelayMs: 0,
            respond: (req) => {
              seen.push(req);
              return { content: 'NATIVE ANSWER', toolCalls: [] };
            },
          }),
        }).build();
      },
    });
    try {
      const first = await events(handle.url, 'first user message', 'r1', { selection: 'B' });
      expect(first.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toMatchObject([
        { delta: 'HOST CHECKED' },
      ]);
      expect(first.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'HOST CHECKED' });
      expect(JSON.stringify(first)).not.toContain('NATIVE ANSWER');
      expect(first.find((e) => e.type === 'CUSTOM')).toMatchObject({
        name: 'app.done',
        value: { stamp: 'checked' },
      });
      await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'legacy followup', sessionId: 'one' }),
      });
      await events(handle.url, 'protocol followup', 'r2');
      expect(builds).toBe(1);
      expect(JSON.stringify(seen.at(-1)?.messages)).toContain('first user message');
      expect(JSON.stringify(seen.at(-1)?.messages)).toContain('legacy followup');
    } finally {
      await handle.close();
    }
  });

  it('refuses per-request frontend tools on pooled agents instead of mounting a stale catalog', async () => {
    let calls = 0;
    const handle = await standingAgent({
      sessions: memorySessions(),
      host: httpHost({
        name: 'test',
        wire: legacy,
        invokePath: '/invoke',
        healthPath: '/health',
        port: 0,
        hostname: '127.0.0.1',
        protocols: [
          protocolRoute({
            path: '/ag-ui',
            adapter: agUi({
              frontendTools: {
                browser_action: {
                  description: 'Runs in the browser',
                  inputSchema: { type: 'object', properties: {} },
                },
              },
            }),
          }),
        ],
      }),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            respond: () => {
              calls++;
              return 'not run';
            },
          }),
        }).build(),
    });
    try {
      const out = await events(
        handle.url,
        'test',
        'r1',
        {},
        { tools: [{ name: 'browser_action', description: 'untrusted', parameters: {} }] },
      );
      expect(out.at(-1)).toMatchObject({
        type: 'RUN_ERROR',
        code: 'ERR_FRONTEND_TOOLS_UNSUPPORTED',
      });
      expect(calls).toBe(0);
    } finally {
      await handle.close();
    }
  });
  it('persists the protocol pause record before delivery, then resumes the same opened tool call', async () => {
    const sessions = memorySessions();
    const approve = defineTool({
      name: 'approve',
      description: 'Ask a person',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => askHuman({ question: 'Proceed?' }),
    });
    const provider = mock({
      chunkDelayMs: 0,
      replies: [
        { content: '', toolCalls: [{ id: 'p1', name: 'approve', args: {} }] },
        'Approved answer',
      ],
    });
    const handle = await standingAgent({
      sessions,
      onIngressDecision: () => undefined,
      host: hostFor(),
      agentFactory: () => Agent.create({ provider, model: 'm' }).tool(approve).build(),
    });
    try {
      const paused = await events(handle.url, 'Approve', 'pause1');
      const finish = paused.find((e) => e.type === 'RUN_FINISHED');
      expect(finish).toMatchObject({ outcome: { type: 'interrupt' } });
      const stored = readPausedRun(await sessions.hydrate('one'));
      expect(stored.wire).toMatchObject({ protocol: 'ag-ui', record: { version: 1 } });
      const interruptId =
        finish?.type === 'RUN_FINISHED' && finish.outcome?.type === 'interrupt'
          ? finish.outcome.interrupts[0]!.id
          : '';
      expect(interruptId).not.toBe('');
      const resumed = await events(
        handle.url,
        '',
        'resume1',
        {},
        { messages: [], resume: [{ interruptId, status: 'resolved', payload: 'yes' }] },
      );
      const call = paused.find((e) => e.type === 'TOOL_CALL_START');
      expect(resumed.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({
        toolCallId: call?.type === 'TOOL_CALL_START' ? call.toolCallId : '',
        content: 'yes',
      });
      expect(resumed.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'Approved answer' });
    } finally {
      await handle.close();
    }
  });

  it('keeps validator accepted context request-local and visible in native preparation', async () => {
    const accepted: unknown[] = [];
    let active: import('../../src/hosting/types.js').HostRequest | undefined;
    const base = hostFor(
      agUi({
        accept: { state: (value) => ({ selected: (value as { selected: string }).selected }) },
      }),
    );
    const host = {
      ...base,
      serve: (handler: Parameters<typeof base.serve>[0]) =>
        base.serve(async (request, reply) => {
          active = request;
          expect(request.protocol?.input).toMatchObject({ state: { selected: 'B' } });
          expect(request.protocol?.turn).toBeUndefined();
          await handler(request, reply);
        }),
    };
    const handle = await standingAgent({
      host,
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({ model: 'm', provider: mock({ reply: 'ok' }) })
          .aroundTurn({
            name: 'read-accepted',
            around: async (_turn, proceed) => {
              accepted.push(active?.protocol?.accepted);
              expect(active?.protocol?.turn).toEqual({ kind: 'message', message: 'selection' });
              expect(Object.isFrozen(active?.protocol?.turn)).toBe(true);
              expect(Reflect.set(active!.protocol!.turn!, 'message', 'forged')).toBe(false);
              await proceed();
            },
          })
          .build(),
    });
    try {
      await events(handle.url, 'selection', 'ctx1', { selected: 'B' });
      expect(accepted).toEqual([{ state: { selected: 'B' } }]);
    } finally {
      await handle.close();
    }
  });

  it('does not send a rejected candidate through text or a successful terminal', async () => {
    const handle = await standingAgent({
      host: hostFor(),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({ reply: '{"text":"UNCHECKED-DRAFT"}', chunkDelayMs: 0 }),
        })
          .outputSchema({ parse: (value) => value as { text: string } })
          .answerValidation<{ text: string }>({
            id: 'deny',
            version: 'test',
            mode: 'enforce',
            validate: () => ({ checks: [{ id: 'no', disposition: 'checked-fail' }] }),
          })
          .build(),
    });
    try {
      const out = await events(handle.url, 'question', 'denied1');
      expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'ERR_ANSWER_VALIDATION' });
      expect(out.some((e) => e.type === 'TEXT_MESSAGE_CONTENT' || e.type === 'RUN_FINISHED')).toBe(
        false,
      );
      expect(JSON.stringify(out)).not.toContain('UNCHECKED-DRAFT');
    } finally {
      await handle.close();
    }
  });

  it('projects tool arguments/results while preserving lifecycle and fixed failures', async () => {
    const calls: unknown[] = [];
    const tool = defineTool({
      name: 'data',
      description: 'Read data',
      inputSchema: { type: 'object', properties: { secret: { type: 'string' } } },
      execute: async () => ({ rows: ['FULL-TABLE-SECRET'] }),
    });
    const handle = await standingAgent({
      host: hostFor(
        agUi({
          toolArguments: (_p, at) => {
            calls.push(at);
            return {};
          },
          toolResults: () => ({ status: 'available-through-panel' }),
        }),
      ),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            replies: [
              {
                content: '',
                toolCalls: [{ id: 'c1', name: 'data', args: { secret: 'ARG-SECRET' } }],
              },
              'done',
            ],
          }),
        })
          .tool(tool)
          .build(),
    });
    try {
      const out = await events(handle.url, 'read', 'project1');
      expect(out.find((e) => e.type === 'TOOL_CALL_ARGS')).toMatchObject({ delta: '{}' });
      expect(out.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({
        content: '{"status":"available-through-panel"}',
      });
      expect(calls).toMatchObject([{ toolCallId: expect.any(String), toolName: 'data' }]);
      expect(JSON.stringify(out)).not.toContain('FULL-TABLE-SECRET');
      expect(JSON.stringify(out)).not.toContain('ARG-SECRET');
    } finally {
      await handle.close();
    }
  });

  it.each(['final', 'custom'] as const)(
    'ends oversized %s delivery with one named refusal and no success',
    async (kind) => {
      const base = hostFor(agUi({ custom: { 'app.large': (p) => p } }), {
        maxEventBytes: 2048,
        maxStreamBytes: 4096,
      });
      const host = {
        ...base,
        serve: (handler: Parameters<typeof base.serve>[0]) =>
          base.serve((request, reply) =>
            handler(request, {
              ...reply,
              complete: (output) => {
                if (kind === 'custom') reply.custom?.('app.large', { text: 'X'.repeat(8192) });
                reply.complete(output);
              },
            }),
          ),
      };
      const handle = await standingAgent({
        host,
        sessions: memorySessions(),
        agentFactory: () =>
          Agent.create({
            model: 'm',
            provider: mock({ reply: kind === 'final' ? 'X'.repeat(8192) : 'ok' }),
          }).build(),
      });
      try {
        const out = await events(handle.url, 'read', 'limit1');
        expect(out.filter((e) => e.type === 'RUN_ERROR')).toMatchObject([
          { code: 'ERR_STREAM_LIMIT' },
        ]);
        expect(out.filter((e) => e.type === 'RUN_STARTED')).toHaveLength(1);
        expect(
          out.some(
            (e) =>
              e.type === 'RUN_FINISHED' || e.type === 'TEXT_MESSAGE_CONTENT' || e.type === 'CUSTOM',
          ),
        ).toBe(false);
      } finally {
        await handle.close();
      }
    },
  );

  it('the official client consumes host-authorized output and retains server history', async () => {
    const handle = await standingAgent({
      host: hostFor(),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({ reply: 'official client answer', chunkDelayMs: 0 }),
        }).build(),
    });
    try {
      const client = new HttpAgent({ url: `${handle.url}/ag-ui`, threadId: 'one' });
      client.addMessage({ id: 'u1', role: 'user', content: 'hello' });
      const result = await client.runAgent();
      expect(result.result).toBe('official client answer');
      expect(client.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: 'official client answer',
      });
    } finally {
      await handle.close();
    }
  });
  it('filters direct and consumer-scope events while the admitted turn is persisting', async () => {
    let started!: () => void;
    const persisting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = memorySessions();
    let first = true;
    const sessions = {
      ...store,
      async persist(...args: Parameters<typeof store.persist>) {
        if (first) {
          first = false;
          started();
          await gate;
        }
        return store.persist(...args);
      },
    };
    const agent = Agent.create({
      model: 'm',
      provider: mock({ replies: ['HOSTED', 'DIRECT-OTHER-RUN'] }),
    }).build();
    const handle = await standingAgent({
      agent,
      sessions,
      host: hostFor(agUi({ custom: { 'app.injected': (p) => p } })),
    });
    try {
      const run = events(handle.url, 'hosted', 'owned1');
      await persisting;
      agent.emit('app.injected', { text: 'CONSUMER-OTHER-EVENT' });
      await agent.run({ message: 'direct' });
      release();
      const out = await run;
      expect(out.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'HOSTED' });
      expect(JSON.stringify(out)).not.toContain('DIRECT-OTHER-RUN');
      expect(JSON.stringify(out)).not.toContain('CONSUMER-OTHER-EVENT');
    } finally {
      release();
      await handle.close();
    }
  });

  it('checks the same verified owner before protocol validators see another conversation', async () => {
    let validations = 0;
    let calls = 0;
    const handle = await standingAgent({
      host: hostFor(
        agUi({
          accept: {
            state: (value) => {
              validations++;
              return value;
            },
          },
        }),
      ),
      identity: { verify: async (token) => ({ userId: token }) },
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            respond: () => {
              calls++;
              return 'owned answer';
            },
          }),
        }).build(),
    });
    try {
      await events(
        handle.url,
        'hello',
        'alice1',
        { selected: 'A' },
        {},
        { authorization: 'Bearer alice' },
      );
      const foreign = await events(
        handle.url,
        'steal',
        'bob1',
        { selected: 'PRIVATE' },
        {},
        { authorization: 'Bearer bob' },
      );
      expect(foreign.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'ERR_SESSION_NOT_FOUND' });
      expect(validations).toBe(1);
      expect(calls).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it('cancels native tool work when the reader leaves and releases the session lane', async () => {
    let entered!: () => void;
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let aborted!: () => void;
    const stopped = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const slow = defineTool({
      name: 'slow',
      description: 'Wait until cancelled',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) =>
        new Promise((_resolve, reject) => {
          entered();
          ctx.signal?.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('cancelled'));
            },
            { once: true },
          );
        }),
    });
    const handle = await standingAgent({
      host: hostFor(),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            replies: [
              { content: '', toolCalls: [{ id: 'wait1', name: 'slow', args: {} }] },
              'after cancellation',
            ],
          }),
        })
          .tool(slow)
          .build(),
    });
    try {
      const response = await fetch(`${handle.url}/ag-ui`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: 'one',
          runId: 'cancel1',
          messages: [{ id: 'u1', role: 'user', content: 'wait' }],
          tools: [],
          context: [],
        }),
      });
      await began;
      await response.body!.cancel();
      await stopped;
      const next = await events(handle.url, 'next turn', 'after1');
      expect(next.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'after cancellation' });
    } finally {
      await handle.close();
    }
  });
  it('bounds aggregate stream bytes independently of the individual event limit', async () => {
    const base = hostFor(agUi({ custom: { 'app.progress': (p) => p } }), {
      maxEventBytes: 2048,
      maxStreamBytes: 8192,
    });
    const host = {
      ...base,
      serve: (handler: Parameters<typeof base.serve>[0]) =>
        base.serve((request, reply) =>
          handler(request, {
            ...reply,
            complete: (output) => {
              for (let i = 0; i < 100; i++)
                reply.custom?.('app.progress', { i, text: 'X'.repeat(512) });
              reply.complete(output);
            },
          }),
        ),
    };
    const handle = await standingAgent({
      host,
      sessions: memorySessions(),
      agentFactory: () => Agent.create({ model: 'm', provider: mock({ reply: 'ok' }) }).build(),
    });
    try {
      const out = await events(handle.url, 'work', 'aggregate1');
      expect(out.filter((e) => e.type === 'CUSTOM').length).toBeLessThan(100);
      expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'ERR_STREAM_LIMIT' });
      expect(out.some((e) => e.type === 'RUN_FINISHED')).toBe(false);
      expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThan(8192 + 16384);
    } finally {
      await handle.close();
    }
  });

  it('caps request bodies even when the legacy host has no configured body ceiling', async () => {
    let calls = 0;
    const handle = await standingAgent({
      host: hostFor(),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            respond: () => {
              calls++;
              return 'not run';
            },
          }),
        }).build(),
    });
    try {
      const response = await fetch(`${handle.url}/ag-ui`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: 'one',
          runId: 'body1',
          messages: [{ id: 'u1', role: 'user', content: 'X'.repeat(1048576) }],
          tools: [],
          context: [],
        }),
      });
      expect(response.status).toBe(413);
      expect(calls).toBe(0);
    } finally {
      await handle.close();
    }
  });

  it('keeps fixed failed-tool words ahead of an optional result projection', async () => {
    let projections = 0;
    const tool = defineTool({
      name: 'bad',
      description: 'Fail',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        throw new Error('PRIVATE-CONNECTION-STRING');
      },
    });
    const handle = await standingAgent({
      host: hostFor(
        agUi({
          toolResults: () => {
            projections++;
            return 'BAD-PROJECTION';
          },
        }),
      ),
      sessions: memorySessions(),
      agentFactory: () =>
        Agent.create({
          model: 'm',
          provider: mock({
            replies: [{ content: '', toolCalls: [{ id: 'bad1', name: 'bad', args: {} }] }, 'done'],
          }),
        })
          .tool(tool)
          .build(),
    });
    try {
      const out = await events(handle.url, 'fail', 'failure1');
      expect(out.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({
        content: 'The tool failed.',
      });
      expect(projections).toBe(0);
      expect(JSON.stringify(out)).not.toContain('PRIVATE-CONNECTION-STRING');
      expect(JSON.stringify(out)).not.toContain('BAD-PROJECTION');
    } finally {
      await handle.close();
    }
  });
  it('host delivery withholds nested candidate text and result fields when the host refuses delivery', async () => {
    const child = (name: string) =>
      Agent.create({
        model: 'm',
        provider: mock({ reply: `PRIVATE-CANDIDATE-${name}`, chunkDelayMs: 0 }),
      }).build();
    const pipeline = Sequence.create()
      .step('first', child('FIRST'))
      .step('second', child('SECOND'))
      .build();
    const translation = agUiSerializer({
      threadId: 'thread',
      runId: 'nested-host',
      delivery: 'host',
    });
    const out: AgUiEvent[] = [];
    const served: unknown[] = [];
    const off = pipeline.on('*', (event) => {
      served.push(event);
      out.push(...translation.event(event));
    });
    try {
      await pipeline.run({ message: 'work' });
      out.push(...translation.settle({ kind: 'failed' }));
      expect(JSON.stringify(served)).toContain('PRIVATE-CANDIDATE-FIRST');
      expect(JSON.stringify(served)).toContain('PRIVATE-CANDIDATE-SECOND');
      expect(out.filter((e) => e.type === 'SUBAGENT_STARTED')).toHaveLength(2);
      expect(out.filter((e) => e.type === 'SUBAGENT_FINISHED')).toHaveLength(2);
      expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR' });
      expect(out.some((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toBe(false);
      expect(JSON.stringify(out)).not.toContain('PRIVATE-CANDIDATE');
    } finally {
      off();
      await pipeline.shutdown({ stop: true });
    }
  });
  it('the ingress census preserves optional protocol ports by presence', () => {
    const note = beginIngress({ input: 'message' }, () => undefined);
    const values: unknown[] = [];
    const baseline = note.watch({ complete() {}, fail() {} });
    expect(Object.keys(baseline)).not.toContain('event');
    expect(Object.keys(baseline)).not.toContain('custom');
    const watched = note.watch({
      complete() {},
      fail() {},
      custom: (name, payload) => values.push({ name, payload }),
      event: (event) => values.push(event),
    });
    watched.custom?.('app.checked', { status: 'ready' });
    expect(typeof watched.event).toBe('function');
    expect(values).toEqual([{ name: 'app.checked', payload: { status: 'ready' } }]);
  });
  it.each([
    ['missing', 'ERR_IDENTITY_NOT_VERIFIED'],
    ['invalid', 'ERR_IDENTITY_NOT_VERIFIED'],
    ['outage', 'ERR_IDENTITY_VERIFIER_UNAVAILABLE'],
    ['admission', 'ERR_ADMISSION_REFUSED'],
  ] as const)(
    'preserves the native %s refusal classification without private error text',
    async (mode, code) => {
      let calls = 0;
      const handle = await standingAgent({
        host: hostFor(),
        sessions: memorySessions(),
        identity: {
          verify: async () => {
            if (mode === 'outage')
              throw new VerifierUnavailableError('private-verifier', 'PRIVATE-CONNECTION-STRING');
            if (mode === 'invalid') throw new Error('PRIVATE-TOKEN-DETAIL');
            return { userId: 'alice' };
          },
        },
        ...(mode === 'admission' && {
          admission: { decide: () => ({ refuse: 'PRIVATE-BUDGET-DETAIL' }) },
        }),
        agentFactory: () =>
          Agent.create({
            model: 'm',
            provider: mock({
              respond: () => {
                calls++;
                return 'must not run';
              },
            }),
          }).build(),
      });
      try {
        const out = await events(
          handle.url,
          'read',
          'refuse1',
          {},
          {},
          mode === 'missing' ? {} : { authorization: 'Bearer PRIVATE-TOKEN' },
        );
        expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR', code });
        expect(JSON.stringify(out)).not.toContain('PRIVATE-');
        expect(JSON.stringify(out)).not.toContain('private-verifier');
        expect(calls).toBe(0);
      } finally {
        await handle.close();
      }
    },
  );
});
