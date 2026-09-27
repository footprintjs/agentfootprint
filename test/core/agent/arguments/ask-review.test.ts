/**
 * The inputs layer's batch ask (honesty layer 2, step 4) — the regressions the
 * step-4 review found, each pinned end to end through a real agent on a
 * scripted provider. The FUNCTIONAL, EDGE and SECURITY cases fail on the
 * reviewed tree (72bb99ee); the INTEGRATION case and the last SECURITY case
 * (every other pause kind's resume event, unchanged) pin behaviour the review
 * found untested, and fail on the mutations that would break it.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL  — the SAME call needs the library's ask AND a second human
 *                   step (its own check-in, a middleware `ask`, the tool's own
 *                   `requestInput`, a credential consent): the batch that asked
 *                   has no second pause to give, so the step is refused — and
 *                   the person's answer is KEPT (`arguments/kept.ts`), the
 *                   model's next proposal of the call runs with it, and the
 *                   step pauses there. The person is asked once. Before the
 *                   fix, the library asked the same question every batch and
 *                   the tool never ran;
 *   - EDGE        — a kept answer is used ONCE (a later call of the tool is
 *                   asked again, as every batch is); a proposal refused AGAIN
 *                   by the same law keeps its answer again, so the loop always
 *                   converges;
 *   - INTEGRATION — a credential consent in the batch that asked, under the
 *                   default `'pause'`: the model reads the credential's own
 *                   sentence and, when it finishes the turn without proposing
 *                   the call again, the turn raises
 *                   `CredentialConsentRequiredError` (the model's answer is not
 *                   returned). (The evidence gate's exemption for answered
 *                   values is pinned, with a value the gate really reads and
 *                   its control, in `ask-layer.test.ts`.);
 *   - SECURITY    — a hidden argument's answer reaches no surface a viewer or
 *                   a recording reads: not the `pause.resume` event (it carries
 *                   the reply's shape, each value `'REDACTED'`), not any other
 *                   event, the recording, the snapshot, the narrative, the
 *                   rows, the served messages or the ask context — on the
 *                   direct, the hosted and the composed resume.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  Sequence,
  checkInApproved,
  defineTool,
  isAskPause,
  isCheckInPause,
  isInputPause,
  isPaused,
  requestInput,
  type AgentOutput,
  type RunnerPauseOutcome,
  type Tool,
} from '../../../../src/index.js';
import { recordRun } from '../../../../src/observe.js';
import {
  bearer,
  CredentialConsentRequiredError,
  type CredentialProvider,
  type CredentialResult,
} from '../../../../src/identity.js';
import { ask as askOutcome } from '../../../../src/core/agent/middleware/outcomes.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { inProcessHost } from '../../../hosting/testHost.js';
import { memorySessions, standingAgent } from '../../../../src/hosting/index.js';

// ─── the harness ─────────────────────────────────────────────────────

type Call = { id: string; name: string; args: Readonly<Record<string, unknown>> };
type Reply = { content: string; toolCalls?: Call[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'ask-review-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
          stopReason: reply.toolCalls !== undefined ? 'tool_use' : 'end_turn',
        };
      },
    },
  };
}

const batch = (...calls: Call[]): Reply => ({
  content: '',
  toolCalls: calls,
});
const answer = (content: string): Reply => ({ content });

const WINDOWS = ['1h', '24h', '7d'] as const;
const windowRule = (question: string) => ({ window: { ask: question, choices: [...WINDOWS] } });
const windowSchema = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string' },
    window: { type: 'string', enum: [...WINDOWS] },
  },
} as const;

/** A tool whose period the person is asked for — and which ALSO asks a person itself. */
function purgeLogs(ran: Record<string, unknown>[], extra: Record<string, unknown> = {}): Tool {
  return defineTool({
    name: 'purge_logs',
    description: 'Delete one service’s log lines older than a period.',
    inputSchema: windowSchema,
    askOrAssume: windowRule('Which period should the purge keep?'),
    execute: async (args: Record<string, unknown>) => {
      ran.push({ ...args });
      return 'purged';
    },
    ...extra,
  } as never);
}

