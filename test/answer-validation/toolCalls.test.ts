/**
 * `context.toolCalls` — the answer check reads which tools THIS run called:
 * name, call id, outcome. Never arguments, never results, never another run's.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  defineTool,
  Parallel,
  type AnswerToolCallsView,
  type OutputSchemaParser,
} from '../../src/index.js';
import { askHuman } from '../../src/core/pause.js';
import { mock } from '../../src/llm-providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import {
  appendToolCall,
  ledgerAtCheck,
  startToolCall,
  toolCallsView,
  toolOutcomeOf,
} from '../../src/answer-validation/index.js';

interface Reply {
  text: string;
}
const replyParser: OutputSchemaParser<Reply> = {
  parse(value) {
    const candidate = value as Partial<Reply> | null;
    if (candidate === null || typeof candidate?.text !== 'string') throw new Error('text required');
    return { text: candidate.text };
  },
};

const ARG_CANARY = 'arg-canary-7781';
const RESULT_CANARY = 'result-canary-5512';
const CODE_ANSWER = JSON.stringify({ text: 'Run this:\n```python\nprint(2 + 2)\n```' });
const PLAIN_ANSWER = JSON.stringify({ text: 'Four.' });

const runCode = defineTool({
  name: 'run_code',
  description: 'Execute Python.',
  inputSchema: { type: 'object', properties: { source: { type: 'string' } } },
  execute: async () => `${RESULT_CANARY}: 4`,
});
const brokenRunCode = defineTool({
  name: 'run_code',
  description: 'Execute Python.',
  inputSchema: { type: 'object', properties: { source: { type: 'string' } } },
  execute: async () => {
    throw new Error('sandbox unavailable');
  },
});
const search = defineTool({
  name: 'search',
  description: 'Search the docs.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  execute: async () => `${RESULT_CANARY}: docs`,
});

/** The README rule: an answer that presents code must have code that ran. */
/** The README rule. It reads the tool list only when the answer presents code;
 *  `seen`, when a test passes one, records the list (and so reads it). */
function presentedCodeRanCheck(seen?: AnswerToolCallsView[]) {
  return (candidate: Readonly<Reply>, context: { toolCalls: AnswerToolCallsView }) => {
    if (seen) seen.push(context.toolCalls);
    // Something must be checked for a pass; the shape check is that.
    const checks: {
      id: string;
      disposition: 'checked-pass' | 'checked-fail' | 'not-applicable';
    }[] = [{ id: 'has-text', disposition: 'checked-pass' }];
    if (!candidate.text.includes('```')) {
      checks.push({ id: 'presented-code-was-executed', disposition: 'not-applicable' });
      return { checks };
    }
    const executed = context.toolCalls.calls.some(
      (call) => call.name === 'run_code' && call.outcome === 'ok',
    );
    checks.push({
      id: 'presented-code-was-executed',
      disposition: executed ? 'checked-pass' : 'checked-fail',
    });
    return { checks };
  };
}

function guarded(replies: unknown[], tools = [runCode, search], seen?: AnswerToolCallsView[]) {
  let builder = Agent.create({
    provider: mock({ chunkDelayMs: 0, replies: replies as never }),
    model: 'mock',
  }).outputSchema(replyParser);
  for (const tool of tools) builder = builder.tool(tool);
  return builder
    .answerValidation<Reply>({
      id: 'presented-code-ran',
      version: '1',
      validate: presentedCodeRanCheck(seen),
    })
    .build();
}

const call = (id: string, name: string, args: Record<string, unknown> = { q: ARG_CANARY }) => ({
  id,
  name,
  args,
});

