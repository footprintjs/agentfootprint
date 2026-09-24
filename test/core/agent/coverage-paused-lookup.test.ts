/**
 * A lookup that pauses still declares what it looked at (9.114.0).
 *
 * A tool that finds nothing and then raises `requestInput` to ask the person
 * used to leave NO record of the miss it was asking about: the dispatch
 * door's coverage reader (`stages/toolCalls.ts` · `declareCoverage`) runs on a
 * RETURNED result, and the batch loop's pause branch returned the checkpoint
 * before any call site of it. So no `tools.absent`, no `coverageDeclared` row,
 * nothing for a coverage band — and the app could not file it either, because
 * the declaration's opaque `context` rides to the model on resume, never to
 * the record.
 *
 * The declaration now carries the miss as data: `absence`, holding the
 * envelope `absent()` returns, recognized by the one recognizer
 * (`coverage/absent.ts` · `readAbsence`) at raise time and READ at the raise
 * site, before the checkpoint is returned. Nothing on resume reads it, and it
 * never rides the awaiting-input shape.
 *
 * Sections (Convention 3): unit (the declaration's refusals, the stamped
 * shape) · integration (byte-identical rows to a returning lookup, the
 * empty-lookup seam, the three-call batch and the unsettled rule) · regression
 * (a raise without `absence`, and a malformed hand raise without it, each
 * pinned against a reference captured on the 9.113.0 tree — `git archive`
 * of the release commit — by this file in update mode):
 *
 *   AF_PAUSED_LOOKUP_REFERENCE=update npx vitest run test/core/agent/coverage-paused-lookup.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import {
  absent,
  Agent,
  allow,
  askHuman,
  checkInApproved,
  coverage,
  COVERAGE_BLOCK_HEADING,
  defineTool,
  flowchartAsTool,
  isPaused,
  InputRequestError,
  isInputPause,
  isPauseRequest,
  pauseHere,
  readAbsence,
  requestInput,
  runbookAsTool,
  type FindingsRow,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { stampInputRequest, validateInputDeclaration } from '../../../src/core/inputRequest.js';
import { notDispatchedResult } from '../../../src/core/agent/stages/toolCalls.js';

// ─── fixtures ────────────────────────────────────────────────────────

const DEVICE = '20:00:00:25:b5:aa:00:1f';
const INVENTORY_RESULT = `devices: ${DEVICE} (host-a), 20:00:00:25:b5:aa:00:2c (host-b)`;

/** The miss, declared — every optional part present, so every field is compared. */
const DECL = {
  what: `port logins for ${DEVICE}`,
  checked: [
    'the live name-server database on fabric A',
    { what: 'window: the last 24h', why: 'login history retention on this fabric' },
  ],
  notChecked: [{ what: 'fabric B', why: 'the person has not said which fabric the host is on' }],
  cannotCover: [{ what: 'hosts outside the collected inventory', why: 'never collected' }],
  tryInstead: 'Ask which fabric the host is cabled to, then look there.',
  tryInsteadTool: { tool: 'fabric_inventory', why: 'it lists what each fabric holds' },
};

const QUESTION = {
  id: 'fabric',
  question: 'Which fabric is the host cabled to?',
  fields: [{ id: 'fabric', type: 'string' as const, required: true }],
};

type Shape = 'return' | 'raise' | 'raise-bare' | 'raise-null';

/** The same lookup in four shapes: returns its miss, raises with it, raises
 *  without it, raises with `absence: null` (the field omitted). */
const lookup = (shape: Shape, maxChars?: number) =>
  defineTool({
    name: 'port_for_device',
    description: 'Which port a device is logged in to.',
    inputSchema: {
      type: 'object',
      properties: { wwpn: { type: 'string' } },
      required: ['wwpn'],
    },
    argumentsFrom: ['fabric_inventory'],
    ...(maxChars !== undefined && { resultCeiling: { maxChars } }),
    execute: () => {
      if (shape === 'return') return absent(DECL);
      if (shape === 'raise') return requestInput({ ...QUESTION, absence: absent(DECL) });
      if (shape === 'raise-null') return requestInput({ ...QUESTION, absence: null } as never);
      return requestInput(QUESTION);
    },
  });

const inventory = () =>
  defineTool({
    name: 'fabric_inventory',
    description: 'List the devices this fabric knows about.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => INVENTORY_RESULT,
  });

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const answer = {
  content: 'Not logged in on fabric A.',
  toolCalls: [],
  stopReason: 'stop' as const,
};

