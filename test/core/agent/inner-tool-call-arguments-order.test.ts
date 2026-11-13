/**
 * An inner call (`ctx.tools.call`): what the gates judge is what runs, in the
 * model call's order.
 *
 *   - ONE detached copy of the arguments is taken before the first await; the
 *     gates, the refusals, the row and the tool all get it, so a composing tool
 *     that writes into its object afterwards changes nothing that runs;
 *   - arguments that are not an object are refused with the schema check's own
 *     sentence, with or without a gate — no gate turns them into `{}`;
 *   - an inner `read_skill` is asked the checker's `skill_read` question, so a
 *     hidden skill's text never reaches the model through a composing tool;
 *   - a `ctx.tools` used after its outer call ended is refused, with a row;
 *   - gate, middleware and dispatch refusals come in the model call's order;
 *   - what the checker is handed: the outer call's history and iteration, a
 *     frozen copy; and a walker that fails refuses with its own sentence.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  checkInApproved,
  defineTool,
  deny,
  isCheckInPause,
  type Tool,
  type ToolExecutionContext,
  type ToolMiddleware,
} from '../../../src/index.js';
import { defineSkill } from '../../../src/doors/context.js';
import { mock } from '../../../src/llm-providers.js';
import type { PermissionChecker } from '../../../src/provider-contract/types.js';
import {
  callThen,
  checkerOf,
  composing,
  decisions,
  events,
  rows,
  target,
} from './fixtures/innerCalls.js';

const later = () => new Promise((resolve) => setTimeout(resolve, 5));

const denyA1 = () =>
  checkerOf(async (req) => {
    await later();
    return req.target === 'secret' && (req.context as { account?: string }).account === 'A1'
      ? { result: 'deny', rationale: 'A1 is closed' }
      : { result: 'allow' };
  });

const denyA1Link: ToolMiddleware = {
  name: 'closed-accounts',
  onToolCall: async (call) => {
    await later();
    return call.toolName === 'secret' && call.args.account === 'A1'
      ? deny('A1 is closed')
      : allow();
  },
};

describe('what the gates judged is what runs', () => {
  it.each(['the permission checker', 'the tool middleware'] as const)(
    'a composing tool that writes into its object after the call cannot change what %s judged',
    async (gate) => {
      const secret = target();
      const compose = composing(async (_call, ctx) => {
        const args = { account: 'ok' };
        const pending = ctx.tools!.call('secret', args);
        args.account = 'A1'; // after the call returned its promise
        await pending;
      });
      const builder = Agent.create({
        provider: mock({ replies: callThen() }),
        model: 'm',
        ...(gate === 'the permission checker' && { permissionChecker: denyA1() }),
      }).tools([secret.tool, compose.tool]);
      const agent = (
        gate === 'the tool middleware' ? builder.toolMiddleware(denyA1Link) : builder
      ).build();
      await agent.run({ message: 'go' });

      expect(secret.entered).toEqual([{ account: 'ok' }]);
      expect(rows(agent).map((r) => r.args)).toEqual([{ account: 'ok' }]);
    },
  );

  it('one object reused for several calls runs each call with the value it had when made', async () => {
    const secret = target();
    const compose = composing(async (_call, ctx) => {
      const args: Record<string, unknown> = {};
      const pending: Promise<unknown>[] = [];
      for (const account of ['B1', 'B2', 'A1']) {
        args.account = account;
        pending.push(ctx.tools!.call('secret', args).catch(() => undefined));
      }
      await Promise.all(pending);
    });
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: denyA1(),
    })
      .tools([secret.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([{ account: 'B1' }, { account: 'B2' }]);
  });
});

describe('arguments that are not an object', () => {
  const gates = {
    'no gate': {},
    'a checker': { permissionChecker: checkerOf(() => ({ result: 'allow' })) },
    'a middleware': { middleware: true },
    'both gates': { permissionChecker: checkerOf(() => ({ result: 'allow' })), middleware: true },
  } as const;

  it.each(
    Object.entries(gates).flatMap(([label, config]) =>
      (
        [
          ['a string', 'A1', 'string'],
          ['an array', ['A1'], 'array'],
          ['null', null, 'null'],
        ] as const
      ).map(([kind, value, typeName]) => [kind, label, config, value, typeName] as const),
    ),
  )(
    '%s is refused with %s, with the schema check’s own sentence',
    async (_k, _l, config, value, typeName) => {
      const secret = target();
      const compose = composing(async (call) => call('secret', value));
      const link: ToolMiddleware = { name: 'pass', onToolCall: () => allow() };
      const builder = Agent.create({
        provider: mock({ replies: callThen() }),
        model: 'm',
        ...('permissionChecker' in config && { permissionChecker: config.permissionChecker }),
      }).tools([secret.tool, compose.tool]);
      const agent = ('middleware' in config ? builder.toolMiddleware(link) : builder).build();
      const seen = events(agent);
      await agent.run({ message: 'go' });

      expect(secret.entered).toEqual([]);
      expect(compose.told).toEqual([
        `refused: Invalid arguments for tool 'secret' — the call was not executed.\n` +
          `- arguments: expected object, got ${typeName}\n` +
          `Fix the arguments to match the tool's input schema and call it again.`,
      ]);
      // No gate was asked about a call that cannot run.
      expect(seen.of('permission.check').map((e) => e.payload.toolCallId)).not.toContain(
        'c1#inner-1',
      );
      expect(decisions(agent).map((d) => d.toolCallId)).not.toContain('c1#inner-1');
      expect(rows(agent).map((r) => [r.args, r.ended, r.refusedBy])).toEqual([
        [{}, 'refused', 'dispatch'],
      ]);
    },
  );

  it('no arguments at all run as the empty object', async () => {
    const received: unknown[] = [];
    const bare = defineTool<Record<string, unknown>, string>({
      name: 'secret',
      description: 'records what it is handed',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        received.push(args);
        return 'done';
      },
    });
    const compose = composing(async (call) => call('secret'));
    const agent = Agent.create({ provider: mock({ replies: callThen() }), model: 'm' })
      .tools([bare, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(received).toEqual([{}]);
  });

  it('arguments no copy can be made of are refused by name', async () => {
    const secret = target();
    const compose = composing(async (call) => call('secret', { account: 'A1', run: () => 1 }));
    const agent = Agent.create({ provider: mock({ replies: callThen() }), model: 'm' })
      .tools([secret.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(compose.told[0]).toMatch(
      /^refused: ctx\.tools\.call\('secret'\): its arguments could not be copied/,
    );
    expect(rows(agent)[0]?.refusedBy).toBe('dispatch');
  });
});

describe('an inner read_skill', () => {
  /** A generic composer: the MODEL picks the inner tool and its arguments. */
  const router = () =>
    defineTool<{ tool: string; args: Record<string, unknown> }, string>({
      name: 'run_tool',
      description: 'runs another tool',
      inputSchema: {
        type: 'object',
        properties: { tool: { type: 'string' }, args: { type: 'object' } },
        required: ['tool'],
      },
      execute: async ({ tool, args }, ctx) => {
        try {
          return `ran: ${String(await ctx.tools!.call(tool, args ?? {}))}`;
        } catch (err) {
          return `refused: ${(err as Error).message}`;
        }
      },
    });

  it.each([true, false])(
    'is asked the skill_read question (direct=%s): a hidden skill’s text never reaches the model',
    async (direct) => {
      const checker: PermissionChecker & { asked: string[] } = {
        ...checkerOf((req) =>
          req.capability === 'skill_read' && req.target === 'skill:secret'
            ? { result: 'deny', rationale: 'role may not read secret' }
            : { result: 'allow' },
        ),
        governs: ['skill_read'],
      };
      const call = direct
        ? { id: 'c1', name: 'read_skill', args: { id: 'secret' } }
        : { id: 'c1', name: 'run_tool', args: { tool: 'read_skill', args: { id: 'secret' } } };
      const agent = Agent.create({
        provider: mock({ replies: [{ toolCalls: [call] }, { content: 'done' }] }),
        model: 'm',
        permissionChecker: checker,
      })
        .tool(router())
        .skill(
          defineSkill({
            id: 'secret',
            description: 'S',
            body: 'SUPER_SECRET_PROCEDURE_TEXT',
            surfaceMode: 'tool-only',
          }),
        )
        .build();
      const seen = events(agent);
      await agent.run({ message: 'go' });

      const served = seen.of('stream.tool_end').map((e) => String(e.payload.result));
      expect(served.join('\n')).not.toContain('SUPER_SECRET_PROCEDURE_TEXT');
      const skillChecks = seen
        .of('permission.check')
        .filter((e) => e.payload.capability === 'skill_read')
        .map((e) => [e.payload.toolCallId, e.payload.target, e.payload.result]);
      expect(skillChecks).toEqual([[direct ? 'c1' : 'c1#inner-1', 'skill:secret', 'deny']]);
      if (!direct) {
        expect(served[0]).toMatch(
          /^refused: ctx\.tools\.call\('read_skill'\): the permission check/,
        );
        expect(rows(agent).map((r) => [r.toolName, r.refusedBy])).toEqual([
          ['read_skill', 'permission'],
        ]);
      }
    },
  );
});

