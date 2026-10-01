/**
 * The inputs layer (honesty layer 2), `assume` only — end to end through real
 * agents on a scripted provider.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL   — a missing ruled argument is FILLED by the library (never the
 *                    tool): the `default` row, the note on the result, the event,
 *                    `tool_start` keeps the proposal, `tool_end.changedArgKeys`
 *                    names the key, permission sees the completed arguments; a
 *                    model that sends the default files `default` with
 *                    `proposed`; any other value files `model`;
 *   - INTEGRATION  — both chart shapes; the served schema; the fold's reasons; a
 *                    continued conversation (the turn stamp, the widened restore);
 *                    `.limitsTravelWithTheAnswer()`'s "Assumed" block; the
 *                    fail-closed refusal of a provider-only ruled tool without
 *                    `.inputsLayer()` and its fill with it; a hand-built rule the
 *                    dispatch re-read refuses; inner dispatch; a middleware
 *                    rewrite with and without a declared origin;
 *   - SECURITY     — a tool whose argument view hides the ruled argument: no raw
 *                    value on the row, the event (no `valueChars`) or the note;
 *   - LOAD         — a wide batch files ONE ledger merge per layer run.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  allow,
  defineTool,
  type AgentRunResult,
  type Tool,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { staticTools } from '../../../../src/tool-providers/index.js';
import type { LLMRequest, LLMResponse, PermissionChecker } from '../../../../src/adapters/types.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { _resetUnmountedRulesWarnings } from '../../../../src/core/agent/arguments/dispatch.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'inputs-layer-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const call = (id: string, name: string, args: object): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const SCHEMA = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string', description: 'Service name.' },
    window: { type: 'string', enum: ['1h', '2h', '24h', '7d'], description: 'Look-back period.' },
  },
} as const;

function searchLogs(ran: Record<string, unknown>[], extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: SCHEMA,
    askOrAssume: { window: { assume: '2h' } },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, errors: 0 };
    },
  });
  return { ...tool, ...extra } as Tool;
}

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');

type Event = { type: string; payload: Record<string, unknown> };

function events(agent: Agent): Event[] {
  const out: Event[] = [];
  agent.on('*', (e) => out.push({ type: e.type, payload: e.payload as never }));
  return out;
}

afterEach(() => {
  _resetUnmountedRulesWarnings();
  vi.restoreAllMocks();
});

// ─── FUNCTIONAL ──────────────────────────────────────────────────────

describe('assume — a missing ruled argument is filled by the library', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`fills, files, notes and admits it (${reactMode})`, async () => {
      const ran: Record<string, unknown>[] = [];
      const m = scripted([
        call('c1', 'search_logs', { service: 'checkout' }),
        answer('No errors.'),
      ]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm', reactMode })
        .tool(searchLogs(ran))
        .build();
      const seen = events(agent);
      await agent.run({ message: 'any errors on checkout?' });

      // The TOOL ran with the declared default — the library filled it.
      expect(ran).toEqual([{ service: 'checkout', window: '2h' }]);

      // One row, stamped with the turn, the fill has no proposal.
      expect(argumentRows(agent)).toEqual([
        {
          kind: 'argument',
          turn: 1,
          toolCallId: 'c1',
          toolName: 'search_logs',
          iteration: 1,
          argument: 'window',
          rule: 'assume',
          period: true,
          source: 'default',
          value: '2h',
        },
      ]);

      // One event, names and enums only.
      const argEvents = seen.filter((e) => e.type === 'agentfootprint.findings.argument');
      expect(argEvents.map((e) => e.payload)).toEqual([
        {
          toolCallId: 'c1',
          toolName: 'search_logs',
          iteration: 1,
          turn: 1,
          argument: 'window',
          rule: 'assume',
          period: true,
          source: 'default',
          valueChars: 2,
        },
      ]);

      // `tool_start` keeps the model's proposal; `tool_end` names the filled key.
      const start = seen.find((e) => e.type === 'agentfootprint.stream.tool_start')!;
      expect(start.payload.args).toEqual({ service: 'checkout' });
      const end = seen.find((e) => e.type === 'agentfootprint.stream.tool_end')!;
      expect(end.payload.changedArgKeys).toEqual(['window']);

      // The model read the note on the result; `toolChars` never reached the wire.
      const toolMessage = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
      expect(toolMessage.content).toBe(
        '{"service":"checkout","errors":0}\n\n[window was not in the search_logs call this ' +
          'result answers; the call ran with "2h", the value the tool\'s rule assumes — recorded ' +
          "as assumed, not as the person's.]",
      );
      expect(toolMessage).not.toHaveProperty('toolChars');

      // …while the committed history message carries the tool-bytes boundary.
      const history = agent.getSnapshot()!.sharedState.history as {
        role: string;
        toolChars?: number;
        content: string;
      }[];
      const committed = history.find((msg) => msg.role === 'tool')!;
      expect(committed.toolChars).toBe('{"service":"checkout","errors":0}'.length);

      // The standing names the assumption. (Honesty step 7b: search_logs declares
      // a ToolPeriod and its result declares no period, so the results layer
      // files `undeclared` beside it — declared silence, recorded as silence.)
      const standing = (await agent.assessment())!;
      expect(standing.standing).toBe('not-sure');
      expect(standing.reasons.map((r) => r.reason)).toEqual([
        'argument-assumed',
        'period-undeclared',
      ]);
      expect(standing.checked.find((c) => c.check === 'argument-rules')).toMatchObject({
        layer: 2,
        ran: 1,
        of: 1,
      });
    });
  }

  it('serves the ruled schema without the argument in `required`, saying the rule', async () => {
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('ok')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'go' });
    for (const req of m.requests) {
      const served = req.tools!.find((t) => t.name === 'search_logs')!;
      expect(served.inputSchema.required).toEqual(['service']);
      const window = (served.inputSchema.properties as Record<string, { description: string }>)
        .window!;
      expect(window.description).toBe(
        'Look-back period. If left out, the tool\'s rule fills "2h", recorded as assumed.',
      );
    }
  });

  it('a model that sends the default itself files `default` with `proposed` — and gets no note', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      call('c1', 'search_logs', { service: 'checkout', window: '2h' }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .build();
    await agent.run({ message: 'any errors?' });
    expect(ran).toEqual([{ service: 'checkout', window: '2h' }]);
    expect(argumentRows(agent)).toMatchObject([{ source: 'default', value: '2h', proposed: '2h' }]);
    const toolMessage = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(toolMessage.content).toBe('{"service":"checkout","errors":0}');
    // (+ `period-undeclared`, step 7b: a ToolPeriod tool whose result declares no period.)
    expect((await agent.assessment())!.reasons.map((r) => r.reason)).toEqual([
      'argument-assumed',
      'period-undeclared',
    ]);
  });

  it('a model that sends another value files `model` — the standing says the record cannot trace it', async () => {
    const m = scripted([
      call('c1', 'search_logs', { service: 'checkout', window: '24h' }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'any errors today?' });
    expect(argumentRows(agent)).toMatchObject([{ source: 'model', value: '24h' }]);
    expect(argumentRows(agent)[0]).not.toHaveProperty('proposed');
    const standing = (await agent.assessment())!;
    // (+ `period-undeclared`, step 7b: a ToolPeriod tool whose result declares no period.)
    expect(standing.reasons.map((r) => r.reason)).toEqual([
      'argument-unverified',
      'period-undeclared',
    ]);
  });

  it('permission judges the COMPLETED arguments — the call that will really run', async () => {
    const judged: unknown[] = [];
    const checker: PermissionChecker = {
      name: 'records-args',
      check: (req) => {
        if (req.capability === 'tool_call') judged.push(req.context);
        return { result: 'allow' };
      },
    };
    const m = scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('ok')]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      permissionChecker: checker,
    })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'go' });
    expect(judged).toEqual([{ service: 'checkout', window: '2h' }]);
  });

  it('a batch Route will not dispatch files nothing (out of iterations)', async () => {
    const m = scripted([
      call('c1', 'search_logs', { service: 'a' }),
      call('c2', 'search_logs', { service: 'b' }),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      maxIterations: 2,
      wrapUpAtMaxIterations: false,
    })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'go' });
    // Iteration 1 dispatched (one row); the second batch went to the final branch.
    expect(argumentRows(agent).map((r) => r.toolCallId)).toEqual(['c1']);
  });
});

// ─── INTEGRATION ─────────────────────────────────────────────────────

describe('assume — across turns (the turn stamp and the widened restore)', () => {
  it('turn 2 that never calls the ruled tool folds without turn 1’s default row', async () => {
    const first = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await first.run({ message: 'errors on a?' });
    const cp = first.checkpoint()!;
    // An agent WITHOUT .findings() still carries its argument rows — and, since
    // step 7b, the results layer's period row for the same call.
    expect(cp.findingsLedger?.map((r) => r.kind)).toEqual(['argument', 'period']);

    const second = Agent.create({
      provider: scripted([answer('hello again')]).provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await second.run({ message: 'thanks', continueFrom: cp });
    // Restored as a record…
    expect(argumentRows(second)).toEqual(argumentRows(first));
    // …and the fold reads THIS turn only: nothing assumed in turn 2.
    const standing = (await second.assessment())!;
    expect(standing.reasons.map((r) => r.reason)).not.toContain('argument-assumed');
    expect(standing.checked.map((c) => c.check)).not.toContain('argument-rules');
  });

  it('turn 2 that calls it again files a row stamped with turn 2', async () => {
    const first = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await first.run({ message: 'errors on a?' });
    const second = Agent.create({
      provider: scripted([call('c9', 'search_logs', { service: 'b' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await second.run({ message: 'and on b?', continueFrom: first.checkpoint()! });
    expect(argumentRows(second).map((r) => [r.toolCallId, r.turn])).toEqual([
      ['c1', 1],
      ['c9', 2],
    ]);
  });

  it('under .findings(), every row the one writer files carries the turn', async () => {
    const m = scripted([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'search_logs',
            args: { service: 'a', _findings: { basis: 'direct' } },
          },
        ],
      },
      answer('none'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .findings()
      .build();
    await agent.run({ message: 'go' });
    const rows = agent.findings() ?? [];
    expect(rows.map((r) => [r.kind, r.turn])).toEqual([
      ['argument', 1],
      ['basis', 1],
      // The results layer's verdict on the batch (step 7b), filed at the loop head.
      ['period', 1],
    ]);
  });
});

describe('assume — the "Assumed" block under .limitsTravelWithTheAnswer()', () => {
  it('appends one line per assumed value; the answer is unchanged with nothing assumed', async () => {
    const withFill = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .limitsTravelWithTheAnswer()
      .build();
    const out = (await withFill.run({ message: 'go' })) as AgentRunResult;
    expect(String(out)).toBe(
      'No errors.\n\n---\n\nAssumed (a tool\'s rule, not your words):\n- window = "2h" (search_logs)',
    );

    const noFill = Agent.create({
      provider: scripted([
        call('c1', 'search_logs', { service: 'a', window: '24h' }),
        answer('No errors.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .limitsTravelWithTheAnswer()
      .build();
    expect(String(await noFill.run({ message: 'go' }))).toBe('No errors.');
  });
});

describe('assume — fail closed, and the dispatch re-read', () => {
  it('a ruled tool only a ToolProvider serves is REFUSED without .inputsLayer(), with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .toolProvider(staticTools([searchLogs(ran)]))
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });
    expect(ran).toEqual([]);
    const toolMessage = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(toolMessage.content).toBe(
      'search_logs was not run on that call: it declares argument rules this agent was not built to apply.',
    );
    const end = seen.find((e) => e.type === 'agentfootprint.stream.tool_end')!;
    expect(end.payload.error).toBe(true);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('.inputsLayer()'))).toHaveLength(1);
    // Unarmed: the schema was served as the author wrote it (a sentence
    // promising a fill would be false), and no row was filed.
    expect(m.requests[0]!.tools![0]!.inputSchema.required).toEqual(['service', 'window']);
    expect(agent.findings()).toBeUndefined();
  });

  it('with .inputsLayer(), the provider-served ruled tool is filled like a registered one', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('none')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .toolProvider(staticTools([searchLogs(ran)]))
      .inputsLayer()
      .build();
    await agent.run({ message: 'go' });
    expect(ran).toEqual([{ service: 'a', window: '2h' }]);
    expect(argumentRows(agent)).toMatchObject([{ source: 'default', argument: 'window' }]);
    expect(m.requests[0]!.tools![0]!.inputSchema.required).toEqual(['service']);
  });

  it('refuses .inputsLayer() twice', () => {
    const builder = Agent.create({
      provider: scripted([]).provider as never,
      model: 'm',
    }).inputsLayer();
    expect(() => builder.inputsLayer()).toThrow(/already set/);
  });

  it('a hand-built rule the dispatch re-read cannot read refuses the call — never repaired', async () => {
    const ran: Record<string, unknown>[] = [];
    const handBuilt = {
      ...searchLogs(ran),
      askOrAssume: { window: { assume: '9h' } }, // outside the enum — defineTool never saw it
    } as unknown as Tool;
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(handBuilt)
      .build();
    await agent.run({ message: 'go' });
    expect(ran).toEqual([]);
    const toolMessage = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(toolMessage.content).toMatch(
      /^search_logs was not run on that call: its argument rules could not be read \(askOrAssume\.window\.assume — "9h" fails the property's own schema/,
    );
    // Undecorated: a rule that cannot be read promises nothing on the wire.
    expect(m.requests[0]!.tools![0]!.inputSchema.required).toEqual(['service', 'window']);
  });

  it('inner dispatch refuses a ruled tool unless every ruled argument is given', async () => {
    let refused = '';
    const composer = defineTool({
      name: 'composer',
      description: 'calls search_logs through ctx.tools',
      execute: async (_args, ctx) => {
        try {
          await ctx.tools!.call('search_logs', { service: 'a' });
        } catch (error) {
          refused = (error as Error).message;
        }
        return await ctx.tools!.call('search_logs', { service: 'a', window: '1h' });
      },
    });
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'composer', {}), answer('done')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .tool(composer)
      .build();
    await agent.run({ message: 'go' });
    expect(refused).toMatch(
      /^ctx\.tools\.call\('search_logs'\): that tool declares argument rules/,
    );
    expect(refused).toContain("'window'");
    expect(ran).toEqual([{ service: 'a', window: '1h' }]);
    // Inner calls file no rows: the outer call is the accounted unit.
    expect(argumentRows(agent)).toEqual([]);
  });

  it('inner dispatch owes a window ONCE: one whole period form passes, the untaken form is not asked for', async () => {
    // A look-back OR a past window's bounds — the shape a composed walk hands
    // its windowed ingredient. Every period argument is ruled (the look-back
    // assumed, the bounds asked), and the tool itself refuses two windows; so
    // owing each one separately refused every call a composer could make.
    const ran: Record<string, unknown>[] = [];
    const activity = defineTool({
      name: 'client_activity',
      description: 'Client operations for one cluster over a look-back or a past window.',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string' },
          window: { type: 'string' },
          start: { type: 'string' },
          stop: { type: 'string' },
        },
        required: ['cluster'],
      },
      askOrAssume: {
        window: { assume: '1h' },
        start: { ask: 'From when?' },
        stop: { ask: 'Until when?' },
      },
      period: {
        forms: [
          { kind: 'lookback', argument: 'window', signed: false, units: 'mhdw' },
          {
            kind: 'bounds',
            from: { argument: 'start', as: 'iso', edge: 'inclusive' },
            to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
          },
        ],
        direction: 'past',
      },
      execute: async (args) => {
        ran.push({ ...args });
        return { rows: [] };
      },
    });
    const refused: string[] = [];
    const attempt = async (ctx: { tools?: { call: (n: string, a: object) => Promise<unknown> } }, args: object) => {
      try {
        await ctx.tools!.call('client_activity', args);
      } catch (error) {
        refused.push((error as Error).message);
      }
    };
    const bounds = { start: '2026-09-29T08:45:00-07:00', stop: '2026-09-29T08:55:00-07:00' };
    const composer = defineTool({
      name: 'walk',
      description: 'calls client_activity through ctx.tools',
      execute: async (_args, ctx) => {
        await attempt(ctx, { cluster: 'c', window: '6h' });
        await attempt(ctx, { cluster: 'c', ...bounds });
        await attempt(ctx, { cluster: 'c', start: bounds.start }); // half a window: no form whole
        await attempt(ctx, { cluster: 'c' }); // no window at all
        return 'done';
      },
    });
    const m = scripted([call('c1', 'walk', {}), answer('done')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(activity)
      .tool(composer)
      .build();
    await agent.run({ message: 'go' });
    expect(ran).toEqual([
      { cluster: 'c', window: '6h' },
      { cluster: 'c', ...bounds },
    ]);
    expect(refused).toHaveLength(2);
    expect(refused[0]).toContain("leaves 'window', 'stop' out");
    expect(refused[1]).toContain("leaves 'window', 'start', 'stop' out");
    expect(refused[1]).toContain('every argument of ONE of its forms');
    expect(argumentRows(agent)).toEqual([]);
  });
});

describe('assume — a before-tool middleware that rewrites a ruled argument', () => {
  const rewrite = (from?: { window: 'person' | 'default' | 'app' }): ToolMiddleware => ({
    name: 'absolute-window',
    onToolCall: (c) =>
      c.toolName === 'search_logs'
        ? from === undefined
          ? allow({ ...c.args, window: '24h' }, 'window from the receipt')
          : allow({ ...c.args, window: '24h' }, 'window from the receipt', { from })
        : allow(),
  });

  it('with no declared origin, the rewrite reads as assumed; the row names the changed keys', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a', window: '1h' }), answer('ok')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs(ran))
      .toolMiddleware(rewrite())
      .build();
    await agent.run({ message: 'go' });
    expect(ran).toEqual([{ service: 'a', window: '24h' }]);
    const rows = agent.getSnapshot()!.sharedState.middlewareDecisions as {
      changedKeys?: string[];
    }[];
    expect(rows.map((r) => r.changedKeys)).toEqual([['window']]);
    const standing = (await agent.assessment())!;
    // (+ `period-undeclared`, step 7b: a ToolPeriod tool whose result declares no period.)
    expect(standing.reasons.map((r) => r.reason)).toEqual([
      'argument-assumed',
      'period-undeclared',
    ]);
    expect(standing.reasons[0]!.witness[0]).toMatchObject({ key: 'middlewareDecisions' });
  });

  it("declared as the person's, the rewrite supersedes the model's row — no reason fires", async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a', window: '1h' }), answer('ok')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .toolMiddleware(rewrite({ window: 'person' }))
      .build();
    await agent.run({ message: 'go' });
    const rows = agent.getSnapshot()!.sharedState.middlewareDecisions as { from?: unknown }[];
    expect(rows[0]!.from).toEqual({ window: 'person' });
    const standing = (await agent.assessment())!;
    // No ARGUMENT reason fires: the person's value superseded the model's row.
    expect(standing.reasons.filter((r) => r.layer === 2)).toEqual([]);
    // What remains is the results layer's (step 7b): search_logs declares a
    // ToolPeriod and its result said nothing about the period its read covered.
    expect(standing.reasons.map((r) => r.reason)).toEqual(['period-undeclared']);
    expect(standing.standing).toBe('not-sure');
  });

  it('allow() refuses an origin outside the vocabulary', () => {
    expect(() => allow({ a: 1 }, 'why', { from: { a: 'guess' as never } })).toThrow(
      /'person', 'app' or 'default'/,
    );
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('assume — a tool whose argument view hides the ruled argument', () => {
  it('no raw value on the row, the event, the note or the served sentence', async () => {
    const hiding = {
      ...searchLogs([]),
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as unknown as Tool;
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('ok')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hiding)
      .build();
    const seen = events(agent);
    await agent.run({ message: 'go' });
    expect(argumentRows(agent)).toMatchObject([{ source: 'default', value: 'REDACTED' }]);
    const payload = seen.find((e) => e.type === 'agentfootprint.findings.argument')!.payload;
    expect(payload).not.toHaveProperty('valueChars');
    expect(JSON.stringify(payload)).not.toContain('2h');
    const toolMessage = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(toolMessage.content).toContain("the value is hidden by the tool's view");
    expect(toolMessage.content).not.toContain('"2h"');
    const window = (
      m.requests[0]!.tools![0]!.inputSchema.properties as Record<string, { description: string }>
    ).window!;
    expect(window.description).toContain("hidden by the tool's view");
    expect(window.description).not.toContain('"2h"');
  });
});

// ─── LOAD ────────────────────────────────────────────────────────────

describe('assume — one ledger merge per layer run, never one per call', () => {
  it('a 200-call batch writes the ledger once, with 200 rows', async () => {
    const calls = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      name: 'search_logs',
      args: { service: `s${i}` },
    }));
    const agent = Agent.create({
      provider: scripted([{ content: '', toolCalls: calls }, answer('none')]).provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'go' });
    expect(argumentRows(agent)).toHaveLength(200);
    const writes = agent
      .getSnapshot()!
      .commitLog.filter((bundle) =>
        (bundle.trace as readonly { path: string }[]).some((t) => t.path === 'findingsLedger'),
      );
    // ONE merge per layer run: the inputs layer's 200 argument rows, then — at
    // the loop head, step 7b — the results layer's 200 period rows (the tool
    // declares a ToolPeriod and no result declared a period).
    expect(writes).toHaveLength(2);
    expect((agent.findings() ?? []).filter((r) => r.kind === 'period')).toHaveLength(200);
  });
});