describe('answerValidation — context.toolCalls', () => {
  it('lists this run’s calls by name, id and outcome — no arguments, no results', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = guarded(
      [
        {
          content: '',
          toolCalls: [call('c1', 'search'), call('c2', 'run_code', { source: ARG_CANARY })],
        },
        { content: '', toolCalls: [call('c3', 'not_a_tool')] },
        CODE_ANSWER,
      ],
      [runCode, search],
      seen,
    );
    expect(await agent.run({ message: 'add two and two' })).toBe(CODE_ANSWER);
    expect(seen).toHaveLength(1);
    const view = seen[0]!;
    expect(view).toEqual({
      calls: [
        { name: 'search', callId: 'c1', outcome: 'ok' },
        { name: 'run_code', callId: 'c2', outcome: 'ok' },
        { name: 'not_a_tool', callId: 'c3', outcome: 'error' },
      ],
      complete: true,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(ARG_CANARY);
    expect(serialized).not.toContain(RESULT_CANARY);
    // Frozen and detached: the check cannot edit the run's ledger.
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.calls)).toBe(true);
    expect(Object.isFrozen(view.calls[0])).toBe(true);
    expect(Reflect.set(view.calls[0]!, 'outcome', 'error')).toBe(false);
    const state = agent.getLastSnapshot()?.sharedState as { toolCallLedger?: AnswerToolCallsView };
    expect(state.toolCallLedger?.calls[0]?.outcome).toBe('ok');
  });

  it('refuses code that was presented but never executed', async () => {
    const agent = guarded([{ content: '', toolCalls: [call('c1', 'search')] }, CODE_ANSWER]);
    const error = await agent.run({ message: 'add two and two' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AnswerValidationError);
    expect((error as AnswerValidationError).report).toMatchObject({
      status: 'failed',
      failed: 1,
      checks: expect.arrayContaining([
        { id: 'presented-code-was-executed', disposition: 'checked-fail' },
      ]),
    });
  });

  it('a code tool that FAILED is not an execution', async () => {
    const agent = guarded(
      [{ content: '', toolCalls: [call('c1', 'run_code', { source: 'x' })] }, CODE_ANSWER],
      [brokenRunCode],
    );
    await expect(agent.run({ message: 'add' })).rejects.toBeInstanceOf(AnswerValidationError);
    expect(agent.answerValidation()?.status).toBe('failed');
  });

  it('an answer without code passes with no tool calls at all', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = guarded([PLAIN_ANSWER], [runCode], seen);
    expect(await agent.run({ message: 'add' })).toBe(PLAIN_ANSWER);
    expect(seen[0]).toEqual({ calls: [], complete: true });
  });

  it('a second turn on the same agent never sees the first turn’s calls', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = guarded(
      [
        { content: '', toolCalls: [call('c1', 'run_code', { source: 'x' })] },
        CODE_ANSWER,
        CODE_ANSWER,
      ],
      [runCode],
      seen,
    );
    expect(await agent.run({ message: 'first' })).toBe(CODE_ANSWER);
    const second = await agent.run({ message: 'second' }).catch((err: unknown) => err);
    expect(second).toBeInstanceOf(AnswerValidationError);
    expect(seen.map((view) => view.calls.map((c) => c.callId))).toEqual([['c1'], []]);
  });

  it('concurrent runs each read only their own ledger', async () => {
    const seen = new Map<string, AnswerToolCallsView>();
    const slowTool = (name: string, delayMs: number) =>
      defineTool({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return 'done';
        },
      });
    const agentFor = (label: string, toolName: string, delayMs: number) =>
      Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { content: '', toolCalls: [call(`${label}-1`, toolName, {})] },
            { content: '', toolCalls: [call(`${label}-2`, toolName, {})] },
            PLAIN_ANSWER,
          ] as never,
        }),
        model: 'mock',
      })
        .outputSchema(replyParser)
        .tool(slowTool(toolName, delayMs))
        .answerValidation<Reply>({
          id: 'own-ledger',
          version: '1',
          validate(_candidate, context) {
            seen.set(label, context.toolCalls);
            return { checks: [{ id: 'seen', disposition: 'checked-pass' }] };
          },
        })
        .build();
    await Promise.all([
      agentFor('a', 'tool_a', 7).run({ message: 'a' }),
      agentFor('b', 'tool_b', 3).run({ message: 'b' }),
      agentFor('c', 'tool_c', 1).run({ message: 'c' }),
    ]);
    for (const label of ['a', 'b', 'c']) {
      expect(seen.get(label)?.calls).toEqual([
        { name: `tool_${label}`, callId: `${label}-1`, outcome: 'ok' },
        { name: `tool_${label}`, callId: `${label}-2`, outcome: 'ok' },
      ]);
    }
  });

  it('a paused call answered on resume is in the resumed run’s ledger, with the calls before the pause', async () => {
    const seen: AnswerToolCallsView[] = [];
    const confirm = defineTool({
      name: 'confirm',
      description: 'Ask a person.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
      execute: async (args: { question?: string }) =>
        askHuman({ question: args.question ?? 'ok?' }),
    });
    const agent = guarded(
      [
        { content: '', toolCalls: [call('c1', 'run_code', { source: 'x' })] },
        { content: '', toolCalls: [call('c2', 'confirm', { question: 'Show it?' })] },
        CODE_ANSWER,
      ],
      [runCode, confirm],
      seen,
    );
    const paused = await agent.run({ message: 'add' });
    expect(typeof paused).not.toBe('string');
    const checkpoint = (paused as { checkpoint: unknown }).checkpoint;
    expect(await agent.resume(checkpoint as never, 'yes')).toBe(CODE_ANSWER);
    expect(seen[0]).toEqual({
      calls: [
        { name: 'run_code', callId: 'c1', outcome: 'ok' },
        { name: 'confirm', callId: 'c2', outcome: 'ok' },
      ],
      complete: true,
    });
  });

  it('a call a permission policy denied is listed as not-run, which is not an execution', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [call('c1', 'run_code', { source: 'x' })] },
          CODE_ANSWER,
        ] as never,
      }),
      model: 'mock',
      permissionChecker: {
        check: async () => ({ result: 'deny' as const, rationale: 'policy' }),
      } as never,
    })
      .outputSchema(replyParser)
      .tool(runCode)
      .answerValidation<Reply>({
        id: 'denied',
        version: '1',
        validate: presentedCodeRanCheck(seen),
      })
      .build();
    await expect(agent.run({ message: 'add' })).rejects.toBeInstanceOf(AnswerValidationError);
    expect(seen[0]).toEqual({
      calls: [{ name: 'run_code', callId: 'c1', outcome: 'not-run' }],
      complete: true,
    });
  });

  it('a resumeOnError leg says its ledger is incomplete — the failed attempt’s calls were not observed', async () => {
    const seen: AnswerToolCallsView[] = [];
    let step = 0;
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        respond: () => {
          step += 1;
          if (step === 1)
            return { content: '', toolCalls: [call('c0', 'run_code', { source: 'x' })] };
          if (step === 2) throw new Error('provider outage');
          return { content: CODE_ANSWER, toolCalls: [] };
        },
      }),
      model: 'mock',
    })
      .outputSchema(replyParser)
      .tool(runCode)
      .answerValidation<Reply>({
        id: 'resumed',
        version: '1',
        validate: presentedCodeRanCheck(seen),
      })
      .build();
    const failed = await agent.run({ message: 'add' }).catch((err: unknown) => err);
    const checkpoint = (failed as { checkpoint?: unknown }).checkpoint;
    expect(checkpoint).toBeDefined();
    await expect(agent.resumeOnError(checkpoint as never)).rejects.toBeInstanceOf(
      AnswerValidationError,
    );
    expect(seen[0]).toEqual({ calls: [], complete: false });
    expect(agent.answerValidation()?.status).toBe('unverified');
  });

  it('a checkpoint written before ledgers existed resumes into an incomplete view', async () => {
    const seen: AnswerToolCallsView[] = [];
    const confirm = defineTool({
      name: 'confirm',
      description: 'Ask a person.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => askHuman({ question: 'Show it?' }),
    });
    const agent = guarded(
      [
        { content: '', toolCalls: [call('c1', 'run_code', { source: 'x' })] },
        { content: '', toolCalls: [call('c2', 'confirm', {})] },
        CODE_ANSWER,
      ],
      [runCode, confirm],
      seen,
    );
    const paused = (await agent.run({ message: 'add' })) as { checkpoint: unknown };
    // Strip the ledger wherever the checkpoint carries it: an older release wrote none.
    let stripped = 0;
    const strip = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      if (Object.hasOwn(value, 'toolCallLedger')) {
        delete (value as Record<string, unknown>).toolCallLedger;
        stripped += 1;
      }
      for (const child of Object.values(value)) strip(child);
    };
    const checkpoint = structuredClone(paused.checkpoint);
    strip(checkpoint);
    expect(stripped).toBeGreaterThan(0);
    await agent.resume(checkpoint as never, 'yes').catch(() => undefined);
    // The paused call is listed, but what ran before the pause was not observed.
    expect(seen[0]).toEqual({
      calls: [{ name: 'confirm', callId: 'c2', outcome: 'ok' }],
      complete: false,
    });
  });

  it('past limits.maxToolCalls the view says it is incomplete', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          {
            content: '',
            toolCalls: [call('c1', 'search'), call('c2', 'search'), call('c3', 'search')],
          },
          CODE_ANSWER,
        ] as never,
      }),
      model: 'mock',
    })
      .outputSchema(replyParser)
      .tool(search)
      .answerValidation<Reply>({
        id: 'bounded',
        version: '1',
        limits: { maxToolCalls: 2 },
        validate: presentedCodeRanCheck(seen),
      })
      .build();
    await expect(agent.run({ message: 'add' })).rejects.toBeInstanceOf(AnswerValidationError);
    expect(seen[0]).toEqual({
      calls: [
        { name: 'search', callId: 'c1', outcome: 'ok' },
        { name: 'search', callId: 'c2', outcome: 'ok' },
      ],
      complete: false,
    });
    // Incomplete: a check that read the list cannot pass on it.
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'tool-calls-incomplete',
    });
  });

  it('under conversationRedaction() the record keeps `complete` and none of the names; the check reads them live', async () => {
    const NAME_CANARY = 'zq_made_up_tool_4410';
    const seen: AnswerToolCallsView[] = [];
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [{ content: '', toolCalls: [call('c1', NAME_CANARY)] }, PLAIN_ANSWER] as never,
      }),
      model: 'mock',
      redact: conversationRedaction(),
    })
      .outputSchema(replyParser)
      .tool(search)
      .answerValidation<Reply>({
        id: 'redacted',
        version: '1',
        validate: presentedCodeRanCheck(seen),
      })
      .build();
    await agent.run({ message: 'go' });
    expect(seen[0]?.calls.map((c) => c.name)).toEqual([NAME_CANARY]);
    const served = agent.getLastSnapshot();
    const state = served?.sharedState as { toolCallLedger?: { complete?: unknown } };
    expect(state.toolCallLedger?.complete).toBe(true);
    expect(JSON.stringify(state.toolCallLedger)).not.toContain(NAME_CANARY);
    expect(JSON.stringify(served?.commitLog ?? [])).not.toContain(NAME_CANARY);
  });

  it('a tool that declares it failed is an error; a missing ledger is never "nothing ran"', async () => {
    expect(toolOutcomeOf({ status: 'failure' }, true)).toBe('error');
    expect(toolOutcomeOf({ status: 'invalid' }, true)).toBe('error');
    expect(toolOutcomeOf({ status: 'partial' }, true)).toBe('ok');
    // A call a person declined: no error, did not run.
    expect(toolOutcomeOf({}, false)).toBe('not-run');
    expect(toolCallsView(undefined, 10)).toEqual({ calls: [], complete: false });
  });

  it('refuses a maxToolCalls past its ceiling', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
        .outputSchema(replyParser)
        .answerValidation<Reply>({
          id: 'too-many',
          version: '1',
          limits: { maxToolCalls: 10_001 },
          validate: () => ({ checks: [] }),
        }),
    ).toThrow(/maxToolCalls/);
  });

  it('an agent without answerValidation keeps no ledger', async () => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [{ content: '', toolCalls: [call('c1', 'search')] }, 'done'] as never,
      }),
      model: 'mock',
    })
      .tool(search)
      .build();
    await agent.run({ message: 'go' });
    expect(Object.keys(agent.getLastSnapshot()?.sharedState ?? {})).not.toContain('toolCallLedger');
  });
});

