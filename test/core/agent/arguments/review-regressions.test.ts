/**
 * The inputs layer (honesty layer 2) — the regressions the step-3 review
 * found, each pinned end to end through a real agent on a scripted provider
 * (or, where the reader is a pure fold, on the record it reads).
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL  — the note names only a value the call RAN with: a before-tool
 *                   middleware that rewrote a filled argument leaves that
 *                   clause out, the history message carries no boundary, and
 *                   the "Assumed" block leaves the line out; a rewrite of
 *                   another argument, or to the same value, keeps them;
 *   - SECURITY    — the inputs layer's refusals are decided BEFORE the
 *                   middleware chain, so no approval is asked for a call that
 *                   will not run; the ask-resume door re-applies both refusals
 *                   (a tool that declares rules the resuming agent cannot
 *                   apply; a checkpoint whose entry refused the call);
 *   - INTEGRATION — every reader of a result reads the TOOL's own bytes
 *                   (`lib/toolBytes.ts` · `toolBytesOf`): a filled call's `[]`
 *                   still reads `empty-undeclared` and its JSON-text absence
 *                   still reads `declared-absent`; the answer account's in-view
 *                   reading is the same with a note; the note grounds no
 *                   argument for the unsupported-argument seam and no producer
 *                   value for the empty-lookup seam — the armed run files what
 *                   its unarmed twin files;
 *   - EDGE        — two filters no other test pinned: an entry applies only to
 *                   the batch it was resolved for (a provider that reuses a
 *                   call id across iterations), and the "Assumed" block reads
 *                   this turn's rows only (a continued conversation).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  isPaused,
  type Tool,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { staticTools } from '../../../../src/tool-providers/index.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { producerCorpusOf } from '../../../../src/core/agent/stages/toolCalls.js';
import { _resetUnmountedRulesWarnings } from '../../../../src/core/agent/arguments/dispatch.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import { unreadableRulesRefusal } from '../../../../src/core/agent/arguments/serve.js';
import { accountForAnswer } from '../../../../src/lib/answer-account/account.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import {
  fixtureA,
  FLAGSHIP_RUN_ID,
  NEO_DECLARATIONS,
} from '../../../lib/answer-account/helpers.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'inputs-layer-review-mock',
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

/** `search_logs` with `window` ruled `assume: '2h'`; returns `result` (a bare `[]` by default). */
function searchLogs(ran: Record<string, unknown>[], result: unknown = []): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: SCHEMA,
    askOrAssume: { window: { assume: '2h' } },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return result;
    },
  }) as Tool;
}

const NOTE_2H =
  '\n\n[window was not in the search_logs call this result answers; the call ran with "2h", ' +
  "the value the tool's rule assumes — recorded as assumed, not as the person's.]";

const UNMOUNTED_REFUSAL =
  'search_logs was not run on that call: it declares argument rules this agent was not built to apply.';

const lastToolMessage = (requests: readonly LLMRequest[]): LLMMessage =>
  requests[requests.length - 1]!.messages.filter((m) => m.role === 'tool').at(-1)!;

const committedToolMessage = (agent: Agent): LLMMessage =>
  (agent.getSnapshot()!.sharedState.history as LLMMessage[])
    .filter((m) => m.role === 'tool')
    .at(-1)!;

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');

const reasonsOf = async (agent: Agent): Promise<string[]> =>
  ((await agent.assessment())?.reasons ?? []).map((r) => r.reason);

afterEach(() => {
  _resetUnmountedRulesWarnings();
  vi.restoreAllMocks();
});

// ─── FUNCTIONAL — the note names only a value the call ran with ──────