describe('a ctx.tools used after its outer call ended', () => {
  function keeperAndLate() {
    const secret = target();
    let kept: { call: (n: string, a: unknown) => Promise<unknown> } | undefined;
    const told: string[] = [];
    const keeper = defineTool<Record<string, unknown>, string>({
      name: 'keeper',
      description: 'keeps its ctx.tools',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_a, ctx) => {
        kept = ctx.tools as never;
        return 'kept';
      },
    });
    const late = defineTool<Record<string, unknown>, string>({
      name: 'late',
      description: 'uses the kept ctx.tools',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        try {
          told.push(`ran: ${String(await kept!.call('secret', { account: 'B1' }))}`);
        } catch (err) {
          told.push(`refused: ${(err as Error).message}`);
        }
        return told[0]!;
      },
    });
    return { secret, keeper, late, told };
  }

  it('is refused by name in a later iteration, and nothing is asked or run', async () => {
    const { secret, keeper, late, told } = keeperAndLate();
    const checker = checkerOf(() => ({ result: 'allow' }));
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'keeper', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'late', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, keeper, late])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(told[0]).toMatch(
      /^refused: ctx\.tools\.call\('secret'\): this ctx\.tools belonged to tool call 'c1', which has ended/,
    );
    expect(checker.asked).toEqual(['tool_call:keeper', 'tool_call:late']);
  });

  it('leaves a row that says so while the outer call’s stage is still open', async () => {
    const { secret, keeper, late } = keeperAndLate();
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'c1', name: 'keeper', args: {} },
              { id: 'c2', name: 'late', args: {} },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'm',
    })
      .tools([secret.tool, keeper, late])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(rows(agent).map((r) => [r.toolCallId, r.entered, r.ended, r.refusedBy])).toEqual([
      ['c1#inner-1', false, 'refused', 'ended'],
    ]);
  });
});

