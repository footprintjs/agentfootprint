/**
 * A tool called from inside another tool (`ctx.tools.call`) passes the same
 * gates as a call the model makes, and leaves its own row.
 *
 * Every case runs a real agent over a scripted provider. The model calls a
 * composing tool (`compose`); its `execute` calls another registered tool
 * through `ctx.tools` and hands back what happened. What each case holds:
 *
 *   - the permission checker and the before-tool middleware chain are asked
 *     about the INNER call, under its own id (`<outer>#inner-<n>`) and with its
 *     own arguments, and their refusal stops the tool's function from being
 *     entered — a deny, a halt, a throw, an ask; and for any answer, the inner
 *     call is refused exactly when the model's own call is (the same functions);
 *   - an allowed inner call runs, and a rewrite runs as rewritten;
 *   - every inner call leaves ONE row on `innerToolCalls` (which outer call
 *     asked, the tool, whether its function was entered, how it ended), and
 *     never a `tool_start` / `tool_end` of its own;
 *   - with no gate configured the call runs and still leaves its row.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isCheckInPause,
  isPaused,
  pauseHere,
  type MiddlewareDecision,
  type Tool,
  type ToolMiddleware,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import { conversationRedaction } from '../../../src/doors/security.js';
import type { PermissionChecker, PermissionRequest } from '../../../src/provider-contract/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────

interface Row {
  readonly toolCallId: string;
  readonly outerToolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly args: Readonly<Record<string, unknown>>;
  readonly entered: boolean;
  readonly ended: string;
  readonly refusedBy?: string;
}

/** A tool that records every set of arguments it was entered with. */
function target(name = 'secret', extra: Partial<Tool> = {}) {
  const entered: Record<string, unknown>[] = [];
  const tool = {
    ...defineTool<Record<string, unknown>, string>({
      name,
      description: `the ${name} tool`,
      inputSchema: {
        type: 'object',
        properties: { account: { type: 'string' }, limit: { type: 'number' } },
      },
      execute: (args) => {
        entered.push({ ...args });
        return `${name}-done`;
      },
    }),
    ...extra,
  } as Tool;
  return { tool, entered };
}

/**
 * The composing tool: calls `inner` through `ctx.tools` with `innerArgs`, and
 * returns `ran: <result>` or `refused: <message>` — so the test reads exactly
 * what the outer tool was told.
 */
function composer(inner: string, innerArgs: Record<string, unknown> = { account: 'A1' }) {
  const told: string[] = [];
  const tool = defineTool<Record<string, unknown>, string>({
    name: 'compose',
    description: 'composes another tool',
    inputSchema: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      if (ctx.tools === undefined) throw new Error('no ctx.tools');
      try {
        const result = await ctx.tools.call(inner, innerArgs);
        told.push(`ran: ${String(result)}`);
      } catch (err) {
        told.push(`refused: ${(err as Error).message}`);
      }
      return told[told.length - 1]!;
    },
  });
  return { tool, told };
}

const composeThen = (id = 'c1') => [
  { toolCalls: [{ id, name: 'compose', args: {} }] },
  { content: 'done' },
];

function rows(agent: Agent): readonly Row[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { innerToolCalls?: readonly Row[] }
    | undefined;
  return state?.innerToolCalls ?? [];
}

function decisions(agent: Agent): readonly MiddlewareDecision[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { middlewareDecisions?: readonly MiddlewareDecision[] }
    | undefined;
  return state?.middlewareDecisions ?? [];
}

function events(agent: Agent) {
  const seen: { type: string; payload: Record<string, unknown> }[] = [];
  agent.on(
    '*' as never,
    ((e: { type: string; payload: Record<string, unknown> }) => {
      seen.push({ type: e.type, payload: e.payload });
    }) as never,
  );
  return {
    of: (suffix: string) => seen.filter((e) => e.type === `agentfootprint.${suffix}`),
  };
}

function checkerOf(
  answer: (req: PermissionRequest) => unknown,
): PermissionChecker & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'policy',
    asked,
    check: (req) => {
      asked.push(`${req.capability}:${req.target}`);
      return answer(req) as never;
    },
  };
}

const denySecret = () =>
  checkerOf((req) => ({ result: req.target === 'secret' ? 'deny' : 'allow', rationale: 'no' }));

// ─── 1. Each gate alone refuses what it refuses for the model's own call ──