/** Inventory first (so the lookup is GROUNDED), then the lookup, then the answer. */
const SCRIPT = [
  call('c1', 'fabric_inventory'),
  call('c2', 'port_for_device', { wwpn: DEVICE }),
  answer,
];

interface Leg {
  readonly events: { type: string; payload: Record<string, unknown> }[];
  readonly requests: LLMRequest[];
  readonly agent: Agent;
}

function build(
  shape: Shape,
  reactMode?: 'dynamic' | 'dynamic-grouped',
  limitsTravel = false,
  maxChars?: number,
  extra: {
    /** Another model script in place of `SCRIPT`. */
    readonly script?: readonly Partial<LLMResponse>[];
    /** A tool middleware that rewrites the lookup's `wwpn` to `DEVICE`, so
     *  the args the tool runs with are not the args the model sent. */
    readonly rewriteWwpn?: boolean;
  } = {},
): Leg {
  const events: Leg['events'] = [];
  const requests: LLMRequest[] = [];
  const inner = mock({ replies: [...(extra.script ?? SCRIPT)] });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      return inner.complete(req);
    },
  };
  let builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 6,
    noticeEmptyLookups: true,
    ...(reactMode !== undefined && { reactMode }),
  })
    .system('You are a fabric triage assistant.')
    .tool(inventory())
    .tool(lookup(shape, maxChars));
  if (limitsTravel) builder = builder.limitsTravelWithTheAnswer();
  if (extra.rewriteWwpn === true) {
    builder = builder.toolMiddleware({
      name: 'resolve-device-alias',
      onToolCall: (c) =>
        c.toolName === 'port_for_device'
          ? allow({ ...c.args, wwpn: DEVICE }, 'resolved the alias to the device')
          : allow(),
    });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { events, requests, agent };
}

const payloadsOf = (leg: Leg, type: string) =>
  leg.events.filter((e) => e.type === type).map((e) => e.payload);

type State = {
  coverageDeclared?: readonly Record<string, unknown>[];
  history?: readonly LLMMessage[];
};
const stateOf = (agent: Agent): State => (agent.getSnapshot()?.sharedState ?? {}) as State;

// ─── 1. UNIT — the declaration carries the miss, and only a recognizable one ──