describe('refusals come in the model call’s order', () => {
  it('a name the map does not hold is put to the checker first, as a model call’s is', async () => {
    const compose = composing(async (call) => call('no_such_tool', {}));
    const checker = checkerOf(() => ({ result: 'allow' }));
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(checker.asked).toEqual(['tool_call:compose', 'tool_call:no_such_tool']);
    expect(compose.told[0]).toContain('no tool of that name');
    expect(rows(agent)[0]?.refusedBy).toBe('dispatch');
  });

  it('the middleware is walked before a check-in tool is refused, for the inner call as for the model’s', async () => {
    const approve = target('approve_me', { checkIn: 'always' } as Partial<Tool>);
    const compose = composing(async (call) => call('approve_me', { account: 'A1' }));
    const link: ToolMiddleware = {
      name: 'closed',
      onToolCall: (call) => (call.toolName === 'approve_me' ? deny('closed') : allow()),
    };
    const agent = Agent.create({ provider: mock({ replies: callThen() }), model: 'm' })
      .tools([approve.tool, compose.tool])
      .toolMiddleware(link)
      .build();
    await agent.run({ message: 'go' });

    expect(compose.told[0]).toContain('the tool middleware refused this inner call');
    expect(rows(agent)[0]?.refusedBy).toBe('middleware');
  });

  it('a check-in tool the middleware lets through is refused after the chain’s row', async () => {
    const approve = target('approve_me', { checkIn: 'always' } as Partial<Tool>);
    const compose = composing(async (call) => call('approve_me', { account: 'A1' }));
    const link: ToolMiddleware = { name: 'open', onToolCall: () => allow() };
    const agent = Agent.create({ provider: mock({ replies: callThen() }), model: 'm' })
      .tools([approve.tool, compose.tool])
      .toolMiddleware(link)
      .build();
    await agent.run({ message: 'go' });

    expect(compose.told[0]).toContain('declares a human check-in');
    expect(rows(agent)[0]?.refusedBy).toBe('dispatch');
    expect(decisions(agent).map((d) => [d.toolCallId, d.outcome])).toEqual([
      ['c1', 'allow'],
      ['c1#inner-1', 'allow'],
    ]);
  });
});