/** A check that passes whenever run_code ran — it never looks at `complete`.
 *  The framework must still refuse to pass it on a list that is not whole. */
function trustingCheck(seen: AnswerToolCallsView[]) {
  return (_answer: Readonly<Reply>, context: { toolCalls: AnswerToolCallsView }) => {
    seen.push(context.toolCalls);
    const ran = context.toolCalls.calls.some((c) => c.name === 'run_code' && c.outcome === 'ok');
    return {
      checks: [
        { id: 'ran', disposition: ran ? ('checked-pass' as const) : ('checked-fail' as const) },
      ],
    };
  };
}

function trusting(provider: unknown, tools: unknown[], seen: AnswerToolCallsView[], extra = {}) {
  let builder = Agent.create({ provider: provider as never, model: 'mock', ...extra }).outputSchema(
    replyParser,
  );
  for (const tool of tools) builder = builder.tool(tool as never);
  return builder
    .answerValidation<Reply>({ id: 'trusting', version: '1', validate: trustingCheck(seen) })
    .build();
}

describe('the list fails closed — a check that reads an incomplete list cannot pass', () => {
  it('in flight: a tool that declared its work pending makes the list incomplete', async () => {
    const seen: AnswerToolCallsView[] = [];
    const startJob = defineTool({
      name: 'run_code',
      description: 'Start a code job.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'job started', effects: [], status: 'pending' }),
    });
    const agent = trusting(
      mock({
        chunkDelayMs: 0,
        replies: [{ content: '', toolCalls: [call('c1', 'run_code', {})] }, CODE_ANSWER] as never,
      }),
      [startJob],
      seen,
    );
    await expect(agent.run({ message: 'add' })).rejects.toBeInstanceOf(AnswerValidationError);
    expect(seen[0]).toEqual({
      calls: [{ name: 'run_code', callId: 'c1', outcome: 'ok' }],
      complete: false,
    });
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'tool-calls-incomplete',
      checks: [{ id: 'ran', disposition: 'checked-pass' }],
    });
  });

  it('in flight: a pending result a ceiling refused is still unsettled', async () => {
    const seen: AnswerToolCallsView[] = [];
    const startJob = defineTool({
      name: 'run_code',
      description: 'Start a code job.',
      inputSchema: { type: 'object', properties: {} },
      resultCeiling: { maxChars: 10 },
      execute: async () => ({ content: 'x'.repeat(500), effects: [], status: 'pending' }),
    });
    const agent = trusting(
      mock({
        chunkDelayMs: 0,
        replies: [{ content: '', toolCalls: [call('c1', 'run_code', {})] }, CODE_ANSWER] as never,
      }),
      [startJob],
      seen,
    );
    await agent.run({ message: 'add' }).catch(() => undefined);
    // The ceiling refused the payload (the bracket now says `invalid`, so the
    // call is an error) — and the tool had declared its work pending.
    expect(seen[0]).toEqual({
      calls: [{ name: 'run_code', callId: 'c1', outcome: 'error' }],
      complete: false,
    });
    expect(agent.answerValidation()?.status).toBe('unverified');
  });

  it('in flight: a last reply whose calls never went out makes the list incomplete', async () => {
    const seen: AnswerToolCallsView[] = [];
    const agent = trusting(
      mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [call('c1', 'run_code', {})] },
          { content: '', toolCalls: [call('c2', 'run_code', {})] },
          // Cut off by the iteration budget: this reply's call is never dispatched.
          { content: CODE_ANSWER, toolCalls: [call('c3', 'run_code', {})] },
        ] as never,
      }),
      [runCode],
      seen,
      { maxIterations: 2 },
    );
    const outcome = await agent.run({ message: 'add' }).catch((err: unknown) => err);
    expect(outcome).toBeInstanceOf(AnswerValidationError);
    expect(seen[0]?.complete).toBe(false);
    expect(agent.answerValidation()).toMatchObject({ reason: 'tool-calls-incomplete' });
  });

  it('a retried call: the failed attempt and the retry are both listed, in order', async () => {
    const seen: AnswerToolCallsView[] = [];
    let attempts = 0;
    const flaky = defineTool({
      name: 'run_code',
      description: 'Execute Python.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('sandbox busy');
        return '4';
      },
    });
    const agent = trusting(
      mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [call('c1', 'run_code', {})] },
          { content: '', toolCalls: [call('c2', 'run_code', {})] },
          CODE_ANSWER,
        ] as never,
      }),
      [flaky],
      seen,
    );
    expect(await agent.run({ message: 'add' })).toBe(CODE_ANSWER);
    expect(seen[0]).toEqual({
      calls: [
        { name: 'run_code', callId: 'c1', outcome: 'error' },
        { name: 'run_code', callId: 'c2', outcome: 'ok' },
      ],
      complete: true,
    });
  });

  it('a retried request (resumeOnError): a passing check over a partial list is refused', async () => {
    const seen: AnswerToolCallsView[] = [];
    let step = 0;
    const agent = trusting(
      mock({
        chunkDelayMs: 0,
        respond: () => {
          step += 1;
          if (step === 1) return { content: '', toolCalls: [call('c0', 'run_code', {})] };
          if (step === 2) throw new Error('provider outage');
          if (step === 3) return { content: '', toolCalls: [call('c1', 'run_code', {})] };
          return { content: CODE_ANSWER, toolCalls: [] };
        },
      }),
      [runCode],
      seen,
    );
    const failed = await agent.run({ message: 'add' }).catch((err: unknown) => err);
    const checkpoint = (failed as { checkpoint?: unknown }).checkpoint;
    await expect(agent.resumeOnError(checkpoint as never)).rejects.toBeInstanceOf(
      AnswerValidationError,
    );
    // The retried leg's own call is listed; the failed leg's is not observed.
    expect(seen[0]).toEqual({
      calls: [{ name: 'run_code', callId: 'c1', outcome: 'ok' }],
      complete: false,
    });
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'tool-calls-incomplete',
      checks: [{ id: 'ran', disposition: 'checked-pass' }],
    });
  });

  it('the README rule passes a plain answer on a resumeOnError leg — it never reads the list', async () => {
    let step = 0;
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        respond: () => {
          step += 1;
          if (step === 1) return { content: '', toolCalls: [call('c0', 'run_code', {})] };
          if (step === 2) throw new Error('provider outage');
          return { content: PLAIN_ANSWER, toolCalls: [] };
        },
      }),
      model: 'mock',
    })
      .outputSchema(replyParser)
      .tool(runCode)
      .answerValidation<Reply>({
        id: 'readme-rule',
        version: '1',
        validate: presentedCodeRanCheck(),
      })
      .build();
    const failed = await agent.run({ message: 'add' }).catch((err: unknown) => err);
    const checkpoint = (failed as { checkpoint?: unknown }).checkpoint;
    expect(await agent.resumeOnError(checkpoint as never)).toBe(PLAIN_ANSWER);
    expect(agent.answerValidation()?.status).toBe('passed');
  });

  it('a check that never reads the list is not held to it', async () => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [call('c1', 'run_code', {})] },
          { content: CODE_ANSWER, toolCalls: [call('c2', 'run_code', {})] },
        ] as never,
      }),
      model: 'mock',
      maxIterations: 2,
    })
      .outputSchema(replyParser)
      .tool(runCode)
      .answerValidation<Reply>({
        id: 'shape-only',
        version: '1',
        validate: () => ({ checks: [{ id: 'shape', disposition: 'checked-pass' }] }),
      })
      .build();
    await agent.run({ message: 'add' }).catch(() => undefined);
    expect(agent.answerValidation()?.reason).not.toBe('tool-calls-incomplete');
  });

  it('two concurrent member runs in one composition each read only their own calls', async () => {
    const seen = new Map<string, AnswerToolCallsView>();
    const member = (label: string, delayMs: number) =>
      Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { content: '', toolCalls: [call(`${label}-1`, `tool_${label}`, {})] },
            PLAIN_ANSWER,
          ] as never,
        }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: `tool_${label}`,
            description: label,
            inputSchema: { type: 'object', properties: {} },
            execute: async () => {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              return 'ok';
            },
          }),
        )
        .outputSchema(replyParser)
        .answerValidation<Reply>({
          id: `member-${label}`,
          version: '1',
          validate(_answer, context) {
            seen.set(label, context.toolCalls);
            return { checks: [{ id: 'seen', disposition: 'checked-pass' }] };
          },
        })
        .build();
    const fan = Parallel.create()
      .branch('x', member('x', 5))
      .branch('y', member('y', 1))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    await fan.run({ message: 'go' });
    expect(seen.get('x')).toEqual({
      calls: [{ name: 'tool_x', callId: 'x-1', outcome: 'ok' }],
      complete: true,
    });
    expect(seen.get('y')).toEqual({
      calls: [{ name: 'tool_y', callId: 'y-1', outcome: 'ok' }],
      complete: true,
    });
  });
});