describe('unit: `InputRequestDeclaration.absence` — minted by `absent()`, refused otherwise', () => {
  it('a declaration holding an `absent()` envelope validates, and the one recognizer reads what it keeps', () => {
    const clean = validateInputDeclaration({ ...QUESTION, absence: absent(DECL) });
    expect(readAbsence(clean.absence)).toBeDefined();
    expect(clean.absence).toEqual(absent(DECL));
  });

  it.each([
    ['an envelope with an empty `checked`', { af_absent: true, checked: [] }],
    ['a value without the marker', { looked_for: 'x', checked: ['somewhere'] }],
    ['a marker that is not exactly `true`', { af_absent: 'true', checked: ['somewhere'] }],
    ['a sentence', 'nothing was found'],
    ['an array', [absent(DECL)]],
    // The field carries the miss, not a boundary drawn around it.
    ['a coverage() ledger around an absence', coverage(absent(DECL), { checked: ['fabric A'] })],
  ])('refuses %s at raise time — a clear InputRequestError, never a pause', (_label, bad) => {
    let thrown: unknown;
    try {
      requestInput({ ...QUESTION, absence: bad } as never);
    } catch (err) {
      thrown = err;
    }
    expect(isPauseRequest(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(InputRequestError);
    expect(String((thrown as Error).message)).toContain('absent()');
    expect(() => validateInputDeclaration({ ...QUESTION, absence: bad })).toThrow(
      InputRequestError,
    );
  });

  it('`absence: null` is the field omitted — the coverage rule for a missing optional value, never a refusal', () => {
    // A JSON producer writes a missing optional value as `null`
    // (`coverage/absent.ts` · `notGiven`); it carries no miss to file.
    const clean = validateInputDeclaration({ ...QUESTION, absence: null });
    expect('absence' in clean).toBe(false);
    expect(clean).toEqual(validateInputDeclaration(QUESTION));
    let thrown: unknown;
    try {
      requestInput({ ...QUESTION, absence: null } as never);
    } catch (err) {
      thrown = err;
    }
    expect(isPauseRequest(thrown)).toBe(true);
  });

  it('the stamped awaiting-input shape never carries it — the person and the model are not handed the field', () => {
    const waiting = stampInputRequest({ ...QUESTION, absence: absent(DECL) }, 'run:c2', {
      originalRequest: 'which port?',
      toolCallId: 'c2',
    });
    expect('absence' in waiting).toBe(false);
    expect(waiting).toEqual(
      stampInputRequest(QUESTION, 'run:c2', { originalRequest: 'which port?', toolCallId: 'c2' }),
    );
  });
});

// ─── 2. INTEGRATION — filed at the raise, byte for byte ─────────────────

describe('integration: a raising lookup files what a returning lookup files', () => {
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    '%s: `tools.absent` and the `coverageDeclared` rows are byte-identical to a lookup that RETURNS the same absence',
    async (mode) => {
      const returned = build('return', mode);
      await returned.agent.run({ message: 'which port is the first device on?' });

      const raised = build('raise', mode);
      const paused = await raised.agent.run({ message: 'which port is the first device on?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');

      const want = payloadsOf(returned, 'agentfootprint.tools.absent');
      expect(want).toHaveLength(1);
      expect(JSON.stringify(payloadsOf(raised, 'agentfootprint.tools.absent'))).toBe(
        JSON.stringify(want),
      );
      const rows = stateOf(returned.agent).coverageDeclared;
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(stateOf(raised.agent).coverageDeclared)).toBe(JSON.stringify(rows));
      // Filed at the RAISE: the rows ride the checkpoint the pause returned.
      expect(JSON.stringify(paused.checkpoint)).toContain(JSON.stringify(rows));
    },
  );

  it('the empty-lookup seam, when grounded, files the same advisory at the raise as on the return', async () => {
    const returned = build('return');
    await returned.agent.run({ message: 'which port is the first device on?' });
    const raised = build('raise');
    await raised.agent.run({ message: 'which port is the first device on?' });
    const emptyLookups = (leg: Leg) =>
      payloadsOf(leg, 'agentfootprint.integrity.context_error').filter(
        (f) => f.kind === 'empty-lookup',
      );
    expect(emptyLookups(returned)).toHaveLength(1);
    expect(emptyLookups(raised)).toEqual(emptyLookups(returned));
    // In the returned path's order too: the miss is declared, then judged.
    const order = (leg: Leg) =>
      leg.events.flatMap((e) =>
        e.type === 'agentfootprint.tools.absent' ||
        (e.type === 'agentfootprint.integrity.context_error' && e.payload.kind === 'empty-lookup')
          ? [e.type]
          : [],
      );
    expect(order(returned)).toEqual([
      'agentfootprint.tools.absent',
      'agentfootprint.integrity.context_error',
    ]);
    expect(order(raised)).toEqual(order(returned));
  });

  // The seam's two inputs at the raise are the batch's own: the history that
  // already holds THIS turn's earlier results, and the args the tool RAN
  // with. Each case below grounds the lookup only through one of them.
  it.each([
    [
      'the producer ran earlier in the SAME batch — grounded on this turn’s history',
      {
        script: [
          {
            toolCalls: [
              { id: 'c1', name: 'fabric_inventory', args: {} },
              { id: 'c2', name: 'port_for_device', args: { wwpn: DEVICE } },
            ],
          },
          answer,
        ],
      },
    ],
    [
      'a middleware rewrote the args — grounded on what the tool ran with, not what the model sent',
      {
        script: [
          call('c1', 'fabric_inventory'),
          call('c2', 'port_for_device', { wwpn: 'the first device' }),
          answer,
        ],
        rewriteWwpn: true,
      },
    ],
  ] satisfies [string, Parameters<typeof build>[4]][])(
    'the empty-lookup seam at the raise: %s',
    async (_label, extra) => {
      const emptyLookups = (leg: Leg) =>
        payloadsOf(leg, 'agentfootprint.integrity.context_error').filter(
          (f) => f.kind === 'empty-lookup',
        );
      const returned = build('return', undefined, false, undefined, extra);
      await returned.agent.run({ message: 'which port is the first device on?' });
      const raised = build('raise', undefined, false, undefined, extra);
      const paused = await raised.agent.run({ message: 'which port is the first device on?' });
      expect(isInputPause(paused)).toBe(true);
      expect(emptyLookups(returned)).toHaveLength(1);
      expect(emptyLookups(raised)).toEqual(emptyLookups(returned));
    },
  );

  it("the one named difference: the tool's `resultCeiling` never judges a raised miss — nothing is served for it to measure", async () => {
    // 100 chars refuses the returned envelope (its `note` alone is longer).
    const returned = build('return', undefined, false, 100);
    await returned.agent.run({ message: 'which port is the first device on?' });
    const raised = build('raise', undefined, false, 100);
    await raised.agent.run({ message: 'which port is the first device on?' });
    const count = (leg: Leg) => ({
      absent: payloadsOf(leg, 'agentfootprint.tools.absent').length,
      refused: payloadsOf(leg, 'agentfootprint.tools.result_refused').length,
      emptyLookups: payloadsOf(leg, 'agentfootprint.integrity.context_error').filter(
        (f) => f.kind === 'empty-lookup',
      ).length,
    });
    // Returned: the ceiling refuses the payload, so the seam has no answer to read.
    expect(count(returned)).toEqual({ absent: 1, refused: 1, emptyLookups: 0 });
    // Raised: no result is served, so no ceiling runs, and the seam reads the miss.
    expect(count(raised)).toEqual({ absent: 1, refused: 0, emptyLookups: 1 });
  });

  it('the rows ride the checkpoint: under `.limitsTravelWithTheAnswer()` the resumed answer carries the block a returned miss gives', async () => {
    const returned = build('return', undefined, true);
    const want = await returned.agent.run({ message: 'which port is the first device on?' });
    // The block was appended — the comparison below is not two bare replies.
    expect(want).not.toBe(answer.content);
    expect(String(want)).toContain(COVERAGE_BLOCK_HEADING);
    expect(String(want)).toContain(DECL.notChecked[0]!.what);

    const raised = build('raise', undefined, true);
    const paused = await raised.agent.run({ message: 'which port is the first device on?' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const got = await raised.agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { fabric: 'A' },
    });
    expect(got).toBe(want);
  });

  it.each([
    ['a valid envelope', absent(DECL)],
    // Resume would REFUSE this if it validated the field — so it pins that
    // `inputRequest.ts` · `readAwaitingInput` re-validates five keys, not six.
    ['an unreadable value', 'not an envelope'],
  ])(
    'resume reads nothing new: the stored pause carries no envelope, and a planted one (%s) files nothing',
    async (_label, plantedValue) => {
      const raised = build('raise');
      const paused = await raised.agent.run({ message: 'which port is the first device on?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');
      // Nothing the person, the model or the durable pause reads holds the miss.
      expect('absence' in paused.awaitingInput).toBe(false);
      expect(JSON.stringify(paused.checkpoint)).not.toContain('af_absent');
      expect(JSON.stringify(paused.pauseData)).not.toContain('af_absent');
      const rowsAtRaise = JSON.stringify(stateOf(raised.agent).coverageDeclared);

      // A checkpoint someone planted an envelope in: resume still reads nothing.
      const planted = structuredClone(paused.checkpoint) as typeof paused.checkpoint & {
        pauseData: { awaitingInput: Record<string, unknown> };
      };
      planted.pauseData.awaitingInput.absence = plantedValue;
      const done = await raised.agent.resume(planted, {
        requestId: paused.awaitingInput.requestId,
        values: { fabric: 'A' },
      });
      expect(done).toBe(answer.content);
      expect(payloadsOf(raised, 'agentfootprint.tools.absent')).toHaveLength(1);
      expect(JSON.stringify(stateOf(raised.agent).coverageDeclared)).toBe(rowsAtRaise);
      // The paused call's served result is the person's answer — never the envelope.
      const served = stateOf(raised.agent).history?.find(
        (m) => m.role === 'tool' && m.toolCallId === 'c2',
      );
      expect(served?.content).toContain('input_received');
      expect(served?.content).not.toContain('af_absent');
    },
  );
});

// ─── 2b. INTEGRATION — a raise that does not pause files nothing ────────

/** One tool, one call, then the answer — and every `tools.absent` it emits. */
function oneTool(tool: ReturnType<typeof defineTool>) {
  const agent = Agent.create({
    provider: mock({ replies: [call('c1', tool.schema.name), answer] }),
    model: 'mock',
    maxIterations: 6,
  })
    .tool(tool)
    .build();
  const absentIds: unknown[] = [];
  agent.on('agentfootprint.tools.absent', (e) => absentIds.push(e.payload.toolCallId));
  const served = () =>
    stateOf(agent).history?.find((m) => m.role === 'tool' && m.toolCallId === 'c1')?.content;
  return { agent, absentIds, served };
}

describe('integration: a raise that does not pause files nothing', () => {
  it('an unreadable `absence` errors the call at the raise: no pause, no row, the model reads the refusal', async () => {
    const { agent, absentIds, served } = oneTool(
      defineTool({
        name: 'raises_badly',
        description: 'a lookup whose miss is hand-built wrong',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          requestInput({ ...QUESTION, absence: { af_absent: true, checked: [] } } as never),
      }),
    );
    const out = await agent.run({ message: 'which port?' });
    expect(isPaused(out)).toBe(false);
    expect(absentIds).toEqual([]);
    expect(stateOf(agent).coverageDeclared).toBeUndefined();
    expect(served()).toContain('absent()');
  });

  // Envelopes the one recognizer READS (marker + a non-empty `checked`) whose
  // lists the door cannot copy — a hand-built value, forwarded from parsed
  // JSON. Returned, the copy throws inside the dispatch `try` and the call
  // errors; raised, it must meet the same containment — never fail the run.
  it.each([
    ['a null item in `checked`', { af_absent: true, checked: [null] }],
    [
      'a number for `not_checked`',
      { af_absent: true, checked: [{ what: 'fabric A' }], not_checked: 5 },
    ],
    [
      'a sentence for `not_checked`',
      { af_absent: true, checked: [{ what: 'fabric A' }], not_checked: 'fabric B' },
    ],
    [
      'a number for `cannot_cover`',
      { af_absent: true, checked: [{ what: 'fabric A' }], cannot_cover: 7 },
    ],
  ])(
    'an envelope the recognizer reads but the door cannot copy (%s) errors the call exactly as returned — the run goes on, nothing pauses, nothing is filed',
    async (_label, envelope) => {
      expect(readAbsence(envelope)).toBeDefined();
      const returnsIt = oneTool(
        defineTool({
          name: 'hand_built',
          description: 'a lookup forwarding a miss minted elsewhere',
          inputSchema: { type: 'object', properties: {} },
          execute: () => envelope,
        }),
      );
      const returnedOut = await returnsIt.agent.run({ message: 'which port?' });
      const raisesIt = oneTool(
        defineTool({
          name: 'hand_built',
          description: 'a lookup forwarding a miss minted elsewhere',
          inputSchema: { type: 'object', properties: {} },
          execute: () => requestInput({ ...QUESTION, absence: envelope } as never),
        }),
      );
      const raisedOut = await raisesIt.agent.run({ message: 'which port?' });

      expect(isPaused(raisedOut)).toBe(false);
      expect(raisedOut).toBe(returnedOut);
      expect(raisedOut).toBe(answer.content);
      // The call errored with the text the returned path serves — parity.
      expect(returnsIt.served()).toBeDefined();
      expect(raisesIt.served()).toBe(returnsIt.served());
      // Nothing filed on either path, and the raise wrote no pause state:
      // its pause keys hold what the run that never raised holds.
      expect(raisesIt.absentIds).toEqual([]);
      expect(returnsIt.absentIds).toEqual([]);
      expect(stateOf(raisesIt.agent).coverageDeclared).toBeUndefined();
      const raisedState = stateOf(raisesIt.agent) as Record<string, unknown>;
      const returnedState = stateOf(returnsIt.agent) as Record<string, unknown>;
      for (const key of [
        'pausedToolCallId',
        'pausedToolName',
        'pausedToolStartMs',
        'pausedToolArgs',
      ]) {
        expect(raisedState[key], key).toEqual(returnedState[key]);
      }
    },
  );

  it('a raise while an approved check-in resumes is refused as an ERROR, and an errored call files no coverage', async () => {
    const { agent, absentIds, served } = oneTool(
      defineTool({
        name: 'gated_lookup',
        description: 'a lookup a person approves first',
        inputSchema: { type: 'object', properties: {} },
        checkIn: 'always',
        execute: () => requestInput({ ...QUESTION, absence: absent(DECL) }),
      }),
    );
    const paused = await agent.run({ message: 'which port?' });
    if (!isPaused(paused)) throw new Error('expected the check-in pause');
    const done = await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));
    expect(done).toBe(answer.content);
    expect(absentIds).toEqual([]);
    expect(stateOf(agent).coverageDeclared).toBeUndefined();
    expect(served()).toContain('requested a pause while resuming an approved check-in');
  });
});