function searchLogs(ran: Record<string, unknown>[]): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: windowSchema,
    askOrAssume: windowRule('Which period should the search cover?'),
    execute: async (args) => {
      ran.push({ ...args });
      return { errors: 0 };
    },
  });
}

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');

type Event = { type: string; payload: Record<string, unknown> };
function events(runner: { on: Agent['on'] }): Event[] {
  const out: Event[] = [];
  runner.on('*', (e) => out.push({ type: e.type, payload: e.payload as never }));
  return out;
}

/** The pauses the LIBRARY's own ask raised — read off the typed `pause.request` events. */
const libraryAsks = (seen: readonly Event[]): Event[] =>
  seen.filter(
    (e) =>
      e.type === 'agentfootprint.pause.request' &&
      JSON.stringify(e.payload.questionPayload).includes('"ask":"arguments"'),
  );

const replyTo = (out: AgentOutput | RunnerPauseOutcome, values: Record<string, unknown>) => {
  if (!isInputPause(out)) throw new Error(`expected an input pause, got ${JSON.stringify(out)}`);
  return { requestId: out.awaitingInput.requestId, values };
};

/** The checkpoint as a host would store it: detached, through JSON. */
const stored = (out: AgentOutput | RunnerPauseOutcome) => {
  if (!isPaused(out)) throw new Error('expected a pause');
  return JSON.parse(JSON.stringify(out.checkpoint)) as RunnerPauseOutcome['checkpoint'];
};

const toolMessage = (req: LLMRequest | undefined, toolCallId: string) =>
  req?.messages.find((msg) => msg.role === 'tool' && msg.toolCallId === toolCallId);

/** The clause a refusal gains when the call carried the person's answer (`serve.ts` · `keptAnswersNote`). */
const keptWindow = (tool: string): string =>
  `The person's answer for window was kept for the next ${tool} call that leaves it out, ` +
  'so the call may be proposed again without window.';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── BLOCKING 1 — the same call needs the ask AND a second human step ───

