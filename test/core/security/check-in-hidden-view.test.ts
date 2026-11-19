/**
 * Security — a person asked to approve a call whose arguments the tool's view
 * hides is TOLD which values are hidden, and the decision records it.
 *
 * Reproduced on main before this change: a check-in tool carrying an argument
 * view (`flowchartAsTool({ redact })`, `runbookAsTool({ redact })`, or the
 * symbol set by hand) showed the person `to: 'REDACTED'` and the sentence
 * `… — with to=REDACTED, amount=5000`, then ran with the real account on
 * approval. Nothing on the request said which values were hidden, so a real
 * argument whose value is the string "REDACTED" read exactly like a hidden
 * one, and the `checkin.decision` record could not tell an approval given on a
 * hidden view from one given on the whole call.
 *
 * The law (owner decision, 13 November 2026): an approval may be asked while a
 * value is hidden; the request names the hidden arguments (`hiddenArgs`), the
 * built-in sentence says they are hidden and names them, and the decision's
 * event and stored record carry the same names. No hidden value reaches any
 * of them (the check-in surfaces). What is shown, what runs and the binding of
 * the approval to the exact call are unchanged. The binding of the names
 * themselves, the changed-view refusal and the chat-interface page are pinned
 * in `check-in-hidden-view-bound.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  CheckInRecorder,
  checkInApproved,
  checkInDeclined,
  defineTool,
  isCheckInPause,
  type CheckInAssembler,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { argsRedactedBy, SHOWN_ARGS, type ShownArgs } from '../../../src/core/toolShownArgs.js';

/** The hidden value. Searched for in everything a person, a listener or a log sees. */
const SECRET = 'acct-SECRET-7f3a91';

interface WireArgs {
  readonly to: string;
  readonly amount: number;
  readonly memo: string;
}

/** A wire tool with a check-in, carrying `view` the way `flowchartAsTool({ redact })` does. */
function wireTool(ran: WireArgs[], view: ShownArgs | undefined) {
  const tool = defineTool<WireArgs, string>({
    name: 'wire_money',
    description: 'Wire money.',
    inputSchema: {
      type: 'object',
      properties: {
        // A string, or an object whose fields a view may hide one by one.
        to: { type: ['string', 'object'] },
        amount: { type: 'number' },
        memo: { type: 'string' },
      },
      required: ['to', 'amount', 'memo'],
    },
    checkIn: 'always',
    execute: (args) => {
      ran.push({ ...args });
      return 'sent';
    },
  });
  return view === undefined ? tool : Object.assign(tool, { [SHOWN_ARGS]: view });
}

function wireAgent(
  args: WireArgs,
  view: ShownArgs | undefined,
  opts: { readonly evidence?: 'minimal' | 'standard' | CheckInAssembler } = {},
) {
  const ran: WireArgs[] = [];
  const events: { type: string; payload: unknown }[] = [];
  const checkins = new CheckInRecorder();
  const builder = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'w1', name: 'wire_money', args }] }, 'done'],
    }),
    model: 'm',
  })
    .system('You move money.')
    .tool(wireTool(ran, view));
  const agent = (
    opts.evidence !== undefined ? builder.checkIn({ evidence: opts.evidence }) : builder
  ).build();
  agent.attach(checkins);
  agent.on('*', (event) => events.push({ type: event.type, payload: event.payload }));
  return { agent, ran, events, checkins };
}

const HIDES_TO = argsRedactedBy({ keys: ['to'] });

afterEach(() => vi.restoreAllMocks());