describe('tool-call ledger primitives', () => {
  it('reads the outcome a tool_end bracket states', () => {
    expect(toolOutcomeOf({}, true)).toBe('ok');
    expect(toolOutcomeOf({ error: true }, true)).toBe('error');
    expect(toolOutcomeOf({ notExecuted: true }, false)).toBe('not-run');
    expect(
      toolOutcomeOf({ notDispatched: { pausedCall: { toolCallId: 'p', toolName: 'q' } } }, false),
    ).toBe('not-run');
  });

  it('drops anything off the declared shape and detaches from its source', () => {
    const source = {
      calls: [
        { name: 'ok_tool', callId: 'a', outcome: 'ok', args: { secret: ARG_CANARY } },
        { name: 'x'.repeat(300), callId: 'b', outcome: 'ok' },
        { name: 'odd', callId: 'c', outcome: 'maybe' },
      ],
      complete: true,
    } as unknown as AnswerToolCallsView;
    const view = toolCallsView(source, 10);
    expect(view).toEqual({
      calls: [{ name: 'ok_tool', callId: 'a', outcome: 'ok' }],
      complete: false,
    });
    (source.calls as unknown as { name: string }[])[0]!.name = 'changed';
    expect(view.calls[0]!.name).toBe('ok_tool');
  });

  it('an opened call with no closing bracket keeps the check-time list incomplete', () => {
    let ledger = startToolCall({ calls: [], complete: true }, 'a', 10);
    expect(ledgerAtCheck(ledger, 0).complete).toBe(false);
    ledger = appendToolCall(ledger, { name: 't', callId: 'a', outcome: 'ok' }, 10);
    expect(ledgerAtCheck(ledger, 0)).toEqual({
      calls: [{ name: 't', callId: 'a', outcome: 'ok' }],
      complete: true,
    });
    expect(ledgerAtCheck(ledger, 1).complete).toBe(false);
    expect(ledgerAtCheck(undefined, 0).complete).toBe(false);
    // A call the tool says is still working is not settled.
    expect(
      appendToolCall(ledger, { name: 't', callId: 'b', outcome: 'ok' }, 10, false).complete,
    ).toBe(false);
  });

  it('a list off its declared shape (a redaction placeholder) is unknown, never empty', () => {
    const placeholder = { calls: 'REDACTED', inFlight: 'REDACTED', complete: true } as never;
    expect(ledgerAtCheck(placeholder, 0)).toEqual({ calls: [], complete: false });
    expect(toolCallsView(placeholder, 10)).toEqual({ calls: [], complete: false });
    expect(ledgerAtCheck({ calls: [], complete: true, inFlight: 'x' } as never, 0).complete).toBe(
      false,
    );
  });

  it('stops listing at the bound and keeps the same ledger once it is incomplete', () => {
    let ledger = appendToolCall(undefined, { name: 't', callId: '1', outcome: 'ok' }, 1);
    ledger = appendToolCall(ledger, { name: 't', callId: '2', outcome: 'ok' }, 1);
    expect(ledger).toEqual({ calls: [{ name: 't', callId: '1', outcome: 'ok' }], complete: false });
    expect(appendToolCall(ledger, { name: 't', callId: '3', outcome: 'ok' }, 1)).toBe(ledger);
  });
});