describe('the SAME call needs the ask and a second human step — asked once, the answer kept', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`its own check-in: refused after the ask, then paused on the next proposal, and it runs (${reactMode})`, async () => {
      const ran: Record<string, unknown>[] = [];
      const m = scripted([
        batch({ id: 'c1', name: 'purge_logs', args: { service: 'checkout' } }),
        // The model proposes the refused call again, leaving the ask argument out —
        // as the served schema tells it to.
        batch({ id: 'c2', name: 'purge_logs', args: { service: 'checkout' } }),
        answer('Purged.'),
      ]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm', reactMode })
        .tool(purgeLogs(ran, { checkIn: 'always' }))
        .build();
      const seen = events(agent);

      const asked = await agent.run({ message: 'purge old checkout logs' });
      expect(isInputPause(asked)).toBe(true);
      const second = await agent.resume(stored(asked), replyTo(asked, { f1: '24h' }));

      // The batch that asked had no second pause: the check-in was refused, the
      // answer kept, and the model was told both.
      const refusal = toolMessage(m.requests[1], 'c1')?.content ?? '';
      expect(refusal).toContain('purge_logs was not run to completion on that call');
      expect(refusal).toContain('check-in consent gate');
      expect(refusal).toContain(keptWindow('purge_logs'));
      // The next proposal ran on the kept answer and paused for ITS check-in —
      // not for the library's question again.
      expect(isCheckInPause(second)).toBe(true);
      expect(isInputPause(second)).toBe(false);
      if (!isCheckInPause(second)) throw new Error('unreachable');
      expect(second.checkIn.args).toEqual({ service: 'checkout', window: '24h' });
      expect(ran).toEqual([]);

      const done = await agent.resume(stored(second), checkInApproved({ by: 'ops' }));
      expect(done).toBe('Purged.');
      expect(ran).toEqual([{ service: 'checkout', window: '24h' }]);
      // Asked ONCE; three model calls, none for the resume of either pause.
      expect(libraryAsks(seen)).toHaveLength(1);
      expect(m.requests).toHaveLength(3);
      // The record: c1 asked and answered; c2 answered from the kept answer, with
      // no asked row — nobody was asked in its batch.
      expect(argumentRows(agent).map((r) => [r.toolCallId, r.asked ?? r.source, r.value])).toEqual([
        ['c1', 'missing', undefined],
        ['c1', 'answered', '24h'],
        ['c2', 'answered', '24h'],
      ]);
      // The kept answer was used once and is gone.
      const state = agent.getSnapshot()?.sharedState as { argumentAnswersKept?: unknown };
      expect(state.argumentAnswersKept).toBeUndefined();
    });
  }

  it('a middleware `ask`: refused after the ask, then asked on the next proposal, and it runs', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      batch({ id: 'c2', name: 'search_logs', args: { service: 'checkout' } }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(searchLogs(ran))
      .toolMiddleware({ name: 'gate', onToolCall: () => askOutcome({ question: 'Approve?' }) })
      .build();
    const seen = events(agent);
    const asked = await agent.run({ message: 'errors on checkout?' });
    const second = await agent.resume(stored(asked), replyTo(asked, { f1: '7d' }));
    const refusal = toolMessage(m.requests[1], 'c1')?.content ?? '';
    expect(refusal).toContain("middleware 'gate' asked a person to decide");
    expect(refusal).toContain(keptWindow('search_logs'));
    expect(isAskPause(second)).toBe(true);
    const done = await agent.resume(stored(second), checkInApproved({ by: 'ops' }));
    expect(done).toBe('No errors.');
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
    expect(libraryAsks(seen)).toHaveLength(1);
  });

  it('the tool’s own `requestInput`: refused after the ask, then paused on the next proposal', async () => {
    const ran: Record<string, unknown>[] = [];
    const exportLogs = defineTool({
      name: 'export_logs',
      description: 'Export one service’s log lines over a period.',
      inputSchema: windowSchema,
      askOrAssume: windowRule('Which period should the export cover?'),
      execute: async (args) => {
        ran.push({ ...args });
        return requestInput({
          id: 'format',
          question: 'Which file format?',
          fields: [{ id: 'format', type: 'string', required: true, enum: ['csv', 'json'] }],
        });
      },
    });
    const m = scripted([
      batch({ id: 'c1', name: 'export_logs', args: { service: 'checkout' } }),
      batch({ id: 'c2', name: 'export_logs', args: { service: 'checkout' } }),
      answer('Exported.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(exportLogs)
      .build();
    const seen = events(agent);
    const asked = await agent.run({ message: 'export the checkout logs' });
    const second = await agent.resume(stored(asked), replyTo(asked, { f1: '1h' }));
    const refusal = toolMessage(m.requests[1], 'c1')?.content ?? '';
    expect(refusal).toContain('the tool asked to pause for a person');
    expect(refusal).toContain(keptWindow('export_logs'));
    // The second pause is the TOOL's own typed ask — not the library's.
    if (!isInputPause(second)) throw new Error('expected the tool’s own ask');
    expect(second.awaitingInput.context).toBeUndefined();
    expect(second.awaitingInput.question).toBe('Which file format?');
    // Both passes ran on the person's period: the answer, then the kept answer.
    expect(ran).toEqual([
      { service: 'checkout', window: '1h' },
      { service: 'checkout', window: '1h' },
    ]);
    const done = await agent.resume(stored(second), {
      requestId: second.awaitingInput.requestId,
      values: { format: 'csv' },
    });
    expect(done).toBe('Exported.');
    expect(libraryAsks(seen)).toHaveLength(1);
  });

  it('a credential consent (default `pause`): told after the ask, then paused on the next proposal, and it runs', async () => {
    const vault = { granted: false };
    const credentials: CredentialProvider = {
      id: 'test-3lo',
      getCredential: (): Promise<CredentialResult> =>
        Promise.resolve(
          vault.granted
            ? { status: 'issued', credential: bearer('tok') }
            : {
                status: 'authorization-required',
                authorizationUrl: 'https://idp.example.test/authorize?state=s1',
                sessionId: 'sess-1',
              },
        ),
    };
    const ran: Record<string, unknown>[] = [];
    const pay = defineTool({
      name: 'pay_invoice',
      description: 'Pay an outstanding invoice.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, method: { type: 'string', enum: ['card', 'wire'] } },
      },
      askOrAssume: { method: { ask: 'How should it be paid?', choices: ['card', 'wire'] } },
      needs: { credential: 'billing', mode: 'user', scopes: ['invoice.write'] },
      execute: async (args) => {
        ran.push({ ...args });
        return 'PAID';
      },
    });
    const m = scripted([
      batch({ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }),
      batch({ id: 'c2', name: 'pay_invoice', args: { id: 'INV-42' } }),
      answer('Paid by wire.'),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      credentials,
    } as never)
      .tool(pay)
      .build();
    const seen = events(agent);
    const asked = await agent.run({ message: 'pay INV-42' });
    const second = await agent.resume(stored(asked), replyTo(asked, { f1: 'wire' }));
    // The batch that asked: the credential's own sentence — and the answer kept.
    expect(toolMessage(m.requests[1], 'c1')?.content).toContain(
      "authorization required: 'billing'",
    );
    // The next proposal asks for CONSENT, not for the method again.
    expect(isPaused(second)).toBe(true);
    expect(isInputPause(second)).toBe(false);
    expect(
      (second as { pauseData?: { authorization?: { service?: string } } }).pauseData?.authorization
        ?.service,
    ).toBe('billing');
    vault.granted = true; // the person consented, out of band
    const done = await agent.resume(stored(second), undefined as never);
    expect(done).toBe('Paid by wire.');
    expect(ran).toEqual([{ id: 'INV-42', method: 'wire' }]);
    expect(libraryAsks(seen)).toHaveLength(1);
  });
});

