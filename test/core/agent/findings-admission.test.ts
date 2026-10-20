import { findingsFrame } from '../../helpers/findingsData.js';
import { conversationRedaction } from '../../../src/redaction/conversation.js';
/** Phase A: reference admission changes invocation, never schema/cache layout. */
import { describe, expect, it, vi } from 'vitest';
import { Agent, ask, checkInApproved, defineTool, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { bearer } from '../../../src/identity.js';
import { withFallback, withRetry } from '../../../src/resilience/index.js';
import { staticTools } from '../../../src/tool-providers/index.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
import { allow } from '../../../src/core/agent/middleware/outcomes.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const claim = {
  subject: { kind: 'fixture', id: 'x' },
  predicate: 'status',
  value: 'DECLARED-ONLY',
};
const previous = (id: string) => ({ toolCallId: id, standing: 'fact', assertions: [claim] });
const call = (id: string, refs: string[] = []) => ({
  id,
  name: 'read_item',
  args: {
    q: id,
    ...(refs.length ? { _findings: { basis: 'direct', previous: refs.map(previous) } } : {}),
  },
});
const turn = (...calls: ReturnType<typeof call>[]) => ({ content: '', toolCalls: calls });

function fixture(
  turns: (Partial<LLMResponse> | string)[],
  options: {
    reactMode?: 'dynamic' | 'dynamic-grouped' | 'classic';
    recordReceipt?: boolean;
    wrapUpAtMaxIterations?: boolean;
  } = {},
) {
  const requests: LLMRequest[] = [];
  let at = 0;
  const execute = vi.fn(() => 'fixture result');
  const permission = vi.fn(() => ({ result: 'allow' as const }));
  const before = vi.fn(() => allow());
  const getCredential = vi.fn(async () => ({
    status: 'issued' as const,
    credential: bearer('fixture-token'),
  }));
  const builder = Agent.create({
    provider: mock({
      respond: (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        return turns[at++] ?? 'done';
      },
    }),
    model: 'mock',
    ...options,
    permissionChecker: { check: permission },
    credentials: { id: 'fixture', getCredential },
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read fixture',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        needs: { credential: 'fixture' },
        execute,
      }),
    )
    .toolMiddleware({ name: 'counter', onToolCall: before })
    .findings();
  return { builder, execute, permission, before, getCredential, requests };
}
const state = (agent: Agent) => agent.getLastSnapshot()?.sharedState as unknown as AgentState;