describe('the request names the arguments the view hides (contract 1)', () => {
  it('a hidden argument is listed by name; the shown arguments are unchanged', async () => {
    const { agent } = wireAgent({ to: SECRET, amount: 5000, memo: 'rent' }, HIDES_TO);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(paused.checkIn.hiddenArgs).toEqual(['to']);
    expect(paused.checkIn.args).toEqual({ to: 'REDACTED', amount: 5000, memo: 'rent' });
  });

  it('a real argument whose value is the string "REDACTED" is not listed', async () => {
    const { agent } = wireAgent({ to: SECRET, amount: 5000, memo: 'REDACTED' }, HIDES_TO);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(paused.checkIn.hiddenArgs).toEqual(['to']);
    expect(paused.checkIn.args).toEqual({ to: 'REDACTED', amount: 5000, memo: 'REDACTED' });
  });

  it('a hidden argument whose real value is the string "REDACTED" is still listed', async () => {
    const { agent } = wireAgent({ to: 'REDACTED', amount: 5000, memo: 'rent' }, HIDES_TO);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(paused.checkIn.hiddenArgs).toEqual(['to']);
  });

  it('a nested field the view hides lists the argument that holds it', async () => {
    const view = argsRedactedBy({ fields: { to: ['iban'] } });
    const { agent } = wireAgent(
      { to: { bank: 'b', iban: SECRET } as unknown as string, amount: 1, memo: 'm' },
      view,
    );
    const paused = await agent.run({ message: 'pay' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(paused.checkIn.hiddenArgs).toEqual(['to']);
    expect(JSON.stringify(paused.checkIn)).not.toContain(SECRET);
  });

  it('a view that throws hides everything, and lists everything', async () => {
    const throwing: ShownArgs = () => {
      throw new Error('view failed');
    };
    const { agent } = wireAgent({ to: SECRET, amount: 5000, memo: 'rent' }, throwing);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(paused.checkIn.hiddenArgs).toEqual(['to', 'amount', 'memo']);
  });

  it('nothing hidden: the field is absent and the request is as before', async () => {
    const { agent } = wireAgent({ to: 'acct-1', amount: 5000, memo: 'rent' }, undefined);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect('hiddenArgs' in paused.checkIn).toBe(false);
    expect(paused.checkIn.evidence.willDo).toBe(
      'Wire money. — with to=acct-1, amount=5000, memo=rent',
    );
  });

  it('a view that hides nothing in this call: the field is absent', async () => {
    const view = argsRedactedBy({ keys: ['apiKey'] });
    const { agent } = wireAgent({ to: 'acct-1', amount: 5000, memo: 'rent' }, view);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect('hiddenArgs' in paused.checkIn).toBe(false);
  });
});

describe('the sentence the person reads says values are hidden and names them (contract 2)', () => {
  for (const evidence of ['standard', 'minimal'] as const) {
    it(`the ${evidence} assembler`, async () => {
      const { agent } = wireAgent({ to: SECRET, amount: 5000, memo: 'rent' }, HIDES_TO, {
        evidence,
      });
      const paused = await agent.run({ message: 'pay rent' });
      if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
      expect(paused.checkIn.evidence.willDo).toBe(
        'Wire money. — with to=REDACTED, amount=5000, memo=rent. ' +
          'Values hidden from this view: `to`. The call runs with the real values.',
      );
    });
  }

  it('a custom assembler is handed the same names', async () => {
    const seen: unknown[] = [];
    const custom: CheckInAssembler = (input) => {
      seen.push(input.hiddenArgs);
      return { willDo: 'custom' };
    };
    const { agent } = wireAgent({ to: SECRET, amount: 5000, memo: 'rent' }, HIDES_TO, {
      evidence: custom,
    });
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    expect(seen).toEqual([['to']]);
    expect(paused.checkIn.hiddenArgs).toEqual(['to']);
  });
});

describe('the decision records the names (contract 3) and the call is unchanged (contract 6)', () => {
  it('approved: the event and the stored record carry the names; the tool runs with the real value', async () => {
    const { agent, ran, events, checkins } = wireAgent(
      { to: SECRET, amount: 5000, memo: 'rent' },
      HIDES_TO,
    );
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'op' }));

    const decision = events.find((e) => e.type === 'agentfootprint.checkin.decision');
    expect(decision?.payload).toMatchObject({ approved: true, hiddenArgs: ['to'] });
    expect(checkins.getDecisions()).toEqual([
      expect.objectContaining({ approved: true, hiddenArgs: ['to'] }),
    ]);
    const request = events.find((e) => e.type === 'agentfootprint.checkin.request');
    expect((request?.payload as { request: { hiddenArgs?: unknown } }).request.hiddenArgs).toEqual([
      'to',
    ]);
    expect(checkins.getRequests()[0]?.request.hiddenArgs).toEqual(['to']);
    // What runs is unchanged: the real value, once.
    expect(ran).toEqual([{ to: SECRET, amount: 5000, memo: 'rent' }]);
  });

  it('declined: the record carries the names too', async () => {
    const { agent, ran, events, checkins } = wireAgent(
      { to: SECRET, amount: 5000, memo: 'rent' },
      HIDES_TO,
    );
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    await agent.resume(paused.checkpoint, checkInDeclined({ request: paused.checkIn, by: 'op' }));
    const decision = events.find((e) => e.type === 'agentfootprint.checkin.decision');
    expect(decision?.payload).toMatchObject({ approved: false, hiddenArgs: ['to'] });
    expect(checkins.getDecisions()[0]?.hiddenArgs).toEqual(['to']);
    expect(ran).toEqual([]);
  });

  it('nothing hidden: the decision event and record carry no field', async () => {
    const { agent, events, checkins } = wireAgent(
      { to: 'acct-1', amount: 5000, memo: 'rent' },
      undefined,
    );
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'op' }));
    const decision = events.find((e) => e.type === 'agentfootprint.checkin.decision');
    expect(decision?.payload).not.toHaveProperty('hiddenArgs');
    expect(checkins.getDecisions()[0]).not.toHaveProperty('hiddenArgs');
  });

  it('the approval stays bound to the exact call: a decision for another request is refused', async () => {
    const { agent, ran } = wireAgent({ to: SECRET, amount: 5000, memo: 'rent' }, HIDES_TO);
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    const wrong = checkInApproved({ request: { id: 'not-this-request' }, by: 'op' });
    const refusal = await agent.resume(paused.checkpoint, wrong).then(
      () => undefined,
      (err: unknown) => err as Error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(ran).toEqual([]);
  });
});