describe('a before-tool middleware rewrites an argument the layer FILLED', () => {
  const rewrite = (
    args: (a: Record<string, unknown>) => Record<string, unknown>,
    from?: { window: 'person' | 'app' | 'default' },
  ): ToolMiddleware => ({
    name: 'absolute-window',
    onToolCall: (c) =>
      c.toolName !== 'search_logs'
        ? allow()
        : from === undefined
        ? allow(args(c.args), 'window from the receipt')
        : allow(args(c.args), 'window from the receipt', { from }),
  });

  it('the note leaves the rewritten clause out, the message carries no boundary, the answer names no assumption', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .toolMiddleware(rewrite((a) => ({ ...a, window: '24h' })))
      .limitsTravelWithTheAnswer()
      .build();
    const out = await agent.run({ message: 'any errors on checkout?' });

    // The tool ran with the middleware's value, not the fill.
    expect(ran).toEqual([{ service: 'checkout', window: '24h' }]);
    // The model reads the tool's own bytes — no sentence saying it ran with "2h".
    expect(lastToolMessage(m.requests).content).toBe('[]');
    expect(committedToolMessage(agent)).not.toHaveProperty('toolChars');
    // The person's answer names no value the call did not run with.
    expect(String(out)).toBe('No errors.');
    // The row stays the layer's verdict; the standing reads the rewrite (no
    // declared origin → assumed) AND the empty result the rewrite ran on.
    expect(argumentRows(agent)).toMatchObject([{ source: 'default', value: '2h' }]);
    const standing = (await agent.assessment())!;
    expect(standing.reasons.map((r) => r.reason)).toEqual(['argument-assumed', 'empty-undeclared']);
    expect(standing.reasons[0]!.witness[0]).toMatchObject({ key: 'middlewareDecisions' });
  });

  it("declared the person's: nothing is assumed — and the bare [] still reads not sure", async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .toolMiddleware(rewrite((a) => ({ ...a, window: '24h' }), { window: 'person' }))
      .build();
    await agent.run({ message: 'any errors on checkout in the last day?' });
    expect(await reasonsOf(agent)).toEqual(['empty-undeclared']);
  });

  it('a rewrite of ANOTHER argument keeps the fill’s clause, its boundary and its line', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'Checkout' }), answer('No errors.')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .toolMiddleware(rewrite((a) => ({ ...a, service: String(a.service).toLowerCase() })))
      .limitsTravelWithTheAnswer()
      .build();
    const out = await agent.run({ message: 'any errors on Checkout?' });
    expect(ran).toEqual([{ service: 'checkout', window: '2h' }]);
    expect(lastToolMessage(m.requests).content).toBe(`[]${NOTE_2H}`);
    expect(committedToolMessage(agent).toolChars).toBe(2);
    expect(String(out)).toBe(
      'No errors.\n\n---\n\nAssumed (a tool\'s rule, not your words):\n- window = "2h" (search_logs)',
    );
  });

  it('a rewrite to the SAME value keeps the clause — the call ran with the fill', async () => {
    const m = scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs([]))
      .toolMiddleware(rewrite((a) => ({ ...a, window: '2h' })))
      .limitsTravelWithTheAnswer()
      .build();
    const out = await agent.run({ message: 'any errors on checkout?' });
    expect(lastToolMessage(m.requests).content).toBe(`[]${NOTE_2H}`);
    expect(String(out)).toContain('- window = "2h" (search_logs)');
  });
});

// ─── SECURITY — the refusals come before the middleware chain ───────

describe('a call the inputs layer refuses is never put to a person', () => {
  const approveEveryCall: ToolMiddleware = {
    name: 'approve-every-call',
    onToolCall: () => ask({ question: 'Run this tool?' }),
  };

  it('a ruled tool only a ToolProvider serves, on an agent without the layer: refused, never paused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .toolProvider(staticTools([searchLogs(ran)]))
      .toolMiddleware(approveEveryCall)
      .build();
    const out = await agent.run({ message: 'errors on a?' });
    expect(isPaused(out)).toBe(false);
    expect(ran).toEqual([]);
    expect(lastToolMessage(m.requests).content).toBe(UNMOUNTED_REFUSAL);
    // The chain was never walked: no link was asked, no decision was filed.
    expect(agent.getSnapshot()!.sharedState.middlewareDecisions).toBeUndefined();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('.inputsLayer()'))).toHaveLength(1);
  });

  it('a rule the dispatch re-read cannot read: refused, never paused', async () => {
    const ran: Record<string, unknown>[] = [];
    const handBuilt = {
      ...searchLogs(ran),
      askOrAssume: { window: { assume: '9h' } }, // outside the enum — defineTool never saw it
    } as unknown as Tool;
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(handBuilt)
      .toolMiddleware(approveEveryCall)
      .build();
    const out = await agent.run({ message: 'errors on a?' });
    expect(isPaused(out)).toBe(false);
    expect(ran).toEqual([]);
    expect(lastToolMessage(m.requests).content).toMatch(
      /^search_logs was not run on that call: its argument rules could not be read/,
    );
    expect(agent.getSnapshot()!.sharedState.middlewareDecisions).toBeUndefined();
  });

  it('the ask-resume door: a tool that declares rules by the time the person approves is refused there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A provider-served tool whose rules appear between the pause and the
    // resume — the door must ask the question itself, not trust the pause.
    let ruled = false;
    const ran: Record<string, unknown>[] = [];
    const plain = defineTool({
      name: 'search_logs',
      description: 'Error lines for one service over a look-back period.',
      inputSchema: SCHEMA,
      execute: async (args) => {
        ran.push({ ...args });
        return [];
      },
    }) as Tool;
    const shifting = {
      ...plain,
      get askOrAssume() {
        return ruled ? { window: { assume: '2h' } } : undefined;
      },
    } as unknown as Tool;
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .toolProvider(staticTools([shifting]))
      .toolMiddleware(approveEveryCall)
      .build();
    const paused = await agent.run({ message: 'errors on a?' });
    expect(isPaused(paused)).toBe(true);
    ruled = true;
    if (!isPaused(paused)) return;
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));
    expect(ran).toEqual([]);
    expect(lastToolMessage(m.requests).content).toBe(UNMOUNTED_REFUSAL);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('.inputsLayer()'))).toHaveLength(1);
  });

  it('the ask-resume door: a checkpoint whose entry refused the paused call is refused there', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([call('c1', 'search_logs', { service: 'a' }), answer('could not')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .toolMiddleware(approveEveryCall)
      .build();
    const paused = await agent.run({ message: 'errors on a?' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    // The shape a runtime that decided the refusal AFTER the chain left on
    // its checkpoint: the layer's entry refuses the call the ask paused on.
    const refused = unreadableRulesRefusal('search_logs', 'askOrAssume.window.assume — "9h"');
    const state = (paused.checkpoint as unknown as { sharedState: Record<string, unknown> })
      .sharedState;
    state.argumentResolutions = [{ toolCallId: 'c1', iteration: 1, refused }];
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));
    expect(ran).toEqual([]);
    expect(lastToolMessage(m.requests).content).toBe(refused);
  });
});