describe('findings served-reference admission', () => {
  it('keeps findings unsupported in classic mode', () => {
    expect(() => fixture(['done'], { reactMode: 'classic' }).builder.build()).toThrow(/classic/);
  });
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    for (const recordReceipt of [true, false]) {
      it(`${reactMode}, receipt=${recordReceipt}: forged metadata refuses before all dispatch callbacks and keeps unknown declaration`, async () => {
        const f = fixture([turn(call('c1', ['foreign-canary'])), 'done'], {
          reactMode,
          recordReceipt,
        });
        const agent = f.builder.build();
        await agent.run({ message: 'read fixture' });
        expect(f.execute).not.toHaveBeenCalled();
        expect(f.permission).not.toHaveBeenCalled();
        expect(f.before).not.toHaveBeenCalled();
        expect(f.getCredential).not.toHaveBeenCalled();
        expect(state(agent).findingsLedger).toContainEqual(
          expect.objectContaining({
            toolCallId: 'foreign-canary',
            unknownId: true,
            assertions: [expect.objectContaining({ value: 'DECLARED-ONLY' })],
          }),
        );
        const result = f.requests[1]?.messages.find((m) => m.role === 'tool');
        expect(result?.content).toContain('findings-reference');
        expect(result?.content).not.toContain('foreign-canary');
      });
    }
  }
  it('does not admit a guessed result from an earlier sibling in the same response batch', async () => {
    const f = fixture([turn(call('c1'), call('c2', ['c1'])), 'done']);
    await f.builder.build().run({ message: 'read' });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.execute.mock.calls[0]?.[0]).toEqual({ q: 'c1' });
    expect(f.getCredential).toHaveBeenCalledTimes(1);
  });
  it('detects a reused provider ID before first-wins deduplication', async () => {
    const f = fixture([turn(call('same')), turn(call('same')), turn(call('c3', ['same'])), 'done']);
    const agent = f.builder.build();
    await agent.run({ message: 'read' });
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(state(agent).findingsLedger).toContainEqual(
      expect.objectContaining({ toolCallId: 'same', unknownId: true }),
    );
  });
  it('admits an unambiguous served result and leaves the findings schema enum unchanged', async () => {
    const f = fixture([turn(call('c1')), turn(call('c2', ['c1'])), 'done']);
    await f.builder.build().run({ message: 'read' });
    expect(f.execute).toHaveBeenCalledTimes(2);
    const schema = f.requests[1]?.tools?.[0]?.inputSchema as {
      properties: {
        _findings: {
          properties: { previous: { items: { properties: { toolCallId: { enum: string[] } } } } };
        };
      };
    };
    expect(
      schema.properties._findings.properties.previous.items.properties.toolCallId.enum,
    ).toBeUndefined();
    expect(findingsFrame(f.requests[1]!.messages).data.advisoryResultIds).toEqual(['c1']);
    expect(f.requests[1]?.cacheMarkers).toBeUndefined();
  });
  it('plain JSON answer with an unserved reference is denied with no additional model call', async () => {
    const answer = JSON.stringify({
      answer: 'DRAFT-ONLY',
      _findings: { previous: [previous('ghost')] },
    });
    const f = fixture([answer]);
    const agent = f.builder.build();
    await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
      name: 'MessageDeniedError',
    });
    expect(f.requests).toHaveLength(1);
    expect(state(agent).findingsLedger).toContainEqual(
      expect.objectContaining({ toolCallId: 'ghost', unknownId: true }),
    );
  });
  it('only spends a configured schema retry and keeps it inside the existing iteration budget', async () => {
    const answer = JSON.stringify({
      answer: 'DRAFT-ONLY',
      _findings: { previous: [previous('ghost')] },
    });
    const f = fixture([answer, JSON.stringify({ answer: 'repaired' })]);
    const parser = { parse: (value: unknown) => value as { answer: string } };
    const agent = f.builder.outputSchema(parser, { retries: 1 }).maxIterations(3).build();
    expect(await agent.runTyped({ message: 'read' })).toEqual({ answer: 'repaired' });
    expect(f.requests).toHaveLength(2);
  });
  it('a configured retry cannot borrow iterations after the cap', async () => {
    const answer = JSON.stringify({
      answer: 'DRAFT-ONLY',
      _findings: { previous: [previous('ghost')] },
    });
    const f = fixture([answer]);
    const agent = f.builder
      .outputSchema({ parse: (v: unknown) => v }, { retries: 1 })
      .maxIterations(1)
      .build();
    await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
      name: 'MessageDeniedError',
    });
    expect(f.requests).toHaveLength(1);
  });
  it('refuses before the batch ask invokes its host context or pauses', async () => {
    const context = vi.fn(() => ({ fixture: 'context' }));
    const execute = vi.fn(() => 'result');
    const agent = Agent.create({
      provider: mock({
        replies: [
          turn({
            ...call('c1', ['ghost']),
            args: { _findings: { previous: [previous('ghost')] } },
          }),
          'done',
        ],
      }),
      model: 'mock',
      argumentAskContext: context,
    })
      .tool(
        defineTool({
          name: 'read_item',
          description: 'Read item',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          askOrAssume: { q: { ask: 'Which fixture?' } },
          execute,
        }),
      )
      .findings()
      .build();
    const result = await agent.run({ message: 'read' });
    expect(isPaused(result)).toBe(false);
    expect(context).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('findings admission boundary and lifetime controls', () => {
  it('advisory cap32 does not refuse a uniquely served older result', async () => {
    const f = fixture([
      ...Array.from({ length: 34 }, (_, i) => turn(call(`c${i}`))),
      turn(call('final-call', ['c0'])),
      'done',
    ]);
    const agent = f.builder.maxIterations(40).build();
    await agent.run({ message: 'read fixtures' });
    expect(f.execute).toHaveBeenCalledTimes(35);
    expect(state(agent).findingsLedger).toContainEqual(
      expect.objectContaining({ toolCallId: 'c0', toolName: 'read_item' }),
    );
    expect(
      state(agent).findingsRequest?.[0].results.find((entry) => entry.toolCallId === 'c0')
        ?.identified,
    ).toBe(true);
  });
  it('retired but uniquely served ticket identity stays identifiable without claiming body visibility', async () => {
    const noise = {
      ...call('c2'),
      args: { q: 'c2', _findings: { previous: [{ toolCallId: 'c1', standing: 'noise' }] } },
    };
    const f = fixture([turn(call('c1')), turn(noise), turn(call('c3', ['c1'])), 'done']);
    const agent = f.builder.build();
    await agent.run({ message: 'read' });
    expect(f.execute).toHaveBeenCalledTimes(3);
    const standings = state(agent).findingsLedger?.filter((r) => r.kind === 'standing');
    expect(standings?.at(-1)).toMatchObject({ toolCallId: 'c1', toolName: 'read_item' });
    expect(JSON.stringify(agent.getLastSnapshot()).includes('"visibility":"ticket"')).toBe(true);
  });
  it('fresh continuation re-serving old history works without a historical Phase A receipt', async () => {
    const first = fixture([turn(call('c1')), 'done'], { recordReceipt: false });
    const before = first.builder.build();
    await before.run({ message: 'first' });
    const checkpoint = before.checkpoint()!;
    const next = fixture([turn(call('c2', ['c1'])), 'done'], { recordReceipt: false });
    await next.builder.build().run({ message: 'continue', continueFrom: checkpoint });
    expect(next.execute).toHaveBeenCalledTimes(1);
  });
  it('a new invocation cannot borrow the previous invocation request witness', async () => {
    const f = fixture([turn(call('c1')), 'done', turn(call('c2', ['c1'])), 'done']);
    const agent = f.builder.build();
    await agent.run({ message: 'first' });
    await agent.run({ message: 'separate new run' });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('final JSON reference refusal precedes effectful output middleware', async () => {
    const output = vi.fn(() => allow());
    const f = fixture([
      JSON.stringify({ answer: 'draft', _findings: { previous: [previous('ghost')] } }),
    ]);
    const agent = f.builder
      .messageMiddleware({
        name: 'output-counter',
        onMessage: (message) => (message.phase === 'output' ? output() : allow()),
      })
      .build();
    await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
      name: 'MessageDeniedError',
    });
    expect(output).not.toHaveBeenCalled();
  });
  it('already emitted stream drafts stay drafts when final settlement is refused', async () => {
    const f = fixture([
      JSON.stringify({ answer: 'DRAFT-ONLY', _findings: { previous: [previous('ghost')] } }),
    ]);
    const agent = f.builder.build();
    const tokens: string[] = [];
    agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
    await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
      name: 'MessageDeniedError',
    });
    expect(tokens.join('')).toContain('DRAFT-ONLY');
    expect(tokens.join('')).not.toContain('_findings');
    expect(f.requests).toHaveLength(1);
  });
  it('conversation redaction hides the new capture and preserves live admission', async () => {
    const execute = vi.fn(() => 'private body');
    let index = 0;
    const scripted = [turn(call('PRIVATE-ID')), turn(call('c2', ['PRIVATE-ID'])), 'done'];
    const agent = Agent.create({
      provider: mock({ respond: () => scripted[index++] ?? 'done' }),
      model: 'mock',
      redact: conversationRedaction(),
    })
      .tool(
        defineTool({
          name: 'read_item',
          description: 'Read fixture',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute,
        }),
      )
      .findings()
      .build();
    await agent.run({ message: 'read' });
    expect(execute).toHaveBeenCalledTimes(2);
    const captureValues: unknown[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'findingsRequest') captureValues.push(child);
        visit(child);
      }
    };
    visit(agent.getLastSnapshot());
    expect(captureValues.length).toBeGreaterThan(0);
    expect(JSON.stringify(captureValues)).not.toContain('PRIVATE-ID');
  });
  it('same-instance pause resume keeps the proposal witness; missing witness refuses before remaining middleware', async () => {
    for (const removeWitness of [false, true]) {
      const executed = vi.fn(() => 'result');
      const remaining = vi.fn(() => allow());
      const build = () =>
        Agent.create({
          provider: mock({ replies: [turn(call('c1')), turn(call('c2', ['c1'])), 'done'] }),
          model: 'mock',
        })
          .tool(
            defineTool({
              name: 'read_item',
              description: 'Read',
              inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
              execute: executed,
            }),
          )
          .toolMiddleware({
            name: 'ask',
            onToolCall: (context) =>
              context.args.q === 'c2' ? ask({ question: 'Proceed?' }) : allow(),
          })
          .toolMiddleware({ name: 'remaining', onToolCall: remaining })
          .findings()
          .build();
      const agent = build();
      const pause = await agent.run({ message: 'read' });
      if (!isPaused(pause)) throw new Error('Expected a real pause');
      const checkpoint = structuredClone(pause.checkpoint);
      remaining.mockClear();
      if (removeWitness) {
        delete (checkpoint.sharedState as Partial<AgentState>).findingsRequest;
        await expect(
          agent.resume(checkpoint, checkInApproved({ by: 'fixture' })),
        ).rejects.toMatchObject({ name: 'MessageDeniedError' });
        expect(remaining).not.toHaveBeenCalled();
        expect(executed).toHaveBeenCalledTimes(1);
      } else {
        await agent.resume(checkpoint, checkInApproved({ by: 'fixture' }));
        expect(executed).toHaveBeenCalledTimes(2);
      }
    }
  });
  it('uses only the successful fallback leaf request, never the failed attempt union', async () => {
    const execute = vi.fn(() => 'result');
    let first = true;
    const primary: LLMProvider = {
      name: 'primary',
      complete: async (req, hooks) => {
        hooks?.onReplayPrepared?.({
          provider: 'primary',
          model: req.model,
          request: req,
          omissions: [],
        });
        if (first) {
          first = false;
          return { ...turn(call('c1')), usage: { input: 0, output: 0 } };
        }
        throw new Error('synthetic primary failure');
      },
    };
    let final = false;
    const secondary: LLMProvider = {
      name: 'secondary',
      complete: async (req, hooks) => {
        hooks?.onReplayPrepared?.({
          provider: 'secondary',
          model: req.model,
          request: { ...req, messages: req.messages.filter((m) => m.role !== 'tool') },
          omissions: [],
        });
        if (final) return { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
        final = true;
        return { ...turn(call('c2', ['c1'])), usage: { input: 0, output: 0 } };
      },
    };
    const agent = Agent.create({ provider: withFallback(primary, secondary), model: 'mock' })
      .tool(
        defineTool({
          name: 'read_item',
          description: 'Read',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute,
        }),
      )
      .findings()
      .build();
    await agent.run({ message: 'read' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('malformed reserved metadata cannot erase an attempted citation', () => {
  for (const previousValue of [
    [{ toolCallId: 123, standing: 'fact' }],
    [{ toolCallId: 'ghost', standing: 'definitely-fact' }],
    { toolCallId: 'ghost', standing: 'fact' },
  ]) {
    it(`refuses malformed previous ${JSON.stringify(
      previousValue,
    )} before invoke and preserves a bounded attempted frame`, async () => {
      const proposed = {
        ...call('bad'),
        args: { q: 'bad', _findings: { previous: previousValue } },
      };
      const f = fixture([turn(proposed), 'done']);
      const agent = f.builder.build();
      await agent.run({ message: 'read' });
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.permission).not.toHaveBeenCalled();
      expect(state(agent).findingsLedger).toContainEqual(
        expect.objectContaining({
          kind: 'reference-refusal',
          reason: 'malformed',
          attempted: expect.any(String),
        }),
      );
    });
    it('JSON answer malformed citations are refused instead of disappearing in the peel', async () => {
      const f = fixture([
        JSON.stringify({ answer: 'draft', _findings: { previous: previousValue } }),
      ]);
      await expect(f.builder.build().run({ message: 'read' })).rejects.toMatchObject({
        name: 'MessageDeniedError',
      });
    });
  }
});

it('forced final with pending calls validates original JSON before output middleware can erase it', async () => {
  const output = vi.fn(() => allow('REWRITTEN-ANSWER', 'fixture rewrite'));
  const f = fixture(
    [
      {
        ...turn(call('pending')),
        content: JSON.stringify({ answer: 'draft', _findings: { previous: [previous('ghost')] } }),
      },
    ],
    { wrapUpAtMaxIterations: false },
  );
  const agent = f.builder
    .maxIterations(1)
    .messageMiddleware({
      name: 'erase',
      onMessage: (message) => (message.phase === 'output' ? output() : allow()),
    })
    .build();
  await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
    name: 'MessageDeniedError',
  });
  expect(output).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(1);
});

it('reliability callback fallback binds its own accepted request, not a failed leaf preparation', async () => {
  const execute = vi.fn(() => 'result');
  let initial = true;
  const provider: LLMProvider = {
    name: 'callback-fixture',
    complete: async (req, hooks) => {
      if (initial) {
        initial = false;
        return { ...turn(call('c1')), usage: { input: 0, output: 0 } };
      }
      hooks?.onReplayPrepared?.({
        provider: 'callback-fixture',
        model: req.model,
        request: { ...req, messages: [] },
        omissions: [],
      });
      throw new Error('synthetic leaf failure');
    },
  };
  let repair = 0;
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute,
      }),
    )
    .findings()
    .reliability({
      postDecide: [
        { when: (scope) => scope.error !== undefined, then: 'fallback', kind: 'fixture-repair' },
      ],
      fallback: async (req) => {
        expect(req.messages.some((m) => m.toolCallId === 'c1')).toBe(true);
        return repair++ === 0
          ? { ...turn(call('c2', ['c1'])), usage: { input: 0, output: 0 } }
          : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
      },
    })
    .build();
  await agent.run({ message: 'read' });
  expect(execute).toHaveBeenCalledTimes(2);
});