// ─── 2c. INTEGRATION — a raise inside a composed call ──────────────────

describe("integration: a raise inside a composed call is the OUTER call's raise", () => {
  it('an inner lookup reached through `ctx.tools.call` files its miss once, under the outer call — the call that paused', async () => {
    const innerLookup = defineTool({
      name: 'inner_lookup',
      description: 'the lookup a procedure composes',
      inputSchema: { type: 'object', properties: {} },
      execute: () => requestInput({ ...QUESTION, absence: absent(DECL) }),
    });
    const outerProc = defineTool({
      name: 'outer_proc',
      description: 'a procedure over the lookup',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => ctx.tools?.call('inner_lookup', {}),
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'outer_proc'), answer] }),
      model: 'mock',
      maxIterations: 6,
    })
      .tools([innerLookup, outerProc])
      .build();
    const filedUnder: unknown[] = [];
    agent.on('agentfootprint.tools.absent', (e) =>
      filedUnder.push(`${e.payload.toolName}/${e.payload.toolCallId}`),
    );

    const paused = await agent.run({ message: 'which port?' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    expect(filedUnder).toEqual(['outer_proc/c1']);
    const rows = (stateOf(agent).coverageDeclared ?? []).map(
      (row) => `${String(row.toolName)}/${String(row.toolCallId)}`,
    );
    expect(rows).toEqual(['outer_proc/c1']);

    const done = await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { fabric: 'A' },
    });
    expect(done).toBe(answer.content);
    expect(filedUnder).toEqual(['outer_proc/c1']);
  });

  // The other two composed doors the CHANGELOG names — each pinned the same
  // way: the pause is the outer call's, filed once under it, never on resume.
  it.each([
    [
      'a runbook procedure calling the lookup through its dispatch',
      () => [
        defineTool({
          name: 'inner_lookup',
          description: 'the lookup a procedure composes',
          inputSchema: { type: 'object', properties: {} },
          execute: () => requestInput({ ...QUESTION, absence: absent(DECL) }),
        }),
        runbookAsTool({
          name: 'outer',
          description: 'a runbook over the lookup',
          composedOf: ['inner_lookup'],
          procedure: (tools) =>
            flowChart<{ rows?: unknown }>(
              'Fetch',
              async (scope) => {
                scope.rows = await tools.call('inner_lookup', {});
              },
              'fetch',
            ).build(),
        }),
      ],
    ],
    [
      'a `flowchartAsTool` stage raising the request itself',
      () => [
        flowchartAsTool({
          name: 'outer',
          description: 'a flowchart that asks about its miss',
          flowchart: flowChart<Record<string, unknown>>(
            'Fetch',
            async () => {
              requestInput({ ...QUESTION, absence: absent(DECL) });
            },
            'fetch',
          ).build(),
        }),
      ],
    ],
  ])('%s: filed once, under the outer call', async (_label, toolsOf) => {
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'outer'), answer] }),
      model: 'mock',
      maxIterations: 6,
    })
      .tools(toolsOf())
      .build();
    const filedUnder: unknown[] = [];
    agent.on('agentfootprint.tools.absent', (e) =>
      filedUnder.push(`${e.payload.toolName}/${e.payload.toolCallId}`),
    );

    const paused = await agent.run({ message: 'which port?' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    expect(filedUnder).toEqual(['outer/c1']);
    const rows = (stateOf(agent).coverageDeclared ?? []).map(
      (row) => `${String(row.toolName)}/${String(row.toolCallId)}`,
    );
    expect(rows).toEqual(['outer/c1']);

    const done = await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { fabric: 'A' },
    });
    expect(done).toBe(answer.content);
    expect(filedUnder).toEqual(['outer/c1']);
  });
});