// ─── INTEGRATION — every reader reads the tool's own bytes ──────────

describe('the note hides no reading of the result it follows', () => {
  it('a filled call’s bare [] reads empty-undeclared beside argument-assumed', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .build();
    await agent.run({ message: 'errors on a?' });
    const standing = (await agent.assessment())!;
    expect(standing.reasons.map((r) => r.reason)).toEqual(['argument-assumed', 'empty-undeclared']);
    expect(standing.checked.find((c) => c.check === 'result-shape')).toMatchObject({
      ran: 1,
      of: 1,
    });
  });

  it('a filled call’s JSON-text absence (an MCP client in text mode) reads declared-absent, and it declared what it covered', async () => {
    const envelope = JSON.stringify(
      absent({ what: 'error lines for checkout', checked: ['the log index for the window asked'] }),
    );
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([], envelope))
      .build();
    await agent.run({ message: 'any errors on checkout?' });
    const standing = (await agent.assessment())!;
    expect(standing.reasons.map((r) => r.reason)).toEqual(['argument-assumed', 'declared-absent']);
    expect(standing.checked.find((c) => c.check === 'tool-coverage')).toMatchObject({
      ran: 1,
      of: 1,
    });
  });

  it('the answer account reads an earlier answer’s filled result the same, note or no note', () => {
    const id = 'toolu_01YQPyS4gmUrsi8mv52oj1DE';
    const inViewOf = (edit: (m: Record<string, unknown>) => void) => {
      const rec = fixtureA() as unknown as {
        snapshot: { sharedState: { history: Record<string, unknown>[] } };
      };
      const message = rec.snapshot.sharedState.history.find(
        (m) => m.role === 'tool' && m.toolCallId === id,
      )!;
      edit(message);
      return accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
        runId: FLAGSHIP_RUN_ID,
      }).facts.inView[0]!;
    };
    const plain = inViewOf(() => undefined);
    expect(plain.emptiness).toBe('undeclared-empty');
    const annotated = inViewOf((m) => {
      m.toolChars = (m.content as string).length;
      m.content = `${m.content as string}${NOTE_2H}`;
    });
    expect(annotated.emptiness).toBe(plain.emptiness);
    expect(annotated.emptinessSource).toBe(plain.emptinessSource);
  });
});