it('author-owned reserved arguments on provider tools retain their existing ownership', async () => {
  const execute = vi.fn(() => 'author result');
  const args = {
    _findings: { previous: [{ toolCallId: 'author-foreign', standing: 'author-word' }] },
  };
  const agent = Agent.create({
    provider: mock({
      replies: [{ content: '', toolCalls: [{ id: 'a', name: 'author', args }] }, 'done'],
    }),
    model: 'mock',
  })
    .toolProvider(
      staticTools([
        defineTool({
          name: 'author',
          description: 'Author fixture',
          inputSchema: { type: 'object', properties: { _findings: { type: 'object' } } },
          execute,
        }),
      ]),
    )
    .findings()
    .build();
  await agent.run({ message: 'read' });
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).toEqual(args);
  expect(state(agent).findingsLedger).toBeUndefined();
});

it('a mixed batch excludes refused asks while independent valid asks retain their existing pause', async () => {
  const context = vi.fn(() => ({ fixture: 'context' }));
  const execute = vi.fn(() => 'result');
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [
            {
              id: 'bad',
              name: 'read_item',
              args: { _findings: { previous: [previous('ghost')] } },
            },
            { id: 'good', name: 'read_item', args: {} },
          ],
        },
        'done',
      ],
    }),
    model: 'mock',
    argumentAskContext: context,
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        askOrAssume: { q: { ask: 'Which fixture?' } },
        execute,
      }),
    )
    .findings()
    .build();
  const pause = await agent.run({ message: 'read' });
  expect(isPaused(pause)).toBe(true);
  expect(context).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(state(agent).findingsLedger).toContainEqual(
    expect.objectContaining({ toolCallId: 'ghost', unknownId: true }),
  );
});

