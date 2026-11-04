import {
  scripted,
  batch,
  answer,
  events,
  replyTo,
  stored,
  type Event,
} from './askReviewHarness.js';
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
  checkInApproved,
  defineTool,
  isAskPause,
  isCheckInPause,
  isInputPause,
  isPaused,
  requestInput,
  type Tool,
} from '../../../../src/index.js';
import {
  bearer,
  CredentialConsentRequiredError,
  type CredentialProvider,
  type CredentialResult,
} from '../../../../src/identity.js';
import { ask as askOutcome } from '../../../../src/core/agent/middleware/outcomes.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import { pausedRequest } from '../../../helpers/pausedRequest.js';

// ─── the harness ─────────────────────────────────────────────────────

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

/** The pauses the LIBRARY's own ask raised — read off the typed `pause.request` events. */
const libraryAsks = (seen: readonly Event[]): Event[] =>
  seen.filter(
    (e) =>
      e.type === 'agentfootprint.pause.request' &&
      JSON.stringify(e.payload.questionPayload).includes('"ask":"arguments"'),
  );

/** The checkpoint as a host would store it: detached, through JSON. */

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

      const done = await agent.resume(
        stored(second),
        checkInApproved({ request: pausedRequest(second), by: 'ops' }),
      );
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
    const done = await agent.resume(
      stored(second),
      checkInApproved({ request: pausedRequest(second), by: 'ops' }),
    );
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
    const third = await agent.resume(
      stored(checkIn),
      checkInApproved({ request: pausedRequest(checkIn), by: 'ops' }),
    );
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
    await agent.resume(
      stored(third),
      checkInApproved({ request: pausedRequest(third), by: 'ops' }),
    );
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
