/**
 * The inputs layer's declared sources (honesty layer 2, step 5) — end to end
 * through real agents on a scripted provider.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL   — the served schema carries `_findings.from` on RULED tools
 *                    only (first, and required), explained once in its own
 *                    property — no instruction line — under the arm only; a declared phrase makes "over the last week" check
 *                    out as `7d` and the call runs; an untraced value on an
 *                    `ask` argument is ASKED (the model's value never rides
 *                    the ask) and the answer's note says what the call had
 *                    carried; a reading asks with the person's own words as
 *                    `quoted`; the declared default stays a default whatever
 *                    the claim (V1); a failed claim on a free argument is
 *                    filed with no rule; the malformed `from` entries ride the
 *                    basis row, or the call's first argument row;
 *   - INTEGRATION  — a `Sequence` hands its second agent a composed message,
 *                    and a quote from it fails `composed-message` — so do
 *                    `workflow()` (a later step) and `graph()` (a child
 *                    node), where the `ask` argument is then asked; a period
 *                    answered in turn 1 as `24h` traces in turn 2 to a `-24h`
 *                    argument (`matched: 'spelling'`); a `turn` claim with no
 *                    earlier answer is no source; the app's `externalGrounds`
 *                    label rides `appSource`; the standing folds each verdict
 *                    (`argument-read`, `value-contingent`, `argument-unverified`,
 *                    `consistent` — never `known`); the arm is refused at build
 *                    without the inputs layer;
 *   - SECURITY     — laundering: a value only in the library's note (behind the
 *                    tool-bytes boundary) files `not-in-result` — while a
 *                    number in the tool's JSON BEFORE a framework note (the
 *                    repeated-call note) or in several MCP text blocks is
 *                    found; the library's own instructions are never the
 *                    app's text; a quote from a
 *                    library frame or an evicted turn is `quote-not-found`; a
 *                    hidden argument's quote, value and proposal read
 *                    `'REDACTED'`, the event carries no length and the ask no
 *                    `quoted`; a quote beside a call whose view hid ANOTHER
 *                    argument reads `'REDACTED'` too (free text may hold any
 *                    argument's value) — and so does a quote beside a call of
 *                    ANOTHER tool while a tool that hides arguments is in
 *                    reach (the same batch, a later turn, before the hiding
 *                    call) — and on an agent with a ToolProvider, whatever
 *                    the order (the hiding tool called in a later iteration,
 *                    listed for the first time after the quote, never called
 *                    before an ask; any provider counts, even one that lists
 *                    no hiding tool); the served note names no hidden value; a before-tool rewrite after the layer reads as
 *                    assumed; events never carry a value or a quote;
 *   - PERFORMANCE  — what `from` adds to a served request (recorded, not
 *                    claimed; the system prompt does not move), and the
 *                    checks' cost per batch;
 *   - LOAD         — 50 calls × 5 ruled arguments, each with a `from` entry:
 *                    250 rows in ONE ledger write.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  Sequence,
  defineTool,
  graph,
  isInputPause,
  isPaused,
  workflow,
  type AgentOutput,
  type RunnerPauseOutcome,
  type Tool,
} from '../../../../src/index.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import { allow } from '../../../../src/core/agent/middleware/outcomes.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import { checkSource } from '../../../../src/core/agent/arguments/checks.js';
import {
  FINDINGS_FROM_PROPERTY,
  FINDINGS_INSTRUCTION_ID,
} from '../../../../src/core/agent/findings/reserved.js';
import { sourceCorpusOf } from '../../../../src/core/agent/honesty/sourceCorpus.js';
import { mockMcpClient } from '../../../../src/lib/mcp/mockMcpClient.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { STEP_NUDGE_FRAME_PREFIX } from '../../../../src/lib/saidByPerson.js';

// ─── the harness ─────────────────────────────────────────────────────

type Call = { id: string; name: string; args: object };
type Reply = { content: string; toolCalls?: Call[] };

function scripted(script: readonly Reply[] | ((req: LLMRequest, i: number) => Reply)) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'sources-layer-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply =
          typeof script === 'function'
            ? script(req, i)
            : script[Math.min(i, script.length - 1)] ?? { content: 'done' };
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

const batch = (...calls: Call[]): Reply => ({ content: '', toolCalls: calls });
const answer = (content: string): Reply => ({ content });
const from = (...entries: object[]) => ({ basis: 'direct', from: entries });

/** A log search whose period the PERSON is asked for, with phrases on two choices. */
function askingSearch(ran: Record<string, unknown>[], extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: ['1h', '24h', '7d'], description: 'Look-back period.' },
      },
    },
    askOrAssume: {
      window: {
        ask: 'Which period should the error search cover?',
        choices: [
          { value: '24h', said: ['last 24 hours', 'past day'] },
          { value: '7d', said: ['last week', 'past week'] },
          '1h',
        ],
      },
    },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, window: args.window, errors: 0 };
    },
  });
  return { ...tool, ...extra } as Tool;
}

/** The same search, its period ASSUMED (`2h`), plus a free `service`. */
function assumingSearch(ran: Record<string, unknown>[]): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '2h', '24h', '7d'] },
      },
    },
    askOrAssume: { window: { assume: '2h' } },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, errors: 0 };
    },
  });
}

/** A network tool whose period is spelled as a negative offset, asked of the person. */
function netFlows(ran: Record<string, unknown>[]): Tool {
  return defineTool({
    name: 'net_flows',
    description: 'Flows for one host.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        range: { type: 'string', enum: ['-1h', '-24h', '-7d'] },
      },
    },
    askOrAssume: {
      range: { ask: 'Which period should the flow search cover?', choices: ['-1h', '-24h', '-7d'] },
    },
    period: { argument: 'range', spelling: 'signed-lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { host: args.host, flows: 3 };
    },
  });
}