// ─── 3. INTEGRATION — the three-call batch, and the unsettled rule ─────

const RULED_OUT = (toolCallId: string) => ({
  toolCallId,
  standing: 'ruled-out',
  line: 'the port path is not what is slow',
});

/** c1 returns its miss, c2 raises with the same kind of miss, c3 is settled on resume. */
const BATCH_SCRIPT: readonly Partial<LLMResponse>[] = [
  {
    toolCalls: [
      { id: 'c1', name: 'returns_miss', args: { _findings: { basis: 'direct' } } },
      { id: 'c2', name: 'raises_miss', args: { _findings: { basis: 'direct' } } },
      { id: 'c3', name: 'returns_miss', args: { _findings: { basis: 'direct' } } },
    ],
  },
  {
    toolCalls: [
      {
        id: 'd1',
        name: 'returns_miss',
        args: { _findings: { basis: 'direct', previous: [RULED_OUT('c1'), RULED_OUT('c2')] } },
      },
    ],
  },
  { content: 'done' },
];

describe('integration: a pause inside a three-call batch (the 9.113.0 settlement)', () => {
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    '%s: the sibling is settled on resume, each absence is filed once, and a ruling-out on the paused call files no unsettled row',
    async (reactMode) => {
      const ran: string[] = [];
      const returnsMiss = defineTool({
        name: 'returns_miss',
        description: 'a lookup that returns its miss',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, ctx) => {
          ran.push(ctx.toolCallId);
          return absent(DECL);
        },
      });
      const raisesMiss = defineTool({
        name: 'raises_miss',
        description: 'a lookup that asks the person about its miss',
        inputSchema: { type: 'object', properties: {} },
        execute: () => requestInput({ ...QUESTION, absence: absent(DECL) }),
      });
      const agent = Agent.create({
        provider: mock({ replies: [...BATCH_SCRIPT] }),
        model: 'mock',
        maxIterations: 8,
        reactMode,
      })
        .tools([returnsMiss, raisesMiss])
        .findings()
        .build();
      const absentIds: unknown[] = [];
      agent.on('agentfootprint.tools.absent', (e) => absentIds.push(e.payload.toolCallId));

      const paused = await agent.run({ message: 'is the port path slow?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');
      expect(absentIds).toEqual(['c1', 'c2']);
      const done = await agent.resume(paused.checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { fabric: 'A' },
      });
      expect(done).toBe('done');

      // The settlement is unchanged: c3 never ran, and its result is the sentence.
      expect(ran).toEqual(['c1', 'd1']);
      const state = stateOf(agent);
      const settled = state.history?.find((m) => m.role === 'tool' && m.toolCallId === 'c3');
      expect(settled?.content).toBe(
        notDispatchedResult('returns_miss', { toolName: 'raises_miss', toolCallId: 'c2' }),
      );

      // Each absence filed once — c2's at the raise, never again on resume.
      expect(absentIds).toEqual(['c1', 'c2', 'd1']);
      expect((state.coverageDeclared ?? []).map((row) => row.toolCallId)).toEqual([
        'c1',
        'c2',
        'd1',
      ]);

      // The unsettled rule is unchanged: it needs the SERVED result to read as
      // an absence, and c2 was served the person's answer — so c1 gets its
      // row and c2 gets none.
      const ledger = (agent.findings() ?? []) as readonly FindingsRow[];
      const unsettled = ledger.flatMap((row) =>
        row.kind === 'unsettled-by-absence' ? [row.toolCallId] : [],
      );
      expect(unsettled).toEqual(['c1']);
    },
  );
});