describe('a kept answer — used once, kept again only by the same law', () => {
  it('a LATER call of the same tool, after the kept answer ran, is asked again', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'purge_logs', args: { service: 'checkout' } }),
      batch({ id: 'c2', name: 'purge_logs', args: { service: 'checkout' } }),
      batch({ id: 'c3', name: 'purge_logs', args: { service: 'payments' } }),
      answer('Done.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(purgeLogs(ran, { checkIn: 'always' }))
      .build();
    const asked = await agent.run({ message: 'purge checkout, then payments' });
    const checkIn = await agent.resume(stored(asked), replyTo(asked, { f1: '24h' }));
    const third = await agent.resume(stored(checkIn), checkInApproved({ by: 'ops' }));
    // c3 is a new call the person was never asked about: the library asks.
    if (!isInputPause(third)) throw new Error('expected the library’s ask for c3');
    expect(third.awaitingInput.context).toMatchObject({
      agentfootprint: {
        ask: 'arguments',
        fields: [{ tool: 'purge_logs', argument: 'window', calls: ['c3'] }],
      },
    });
    expect(ran).toEqual([{ service: 'checkout', window: '24h' }]);
  });

  it('a proposal refused AGAIN (its batch asked for something else) keeps the answer again — the loop converges', async () => {
    const purged: Record<string, unknown>[] = [];
    const searched: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'purge_logs', args: { service: 'checkout' } }),
      // The proposal comes back beside a NEW call that needs its own answer, so
      // this batch asks too — and the purge's check-in is refused again.
      batch(
        { id: 'c2', name: 'purge_logs', args: { service: 'checkout' } },
        { id: 's1', name: 'search_logs', args: { service: 'checkout' } },
      ),
      batch({ id: 'c3', name: 'purge_logs', args: { service: 'checkout' } }),
      answer('Done.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tools([purgeLogs(purged, { checkIn: 'always' }), searchLogs(searched)])
      .build();
    const seen = events(agent);
    const first = await agent.run({ message: 'purge and search' });
    const second = await agent.resume(stored(first), replyTo(first, { f1: '24h' }));
    // The second batch asks ONLY for the search's period: the purge's is kept.
    if (!isInputPause(second)) throw new Error('expected the library’s ask for s1');
    expect(second.awaitingInput.context).toMatchObject({
      agentfootprint: { fields: [{ tool: 'search_logs', argument: 'window', calls: ['s1'] }] },
    });
    const third = await agent.resume(stored(second), replyTo(second, { f1: '1h' }));
    expect(toolMessage(m.requests[2], 'c2')?.content).toContain(keptWindow('purge_logs'));
    // …and the third proposal pauses for the check-in, on the answer given once.
    if (!isCheckInPause(third)) throw new Error('expected the purge’s check-in');
    expect(third.checkIn.args).toEqual({ service: 'checkout', window: '24h' });
    await agent.resume(stored(third), checkInApproved({ by: 'ops' }));
    expect(purged).toEqual([{ service: 'checkout', window: '24h' }]);
    expect(searched).toEqual([{ service: 'checkout', window: '1h' }]);
    expect(libraryAsks(seen)).toHaveLength(2);
  });
});