const listHosts = defineTool({
  name: 'list_hosts',
  description: 'Hosts of one service.',
  inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
  execute: async () => ({ hosts: ['srv-4417', 'srv-2210'] }),
});

/** A tool with no rules — its `_findings` never carries `from`. */
const listServices = defineTool({
  name: 'list_services',
  description: 'Every service.',
  execute: async () => ({ services: ['checkout', 'payments'] }),
});

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');

type Event = { type: string; payload: Record<string, unknown> };
function events(agent: Agent): Event[] {
  const out: Event[] = [];
  agent.on('*', (e) => out.push({ type: e.type, payload: e.payload as never }));
  return out;
}

const replyTo = (out: AgentOutput | RunnerPauseOutcome, values: Record<string, unknown>) => {
  if (!isInputPause(out)) throw new Error(`expected the library's ask, got ${JSON.stringify(out)}`);
  return { requestId: out.awaitingInput.requestId, values };
};

const stored = (out: AgentOutput | RunnerPauseOutcome) => {
  if (!isPaused(out)) throw new Error('expected a pause');
  return JSON.parse(JSON.stringify(out.checkpoint)) as RunnerPauseOutcome['checkpoint'];
};

type Props = Record<string, { properties?: Record<string, unknown>; description?: string }>;
const findingsProperty = (req: LLMRequest, tool: string) =>
  (req.tools!.find((t) => t.name === tool)!.inputSchema.properties as Props)._findings!;

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── FUNCTIONAL ──────────────────────────────────────────────────────

describe('what the model is served — `from` on ruled tools only, explained once, only under the arm', () => {
  it('armed: a ruled tool’s `_findings` carries `from` first and required; an unruled tool’s does not; no instruction line', async () => {
    const m = scripted([answer('hi')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .tool(listServices)
      .findings({ argumentSources: true })
      .build();
    await agent.run({ message: 'hello' });
    const req = m.requests[0]!;
    const ruled = findingsProperty(req, 'search_logs') as {
      properties: Record<string, unknown>;
      required: string[];
      description: string;
    };
    expect(ruled.properties.from).toEqual(FINDINGS_FROM_PROPERTY);
    expect(Object.keys(ruled.properties)[0]).toBe('from');
    expect(ruled.required).toEqual(['basis', 'from']);
    expect(findingsProperty(req, 'list_services').properties!.from).toBeUndefined();
    // The first sentence of the decoration is unchanged — `withoutFindingsArgument` still knows it.
    expect(ruled.description).toMatch(/^Findings v1 \(reserved/);
    // Explained ONCE, in the property: the system prompt carries no sources line.
    expect(req.systemPrompt ?? '').not.toContain('_findings.from');
    expect(req.systemPrompt ?? '').not.toContain("'turn'");
  });

  it('unarmed `.findings()`: no `from` anywhere, no line — the served request is the bytes it was', async () => {
    const m = scripted([answer('hi')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings()
      .build();
    await agent.run({ message: 'hello' });
    const req = m.requests[0]!;
    expect(findingsProperty(req, 'search_logs').properties!.from).toBeUndefined();
    expect(req.systemPrompt ?? '').not.toContain('_findings.from');
  });

  it('refused at build without the inputs layer — configured-and-inert is not configured', () => {
    const m = scripted([answer('hi')]);
    expect(() =>
      Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(listServices)
        .findings({ argumentSources: true })
        .build(),
    ).toThrow(/argumentSources: true \}\) needs the inputs layer/);
    expect(() =>
      Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(listServices)
        .findings({ argumentSources: 'yes' as never }),
    ).toThrow(/argumentSources must be true or false/);
  });
});

describe('the checks decide what runs — an untraced value on an `ask` argument is asked', () => {
  it('a declared phrase makes "over the last week" check out as 7d, and the call runs', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
        },
      }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'Any errors on checkout over the last week?' });
    expect(out).toBe('No errors.');
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
    expect(argumentRows(agent)).toEqual([
      {
        kind: 'argument',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'search_logs',
        iteration: 1,
        argument: 'window',
        rule: 'ask',
        period: true,
        source: 'said',
        value: '7d',
        claimed: 'user',
        matched: 'phrase',
        quote: 'over the last week',
      },
    ]);
    // A traced source keeps every reason from firing — and supports nothing.
    const a = await agent.assessment();
    expect(a?.standing).toBe('consistent');
    expect(a?.checked.find((c) => c.check === 'argument-sources')).toMatchObject({ ran: 1, of: 1 });
  });

  it('an untraced value (nothing declared) is ASKED; the answer replaces it and the note says so', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout', window: '24h' } }),
      answer('No errors in the last hour.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .findings({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Any errors on checkout?' });
    expect(ran).toEqual([]);
    if (!isInputPause(paused)) throw new Error('expected the ask');
    // The model's value never rides the ask: nothing supplied, no default, no `quoted`.
    expect(paused.awaitingInput.supplied).toEqual({});
    expect(paused.awaitingInput.fields[0]).not.toHaveProperty('default');
    expect(paused.awaitingInput.context).toEqual({
      agentfootprint: {
        ask: 'arguments',
        fields: [{ id: 'f1', tool: 'search_logs', argument: 'window', calls: ['c1'] }],
      },
    });
    expect(argumentRows(agent)).toEqual([
      expect.objectContaining({
        asked: 'unverified',
        proposed: '24h',
        claimed: 'none',
        rule: 'ask',
      }),
    ]);
    expect(argumentRows(agent)[0]!.source).toBeUndefined();
    expect((await agent.assessment())?.standing).toBe('ask');

    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '1h' }));
    expect(done).toBe('No errors in the last hour.');
    expect(ran).toEqual([{ service: 'checkout', window: '1h' }]);
    const rows = argumentRows(agent);
    expect(rows[1]).toMatchObject({ source: 'answered', value: '1h', proposed: '24h' });
    const tool = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    // …and, under declared sources, a later call may cite the answer (`turn`).
    expect(tool.content).toContain(
      'window = "1h" in the search_logs call this result answers was chosen by the person when ' +
        'asked (the call had carried "24h"); a later call may cite that answer in `_findings.from` ' +
        "with source 'turn'.]",
    );
  });

  it('a READING asks — with the person’s own words as `quoted`, never the model’s value', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '24h',
          _findings: from({ argument: 'window', source: 'user', quote: 'errors on checkout' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Any errors on checkout?' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(paused.awaitingInput.context).toEqual({
      agentfootprint: {
        ask: 'arguments',
        fields: [
          {
            id: 'f1',
            tool: 'search_logs',
            argument: 'window',
            calls: ['c1'],
            quoted: 'errors on checkout',
          },
        ],
      },
    });
    expect(argumentRows(agent)[0]).toMatchObject({
      asked: 'unverified',
      claimed: 'user',
      quote: 'errors on checkout',
      reading: true,
    });
  });

  it('V1: the declared default stays a default whatever the claim — the standing says assumed', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '2h',
          _findings: from({ argument: 'window', source: 'app' }),
        },
      }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .system('Search the last 2h unless told otherwise.')
      .tool(assumingSearch(ran))
      .findings({ argumentSources: true })
      .build();
    await agent.run({ message: 'Any errors on checkout?' });
    expect(argumentRows(agent)).toEqual([
      expect.objectContaining({ source: 'default', value: '2h', proposed: '2h', claimed: 'app' }),
    ]);
    expect(argumentRows(agent)[0]!.appSource).toBeUndefined();
    const a = await agent.assessment();
    expect(a?.reasons.map((r) => r.reason)).toEqual(['argument-assumed']);
  });

  it('a failed claim on a FREE argument is checked and filed with no rule — the model misstated the record', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'storefront',
          window: '7d',
          _findings: from(
            { argument: 'window', source: 'user', quote: 'the last week' },
            { argument: 'service', source: 'user', quote: 'the storefront backend' },
          ),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    await agent.run({ message: 'Errors on checkout in the last week?' });
    const service = argumentRows(agent).find((r) => r.argument === 'service')!;
    expect(service.rule).toBeUndefined();
    expect(service).toMatchObject({
      source: 'model',
      claimed: 'user',
      failed: 'quote-not-found',
      value: 'storefront',
    });
    const a = await agent.assessment();
    expect(a?.reasons.map((r) => r.reason)).toEqual(['argument-unverified']);
  });

  it('the dropped `from` entries ride the basis row — or, with no basis, the call’s first argument row', async () => {
    const run = async (declaration: object) => {
      const m = scripted([
        batch({
          id: 'c1',
          name: 'search_logs',
          args: { service: 'checkout', window: '7d', _findings: declaration },
        }),
        answer('ok'),
      ]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(askingSearch([]))
        .findings({ argumentSources: true })
        .build();
      await agent.run({ message: 'errors on checkout over the last week?' });
      return agent.findings() ?? [];
    };
    const bad = [
      { argument: 'window', source: 'user', quote: 'the last week' },
      { argument: 'window', source: 'app' },
      { argument: 'nope', source: 'user', quote: 'x' },
    ];
    const withBasis = await run({ basis: 'direct', from: bad });
    expect(withBasis.find((r) => r.kind === 'basis')).toMatchObject({ malformed: 2 });
    expect(withBasis.find((r) => r.kind === 'argument')).not.toHaveProperty('malformed');
    const noBasis = await run({ from: bad });
    expect(noBasis.find((r) => r.kind === 'basis')).toBeUndefined();
    expect(noBasis.find((r) => r.kind === 'argument')).toMatchObject({
      malformed: 2,
      source: 'said',
      matched: 'phrase',
    });
  });
});