// ─── 4. REGRESSION — a raise without `absence` is byte-identical to 9.113.0 ──

const REFERENCE = resolve(__dirname, 'reference/paused-lookup-no-absence.json');

/** Every run-varying number dropped: timings and fire times. */
const untimed = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, v: unknown) =>
      key === 'durationMs' || key === 'lastFiredAt' ? undefined : v,
    ),
  );

describe('regression: a raise WITHOUT `absence` records what 9.113.0 recorded', () => {
  // `absence: null` is the field omitted, so it records the same bytes.
  it.each(['raise-bare', 'raise-null'] as const)(
    '%s: grounded lookup, raise, resume — the record matches the reference captured before this release',
    async (shape) => {
      const leg = build(shape);
      const paused = await leg.agent.run({ message: 'which port is the first device on?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');
      const keysAtPause = Object.keys(leg.agent.getSnapshot()?.sharedState ?? {}).sort();
      const requestId = paused.awaitingInput.requestId;
      const done = await leg.agent.resume(paused.checkpoint, {
        requestId,
        values: { fabric: 'A' },
      });
      const text = JSON.stringify({
        done,
        pauseData: paused.pauseData,
        eventTypes: leg.events.map((e) => e.type),
        coverage: leg.events
          .filter(
            (e) =>
              e.type === 'agentfootprint.tools.absent' ||
              e.type === 'agentfootprint.tools.coverage_declared' ||
              e.type === 'agentfootprint.integrity.context_error' ||
              e.type === 'agentfootprint.integrity.disposition',
          )
          .map((e) => ({ type: e.type, payload: untimed(e.payload) })),
        keysAtPause,
        keysAfterResume: Object.keys(leg.agent.getSnapshot()?.sharedState ?? {}).sort(),
        requests: leg.requests.map((r) => r.messages),
        history: stateOf(leg.agent).history ?? [],
      });
      const record = JSON.parse(text.split(requestId).join('<requestId>')) as unknown;
      if (process.env.AF_PAUSED_LOOKUP_REFERENCE === 'update') {
        if (shape !== 'raise-bare') return;
        mkdirSync(dirname(REFERENCE), { recursive: true });
        writeFileSync(REFERENCE, `${JSON.stringify(record, null, 2)}\n`);
        return;
      }
      expect(existsSync(REFERENCE), 'no reference — capture it on the pre-change tree').toBe(true);
      expect(record).toEqual(JSON.parse(readFileSync(REFERENCE, 'utf8')));
    },
  );
});

// ─── 4b. REGRESSION — a malformed HAND raise fails as 9.113.0 failed ──────

const MALFORMED_REFERENCE = resolve(__dirname, 'reference/hand-raised-malformed-request.json');

/**
 * A hand raise — `pauseHere`/`askHuman` carrying an `inputRequest` that never
 * went through `requestInput`'s own validation — whose declaration is
 * malformed fails the run at the door. Only a declaration that CARRIES an
 * `absence` is judged before the pause writes (its miss is filed first, and a
 * miss the door cannot file must leave no pause behind); every other raise
 * keeps the 9.113.0 order — the writes, then the judgment — so the failed
 * run's committed state still holds the in-flight batch: the assistant turn,
 * every sibling's result, the paused keys.
 */
const MALFORMED: Record<
  string,
  { readonly replies: readonly Partial<LLMResponse>[]; readonly raise: () => never }
> = {
  'pauseHere with no fields, after a sibling ran': {
    replies: [
      {
        toolCalls: [
          { id: 'c0', name: 'ok_tool', args: {} },
          { id: 'c1', name: 'hand_raised', args: {} },
        ],
      },
    ],
    raise: () => pauseHere({ question: 'q?', inputRequest: { id: 'x' } }),
  },
  'askHuman with an empty field list': {
    replies: [{ toolCalls: [{ id: 'c1', name: 'hand_raised', args: {} }] }],
    raise: () => askHuman({ question: 'q', inputRequest: { id: 'x', question: 'q', fields: [] } }),
  },
};

/** The failed run's committed state, with the one wall-clock stamp reduced to whether it was written. */
async function failedRaiseRecord(
  replies: readonly Partial<LLMResponse>[],
  raise: () => never,
): Promise<Record<string, unknown>> {
  const eventTypes: string[] = [];
  const agent = Agent.create({
    provider: mock({ replies: [...replies] }),
    model: 'mock',
    maxIterations: 6,
  })
    .tools([
      defineTool({
        name: 'ok_tool',
        description: 'a sibling that answers',
        inputSchema: { type: 'object', properties: {} },
        execute: () => 'fine',
      }),
      defineTool({
        name: 'hand_raised',
        description: 'a tool that raises its own input request',
        inputSchema: { type: 'object', properties: {} },
        execute: raise,
      }),
    ])
    .build();
  agent.on('*', (e) => eventTypes.push(e.type));
  let error: string | undefined;
  try {
    await agent.run({ message: 'which port?' });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const state = (agent.getSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
  const startMs = state.pausedToolStartMs;
  return {
    error,
    eventTypes,
    keys: Object.keys(state).sort(),
    history: state.history,
    pausedToolCallId: state.pausedToolCallId,
    pausedToolName: state.pausedToolName,
    pausedToolArgs: state.pausedToolArgs,
    pausedToolStartMs: typeof startMs === 'number' && startMs > 0 ? '<written>' : startMs,
  };
}

describe('regression: a malformed HAND raise without `absence` fails as 9.113.0 failed', () => {
  it('the failed run keeps the in-flight batch — the record matches the reference captured before this release', async () => {
    const record: Record<string, unknown> = {};
    for (const [label, { replies, raise }] of Object.entries(MALFORMED)) {
      record[label] = await failedRaiseRecord(replies, raise);
    }
    const snapshot = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    if (process.env.AF_PAUSED_LOOKUP_REFERENCE === 'update') {
      mkdirSync(dirname(MALFORMED_REFERENCE), { recursive: true });
      writeFileSync(MALFORMED_REFERENCE, `${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    expect(existsSync(MALFORMED_REFERENCE), 'no reference — capture it on the 9.113.0 tree').toBe(
      true,
    );
    expect(snapshot).toEqual(JSON.parse(readFileSync(MALFORMED_REFERENCE, 'utf8')));
    // What the reference holds is the in-flight batch, not an empty frame.
    const afterSibling = snapshot['pauseHere with no fields, after a sibling ran'] as {
      error?: string;
      history: { role: string; toolCallId?: string }[];
      pausedToolCallId: string;
    };
    expect(afterSibling.error).toContain('declare an id, question and between one and 32 fields');
    expect(afterSibling.pausedToolCallId).toBe('c1');
    expect(
      afterSibling.history.map((m) => `${m.role}${m.toolCallId ? `:${m.toolCallId}` : ''}`),
    ).toEqual(['user', 'assistant', 'tool:c0']);
  });
});