// ─── A credential consent in the batch that asked (the model does not retry) ─

describe('a credential consent in the batch that asked — the model reads the credential’s sentence', () => {
  it('under the default `pause`, a turn finished without the call raises CredentialConsentRequiredError', async () => {
    const ran: Record<string, unknown>[] = [];
    const credentials: CredentialProvider = {
      id: 'test-3lo',
      getCredential: (): Promise<CredentialResult> =>
        Promise.resolve({
          status: 'authorization-required',
          authorizationUrl: 'https://idp.example.test/authorize?state=s1',
          sessionId: 'sess-1',
        }),
    };
    const pay = defineTool({
      name: 'pay_invoice',
      description: 'Pay an outstanding invoice.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      needs: { credential: 'billing', mode: 'user', scopes: ['invoice.write'] },
      execute: async (args) => {
        ran.push({ paid: args.id });
        return 'PAID';
      },
    });
    const m = scripted([
      batch(
        { id: 'c1', name: 'search_logs', args: { service: 'checkout' } },
        { id: 'c2', name: 'pay_invoice', args: { id: 'INV-42' } },
      ),
      answer('Searched; the payment needs your authorization.'),
    ]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      credentials,
    } as never)
      .tools([searchLogs(ran), pay])
      .build();
    const asked = await agent.run({ message: 'search, then pay INV-42' });
    await expect(agent.resume(stored(asked), replyTo(asked, { f1: '1h' }))).rejects.toBeInstanceOf(
      CredentialConsentRequiredError,
    );
    // The search ran on the answer; the payment did not run, and the model read
    // the credential's own sentence for it — a result for every call it made.
    expect(ran).toEqual([{ service: 'checkout', window: '1h' }]);
    const told = toolMessage(m.requests[1], 'c2')?.content ?? '';
    expect(told).toContain("authorization required: 'billing'");
    expect(told).not.toContain('idp.example.test');
  });
});

// ─── BLOCKING 2 — a hidden argument's answer reaches no surface ────────