it('a malformed oversized attempt is refused and retained as explicitly truncated diagnostic text', async () => {
  const f = fixture([
    turn({
      ...call('bad'),
      args: {
        q: 'bad',
        _findings: { previous: [{ toolCallId: 123, standing: 'x'.repeat(10000) }] },
      },
    }),
    'done',
  ]);
  const agent = f.builder.build();
  await agent.run({ message: 'read' });
  expect(f.execute).not.toHaveBeenCalled();
  const diagnostic = state(agent).findingsLedger?.find((row) => row.kind === 'reference-refusal');
  expect(diagnostic).toMatchObject({ reason: 'malformed', truncated: true });
  expect(diagnostic?.kind === 'reference-refusal' && diagnostic.attempted?.length).toBe(8192);
});

it('an output rewrite introducing a foreign citation is refused before final settlement', async () => {
  const f = fixture(['valid plain draft']);
  const output = vi.fn(() =>
    allow(
      JSON.stringify({ answer: 'rewritten', _findings: { previous: [previous('ghost')] } }),
      'fixture rewrite',
    ),
  );
  const agent = f.builder
    .messageMiddleware({
      name: 'rewrite',
      onMessage: (message) => (message.phase === 'output' ? output() : allow()),
    })
    .build();
  await expect(agent.run({ message: 'read' })).rejects.toMatchObject({
    name: 'MessageDeniedError',
  });
  expect(output).toHaveBeenCalledOnce();
  expect(f.requests).toHaveLength(1);
  expect(state(agent).findingsLedger).toContainEqual(
    expect.objectContaining({ toolCallId: 'ghost', unknownId: true }),
  );
});