describe('the note grounds nothing for the integrity seams (honesty law 4)', () => {
  const contextErrorKinds = async (
    tools: readonly Tool[],
    script: readonly Reply[],
    options: { noticeEmptyLookups?: true } = {},
  ): Promise<string[]> => {
    let builder = Agent.create({
      provider: scripted(script).provider as never,
      model: 'm',
      ...options,
    });
    for (const t of tools) builder = builder.tool(t);
    const agent = builder.build();
    const kinds: string[] = [];
    agent.on('agentfootprint.integrity.context_error', (e) =>
      kinds.push((e.payload as { kind: string }).kind),
    );
    await agent.run({ message: 'go' });
    return kinds;
  };

  it('unsupported-argument: a value only the note carries is not one the run served', async () => {
    const openSession = (armed: boolean): Tool =>
      defineTool({
        name: 'open_session',
        description: 'Open a session against an environment.',
        inputSchema: {
          type: 'object',
          properties: { env: { type: 'string', enum: ['production', 'staging'] } },
        },
        ...(armed && { askOrAssume: { env: { assume: 'production' } } }),
        execute: async () => ({ ok: true }),
      }) as Tool;
    const deployStatus = defineTool({
      name: 'deploy_status',
      description: 'Deploy status of one environment.',
      inputSchema: { type: 'object', properties: { env: { type: 'string' } }, required: ['env'] },
      argumentsFrom: ['list_envs'],
      execute: async () => ({ status: 'green' }),
    }) as Tool;
    const listEnvs = defineTool({
      name: 'list_envs',
      description: 'List environments.',
      execute: async () => ({ envs: ['qa-east', 'qa-west'] }),
    }) as Tool;
    const script = [
      call('c1', 'open_session', {}),
      call('c2', 'deploy_status', { env: 'production' }),
      answer('green'),
    ];
    const unarmed = await contextErrorKinds([openSession(false), deployStatus, listEnvs], script);
    const armed = await contextErrorKinds([openSession(true), deployStatus, listEnvs], script);
    expect(unarmed).toEqual(['unsupported-argument']);
    expect(armed).toEqual(unarmed);
  });

  it('empty-lookup: a host only the note carries is not one the producer served', async () => {
    const openSession = (armed: boolean): Tool =>
      defineTool({
        name: 'open_session',
        description: 'Open a session on a host.',
        inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
        ...(armed && { askOrAssume: { host: { assume: 'host-0042' } } }),
        execute: async () => ({ ok: true }),
      }) as Tool;
    const portLogins = defineTool({
      name: 'port_logins',
      description: 'Port logins for one host.',
      inputSchema: {
        type: 'object',
        properties: { host: { type: 'string' } },
        required: ['host'],
      },
      argumentsFrom: ['open_session'],
      execute: async () => [],
    }) as Tool;
    const script = [
      call('c1', 'open_session', {}),
      call('c2', 'port_logins', { host: 'host-0042' }),
      answer('no logins'),
    ];
    const options = { noticeEmptyLookups: true } as const;
    const unarmed = await contextErrorKinds([openSession(false), portLogins], script, options);
    const armed = await contextErrorKinds([openSession(true), portLogins], script, options);
    expect(unarmed).toEqual(['unsupported-argument']);
    expect(armed).toEqual(unarmed);
  });

  it('producerCorpusOf reads each producer result as the tool’s own bytes', () => {
    const produced = producerCorpusOf(
      [
        {
          role: 'tool',
          toolCallId: 'c1',
          toolName: 'open_session',
          content: '{"ok":true}\n\n[host was not in the open_session call this result answers; …]',
          toolChars: '{"ok":true}'.length,
        },
        { role: 'tool', toolCallId: 'c2', toolName: 'open_session', content: '{"host":"h-7"}' },
      ],
      ['open_session'],
    );
    expect(produced).toEqual([
      { toolName: 'open_session', text: '{"ok":true}' },
      { toolName: 'open_session', text: '{"host":"h-7"}' },
    ]);
  });
});

// ─── EDGE — the two filters no other test pinned ────────────────────

describe('an entry applies to its own batch; the "Assumed" block to its own turn', () => {
  it('a provider that reuses a call id: the later batch runs with its OWN value, never the earlier fill', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'search_logs', { service: 'a' }),
        call('c1', 'search_logs', { service: 'b', window: '24h' }),
        answer('ok'),
      ]).provider as never,
      model: 'm',
    })
      .tool(searchLogs(ran))
      .build();
    await agent.run({ message: 'go' });
    expect(ran).toEqual([
      { service: 'a', window: '2h' },
      { service: 'b', window: '24h' },
    ]);
    expect(argumentRows(agent).map((r) => [r.iteration, r.source, r.value])).toEqual([
      [1, 'default', '2h'],
      [2, 'model', '24h'],
    ]);
  });

  it('turn 2 that calls nothing carries no "Assumed" block from turn 1', async () => {
    const first = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'a' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .limitsTravelWithTheAnswer()
      .build();
    expect(String(await first.run({ message: 'errors?' }))).toContain(
      '- window = "2h" (search_logs)',
    );
    const second = Agent.create({
      provider: scripted([answer('hello again')]).provider as never,
      model: 'm',
    })
      .tool(searchLogs([]))
      .limitsTravelWithTheAnswer()
      .build();
    const two = await second.run({ message: 'thanks', continueFrom: first.checkpoint()! });
    expect(String(two)).toBe('hello again');
  });
});