describe('the permission checker is asked about an inner call', () => {
  it("refuses the inner call it refuses for the model's own call, under the inner id", async () => {
    const secret = target();
    const compose = composer('secret');
    const checker = denySecret();
    const agent = Agent.create({
      provider: mock({
        replies: [
          // The model's own call, refused — the control.
          { toolCalls: [{ id: 'c0', name: 'secret', args: { account: 'A1' } }] },
          { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, compose.tool])
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(checker.asked).toEqual(['tool_call:secret', 'tool_call:compose', 'tool_call:secret']);
    expect(compose.told).toHaveLength(1);
    expect(compose.told[0]).toMatch(/^refused: ctx\.tools\.call\('secret'\): /);
    expect(compose.told[0]).toContain('permission check');
    expect(compose.told[0]).toContain('[permission denied: no]');
    const checks = seen.of('permission.check').map((e) => e.payload);
    expect(checks.map((c) => [c.toolCallId, c.target, c.result])).toEqual([
      ['c0', 'secret', 'deny'],
      ['c1', 'compose', 'allow'],
      ['c1#inner-1', 'secret', 'deny'],
    ]);
    expect(rows(agent)).toEqual([
      {
        toolCallId: 'c1#inner-1',
        outerToolCallId: 'c1',
        toolName: 'secret',
        iteration: 2,
        args: { account: 'A1' },
        entered: false,
        ended: 'refused',
        refusedBy: 'permission',
      },
    ]);
  });

  it.each([
    ['halt', () => ({ result: 'halt', reason: 'security:exfiltration' })],
    [
      'a throw',
      () => {
        throw new Error('policy service down');
      },
    ],
  ] as const)('refuses on %s, and the run goes on', async (_label, answer) => {
    const secret = target();
    const compose = composer('secret');
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checkerOf((req) =>
        req.target === 'secret' ? answer() : { result: 'allow' },
      ),
    })
      .tools([secret.tool, compose.tool])
      .build();
    const out = await agent.run({ message: 'go' });

    expect(out).toBe('done');
    expect(secret.entered).toEqual([]);
    expect(compose.told[0]).toMatch(/^refused: ctx\.tools\.call\('secret'\): .*permission check/);
    expect(rows(agent).map((r) => [r.entered, r.ended, r.refusedBy])).toEqual([
      [false, 'refused', 'permission'],
    ]);
  });

  // The rule for a checker's answer lives in the model call's own functions
  // (`checkToolPermission`, `askDeclaredCapabilities`); an inner call reaches
  // it by calling them. So for EVERY answer — the four known ones, an answer
  // nobody wrote down, a malformed one — the inner call runs exactly when the
  // model's own call runs. When that rule changes (an unrecognised answer
  // refused), this test holds the inner call to the new rule with no edit.
  it.each([
    ['allow', { result: 'allow' }],
    ['gate_open', { result: 'gate_open' }],
    ['deny', { result: 'deny' }],
    ['halt', { result: 'halt' }],
    ['ALLOW', { result: 'ALLOW' }],
    ['ask', { result: 'ask' }],
    ['an empty object', {}],
    ['null result', { result: null }],
  ] as const)(
    "for the answer %s, the inner call runs exactly when the model's own call runs",
    async (_label, answer) => {
      const asked = (direct: boolean) => {
        const secret = target();
        const compose = composer('secret');
        const replies = direct
          ? [
              { toolCalls: [{ id: 'c1', name: 'secret', args: { account: 'A1' } }] },
              { content: 'done' },
            ]
          : composeThen();
        const agent = Agent.create({
          provider: mock({ replies }),
          model: 'm',
          permissionChecker: checkerOf((req) =>
            req.target === 'secret' ? answer : { result: 'allow' },
          ),
        })
          .tools([secret.tool, compose.tool])
          .build();
        return { agent, secret };
      };
      const direct = asked(true);
      await direct.agent.run({ message: 'go' }).catch(() => undefined);
      const inner = asked(false);
      await inner.agent.run({ message: 'go' });

      expect(inner.secret.entered.length).toBe(direct.secret.entered.length);
      const row = rows(inner.agent)[0];
      expect(row?.entered).toBe(direct.secret.entered.length > 0);
      if (row?.entered === false) expect(row.refusedBy).toBe('permission');
    },
  );

  it('a halt refuses the inner call; it does not end the run', async () => {
    const secret = target();
    const compose = composer('secret');
    const seen: string[] = [];
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checkerOf((req) =>
        req.target === 'secret'
          ? { result: 'halt', reason: 'security:exfiltration' }
          : { result: 'allow' },
      ),
    })
      .tools([secret.tool, compose.tool])
      .build();
    agent.on('agentfootprint.permission.halt' as never, (() => seen.push('halt')) as never);
    expect(await agent.run({ message: 'go' })).toBe('done');
    expect(secret.entered).toEqual([]);
    // The model's generic halt words, never the telemetry reason.
    expect(compose.told[0]).toContain("Tool 'secret' is not available in this context.");
    expect(compose.told[0]).not.toContain('exfiltration');
    expect(seen).toEqual([]);
  });

  it("asks about the inner tool's declared capabilities, as for a model call", async () => {
    const secret = target('secret', { capabilities: ['external_net'] } as Partial<Tool>);
    const compose = composer('secret');
    const checker: PermissionChecker & { asked: string[] } = {
      ...checkerOf((req) =>
        req.capability === 'external_net' ? { result: 'deny' } : { result: 'allow' },
      ),
      governs: ['external_net'],
    };
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(checker.asked).toEqual(['tool_call:compose', 'tool_call:secret', 'external_net:secret']);
    expect(rows(agent)[0]?.refusedBy).toBe('permission');
  });
});