it('provider retries bind the accepted attempt request and do not union a discarded preparation', async () => {
  const execute = vi.fn(() => 'result');
  let at = 0;
  const provider: LLMProvider = {
    name: 'retry-fixture',
    complete: async (req, hooks) => {
      at++;
      if (at === 1) return { ...turn(call('c1')), usage: { input: 0, output: 0 } };
      if (at === 2) {
        hooks?.onReplayPrepared?.({
          provider: 'retry-fixture',
          model: req.model,
          request: req,
          omissions: [],
        });
        throw new Error('synthetic transient');
      }
      hooks?.onReplayPrepared?.({
        provider: 'retry-fixture',
        model: req.model,
        request: { ...req, messages: req.messages.filter((m) => m.role !== 'tool') },
        omissions: [],
      });
      return at === 3
        ? { ...turn(call('c2', ['c1'])), usage: { input: 0, output: 0 } }
        : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
  const agent = Agent.create({
    provider: withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute,
      }),
    )
    .findings()
    .build();
  await agent.run({ message: 'read' });
  expect(execute).toHaveBeenCalledOnce();
  expect(at).toBe(4);
});

it('a fresh continuation and error-resume accept a checkpoint containing a refused declaration', async () => {
  const f = fixture([turn(call('refused', ['ghost'])), 'done']);
  const agent = f.builder.build();
  await agent.run({ message: 'read' });
  const checkpoint = agent.checkpoint()!;
  expect(checkpoint.findingsLedger).toContainEqual(
    expect.objectContaining({ kind: 'reference-refusal' }),
  );
  const continued = fixture(['continued']).builder.build();
  expect(
    await continued.run({ message: 'continue', continueFrom: structuredClone(checkpoint) }),
  ).toBe('continued');
  const resumed = fixture(['resumed']).builder.build();
  expect(await resumed.resumeOnError(structuredClone(checkpoint))).toBe('resumed');
});

it('a successful silent fallback leaf resets a discarded replay preparation', async () => {
  const execute = vi.fn(() => 'result');
  let at = 0;
  const primary: LLMProvider = {
    name: 'primary',
    complete: async (req, hooks) => {
      if (at++ === 0) return { ...turn(call('c1')), usage: { input: 0, output: 0 } };
      hooks?.onReplayPrepared?.({
        provider: 'primary',
        model: req.model,
        request: { ...req, messages: req.messages.filter((m) => m.role !== 'tool') },
        omissions: [],
      });
      throw new Error('synthetic primary failure');
    },
  };
  let final = false;
  const secondary: LLMProvider = {
    name: 'secondary',
    complete: async (req) => {
      expect(req.messages.some((m) => m.toolCallId === 'c1')).toBe(true);
      if (final) return { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
      final = true;
      return { ...turn(call('c2', ['c1'])), usage: { input: 0, output: 0 } };
    },
  };
  const agent = Agent.create({
    provider: withFallback(primary, secondary),
    model: 'mock',
    recordReceipt: false,
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute,
      }),
    )
    .findings()
    .build();
  await agent.run({ message: 'read' });
  expect(execute).toHaveBeenCalledTimes(2);
});

it('a failed fallback leaf cannot introduce a phantom source to a silent accepted leaf', async () => {
  const f = fixture([]);
  let final = false;
  const primary: LLMProvider = {
    name: 'primary',
    complete: async (req, hooks) => {
      hooks?.onReplayPrepared?.({
        provider: 'primary',
        model: req.model,
        request: {
          ...req,
          messages: [
            ...req.messages,
            { role: 'tool', toolCallId: 'phantom', toolName: 'read_item', content: 'not served' },
          ],
        },
        omissions: [],
      });
      throw new Error('synthetic primary failure');
    },
  };
  const secondary: LLMProvider = {
    name: 'secondary',
    complete: async (req) => {
      expect(req.messages.some((m) => m.toolCallId === 'phantom')).toBe(false);
      if (final) return { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
      final = true;
      return { ...turn(call('bad', ['phantom'])), usage: { input: 0, output: 0 } };
    },
  };
  const agent = Agent.create({ provider: withFallback(primary, secondary), model: 'mock' })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute: f.execute,
      }),
    )
    .findings()
    .build();
  await agent.run({ message: 'read' });
  expect(f.execute).not.toHaveBeenCalled();
});

