/**
 * The inputs layer's batch ask (honesty layer 2, step 4) — end to end through
 * real agents on a scripted provider.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL   — two calls in one batch missing `window`: ONE ask, one
 *                    field, both calls bound and run; `asked` then `answered`
 *                    rows and their events; the past-tense note on each
 *                    result; `tool_start` keeps the proposal; a string field
 *                    with no choices files `free: true`; a present value runs,
 *                    flagged `model` (adopted Q2); the served schema; the
 *                    answer's standing reads `ask` while the ask waits;
 *   - INTEGRATION  — both chart shapes; a fresh agent resuming a serialized
 *                    checkpoint; the hosted path (render, answer, cancel — the
 *                    cancel writes only the fixed reply and no orphan result);
 *                    one human question per resume (a check-in, a middleware
 *                    `ask` and a tool's own `requestInput` in the SAME batch are
 *                    refused by name; in a LATER batch a tool's own ask pauses
 *                    and resumes); the readers of a pause (the window stage, the
 *                    answer account, the commentary); the evidence gate learns
 *                    the answers; a composition (`Sequence`) resumes the ask
 *                    with a raw reply; the host's `argumentAskContext`;
 *   - PROPERTY     — every answer inside the declared choices runs the call
 *                    with it and files `answered`; a partial answer re-pauses at
 *                    the door with no model call; an integer answered 2.5 is
 *                    asked again and never bound, and the third invalid answer
 *                    refuses the call;
 *   - SECURITY     — the ask carries none of the model's values; the host hook
 *                    cannot use the reserved key; a hidden argument's answer is
 *                    on no row, event, note or ask `context`;
 *   - PERFORMANCE  — the resume adds no model call;
 *   - LOAD         — a batch that needs 40 fields asks in two rounds and binds
 *                    all 40.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  Sequence,
  defineTool,
  isInputPause,
  isPaused,
  requestInput,
  slidingWindow,
  type AgentOutput,
  type RunnerPauseOutcome,
  type Tool,
} from '../../../../src/index.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import { ask as askOutcome } from '../../../../src/core/agent/middleware/outcomes.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import {
  ARGUMENT_ASK_QUESTION,
  ARGUMENT_REASK_QUESTION,
  MAX_ASK_ROUNDS,
} from '../../../../src/core/agent/arguments/ask.js';
import { ASK_SENTENCE } from '../../../../src/core/agent/arguments/serve.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import {
  defaultCommentaryTemplates,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import { inProcessHost } from '../../../hosting/testHost.js';
import { memorySessions, standingAgent } from '../../../../src/hosting/index.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'ask-layer-mock',
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

const batch = (...calls: { id: string; name: string; args: object }[]): Reply => ({
  content: '',
  toolCalls: calls,
});
const answer = (content: string): Reply => ({ content });

const WINDOW_CHOICES = ['1h', '24h', '7d'] as const;

function searchLogs(ran: Record<string, unknown>[], extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: [...WINDOW_CHOICES], description: 'Look-back period.' },
      },
    },
    askOrAssume: {
      window: { ask: 'Which period should the error search cover?', choices: [...WINDOW_CHOICES] },
    },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, window: args.window, errors: 0 };
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

const replyTo = (out: AgentOutput | RunnerPauseOutcome, values: Record<string, unknown>) => {
  if (!isInputPause(out)) throw new Error(`expected the library's ask, got ${JSON.stringify(out)}`);
  return { requestId: out.awaitingInput.requestId, values };
};

/** The checkpoint as a host would store it: detached, through JSON. */
const stored = (out: AgentOutput | RunnerPauseOutcome) => {
  if (!isPaused(out)) throw new Error('expected a pause');
  return JSON.parse(JSON.stringify(out.checkpoint)) as RunnerPauseOutcome['checkpoint'];
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── FUNCTIONAL ──────────────────────────────────────────────────────

describe('the batch ask — ONE ask for everything the batch left out, before anything runs', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`two calls missing window: one ask, one field, both bound and run (${reactMode})`, async () => {
      const ran: Record<string, unknown>[] = [];
      const m = scripted([
        batch(
          { id: 'c1', name: 'search_logs', args: { service: 'checkout' } },
          { id: 'c2', name: 'search_logs', args: { service: 'payments' } },
        ),
        answer('No errors on either.'),
      ]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm', reactMode })
        .tool(searchLogs(ran))
        .build();
      const seen = events(agent);

      const paused = await agent.run({ message: 'any errors on checkout or payments?' });
      // Nothing ran, and the model was called once.
      expect(ran).toEqual([]);
      expect(m.requests).toHaveLength(1);
      if (!isInputPause(paused)) throw new Error('expected the ask');
      const ask = paused.awaitingInput;
      expect(ask.question).toBe(ARGUMENT_ASK_QUESTION);
      expect(ask.fields).toEqual([
        {
          id: 'f1',
          type: 'string',
          required: true,
          description: 'Which period should the error search cover?',
          enum: ['1h', '24h', '7d'],
        },
      ]);
      expect(ask.context).toEqual({
        agentfootprint: {
          ask: 'arguments',
          fields: [{ id: 'f1', tool: 'search_logs', argument: 'window', calls: ['c1', 'c2'] }],
        },
      });
      expect(ask.origin.toolCallId).toBe('c1');
      expect(ask.supplied).toEqual({});
      // The rows are on the record BEFORE the answer: asked, no value.
      expect(argumentRows(agent).map((r) => [r.toolCallId, r.asked, r.source])).toEqual([
        ['c1', 'missing', undefined],
        ['c2', 'missing', undefined],
      ]);
      // The standing reads ASK while the question is out.
      const waiting = await agent.assessment();
      expect(waiting?.standing).toBe('ask');
      expect(waiting?.reasons.map((r) => r.reason)).toEqual(['argument-asked']);

      const done = await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
      expect(done).toBe('No errors on either.');
      expect(ran).toEqual([
        { service: 'checkout', window: '24h' },
        { service: 'payments', window: '24h' },
      ]);
      // The resume added no model call: one before the ask, one after the results.
      expect(m.requests).toHaveLength(2);
      expect(argumentRows(agent).map((r) => [r.toolCallId, r.asked, r.source, r.value])).toEqual([
        ['c1', 'missing', undefined, undefined],
        ['c2', 'missing', undefined, undefined],
        ['c1', undefined, 'answered', '24h'],
        ['c2', undefined, 'answered', '24h'],
      ]);
      // The past-tense note on each result, after the tool's own bytes.
      const toolMessages = m.requests[1]!.messages.filter((msg) => msg.role === 'tool');
      for (const msg of toolMessages) {
        expect(msg.content).toContain(
          'window = "24h" in the search_logs call this result answers was chosen by the person when asked (the call had left it out).',
        );
      }
      // tool_start keeps the model's proposal; tool_end names the filled key.
      const starts = seen.filter((e) => e.type === 'agentfootprint.stream.tool_start');
      expect(starts.map((e) => e.payload.args)).toEqual([
        { service: 'checkout' },
        { service: 'payments' },
      ]);
      const ends = seen.filter((e) => e.type === 'agentfootprint.stream.tool_end');
      expect(ends.map((e) => e.payload.changedArgKeys)).toEqual([['window'], ['window']]);
      // One event per row, names and enums only.
      const rowEvents = seen.filter((e) => e.type === 'agentfootprint.findings.argument');
      expect(rowEvents.map((e) => [e.payload.asked, e.payload.source])).toEqual([
        ['missing', undefined],
        ['missing', undefined],
        [undefined, 'answered'],
        [undefined, 'answered'],
      ]);
      // After the answer, nothing is waiting: no ask reason.
      expect((await agent.assessment())?.reasons.map((r) => r.reason) ?? []).not.toContain(
        'argument-asked',
      );
    });
  }

  it('the served schema drops the ask argument from `required` and says the rule', async () => {
    const m = scripted([answer('hi')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'hello' });
    const served = m.requests[0]!.tools!.find((t) => t.name === 'search_logs')!;
    expect(served.inputSchema.required).toEqual(['service']);
    const window = (served.inputSchema.properties as Record<string, { description: string }>)
      .window;
    expect(window.description).toBe(`Look-back period. ${ASK_SENTENCE}`);
  });

  it('a present value on an ask argument runs as sent, flagged `model` (adopted Q2)', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout', window: '7d' } }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .build();
    const out = await agent.run({ message: 'errors this week?' });
    expect(out).toBe('ok');
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
    expect(argumentRows(agent)).toEqual([
      expect.objectContaining({ argument: 'window', rule: 'ask', source: 'model', value: '7d' }),
    ]);
    expect((await agent.assessment())?.reasons.map((r) => r.reason)).toContain(
      'argument-unverified',
    );
  });

  it('a string field with no choices files `free: true` — a name, never support', async () => {
    const ran: Record<string, unknown>[] = [];
    const tool = defineTool({
      name: 'lookup_host',
      description: 'd',
      inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
      askOrAssume: { host: { ask: 'Which host?' } },
      execute: async (args) => {
        ran.push({ ...args });
        return 'up';
      },
    });
    const m = scripted([batch({ id: 'c1', name: 'lookup_host', args: {} }), answer('It is up.')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(tool)
      .build();
    const paused = await agent.run({ message: 'is it up?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: 'srv-4417' }));
    expect(ran).toEqual([{ host: 'srv-4417' }]);
    expect(argumentRows(agent).at(-1)).toMatchObject({
      source: 'answered',
      value: 'srv-4417',
      free: true,
    });
  });
});

// ─── INTEGRATION ─────────────────────────────────────────────────────

describe('resume — a fresh agent, a serialized checkpoint', () => {
  it('a new agent instance resumes the stored ask and runs the batch', async () => {
    const ran: Record<string, unknown>[] = [];
    const script = [
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('Done.'),
    ];
    const first = Agent.create({ provider: scripted(script).provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .build();
    const paused = await first.run({ message: 'errors?' });
    const cp = stored(paused);
    const reply = replyTo(paused, { f1: '7d' });
    const second = Agent.create({
      provider: scripted(script.slice(1)).provider as never,
      model: 'm',
    })
      .tool(searchLogs(ran))
      .build();
    expect(await second.resume(cp, reply)).toBe('Done.');
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
  });
});

describe('the next turn — the ledger crosses it, the standing does not', () => {
  it('turn 1 asks and answers; turn 2 folds without turn 1’s rows', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('No errors in the last 24h.'),
      answer('You are welcome.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .build();
    const paused = await agent.run({ message: 'errors on checkout?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    expect(await agent.followUp('thanks')).toBe('You are welcome.');
    // The rows ride the conversation, stamped with the turn they were filed in.
    expect(argumentRows(agent).map((r) => [r.turn, r.asked ?? r.source])).toEqual([
      [1, 'missing'],
      [1, 'answered'],
    ]);
    const second = await agent.assessment();
    expect(second?.reasons.map((r) => r.reason) ?? []).not.toContain('argument-asked');
    expect(second?.checked.map((c) => c.check) ?? []).not.toContain('argument-rules');
  });
});

describe('the hosted path — render, answer, cancel', () => {
  async function hosted(ran: Record<string, unknown>[]) {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    return { host, handle, sessions };
  }

  it('renders the ask as a pending typed input and resumes it with the answer', async () => {
    const ran: Record<string, unknown>[] = [];
    const { host, handle } = await hosted(ran);
    try {
      const first = await host.deliver({ input: 'errors on checkout?', sessionId: 's' });
      const pending = first.awaiting?.awaitingInput;
      expect(pending?.context).toMatchObject({ agentfootprint: { ask: 'arguments' } });
      expect(ran).toEqual([]);
      const done = await host.deliver({
        input: '',
        sessionId: 's',
        decision: { requestId: pending!.requestId, values: { f1: '1h' } },
      });
      expect(done.output).toBe('No errors.');
      expect(ran).toEqual([{ service: 'checkout', window: '1h' }]);
    } finally {
      await handle.close();
    }
  });

  it('a cancel writes only the fixed reply — no orphan tool result, nothing ran', async () => {
    const ran: Record<string, unknown>[] = [];
    const { host, handle, sessions } = await hosted(ran);
    try {
      const first = await host.deliver({ input: 'errors on checkout?', sessionId: 's' });
      const cancelled = await host.deliver({
        input: '',
        sessionId: 's',
        decision: { requestId: first.awaiting!.awaitingInput!.requestId, cancel: true },
      });
      expect(cancelled.output).toBe('Input request cancelled.');
      expect(ran).toEqual([]);
      const envelope = JSON.stringify(await sessions.hydrate('s'));
      expect(envelope).not.toContain('input_cancelled');
      expect(envelope).not.toContain('"role":"tool"');
    } finally {
      await handle.close();
    }
  });
});

describe('one human question per resume — a later pause in the SAME batch is refused by name', () => {
  it('a check-in that trips in the batch that asked is refused, never asked', async () => {
    const ran: Record<string, unknown>[] = [];
    const guarded = defineTool({
      name: 'purge_logs',
      description: 'd',
      inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
      checkIn: 'always',
      execute: async (args) => {
        ran.push({ purged: args.service });
        return 'purged';
      },
    });
    const m = scripted([
      batch(
        { id: 'c1', name: 'search_logs', args: { service: 'checkout' } },
        { id: 'c2', name: 'purge_logs', args: { service: 'checkout' } },
      ),
      answer('Searched; the purge needs approval first.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools([searchLogs(ran), guarded])
      .build();
    const paused = await agent.run({ message: 'search then purge' });
    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    expect(isPaused(done)).toBe(false);
    expect(ran).toEqual([{ service: 'checkout', window: '24h' }]);
    const purge = m.requests[1]!.messages.find(
      (msg) => msg.role === 'tool' && msg.toolCallId === 'c2',
    );
    expect(purge?.content).toContain('purge_logs was not run to completion on that call');
    expect(purge?.content).toContain('check-in consent gate');
    expect(purge?.content).toContain('already paused once');
  });

  it('a middleware ask in the batch that asked gets the chain’s refusal', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .toolMiddleware({ name: 'gate', onToolCall: () => askOutcome({ question: 'approve?' }) })
      .build();
    const paused = await agent.run({ message: 'errors?' });
    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '1h' }));
    expect(isPaused(done)).toBe(false);
    expect(ran).toEqual([]);
    const result = m.requests[1]!.messages.find((msg) => msg.role === 'tool');
    expect(result?.content).toContain("middleware 'gate' asked a person to decide");
  });

  it('a tool’s own requestInput in the batch that asked settles as an error with the sentence', async () => {
    const collect = defineTool({
      name: 'collect_window',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        requestInput({
          id: 'q',
          question: 'Year?',
          fields: [{ id: 'year', type: 'number', required: true }],
        }),
    });
    const m = scripted([
      batch(
        { id: 'c1', name: 'search_logs', args: { service: 'checkout' } },
        { id: 'c2', name: 'collect_window', args: {} },
      ),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools([searchLogs([]), collect])
      .build();
    const paused = await agent.run({ message: 'go' });
    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '1h' }));
    expect(done).toBe('ok');
    const result = m.requests[1]!.messages.find(
      (msg) => msg.role === 'tool' && msg.toolCallId === 'c2',
    );
    expect(result?.content).toContain('the tool asked to pause for a person');
  });

  it('in a LATER batch, a tool’s own ask pauses and resumes as it always did', async () => {
    const collect = defineTool({
      name: 'collect_window',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        requestInput({
          id: 'q',
          question: 'Year?',
          fields: [{ id: 'year', type: 'number', required: true }],
        }),
    });
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      batch({ id: 'c2', name: 'collect_window', args: {} }),
      answer('Got the year.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools([searchLogs([]), collect])
      .build();
    const first = await agent.run({ message: 'go' });
    const second = await agent.resume(stored(first), replyTo(first, { f1: '1h' }));
    if (!isInputPause(second)) throw new Error('expected the tool’s own ask');
    expect(second.awaitingInput.context).toBeUndefined();
    const done = await agent.resume(stored(second), {
      requestId: second.awaitingInput.requestId,
      values: { year: 2026 },
    });
    expect(done).toBe('Got the year.');
  });
});

describe('the readers of a pause', () => {
  it('the answer account and the saved recording say ASK while the library’s ask waits', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('x'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'errors?' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    recorder.stop();
    expect(assessAnswer(recording).standing).toBe('ask');
    const account = accountForAnswer(recording);
    expect(account.facts.standing).toMatchObject({ value: 'ask' });
    const howSure = account.rows.find((r) => r.id === 'how-sure')!;
    expect(howSure.lines.map((l) => l.template.id)).toContain('howSure.reason.argumentAsked');
  });

  it('the commentary tells the pause, and names no tool that did not run', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('x'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    const seen: unknown[] = [];
    agent.on('*', (e) => seen.push(e));
    await agent.run({ message: 'errors?' });
    const keys = seen
      .map((e) => selectCommentaryKey(e as never))
      .filter((k) => typeof k === 'string');
    expect(keys).toContain('pause.request');
    // Nothing was dispatched and nothing was settled: no tool line, no "did not call" line.
    expect(keys).not.toContain('stream.tool_start.notDispatched');
    expect(keys.filter((k) => String(k).startsWith('stream.tool_'))).toEqual([]);
    expect(defaultCommentaryTemplates['pause.request']).toContain('paused');
  });

  it('a windowed agent resumes through the ask; the window never sees a paused call', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      batch({ id: 'c2', name: 'search_logs', args: { service: 'payments', window: '1h' } }),
      answer('done'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .build();
    const paused = await agent.run({ message: 'errors?' });
    expect(
      (agent.getSnapshot()?.sharedState as { pausedToolCallId?: string }).pausedToolCallId,
    ).toBe('');
    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '7d' }));
    expect(done).toBe('done');
    expect(ran).toEqual([
      { service: 'checkout', window: '7d' },
      { service: 'payments', window: '1h' },
    ]);
  });
});

describe('the evidence gate learns the answers', () => {
  it('an answer that states the answered period is not flagged', async () => {
    const tool = defineTool({
      name: 'search_logs',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          window: { type: 'string', enum: ['1h', '24h', '7d'] },
        },
      },
      askOrAssume: { window: { ask: 'Which period?', choices: ['1h', '24h', '7d'] } },
      // The result does not echo the period — only the person's answer carries it.
      execute: async () => ({ errors: 3 }),
    });
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('3 errors on checkout in the last 7d.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(tool)
      .namesAndNumbersFromEvidence({ posture: 'assist' } as never)
      .build();
    const paused = await agent.run({ message: 'errors on checkout?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: '7d' }));
    const state = agent.getSnapshot()?.sharedState as { unsupportedValues?: unknown };
    expect(state.unsupportedValues).toBeUndefined();
  });
});

describe('a composition — Sequence(agent) resumes the ask with a raw reply', () => {
  it('the ask pauses one subflow deep and the sequence resumes it', async () => {
    const ran: Record<string, unknown>[] = [];
    const inner = Agent.create({
      provider: scripted([
        batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
        answer('No errors.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(searchLogs(ran))
      .build();
    const seq = Sequence.create().step('ops', inner).build();
    const paused = await seq.run({ message: 'errors?' });
    if (!isInputPause(paused)) throw new Error('expected the ask through the sequence');
    const done = await seq.resume(stored(paused), {
      requestId: paused.awaitingInput.requestId,
      values: { f1: '24h' },
    });
    expect(done).toBe('No errors.');
    expect(ran).toEqual([{ service: 'checkout', window: '24h' }]);
  });
});

describe('the host’s own context — `argumentAskContext`', () => {
  it('is spread into the ask’s context beside the reserved key', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('x'),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      argumentAskContext: () => ({ routing: { step: 'metrics' } }),
    })
      .tool(searchLogs([]))
      .build();
    const paused = await agent.run({ message: 'errors?' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(paused.awaitingInput.context).toMatchObject({
      routing: { step: 'metrics' },
      agentfootprint: { ask: 'arguments' },
    });
  });
});

// ─── PROPERTY ────────────────────────────────────────────────────────

describe('PROPERTY — every answer inside the declared choices', () => {
  it('runs the call with it and files `answered` (every choice, both chart shapes)', async () => {
    for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
      for (const choice of WINDOW_CHOICES) {
        const ran: Record<string, unknown>[] = [];
        const m = scripted([
          batch({ id: 'c1', name: 'search_logs', args: { service: 's' } }),
          answer('ok'),
        ]);
        const agent = Agent.create({ provider: m.provider as never, model: 'm', reactMode })
          .tool(searchLogs(ran))
          .build();
        const paused = await agent.run({ message: 'go' });
        await agent.resume(stored(paused), replyTo(paused, { f1: choice }));
        expect(ran).toEqual([{ service: 's', window: choice }]);
        expect(argumentRows(agent).at(-1)).toMatchObject({ source: 'answered', value: choice });
      }
    }
  });

  it('a partial answer re-pauses at the door with no model call and the same request', async () => {
    const tool = defineTool({
      name: 'top_talkers',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer' }, site: { type: 'string' } },
      },
      askOrAssume: { limit: { ask: 'How many rows?' }, site: { ask: 'Which site?' } },
      execute: async (args) => ({ ...args }),
    });
    const m = scripted([batch({ id: 'c1', name: 'top_talkers', args: {} }), answer('ok')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(tool)
      .build();
    const paused = await agent.run({ message: 'go' });
    const partial = await agent.resume(stored(paused), replyTo(paused, { f1: 5 }));
    if (!isInputPause(partial)) throw new Error('expected the door to keep the ask');
    expect(partial.awaitingInput.requestId).toBe(
      (paused as { awaitingInput: { requestId: string } }).awaitingInput.requestId,
    );
    expect(partial.awaitingInput.missing).toEqual(['f2']);
    expect(m.requests).toHaveLength(1);
    expect(await agent.resume(stored(partial), replyTo(partial, { f2: 'lon' }))).toBe('ok');
  });

  it(`an integer answered 2.5 is asked again, never bound; the ${MAX_ASK_ROUNDS}rd invalid answer refuses the call`, async () => {
    const ran: Record<string, unknown>[] = [];
    const tool = defineTool({
      name: 'top_talkers',
      description: 'd',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
      askOrAssume: { limit: { ask: 'How many rows?' } },
      execute: async (args) => {
        ran.push({ ...args });
        return 'rows';
      },
    });
    const m = scripted([
      batch({ id: 'c1', name: 'top_talkers', args: {} }),
      answer('could not run it'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(tool)
      .build();
    let out: AgentOutput | RunnerPauseOutcome = await agent.run({ message: 'go' });
    const questions: string[] = [];
    for (let round = 1; round <= MAX_ASK_ROUNDS; round++) {
      if (!isInputPause(out)) throw new Error(`round ${round}: expected an ask`);
      questions.push(out.awaitingInput.question);
      out = await agent.resume(stored(out), replyTo(out, { f1: 2.5 }));
    }
    expect(questions).toEqual([
      ARGUMENT_ASK_QUESTION,
      ARGUMENT_REASK_QUESTION,
      ARGUMENT_REASK_QUESTION,
    ]);
    expect(out).toBe('could not run it');
    expect(ran).toEqual([]);
    expect(argumentRows(agent).map((r) => r.asked ?? r.source)).toEqual([
      'missing',
      'invalid-answer',
      'invalid-answer',
      'invalid-answer',
    ]);
    const refused = m.requests[1]!.messages.find((msg) => msg.role === 'tool');
    expect(refused?.content).toBe(
      "top_talkers was not run on that call: the person's answers for limit did not fit what the tool accepts (limit: integer).",
    );
    // The turn ended in an answer, not waiting: no ask reason.
    expect((await agent.assessment())?.reasons.map((r) => r.reason) ?? []).not.toContain(
      'argument-asked',
    );
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('SECURITY', () => {
  it('the ask carries none of the model’s values', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'MODEL-SERVICE-VALUE' } }),
      answer('x'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .build();
    const paused = await agent.run({ message: 'errors?' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(JSON.stringify(paused.awaitingInput)).not.toContain('MODEL-SERVICE-VALUE');
  });

  it('a host hook that uses the reserved key is refused, naming the option', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('x'),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      argumentAskContext: () => ({ agentfootprint: { ask: 'spoof' } }),
    })
      .tool(searchLogs([]))
      .build();
    await expect(agent.run({ message: 'errors?' })).rejects.toThrow(
      /argumentAskContext: returned the reserved key/,
    );
  });

  it('a hidden argument’s answer is on no row, event, note or ask context', async () => {
    const ran: Record<string, unknown>[] = [];
    const hiding = searchLogs(ran, {
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as never);
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hiding)
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'errors?' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(JSON.stringify(paused.awaitingInput.context)).not.toContain('7d');
    await agent.resume(stored(paused), replyTo(paused, { f1: '7d' }));
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
    expect(JSON.stringify(argumentRows(agent))).not.toContain('7d');
    const rowEvents = seen.filter((e) => e.type === 'agentfootprint.findings.argument');
    expect(JSON.stringify(rowEvents)).not.toContain('7d');
    expect(rowEvents.every((e) => e.payload.valueChars === undefined)).toBe(true);
    const result = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(result.content).toContain("hidden by the tool's view");
    // The note is the library's; the tool's own result is its own business.
    expect(result.content.slice(result.content.indexOf('[window'))).not.toContain('7d');
  });
});

// ─── LOAD ────────────────────────────────────────────────────────────

describe('LOAD — a batch that needs 40 fields', () => {
  it('asks in two rounds (32 + 8) and binds all 40', async () => {
    const wide = (name: string, n: number, sink: Record<string, unknown>[]) => {
      const properties: Record<string, unknown> = {};
      const rules: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        properties[`a${i}`] = { type: 'integer' };
        rules[`a${i}`] = { ask: `Value ${i}?` };
      }
      return defineTool({
        name,
        description: 'd',
        inputSchema: { type: 'object', properties },
        askOrAssume: rules as never,
        execute: async (args) => {
          sink.push({ ...args });
          return 'ok';
        },
      });
    };
    const ranA: Record<string, unknown>[] = [];
    const ranB: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'wide_a', args: {} }, { id: 'c2', name: 'wide_b', args: {} }),
      answer('done'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools([wide('wide_a', 32, ranA), wide('wide_b', 8, ranB)])
      .build();
    let out: AgentOutput | RunnerPauseOutcome = await agent.run({ message: 'go' });
    const rounds: number[] = [];
    while (isInputPause(out)) {
      const n = out.awaitingInput.fields.length;
      rounds.push(n);
      const values = Object.fromEntries(out.awaitingInput.fields.map((f, k) => [f.id, k + 1]));
      out = await agent.resume(stored(out), replyTo(out, values));
    }
    expect(rounds).toEqual([32, 8]);
    expect(out).toBe('done');
    expect(Object.keys(ranA[0]!)).toHaveLength(32);
    expect(Object.keys(ranB[0]!)).toHaveLength(8);
    expect(m.requests).toHaveLength(2);
  });
});