// ─── INTEGRATION ─────────────────────────────────────────────────────

describe('a result, the app, an earlier answer — each checked in its one place', () => {
  it('a value from a named result runs as `result`; a result the model set aside → value-contingent', async () => {
    const ran: Record<string, unknown>[] = [];
    const flowsTool = netFlows(ran);
    const m = scripted([
      batch({ id: 'c1', name: 'list_hosts', args: { service: 'checkout' } }),
      batch({
        id: 'c2',
        name: 'net_flows',
        args: {
          host: 'srv-4417',
          range: '-24h',
          _findings: {
            basis: 'direct',
            previous: [{ toolCallId: 'c1', standing: 'noise' }],
            from: [
              { argument: 'host', source: 'result', id: 'c1' },
              { argument: 'range', source: 'user', quote: 'the past day' },
            ],
          },
        },
      }),
      answer('3 flows.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(listHosts)
      .tool(flowsTool)
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'Flows on the checkout host for the past day?' });
    // `range` = -24h is a reading of "the past day" (no phrase declared for it) → asked.
    if (!isInputPause(out)) throw new Error(`expected the ask, got ${JSON.stringify(out)}`);
    const host = argumentRows(agent).find((r) => r.argument === 'host')!;
    expect(host).toMatchObject({
      source: 'result',
      result: 'c1',
      setAside: 'noise',
      claimed: 'result',
    });
    expect(host.rule).toBeUndefined();
    await agent.resume(stored(out), replyTo(out, { f1: '-24h' }));
    expect(ran).toEqual([{ host: 'srv-4417', range: '-24h' }]);
    const a = await agent.assessment();
    expect(a?.reasons.map((r) => r.reason)).toContain('value-contingent');
    expect(a?.standing).toBe('not-sure');
  });

  it('a number from a result the library joined a note to (the repeated-call note) is found — never a false `not-in-result`', async () => {
    const ran: Record<string, unknown>[] = [];
    const hosts = defineTool({
      name: 'list_hosts',
      description: 'Hosts of one service.',
      inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
      execute: async () => ({ hosts: [{ id: 4417, name: 'srv-a', up: true }] }),
    });
    const hostErrors = defineTool({
      name: 'host_errors',
      description: 'Errors on one host.',
      inputSchema: {
        type: 'object',
        properties: { host_id: { type: 'number' }, include_up: { type: 'boolean' } },
      },
      askOrAssume: { host_id: { ask: 'Which host id?' } },
      execute: async (args) => {
        ran.push({ ...args });
        return { errors: 0 };
      },
    });
    const m = scripted([
      batch({ id: 'c1', name: 'list_hosts', args: { service: 'checkout' } }),
      // The same call again: its result is served with the repeated-call note after it.
      batch({ id: 'c2', name: 'list_hosts', args: { service: 'checkout' } }),
      batch({
        id: 'c3',
        name: 'host_errors',
        args: {
          host_id: 4417,
          include_up: true,
          _findings: from(
            { argument: 'host_id', source: 'result', id: 'c2' },
            { argument: 'include_up', source: 'result', id: 'c2' },
          ),
        },
      }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hosts)
      .tool(hostErrors)
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'Any errors on the checkout hosts?' });
    // The note really rode c2's result — the case this pins.
    const served = m.requests[2]!.messages.find((x) => x.role === 'tool' && x.toolCallId === 'c2');
    expect(served?.content).toMatch(/^\{"hosts":\[\{"id":4417,.*\}\]\}\s+\[identical call:/s);
    expect(out).toBe('No errors.');
    expect(ran).toEqual([{ host_id: 4417, include_up: true }]);
    expect(argumentRows(agent).map((r) => [r.argument, r.source, r.result, r.failed])).toEqual([
      ['host_id', 'result', 'c2', undefined],
      ['include_up', 'result', 'c2', undefined],
    ]);
  });

  it('an MCP text result of several compact-JSON blocks is read block by block', async () => {
    const ran: Record<string, unknown>[] = [];
    const client = mockMcpClient({
      name: 'fleet',
      tools: [
        {
          name: 'list_hosts',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [
              { type: 'text', text: '{"id":4417,"name":"srv-a"}' },
              { type: 'text', text: '{"id":2210,"name":"srv-b"}' },
            ],
          }),
        },
        {
          name: 'host_errors',
          inputSchema: { type: 'object', properties: { host_id: { type: 'number' } } },
          _meta: { agentfootprint: { askOrAssume: { host_id: { ask: 'Which host id?' } } } },
          handler: async (args) => {
            ran.push({ ...args });
            return '{"errors":0}';
          },
        },
      ],
    });
    const m = scripted([
      batch({ id: 'c1', name: 'list_hosts', args: {} }),
      batch({
        id: 'c2',
        name: 'host_errors',
        args: {
          host_id: 2210,
          _findings: from({ argument: 'host_id', source: 'result', id: 'c1' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools(await client.tools())
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'errors on the second host?' });
    expect(m.requests[1]!.messages.find((x) => x.role === 'tool')?.content).toBe(
      '{"id":4417,"name":"srv-a"}\n{"id":2210,"name":"srv-b"}',
    );
    expect(out).toBe('ok');
    expect(ran).toEqual([{ host_id: 2210 }]);
    expect(argumentRows(agent)[0]).toMatchObject({ source: 'result', result: 'c1' });
  });

  it('the app’s externalGrounds label rides `appSource`', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'net_flows',
        args: {
          host: 'srv-7',
          range: '-1h',
          _findings: from(
            { argument: 'host', source: 'app' },
            { argument: 'range', source: 'user', quote: 'the last hour' },
          ),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      externalGrounds: () => [{ value: 'srv-7', source: 'viewer-selection' }],
    })
      .tool(netFlows([]))
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'flows on the selected host in the last hour?' });
    // "-1h" is not inside "the last hour" and no phrase was declared: a reading → asked.
    expect(isInputPause(out)).toBe(true);
    expect(argumentRows(agent).find((r) => r.argument === 'host')).toMatchObject({
      source: 'app',
      appSource: 'viewer-selection',
      claimed: 'app',
    });
  });

  it('a period answered in turn 1 as 24h traces in turn 2 to a -24h argument (matched: spelling)', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('No errors on checkout.'),
      batch({
        id: 'c2',
        name: 'net_flows',
        args: {
          host: 'srv-4417',
          range: '-24h',
          _findings: from({ argument: 'range', source: 'turn' }),
        },
      }),
      answer('3 flows.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .tool(netFlows(ran))
      .findings({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Errors on checkout?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    const second = await agent.followUp('And the flows on srv-4417?');
    expect(second).toBe('3 flows.');
    expect(ran).toEqual([
      { service: 'checkout', window: '24h' },
      { host: 'srv-4417', range: '-24h' },
    ]);
    const range = argumentRows(agent).find((r) => r.argument === 'range')!;
    expect(range).toMatchObject({
      turn: 2,
      source: 'answered',
      matched: 'spelling',
      earlier: true,
      claimed: 'turn',
    });
  });

  it('a `turn` claim with no earlier answer is no source: the ask fires', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          _findings: from({ argument: 'window', source: 'turn' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'errors on checkout?' });
    expect(isInputPause(out)).toBe(true);
    expect(argumentRows(agent)[0]).toMatchObject({
      asked: 'unverified',
      claimed: 'turn',
      failed: 'no-earlier-turn',
    });
  });

  it('a composed run (Sequence): a quote from the step’s own message is another model’s words', async () => {
    const ran: Record<string, unknown>[] = [];
    const planner = Agent.create({
      provider: scripted([answer('Search checkout errors over the last week.')]).provider as never,
      model: 'm',
    }).build();
    const quoteFromMessage = batch({
      id: 'c1',
      name: 'search_logs',
      args: {
        service: 'checkout',
        window: '2h',
        _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
      },
    });
    const worker = Agent.create({
      provider: scripted([quoteFromMessage, answer('No errors.')]).provider as never,
      model: 'm',
    })
      .tool(assumingSearch(ran))
      .findings({ argumentSources: true })
      .build();
    const seq = Sequence.create().step('plan', planner).step('work', worker).build();
    const out = await seq.run({ message: 'Any errors on checkout?' });
    expect(out).toBe('No errors.');
    // The worker ran as the Sequence's step: its state is the step's subflow heap.
    const snap = seq.getSnapshot() as unknown as {
      subflowResults: Record<string, { treeContext: { globalContext: Record<string, unknown> } }>;
    };
    const step = snap.subflowResults['step-work']!.treeContext.globalContext;
    expect(step.userMessageFrom).toBe('composed');
    const rows = (step.findingsLedger as ArgumentRow[]).filter((r) => r.kind === 'argument');
    // "2h" is the declared default and not the person's — V1 keeps it `default`, the
    // failed claim kept as written.
    expect(rows[0]).toMatchObject({
      source: 'default',
      claimed: 'user',
      failed: 'composed-message',
    });
    // …and the same worker run directly by a person: the words are the person's.
    const direct = Agent.create({
      provider: scripted([quoteFromMessage, answer('No errors.')]).provider as never,
      model: 'm',
    })
      .tool(assumingSearch([]))
      .findings({ argumentSources: true })
      .build();
    await direct.run({ message: 'Search checkout errors over the last week.' });
    expect(argumentRows(direct)[0]).toMatchObject({ source: 'default', claimed: 'user' });
    expect(argumentRows(direct)[0]!.failed).toBeUndefined();
  });

  it('a composed run (workflow() and graph()): a later step’s or a child node’s message is another model’s words', async () => {
    const planner = () =>
      Agent.create({
        provider: scripted([answer('Search checkout errors over the last week.')])
          .provider as never,
        model: 'm',
      }).build();
    const quoteFromMessage = batch({
      id: 'c1',
      name: 'search_logs',
      args: {
        service: 'checkout',
        window: '7d',
        _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
      },
    });
    const worker = (ran: Record<string, unknown>[]) =>
      Agent.create({
        provider: scripted([quoteFromMessage, answer('No errors.')]).provider as never,
        model: 'm',
      })
        .tool(askingSearch(ran))
        .findings({ argumentSources: true })
        .build();
    // The quote holds a phrase declared for `7d`: from the PERSON it would run; from
    // another runner's output it fails, so the `ask` argument is asked — nothing runs.
    const ranInFlow: Record<string, unknown>[] = [];
    const flow = workflow(planner(), worker(ranInFlow));
    expect(isPaused(await flow.run({ message: 'Any errors on checkout?' }))).toBe(true);
    expect(ranInFlow).toEqual([]);
    const ranInGraph: Record<string, unknown>[] = [];
    const g = graph({
      nodes: [
        { id: 'plan', runner: planner() },
        { id: 'work', runner: worker(ranInGraph) },
      ],
      edges: [{ from: 'plan', to: 'work' }],
    });
    expect(isPaused(await g.run({ message: 'Any errors on checkout?' }))).toBe(true);
    expect(ranInGraph).toEqual([]);
    // The row, on a run that completes (the declared default, V1 — the claim kept as written).
    const ran: Record<string, unknown>[] = [];
    const assuming = Agent.create({
      provider: scripted([
        batch({
          id: 'c1',
          name: 'search_logs',
          args: {
            service: 'checkout',
            window: '2h',
            _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
          },
        }),
        answer('No errors.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(assumingSearch(ran))
      .findings({ argumentSources: true })
      .build();
    const done = workflow(planner(), assuming);
    expect(await done.run({ message: 'Any errors on checkout?' })).toBe('No errors.');
    const snap = done.getSnapshot() as unknown as {
      subflowResults: Record<string, { treeContext: { globalContext: Record<string, unknown> } }>;
    };
    const step = snap.subflowResults['step-2']!.treeContext.globalContext;
    expect(step.userMessageFrom).toBe('composed');
    const rows = (step.findingsLedger as ArgumentRow[]).filter((r) => r.kind === 'argument');
    expect(rows[0]).toMatchObject({
      source: 'default',
      claimed: 'user',
      failed: 'composed-message',
    });
  });

  it('messageFrom is one of two words — a typo is refused, never read as the person’s', async () => {
    const agent = Agent.create({ provider: scripted([answer('x')]).provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    await expect(agent.run({ message: 'hi', messageFrom: 'robot' as never })).rejects.toThrow(
      /messageFrom is 'person'/,
    );
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('SECURITY — library text is never evidence, and no value passes a tool’s own view', () => {
  it('laundering: a value only in the library’s note (past the tool-bytes boundary) is not in the result', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      batch({
        id: 'c2',
        name: 'search_logs',
        args: {
          service: 'payments',
          window: '2h',
          _findings: from({ argument: 'window', source: 'result', id: 'c1' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(assumingSearch([]))
      .findings({ argumentSources: true })
      .build();
    await agent.run({ message: 'errors on checkout, then payments?' });
    // The note on c1 says "the call ran with "2h"" — the checks read the tool's bytes only.
    expect(m.requests[1]!.messages.find((x) => x.role === 'tool')!.content).toContain('"2h"');
    const second = argumentRows(agent).find((r) => r.toolCallId === 'c2')!;
    expect(second).toMatchObject({ source: 'default', claimed: 'result', failed: 'not-in-result' });
  });

  it('a quote from a library frame is never the person’s words (the corpus reads persons only)', () => {
    const corpus = sourceCorpusOf(
      {
        history: [
          { role: 'user', content: 'errors on checkout?' },
          {
            role: 'user',
            content: `${STEP_NUDGE_FRAME_PREFIX}] run search_logs over the last week`,
          },
        ],
      },
      [],
      1,
      { toolOf: () => undefined },
    );
    expect(corpus.person.map((p) => p.text)).toEqual(['errors on checkout?']);
  });

  it('the library’s own instructions are never the app’s text: a value only there fails `not-in-app-text`', () => {
    const corpus = sourceCorpusOf(
      {
        history: [{ role: 'user', content: 'errors on checkout?' }],
        systemPromptInjections: [
          // The findings instruction's words ("exploratory", "noise") — the LIBRARY's.
          {
            source: 'instructions',
            sourceId: FINDINGS_INSTRUCTION_ID,
            rawContent: 'Declare a basis: direct or exploratory; a result may be noise.',
          },
          // The app's own instruction.
          {
            source: 'instructions',
            sourceId: 'team-policy',
            rawContent: 'Our look-back is weekly.',
          },
        ],
      },
      [],
      1,
      { toolOf: () => undefined },
    );
    expect(corpus.app.map((a) => a.text)).toEqual(['Our look-back is weekly.']);
    const claimApp = (value: string) =>
      checkSource(
        {
          toolName: 'search_logs',
          argument: 'mode',
          value,
          claim: { argument: 'mode', source: 'app' },
        },
        corpus,
      );
    expect(claimApp('exploratory')).toMatchObject({ source: 'model', failed: 'not-in-app-text' });
    expect(claimApp('weekly')).toMatchObject({ source: 'app', claimed: 'app' });
  });

  it('an evicted turn is not the person’s words any more: the check is window-relative', () => {
    const corpus = sourceCorpusOf(
      { history: [{ role: 'user', content: 'and payments?' }] },
      [],
      2,
      { toolOf: () => undefined },
    );
    expect(corpus.person).toEqual([{ text: 'and payments?' }]);
  });

  it('a hidden argument: quote, value and proposal read REDACTED; no length on the event; no `quoted` on the ask', async () => {
    const hiding = askingSearch([], {
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as never);
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '24h',
          _findings: from({ argument: 'window', source: 'user', quote: 'errors on checkout' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hiding)
      .findings({ argumentSources: true })
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'errors on checkout?' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('errors on checkout');
    const row = argumentRows(agent)[0]!;
    expect(row).toMatchObject({ asked: 'unverified', proposed: 'REDACTED', quote: 'REDACTED' });
    const event = seen.find((e) => e.type === 'agentfootprint.findings.argument')!;
    expect(event.payload.valueChars).toBeUndefined();
    await agent.resume(stored(paused), replyTo(paused, { f1: '7d' }));
    expect(JSON.stringify(agent.findings())).not.toContain('24h');
    expect(JSON.stringify(agent.findings())).not.toContain('"7d"');
    // …and the note served after the result names no hidden value either — not the
    // model's (it says only that the call had carried a value of its own).
    const note = m.requests[m.requests.length - 1]!.messages.find((x) => x.role === 'tool')!;
    expect(note.content).toContain('the call had carried a value of its own');
    expect(note.content).not.toContain('24h');
  });

  it('a quote is free text: when the view hides ANOTHER argument, every quote on the call reads REDACTED and the ask shows none', async () => {
    // The view hides `service` only; the quote names `window` — and holds the hidden service.
    const hiding = askingSearch([], {
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'service' in args ? { ...args, service: 'REDACTED' } : args,
    } as never);
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout-7731',
          window: '24h',
          _findings: from({ argument: 'window', source: 'user', quote: 'errors on checkout-7731' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hiding)
      .findings({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'errors on checkout-7731?' });
    if (!isInputPause(paused)) throw new Error('expected the reading to be asked about');
    expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('7731');
    const row = argumentRows(agent)[0]!;
    // The verdict is still filed: a reading, asked. Only the free text is withheld.
    expect(row).toMatchObject({
      argument: 'window',
      asked: 'unverified',
      proposed: '24h',
      quote: 'REDACTED',
      reading: true,
    });
    expect(JSON.stringify(agent.findings())).not.toContain('7731');
    // The same quote beside a call whose view hid nothing is kept (the neighbouring test's tool).
    const plain = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '24h',
          _findings: from({ argument: 'window', source: 'user', quote: 'errors on checkout' }),
        },
      }),
      answer('ok'),
    ]);
    const open = Agent.create({ provider: plain.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    await open.run({ message: 'errors on checkout?' });
    expect(argumentRows(open)[0]).toMatchObject({ quote: 'errors on checkout', reading: true });
  });

  describe('a quote may hold a value ANOTHER tool hides — no quote is shown while such a tool is in reach', () => {
    /** A sign-in tool whose view hides the password (the `flowchartAsTool({ redact })` shape). */
    const login = (): Tool =>
      ({
        ...defineTool({
          name: 'login',
          description: 'Sign in.',
          inputSchema: {
            type: 'object',
            properties: { user: { type: 'string' }, password: { type: 'string' } },
          },
          execute: async () => ({ ok: true }),
        }),
        [SHOWN_ARGS]: (args: Record<string, unknown>) =>
          'password' in args ? { ...args, password: 'REDACTED' } : args,
      } as never);
    const quoting = (id: string, quote: string, window = '24h') => ({
      id,
      name: 'search_logs',
      args: {
        service: 'checkout',
        window,
        _findings: from({ argument: 'window', source: 'user', quote }),
      },
    });
    const signIn = (id: string) => ({
      id,
      name: 'login',
      args: { user: 'bob', password: 'hunter2', _findings: { basis: 'direct' } },
    });
    const agentWith = (script: Reply[], tools: Tool[]) => {
      let builder = Agent.create({ provider: scripted(script).provider as never, model: 'm' });
      for (const t of tools) builder = builder.tool(t);
      return builder.findings({ argumentSources: true }).build();
    };

    it('the same batch: a sibling call hides the password; the quote holding it is REDACTED, the ask shows none', async () => {
      const sentence =
        'Log me in as bob with password hunter2 and show checkout errors from the last week';
      const agent = agentWith(
        [batch(signIn('c1'), quoting('c2', sentence, '7d')), answer('No errors.')],
        [login(), askingSearch([])],
      );
      const out = await agent.run({ message: sentence });
      // The verdict is unchanged — "last week" is a phrase declared for 7d — only the text is withheld.
      expect(out).toBe('No errors.');
      expect(argumentRows(agent)[0]).toMatchObject({
        toolCallId: 'c2',
        source: 'said',
        matched: 'phrase',
        quote: 'REDACTED',
      });
      expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
      // A reading asks; the ask carries no `quoted`.
      const asking = agentWith(
        [batch(signIn('c1'), quoting('c2', 'I am bob and my password is hunter2')), answer('ok')],
        [login(), askingSearch([])],
      );
      const paused = await asking.run({
        message: 'I am bob and my password is hunter2, any errors on checkout?',
      });
      if (!isInputPause(paused)) throw new Error('expected the reading to be asked about');
      expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('hunter2');
      expect(JSON.stringify(asking.findings())).not.toContain('hunter2');
    });

    it('a later turn: the password went to the sign-in tool in turn 1; turn 2’s quote of it is REDACTED', async () => {
      const agent = agentWith(
        [
          batch(signIn('c1')),
          answer('signed in'),
          batch(quoting('c2', 'my password is hunter2')),
          answer('ok'),
        ],
        [login(), askingSearch([])],
      );
      await agent.run({ message: 'sign me in: user bob, my password is hunter2' });
      const paused = await agent.followUp('any errors on checkout?');
      if (!isInputPause(paused)) throw new Error('expected the reading to be asked about');
      expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('hunter2');
      expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
    });

    it('a quote filed BEFORE the call that hides the value: the registered tool hides it too', async () => {
      const agent = agentWith(
        [batch(quoting('c1', 'password hunter2 and checkout errors', '7d')), answer('ok')],
        [login(), askingSearch([])],
      );
      await agent.run({ message: 'password hunter2 and checkout errors over the last week' });
      expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
      expect(argumentRows(agent)[0]).toMatchObject({ quote: 'REDACTED' });
    });

    describe('a ToolProvider’s tool — its list is known only per iteration, so ANY provider counts', () => {
      const sentence =
        'Log me in as bob with password hunter2 and show checkout errors from the last week';
      /** The registered search plus a provider: `list` decides what the provider serves. */
      const withProvider = (script: Reply[], list: (iteration: number) => Tool[]) =>
        Agent.create({ provider: scripted(script).provider as never, model: 'm' })
          .tool(askingSearch([]))
          .toolProvider({ id: 'p', list: (ctx) => list(ctx.iteration) })
          .findings({ argumentSources: true })
          .build();

      it('the quote is filed in iteration 1, the provider’s hiding tool is called in iteration 2: REDACTED', async () => {
        const hiding = login();
        const agent = withProvider(
          [batch(quoting('c2', sentence, '7d')), batch(signIn('c1')), answer('No errors.')],
          () => [hiding],
        );
        expect(await agent.run({ message: sentence })).toBe('No errors.');
        const row = argumentRows(agent).find((r) => r.toolCallId === 'c2');
        // The verdict is unchanged — only the text is withheld.
        expect(row).toMatchObject({ source: 'said', matched: 'phrase', quote: 'REDACTED' });
        expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
      });

      it('a tool the provider lists for the FIRST time after the quote was filed: REDACTED', async () => {
        const hiding = login();
        const agent = withProvider(
          [batch(quoting('c2', sentence, '7d')), batch(signIn('c1')), answer('No errors.')],
          // Iteration 1 lists nothing: when the quote is filed, no hiding tool exists anywhere.
          (iteration) => (iteration >= 2 ? [hiding] : []),
        );
        await agent.run({ message: sentence });
        expect(argumentRows(agent).find((r) => r.toolCallId === 'c2')).toMatchObject({
          quote: 'REDACTED',
        });
        expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
      });

      it('a reading asked before the provider’s hiding tool was ever called: the ask, the rows and the checkpoint carry no quote', async () => {
        const hiding = login();
        const agent = withProvider(
          [batch(quoting('c2', 'I am bob and my password is hunter2')), answer('ok')],
          () => [hiding],
        );
        const paused = await agent.run({
          message: 'I am bob and my password is hunter2, any errors on checkout?',
        });
        if (!isInputPause(paused)) throw new Error('expected the reading to be asked about');
        expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('hunter2');
        expect(JSON.stringify(agent.findings())).not.toContain('hunter2');
        expect(argumentRows(agent)[0]).toMatchObject({ asked: 'unverified', quote: 'REDACTED' });
        // The stored run holds the conversation (the person's words, verbatim) — and no
        // `quoted` the library wrote: the ask's field and the batch's resolution have none.
        expect(JSON.stringify(paused.checkpoint)).not.toContain('"quoted"');
      });

      it('conservative by construction: a provider that never lists a hiding tool still hides the quote', async () => {
        const agent = withProvider(
          [batch(quoting('c2', 'errors from the last week', '7d')), answer('ok')],
          () => [],
        );
        await agent.run({ message: 'checkout errors from the last week' });
        expect(argumentRows(agent)[0]).toMatchObject({ source: 'said', quote: 'REDACTED' });
      });

      it('`.selfExplain()` serves its trace tools through a provider — it counts too; neither → the quote is shown', async () => {
        const script = () => [
          batch(quoting('c2', 'errors from the last week', '7d')),
          answer('ok'),
        ];
        const explaining = Agent.create({
          provider: scripted(script()).provider as never,
          model: 'm',
        })
          .tool(askingSearch([]))
          .selfExplain()
          .findings({ argumentSources: true })
          .build();
        await explaining.run({ message: 'checkout errors from the last week' });
        expect(argumentRows(explaining)[0]).toMatchObject({ quote: 'REDACTED' });
        const plain = agentWith(script(), [askingSearch([])]);
        await plain.run({ message: 'checkout errors from the last week' });
        expect(argumentRows(plain)[0]).toMatchObject({ quote: 'errors from the last week' });
      });
    });
  });

  it('events carry names, enums and counts — never a value, a quote or a proposal', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .findings({ argumentSources: true })
      .build();
    const seen = events(agent);
    await agent.run({ message: 'errors on checkout over the last week?' });
    const event = seen.find((e) => e.type === 'agentfootprint.findings.argument')!;
    expect(event.payload).toMatchObject({
      argument: 'window',
      source: 'said',
      claimed: 'user',
      matched: 'phrase',
      valueChars: 2,
    });
    expect(JSON.stringify(event.payload)).not.toContain('last week');
    expect(JSON.stringify(event.payload)).not.toContain('7d');
  });

  it('a before-tool rewrite AFTER the layer checked the value reads as assumed', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          _findings: from({ argument: 'window', source: 'user', quote: 'over the last week' }),
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .toolMiddleware({
        name: 'clamp-window',
        onToolCall: (call) => allow({ ...call.args, window: '1h' }, 'clamp'),
      })
      .findings({ argumentSources: true })
      .build();
    await agent.run({ message: 'errors on checkout over the last week?' });
    expect(argumentRows(agent)[0]).toMatchObject({ source: 'said', matched: 'phrase' });
    const a = await agent.assessment();
    expect(a?.reasons.map((r) => r.reason)).toEqual(['argument-assumed']);
  });
});

// ─── PERFORMANCE / LOAD ─────────────────────────────────────────────

describe('PERFORMANCE — what the arm adds to a request, and what the checks cost', () => {
  it('records the served bytes `from` adds (a ruled tool only; the system prompt does not move)', async () => {
    const serve = async (argumentSources: boolean) => {
      const m = scripted([answer('hi')]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(askingSearch([]))
        .tool(listServices)
        .findings({ argumentSources })
        .build();
      await agent.run({ message: 'hello' });
      const req = m.requests[0]!;
      return {
        tools: JSON.stringify(req.tools).length,
        ruled: JSON.stringify(req.tools!.find((t) => t.name === 'search_logs')).length,
        unruled: JSON.stringify(req.tools!.find((t) => t.name === 'list_services')).length,
        system: (req.systemPrompt ?? '').length,
      };
    };
    const off = await serve(false);
    const on = await serve(true);
    // eslint-disable-next-line no-console
    console.log(
      `[declared sources] served chars per request: tools +${on.tools - off.tools} ` +
        `(the ruled tool +${on.ruled - off.ruled}, an unruled tool +${
          on.unruled - off.unruled
        }), ` +
        `system prompt +${on.system - off.system}`,
    );
    expect(on.unruled).toBe(off.unruled);
    expect(on.ruled - off.ruled).toBe(on.tools - off.tools);
    // `from` is explained once, in its own property: the system prompt does not move.
    expect(on.system - off.system).toBe(0);
  });
});

describe('LOAD — 50 calls × 5 ruled arguments, each with a `from` entry', () => {
  it('files 250 rows in ONE ledger write for the batch, every one judged', async () => {
    const wide = defineTool({
      name: 'wide',
      description: 'Five ruled arguments.',
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((k) => [k, { type: 'string' }]),
        ),
      },
      askOrAssume: Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].map((k) => [k, { assume: `default-${k}` }]),
      ),
      execute: async () => ({ rows: ['alpha', 'beta'] }),
    });
    const calls: Call[] = Array.from({ length: 50 }, (_, i) => ({
      id: `w${i}`,
      name: 'wide',
      args: {
        a: 'alpha',
        b: 'beta',
        c: 'gamma',
        d: 'default-d',
        e: 'epsilon',
        _findings: from(
          { argument: 'a', source: 'user', quote: 'alpha' },
          { argument: 'b', source: 'app' },
          { argument: 'c', source: 'assumed' },
          { argument: 'd', source: 'app' },
          { argument: 'e', source: 'turn' },
        ),
      },
    }));
    const m = scripted([batch(...calls), answer('done')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm', maxIterations: 4 })
      .system('Use beta as the b value.')
      .tool(wide)
      .findings({ argumentSources: true })
      .build();
    const rec = recordRun(agent);
    const started = Date.now();
    await agent.run({ message: 'alpha please' });
    const ms = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(`[declared sources] 50 calls × 5 arguments: ${ms} ms end to end`);
    const rows = argumentRows(agent);
    expect(rows).toHaveLength(250);
    expect(rows.every((r) => r.claimed !== undefined)).toBe(true);
    const bySource = (s: string) => rows.filter((r) => r.source === s).length;
    expect(bySource('said')).toBe(50);
    expect(bySource('app')).toBe(50);
    expect(bySource('default')).toBe(50);
    expect(bySource('model')).toBe(100);
    // One ledger write for the layer's batch: the mount's output mapping.
    const snapshot = rec.toRecording().snapshot as {
      commitLog: { stageId?: string; overwrite?: Record<string, unknown> }[];
    };
    const ledgerWrites = snapshot.commitLog.filter(
      (b) => b.stageId === 'sf-inputs' && JSON.stringify(b).includes('"findingsLedger"'),
    );
    expect(ledgerWrites).toHaveLength(1);
    const a = assessAnswer(rec.toRecording());
    expect(a.checked.find((c) => c.check === 'argument-sources')).toMatchObject({
      ran: 250,
      of: 250,
    });
  });
});