it('a silent successful retry cannot retain the failed attempt preparation', async () => {
  const execute = vi.fn(() => 'result');
  let at = 0;
  const provider: LLMProvider = {
    name: 'retry-silent',
    complete: async (req, hooks) => {
      at++;
      if (at === 1) return { ...turn(call('c1')), usage: { input: 0, output: 0 } };
      if (at === 2) {
        hooks?.onReplayPrepared?.({
          provider: 'retry-silent',
          model: req.model,
          request: { ...req, messages: req.messages.filter((m) => m.role !== 'tool') },
          omissions: [],
        });
        throw new Error('synthetic transient');
      }
      expect(req.messages.some((m) => m.toolCallId === 'c1')).toBe(true);
      return at === 3
        ? { ...turn(call('c2', ['c1'])), usage: { input: 0, output: 0 } }
        : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
  const agent = Agent.create({
    provider: withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Read',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute,
      }),
    )
    .findings()
    .build();
  await agent.run({ message: 'read' });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(at).toBe(4);
});

it('grouped turns replace the whole request witness rather than merging previous result lists', async () => {
  const f = fixture(
    [turn(call('c1')), turn(call('c2', ['c1'])), turn(call('c3', ['c1', 'c2'])), 'done'],
    { reactMode: 'dynamic-grouped', recordReceipt: false },
  );
  const agent = f.builder.build();
  await agent.run({ message: 'read' });
  expect(f.execute).toHaveBeenCalledTimes(3);
  expect(
    state(agent).findingsLedger?.some((row) => row.kind === 'standing' && row.unknownId === true),
  ).toBe(false);
});