describe('no hidden value reaches the request, the sentence, the check-in events, the record, a log or an error (contract 4)', () => {
  it('the marker is searched in every one of them', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map((p) => (p instanceof Error ? p.message : String(p))).join(' '));
      });
    }
    const { agent, events, checkins, ran } = wireAgent(
      { to: SECRET, amount: 5000, memo: 'rent' },
      HIDES_TO,
    );
    const paused = await agent.run({ message: 'pay rent' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');

    // A refused decision's error message.
    const refusal = await agent
      .resume(paused.checkpoint, checkInApproved({ request: { id: 'other' }, by: 'op' }))
      .then(
        () => undefined,
        (err: unknown) => err as Error,
      );
    expect(refusal?.message).toBeDefined();
    expect(refusal?.message).not.toContain(SECRET);

    await agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'op' }));

    expect(JSON.stringify(paused.checkIn)).not.toContain(SECRET);
    expect(paused.checkIn.evidence.willDo).not.toContain(SECRET);
    const checkInEvents = events.filter((e) => e.type.startsWith('agentfootprint.checkin.'));
    expect(checkInEvents.map((e) => e.type)).toEqual([
      'agentfootprint.checkin.request',
      'agentfootprint.checkin.decision',
    ]);
    expect(JSON.stringify(checkInEvents)).not.toContain(SECRET);
    expect(JSON.stringify(checkins.getRequests())).not.toContain(SECRET);
    expect(JSON.stringify(checkins.getDecisions())).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
    // …and the tool really had it.
    expect(ran[0]?.to).toBe(SECRET);
  });
});