describe('what the inner call’s checker is handed', () => {
  it('the outer call’s history and iteration, and a frozen copy of the arguments', async () => {
    const secret = target();
    const compose = composing(async (call) => call('secret', { account: 'A1' }));
    const checker = checkerOf(() => ({ result: 'allow' }));
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    const [outer, inner] = checker.requests;
    expect(inner?.iteration).toBe(outer?.iteration);
    expect(inner?.history).toEqual(outer?.history);
    expect((inner?.history ?? []).length).toBeGreaterThan(0);
    expect(inner?.context).toEqual({ account: 'A1' });
    expect(Object.isFrozen(inner?.context)).toBe(true);
  });

  it('on a resumed run, the committed history and the outer call’s iteration', async () => {
    const secret = target();
    const approved = {
      ...target('compose').tool,
      checkIn: 'always' as const,
      execute: async (_a: Record<string, unknown>, ctx: ToolExecutionContext) =>
        String(await ctx.tools!.call('secret', { account: 'A1' })),
    };
    const checker = checkerOf(() => ({ result: 'allow' }));
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, approved as never])
      .build();
    const paused = await agent.run({ message: 'go' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'ops' }));

    const inner = checker.requests.find((r) => r.target === 'secret');
    expect(inner?.iteration).toBe(1);
    const proposed = (inner?.history ?? []).flatMap((m) => m.toolCalls ?? []).map((c) => c.id);
    expect(proposed).toEqual(['c1']);
  });

  it('a walker that fails on an answer it cannot read refuses with its own sentence, and files no chain row', async () => {
    const secret = target();
    const compose = composing(async (call) => call('secret', { account: 'A1' }));
    const silent: ToolMiddleware = {
      name: 'silent',
      onToolCall: (call) => (call.toolName === 'secret' ? (undefined as never) : allow()),
    };
    const agent = Agent.create({ provider: mock({ replies: callThen() }), model: 'm' })
      .tools([secret.tool, compose.tool])
      .toolMiddleware(silent)
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([]);
    expect(compose.told[0]).toBe(
      "refused: ctx.tools.call('secret'): the tool middleware refused this inner call, so the " +
        'tool did not run: the gate gave no answer, and no answer is not an allow.',
    );
    expect(decisions(agent).map((d) => d.toolCallId)).toEqual(['c1']);
    expect(rows(agent)[0]?.refusedBy).toBe('middleware');
  });

  it('ids are taken when the call is made, not when its gates answer', async () => {
    const secret = target();
    const checker = checkerOf(async (req) => {
      // The first call's check answers last.
      if ((req.context as { account?: string }).account === 'A1') await later();
      return { result: 'allow' };
    });
    const compose = composing(async (_call, ctx) => {
      await Promise.all([
        ctx.tools!.call('secret', { account: 'A1' }),
        ctx.tools!.call('secret', { account: 'B2' }),
      ]);
    });
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toEqual([{ account: 'B2' }, { account: 'A1' }]);
    const byId = Object.fromEntries(rows(agent).map((r) => [r.toolCallId, r.args.account]));
    expect(byId).toEqual({ 'c1#inner-1': 'A1', 'c1#inner-2': 'B2' });
  });
});