describe('the before-tool middleware chain is walked for an inner call', () => {
  const build = (link: ToolMiddleware, secret = target(), compose = composer('secret')) => {
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([secret.tool, compose.tool])
      .toolMiddleware(link)
      .build();
    return { agent, secret, compose };
  };

  it("refuses the inner call it refuses for the model's own call, with its row under the inner id", async () => {
    const link: ToolMiddleware = {
      name: 'no-secret',
      onToolCall: (call) => (call.toolName === 'secret' ? deny('secret is off limits') : allow()),
    };
    // The control: the model's own call to `secret`, refused by the same link.
    const control = target();
    const direct = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c0', name: 'secret', args: { account: 'A1' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
    })
      .tools([control.tool])
      .toolMiddleware(link)
      .build();
    await direct.run({ message: 'go' });
    expect(control.entered).toEqual([]);

    const { agent, secret, compose } = build(link);
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(compose.told[0]).toMatch(/^refused: ctx\.tools\.call\('secret'\): .*tool middleware/);
    expect(compose.told[0]).toContain('secret is off limits');
    expect(decisions(agent).map((d) => [d.moment, d.toolCallId, d.toolName, d.outcome])).toEqual([
      ['before-tool', 'c1', 'compose', 'allow'],
      ['before-tool', 'c1#inner-1', 'secret', 'deny'],
    ]);
    expect(rows(agent).map((r) => [r.toolCallId, r.entered, r.ended, r.refusedBy])).toEqual([
      ['c1#inner-1', false, 'refused', 'middleware'],
    ]);
  });

  it('refuses an ask, and the refusal says there is no pause to carry it', async () => {
    const { agent, secret, compose } = build({
      name: 'four-eyes',
      onToolCall: (call) => (call.toolName === 'secret' ? ask({ question: 'ok?' }) : allow()),
    });
    const out = await agent.run({ message: 'go' });

    expect(out).toBe('done');
    expect(secret.entered).toEqual([]);
    expect(compose.told[0]).toContain('asked a person to decide');
    expect(compose.told[0]).toContain('no pause here to carry that ask');
    expect(rows(agent)[0]?.refusedBy).toBe('middleware');
  });

  // An outcome the chain's union does not hold, from a JS link: the walker
  // (`tools/runChain.ts` · `runToolChain`) decides, for both calls alike.
  it("for an outcome the union does not hold, the inner call runs exactly when the model's own call runs", async () => {
    const link = {
      name: 'odd',
      onToolCall: (call: { toolName: string }) =>
        call.toolName === 'secret' ? ({ kind: 'maybe' } as never) : allow(),
    } as ToolMiddleware;
    const control = target();
    const direct = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c0', name: 'secret', args: { account: 'A1' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
    })
      .tools([control.tool])
      .toolMiddleware(link)
      .build();
    await direct.run({ message: 'go' });
    const { agent, secret } = build(link);
    await agent.run({ message: 'go' });

    expect(secret.entered.length).toBe(control.entered.length);
    expect(rows(agent)[0]?.entered).toBe(control.entered.length > 0);
  });

  it('refuses when a link throws', async () => {
    const { agent, secret } = build({
      name: 'broken',
      onToolCall: (call) => {
        if (call.toolName === 'secret') throw new Error('rule store down');
        return allow();
      },
    });
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(rows(agent)[0]?.refusedBy).toBe('middleware');
  });

  it('runs a rewrite as rewritten, like a direct call, and the record shows what ran', async () => {
    const { agent, secret } = build({
      name: 'cap',
      onToolCall: (call) =>
        call.toolName === 'secret' ? allow({ ...call.args, limit: 5 }, 'capped') : allow(),
    });
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([{ account: 'A1', limit: 5 }]);
    const row = rows(agent)[0];
    expect(row).toMatchObject({
      entered: true,
      ended: 'returned',
      args: { account: 'A1', limit: 5 },
    });
    const rewrite = decisions(agent).find((d) => d.toolCallId === 'c1#inner-1');
    expect(rewrite).toMatchObject({ changed: true, after: { account: 'A1', limit: 5 } });
  });

  it('after-tool links see the outer result only — no after-tool row is filed for an inner call', async () => {
    const seenResults: string[] = [];
    const { agent, secret } = build({
      name: 'watch',
      onToolCall: () => allow(),
      onToolResult: (r) => {
        seenResults.push(`${r.toolCallId}:${String(r.result)}`);
        return allow();
      },
    });
    await agent.run({ message: 'go' });

    expect(secret.entered).toHaveLength(1);
    expect(seenResults).toEqual(['c1:ran: secret-done']);
    expect(
      decisions(agent)
        .filter((d) => d.moment === 'after-tool')
        .map((d) => d.toolCallId),
    ).toEqual(['c1']);
  });
});