describe('SECURITY — a hidden argument’s answer reaches no surface a viewer or a recording reads', () => {
  const SECRET = 'ACCT-99887766';

  function lookupAccount(ran: Record<string, unknown>[]): Tool {
    const tool = defineTool({
      name: 'lookup_account',
      description: 'Look an account up.',
      inputSchema: {
        type: 'object',
        properties: { account: { type: 'string' }, region: { type: 'string' } },
      },
      askOrAssume: { account: { ask: 'Which account number?' } },
      execute: async (args) => {
        ran.push({ ...args });
        return 'found';
      },
    });
    return {
      ...tool,
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'account' in args ? { ...args, account: 'REDACTED' } : args,
    } as never;
  }

  const script = () =>
    scripted([
      batch({ id: 'c1', name: 'lookup_account', args: { region: 'eu' } }),
      answer('Found it.'),
    ]);

  /** The resume event's reply: the shape travels, the value does not. */
  function expectRedactedResume(seen: readonly Event[]): void {
    const resumes = seen.filter((e) => e.type === 'agentfootprint.pause.resume');
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.payload.resumeInput).toMatchObject({ values: { f1: 'REDACTED' } });
  }

  it('direct resume: every event, the recording, the snapshot, the narrative, the rows, the served messages', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = script();
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seen = events(agent);
    const recorder = recordRun(agent);
    const asked = await agent.run({ message: 'look my account up' });
    if (!isInputPause(asked)) throw new Error('expected the ask');
    const askContext = JSON.stringify(asked.awaitingInput);
    await agent.resume(stored(asked), replyTo(asked, { f1: SECRET }));
    // The positive control: the call DID run with the person's value.
    expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
    expectRedactedResume(seen);
    const surfaces: Record<string, string> = {
      events: JSON.stringify(seen),
      recording: JSON.stringify(recorder.toRecording()),
      snapshot: JSON.stringify(agent.getSnapshot() ?? {}),
      narrative: JSON.stringify(agent.getLastNarrativeEntries()),
      rows: JSON.stringify(agent.findings() ?? []),
      served: JSON.stringify(m.requests.map((r) => r.messages)),
      askContext,
    };
    recorder.stop();
    for (const [name, blob] of Object.entries(surfaces)) {
      expect(blob, `${name} carries the hidden answer`).not.toContain(SECRET);
    }
  });

  it('the hosted resume: no event carries it', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: script().provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seen = events(agent);
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const first = await host.deliver({ input: 'look my account up', sessionId: 's' });
      const pending = first.awaiting!.awaitingInput!;
      const done = await host.deliver({
        input: '',
        sessionId: 's',
        decision: { requestId: pending.requestId, values: { f1: SECRET } },
      });
      expect(done.output).toBe('Found it.');
      expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
      expectRedactedResume(seen);
      expect(JSON.stringify(seen)).not.toContain(SECRET);
    } finally {
      await handle.close();
    }
  });

  it('the composed resume (Sequence with a raw reply): no event carries it', async () => {
    const ran: Record<string, unknown>[] = [];
    const inner = Agent.create({ provider: script().provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seq = Sequence.create().step('ops', inner).build();
    const seen = events(seq as never);
    const asked = await seq.run({ message: 'look my account up' });
    if (!isInputPause(asked)) throw new Error('expected the ask through the sequence');
    await seq.resume(stored(asked), {
      requestId: asked.awaitingInput.requestId,
      values: { f1: SECRET },
    });
    expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
    expectRedactedResume(seen);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('every OTHER pause kind keeps its reply on the resume event, unchanged', async () => {
    const collect = defineTool({
      name: 'collect_year',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        requestInput({
          id: 'q',
          question: 'Year?',
          fields: [{ id: 'year', type: 'number', required: true }],
        }),
    });
    const agent = Agent.create({
      provider: scripted([batch({ id: 'c1', name: 'collect_year', args: {} }), answer('ok')])
        .provider as never,
      model: 'm',
    })
      .tool(collect)
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'go' });
    await agent.resume(stored(paused), replyTo(paused, { year: 2026 }));
    const resume = seen.find((e) => e.type === 'agentfootprint.pause.resume');
    expect(resume?.payload.resumeInput).toMatchObject({ values: { year: 2026 } });
  });
});