// ─── 2. Allowed, recorded; no gate; nesting; concurrency ─────────────────

describe('the record of an inner call', () => {
  it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
    'the gate and the row hold in every chart shape (%s)',
    async (reactMode) => {
      const secret = target();
      const compose = composer('secret');
      const agent = Agent.create({
        provider: mock({ replies: composeThen() }),
        model: 'm',
        reactMode,
        permissionChecker: denySecret(),
      })
        .tools([secret.tool, compose.tool])
        .build();
      await agent.run({ message: 'go' });

      expect(secret.entered).toEqual([]);
      expect(rows(agent).map((r) => [r.toolCallId, r.ended, r.refusedBy])).toEqual([
        ['c1#inner-1', 'refused', 'permission'],
      ]);
    },
  );

  it('an allowed inner call runs, leaves the gates’ events under its id, and one row — no tool brackets', async () => {
    const secret = target();
    const compose = composer('secret');
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checkerOf(() => ({ result: 'allow' })),
    })
      .tools([secret.tool, compose.tool])
      .toolMiddleware({ name: 'ok', onToolCall: () => allow() })
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([{ account: 'A1' }]);
    expect(compose.told).toEqual(['ran: secret-done']);
    expect(seen.of('permission.check').map((e) => e.payload.toolCallId)).toEqual([
      'c1',
      'c1#inner-1',
    ]);
    expect(seen.of('middleware.decision').map((e) => e.payload.toolCallId)).toEqual([
      'c1',
      'c1#inner-1',
    ]);
    // The model made one call: one bracket, never one for the inner call.
    expect(seen.of('stream.tool_start').map((e) => e.payload.toolCallId)).toEqual(['c1']);
    expect(seen.of('stream.tool_end').map((e) => e.payload.toolCallId)).toEqual(['c1']);
    expect(rows(agent)).toEqual([
      {
        toolCallId: 'c1#inner-1',
        outerToolCallId: 'c1',
        toolName: 'secret',
        iteration: 1,
        args: { account: 'A1' },
        entered: true,
        ended: 'returned',
      },
    ]);
  });

  it('with no gate configured the inner call runs as before, and still leaves its row', async () => {
    const secret = target();
    const compose = composer('secret');
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([secret.tool, compose.tool])
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([{ account: 'A1' }]);
    expect(seen.of('permission.check')).toEqual([]);
    expect(seen.of('middleware.decision')).toEqual([]);
    expect(rows(agent).map((r) => [r.toolCallId, r.entered, r.ended])).toEqual([
      ['c1#inner-1', true, 'returned'],
    ]);
  });

  it('a tool that throws was entered, and its row says it threw', async () => {
    const failing = defineTool<Record<string, unknown>, string>({
      name: 'secret',
      description: 'fails',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        throw new Error('backend 500');
      },
    });
    const compose = composer('secret', {});
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([failing, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(compose.told).toEqual(['refused: backend 500']);
    expect(rows(agent).map((r) => [r.entered, r.ended, r.refusedBy])).toEqual([
      [true, 'threw', undefined],
    ]);
  });

  it('a pause the inner tool raises passes up as the outer call’s pause, and its row says paused', async () => {
    const asking = defineTool<Record<string, unknown>, string>({
      name: 'secret',
      description: 'asks a person',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        pauseHere({ question: 'may I?' });
        return 'unreachable';
      },
    });
    const compose = defineTool<Record<string, unknown>, string>({
      name: 'compose',
      description: 'composes',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => String(await ctx.tools!.call('secret', {})),
    });
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([asking, compose])
      .build();
    const out = await agent.run({ message: 'go' });

    expect(isPaused(out)).toBe(true);
    expect(rows(agent).map((r) => [r.toolCallId, r.entered, r.ended])).toEqual([
      ['c1#inner-1', true, 'paused'],
    ]);
  });

  it('a call inner dispatch itself refuses is recorded as not entered', async () => {
    const compose = composer('no_such_tool', {});
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(compose.told[0]).toContain("ctx.tools.call('no_such_tool')");
    expect(rows(agent)).toEqual([
      expect.objectContaining({
        toolCallId: 'c1#inner-1',
        toolName: 'no_such_tool',
        entered: false,
        ended: 'refused',
        refusedBy: 'dispatch',
      }),
    ]);
  });

  it('an inner tool has no ctx.tools of its own — composition depth stops at one', async () => {
    const depth: string[] = [];
    const middle = defineTool<Record<string, unknown>, string>({
      name: 'middle',
      description: 'tries to compose again',
      inputSchema: { type: 'object', properties: {} },
      execute: (_args, ctx) => {
        depth.push(ctx.tools === undefined ? 'no ctx.tools' : 'has ctx.tools');
        return 'middle-done';
      },
    });
    const compose = composer('middle', {});
    const agent = Agent.create({ provider: mock({ replies: composeThen() }), model: 'm' })
      .tools([middle, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(depth).toEqual(['no ctx.tools']);
    expect(rows(agent).map((r) => r.toolCallId)).toEqual(['c1#inner-1']);
  });

  it('two inner calls at once get different ids, each gated and recorded', async () => {
    const secret = target();
    const checker = checkerOf(() => ({ result: 'allow' }));
    const parallel = defineTool<Record<string, unknown>, string>({
      name: 'compose',
      description: 'two inner calls at once',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        const results = await Promise.all([
          ctx.tools!.call('secret', { account: 'A1' }),
          ctx.tools!.call('secret', { account: 'B2' }),
        ]);
        return results.join(',');
      },
    });
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, parallel])
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });

    expect(secret.entered).toHaveLength(2);
    expect(seen.of('permission.check').map((e) => e.payload.toolCallId)).toEqual([
      'c1',
      'c1#inner-1',
      'c1#inner-2',
    ]);
    expect(rows(agent).map((r) => [r.toolCallId, r.args.account])).toEqual([
      ['c1#inner-1', 'A1'],
      ['c1#inner-2', 'B2'],
    ]);
  });

  it('an inner call on a resumed run passes the gates too', async () => {
    const secret = target();
    const told: string[] = [];
    const approved = defineTool<Record<string, unknown>, string>({
      name: 'compose',
      description: 'needs a person, then composes',
      inputSchema: { type: 'object', properties: {} },
      checkIn: 'always',
      execute: async (_args, ctx) => {
        try {
          return String(await ctx.tools!.call('secret', { account: 'A1' }));
        } catch (err) {
          told.push((err as Error).message);
          return 'refused';
        }
      },
    });
    const checker = denySecret();
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, approved])
      .build();
    const paused = await agent.run({ message: 'go' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'ops' }));

    expect(secret.entered).toEqual([]);
    expect(told[0]).toContain('permission check');
    expect(checker.asked).toEqual(['tool_call:compose', 'tool_call:secret']);
    expect(rows(agent).map((r) => [r.toolCallId, r.refusedBy])).toEqual([
      ['c1#inner-1', 'permission'],
    ]);
  });
});

describe('the row under a redaction policy', () => {
  it('under conversationRedaction() the rows are kept out by their key; the gates’ events stay', async () => {
    const secret = target();
    const compose = composer('secret', { account: 'MARKER-INNER-7' });
    const agent = Agent.create({
      provider: mock({ replies: composeThen() }),
      model: 'm',
      redact: conversationRedaction(),
      permissionChecker: checkerOf(() => ({ result: 'allow' })),
    })
      .tools([secret.tool, compose.tool])
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'go' });
    recorder.stop();

    // The tool ran with the real value; the record never holds it.
    expect(secret.entered).toEqual([{ account: 'MARKER-INNER-7' }]);
    const recording = recorder.toRecording();
    expect(JSON.stringify(recording)).not.toContain('MARKER-INNER-7');
    // Two permission checks were made — the outer call's and the inner call's.
    const checks = (recording.events as unknown as { type: string }[]).filter(
      (e) => e.type === 'agentfootprint.permission.check',
    );
    expect(checks).toHaveLength(2);
  });
});
