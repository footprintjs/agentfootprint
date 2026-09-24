/**
 * THE BATCH SETTLEMENT (9.113.0) — a paused batch's un-dispatched siblings.
 *
 * A model may propose N tool calls in one turn. When call k pauses the run —
 * a middleware `ask`, a tool's `checkIn`, a credential consent, or a tool that
 * raised `pauseHere` / `askHuman` / `requestInput` — calls k+1..N were never
 * dispatched. Before this release every resume path answered call k and
 * nothing else: no `tool_start` / `tool_end` for the rest, `iteration_end`
 * counted one call, and the next request carried N `tool_use` blocks with
 * fewer `tool_result`s than that — a shape a provider refuses.
 *
 * Every resume path now SETTLES each un-dispatched sibling: one fixed,
 * past-anchored sentence as its result (`toolCalls.ts` · `notDispatchedResult`),
 * its own bracket (`tool_start`, then `tool_end` with `durationMs: 0` and no
 * `error` — the call neither ran nor failed), and a place in the resume leg's
 * `iteration_end.toolCallCount`. Nothing is dispatched on resume. The same
 * fact rides the settled message in `history` as data
 * (`LLMMessage.notDispatched`, never on the wire), and the readers that ask
 * "did this call run?" or "is this a tool's result?" — a permission policy's
 * `sequence`, a policy halt, the check-in trail, the window's last-tool-result
 * pin — read it and leave the call out (section 4).
 *
 * THE COUNT RULE. The resume leg's `iteration_end.toolCallCount` is the number
 * of `tool_end` brackets THAT LEG closed: the paused call's own, plus one per
 * settled sibling. Paused on the last of three → 1 (as before); on the middle
 * → 2; on the first → 3. The calls before the paused one closed their
 * brackets on the leg that paused, which ends in a checkpoint and emits no
 * `iteration_end` — unchanged.
 *
 * BYTE IDENTITY. A batch whose LAST call pauses has nothing to settle, and its
 * record is pinned against a reference captured on the 9.112.2 tree BEFORE any
 * source edit of this release, by this file in update mode:
 *
 *   AF_BATCH_SETTLEMENT_REFERENCE=update npx vitest run test/core/scenario/batch-pause-settlement.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  RESERVED_ARGUMENT,
  allow,
  ask,
  checkInApproved,
  defineTool,
  isInputPause,
  isPaused,
  requestInput,
  servedViews,
  slidingWindow,
  type FindingsRow,
  type Standing,
  type StandingRow,
  type WindowStrategy,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { bearer, type CredentialProvider } from '../../../src/identity.js';
import type {
  LLMMessage,
  LLMRequest,
  LLMResponse,
  PermissionChecker,
} from '../../../src/adapters/types.js';
import { notDispatchedResult, pausedBatchOf } from '../../../src/core/agent/stages/toolCalls.js';
import { stripFrameworkFields } from '../../../src/core/agent/composeRequest.js';
import { extractSequence, SYNTHETIC_DENY_PREFIX } from '../../../src/security/extractSequence.js';
import { PolicyHaltError } from '../../../src/security/index.js';

// ─── The harness ─────────────────────────────────────────────────────

/** The four doors a pause comes back through (`toolCalls.ts` · `resume`). */
type PauseKind = 'input' | 'ask' | 'check-in' | 'consent';
const KINDS: readonly PauseKind[] = ['input', 'ask', 'check-in', 'consent'];

const NAMES = ['first', 'second', 'third'] as const;
const IDS = ['c1', 'c2', 'c3'] as const;

interface Harness {
  readonly agent: Agent;
  readonly requests: LLMRequest[];
  readonly events: { type: string; payload: Record<string, unknown> }[];
  /** The tools whose `execute` really ran, in order. */
  readonly ran: string[];
  /** The consent vault's switch — flipped before a `consent` resume. */
  readonly vault: { granted: boolean };
}

/** The batch of three, then a plain answer. */
const BATCH_THEN_DONE: readonly Partial<LLMResponse>[] = [
  { toolCalls: NAMES.map((name, i) => ({ id: IDS[i]!, name, args: {} })) },
  { content: 'done' },
];

function build(
  kind: PauseKind,
  pausedAt: 0 | 1 | 2,
  replies: readonly Partial<LLMResponse>[] = BATCH_THEN_DONE,
): Harness {
  const pausing = NAMES[pausedAt];
  const ran: string[] = [];
  const vault = { granted: false };
  const requests: LLMRequest[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const inner = mock({ replies: [...replies] });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      // A COPY, taken at the call: the request's `messages` is a view of the
      // run's state, and a reference held past the call reads what the run
      // wrote afterwards — not what this call was handed.
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      return inner.complete(req);
    },
  };
  const credentials: CredentialProvider = {
    id: 'test-vault',
    getCredential: async () =>
      vault.granted
        ? { status: 'issued', credential: bearer('tok') }
        : {
            status: 'authorization-required',
            authorizationUrl: 'https://idp.example.test/authorize',
            sessionId: 'sess-1',
          },
  };
  const tools = NAMES.map((name) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      ...(kind === 'check-in' && name === pausing && { checkIn: 'always' as const }),
      ...(kind === 'consent' &&
        name === pausing && { needs: { credential: 'billing', mode: 'user' as const } }),
      execute: () => {
        if (kind === 'input' && name === pausing) {
          return requestInput({
            id: 'year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          });
        }
        ran.push(name);
        return `${name} ran`;
      },
    }),
  );
  let builder = Agent.create({
    provider,
    model: 'mock',
    ...(kind === 'consent' && { credentials }),
  }).tools(tools);
  if (kind === 'ask') {
    builder = builder.toolMiddleware({
      name: 'gate',
      onToolCall: (call) => (call.toolName === pausing ? ask({ question: 'ok?' }) : allow()),
    });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, requests, events, ran, vault };
}

/** Run to the pause, answer it the way its door expects, and resume. */
async function pauseAndResume(
  h: Harness,
  kind: PauseKind,
): Promise<{ answer: unknown; resumedFrom: number; requestId?: string }> {
  const paused = await h.agent.run({ message: 'go' });
  expect(isPaused(paused)).toBe(true);
  if (!isPaused(paused)) throw new Error('expected a pause');
  const resumedFrom = h.events.length;
  if (kind === 'input') {
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const requestId = paused.awaitingInput.requestId;
    const answer = await h.agent.resume(paused.checkpoint, { requestId, values: { year: 2026 } });
    return { answer, resumedFrom, requestId };
  }
  if (kind === 'consent') {
    h.vault.granted = true; // the person consented, out of band
    return { answer: await h.agent.resume(paused.checkpoint, undefined), resumedFrom };
  }
  return {
    answer: await h.agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' })),
    resumedFrom,
  };
}

/** The tool_use ids of the last assistant turn that proposed calls, and the
 *  tool_result ids that answer them on the same request, in wire order. */
function usesAndResults(req: LLMRequest): { uses: string[]; results: string[] } {
  const turnAt = req.messages.map((m) => (m.toolCalls?.length ?? 0) > 0).lastIndexOf(true);
  const turn = req.messages[turnAt]!;
  return {
    uses: (turn.toolCalls ?? []).map((c) => c.id),
    results: req.messages
      .slice(turnAt + 1)
      .filter((m) => m.role === 'tool')
      .map((m) => m.toolCallId ?? ''),
  };
}

const ofType = (h: Harness, type: string, from = 0) =>
  h.events.slice(from).filter((e) => e.type === type);
const forCall = (h: Harness, type: string, id: string) =>
  h.events.filter((e) => e.type === type && e.payload.toolCallId === id);
const sharedState = (h: Harness) =>
  (h.agent.getSnapshot()?.sharedState ?? {}) as {
    history?: readonly LLMMessage[];
    toolResults?: readonly { toolCallId: string }[];
    lastToolResult?: { toolName: string };
  };

// ─── 1. SCENARIO — every door settles the siblings after the paused call ──

describe('batch settlement — a paused batch settles its un-dispatched siblings on every door', () => {
  it.each(KINDS)(
    '%s: a three-call batch paused on its MIDDLE call settles the third on resume',
    async (kind) => {
      const h = build(kind, 1);
      const { answer, resumedFrom } = await pauseAndResume(h, kind);
      expect(answer).toBe('done');

      // Nothing is dispatched on resume: the third tool never ran.
      expect(h.ran).not.toContain('third');

      // The next request carries one tool_result per tool_use, in call order.
      const next = h.requests[1]!;
      const { uses, results } = usesAndResults(next);
      expect(uses).toEqual(['c1', 'c2', 'c3']);
      expect(results).toEqual(['c1', 'c2', 'c3']);

      // The third call's result is the library's fixed sentence, anchored to
      // the paused call by name.
      const sentence = notDispatchedResult('third', { toolName: 'second', toolCallId: 'c2' });
      const settled = next.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c3');
      expect(settled).toEqual({
        role: 'tool',
        content: sentence,
        toolCallId: 'c3',
        toolName: 'third',
      });

      // Its bracket: one tool_start, one tool_end, on the resume leg, after
      // the paused call's own tool_end — and BOTH carry the settlement's
      // typed field, the same shape the history message carries, so a reader
      // of the stream alone never has to guess from `durationMs: 0` whether
      // the call ran. No `error`: the call did not fail — the library chose
      // not to dispatch it, as it does for a denied call, whose bracket
      // carries none either (`toolCalls.ts` · `bracketSettled`).
      const MARKER = { pausedCall: { toolCallId: 'c2', toolName: 'second' } };
      const start = forCall(h, 'agentfootprint.stream.tool_start', 'c3');
      const end = forCall(h, 'agentfootprint.stream.tool_end', 'c3');
      expect(start.map((e) => e.payload)).toEqual([
        { toolName: 'third', toolCallId: 'c3', args: {}, parallelCount: 3, notDispatched: MARKER },
      ]);
      expect(end.map((e) => e.payload)).toEqual([
        { toolCallId: 'c3', result: sentence, durationMs: 0, notDispatched: MARKER },
      ]);
      expect('error' in end[0]!.payload).toBe(false);
      // Absent on every other bracket of the run, both legs: the field is
      // stamped by the settlement and by nothing else.
      const otherBrackets = h.events.filter(
        (e) =>
          (e.type === 'agentfootprint.stream.tool_start' ||
            e.type === 'agentfootprint.stream.tool_end') &&
          e.payload.toolCallId !== 'c3',
      );
      expect(otherBrackets.length).toBeGreaterThanOrEqual(3);
      expect(otherBrackets.filter((e) => 'notDispatched' in e.payload)).toEqual([]);
      const at = (e: unknown) => h.events.indexOf(e as never);
      const pausedEnd = forCall(h, 'agentfootprint.stream.tool_end', 'c2');
      expect(pausedEnd).toHaveLength(1);
      expect(at(start[0])).toBeGreaterThan(resumedFrom);
      expect(at(start[0])).toBeGreaterThan(at(pausedEnd[0]));
      expect(at(end[0])).toBeGreaterThan(at(start[0]));

      // The count: the resume leg closed two brackets (the paused call's and
      // the settled one's), and its iteration_end says so and carries both.
      const iterationEnd = ofType(h, 'agentfootprint.agent.iteration_end', resumedFrom)[0]!;
      expect(at(iterationEnd)).toBeGreaterThan(at(end[0]));
      expect(iterationEnd.payload.toolCallCount).toBe(2);
      const endHistory = iterationEnd.payload.history as readonly LLMMessage[];
      expect(endHistory.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual([
        'c1',
        'c2',
        'c3',
      ]);

      // The sibling BEFORE the paused call keeps today's behaviour: it ran
      // once, on the leg that paused, and was bracketed there only.
      expect(h.ran.filter((n) => n === 'first')).toEqual(['first']);
      const firstStart = forCall(h, 'agentfootprint.stream.tool_start', 'c1');
      const firstEnd = forCall(h, 'agentfootprint.stream.tool_end', 'c1');
      expect(firstStart).toHaveLength(1);
      expect(firstEnd).toHaveLength(1);
      expect(at(firstEnd[0])).toBeLessThan(resumedFrom);

      // A settled sibling never RETURNED, so it joins neither routing key: the
      // batch `on-tool-return` triggers and skill-graph routes read holds the
      // two calls that landed, and `lastToolResult` is the paused call's.
      const state = sharedState(h);
      expect((state.toolResults ?? []).map((r) => r.toolCallId)).toEqual(['c1', 'c2']);
      expect(state.lastToolResult?.toolName).toBe('second');
      // And the stored history is what the next request carried — plus the
      // settlement as DATA on the settled message: the call was never
      // dispatched, and the batch paused on c2. The wire above never carried
      // it (`composeRequest.ts` · `stripFrameworkFields`).
      expect((state.history ?? []).filter((m) => m.role === 'tool').length).toBe(3);
      const stored = (state.history ?? []).find((m) => m.role === 'tool' && m.toolCallId === 'c3');
      expect(stored).toEqual({ ...settled, notDispatched: MARKER });
      // ONE fact, one shape: the history message and both brackets agree.
      expect(stored?.notDispatched).toEqual(start[0]!.payload.notDispatched);
      expect(stored?.notDispatched).toEqual(end[0]!.payload.notDispatched);
    },
  );

  it('input: a batch paused on its FIRST call settles both later siblings, in call order, and counts three', async () => {
    const h = build('input', 0);
    const { resumedFrom } = await pauseAndResume(h, 'input');
    expect(h.ran).toEqual([]);
    const { uses, results } = usesAndResults(h.requests[1]!);
    expect(results).toEqual(uses);
    const settled = h.requests[1]!.messages.filter(
      (m) => m.role === 'tool' && (m.toolCallId === 'c2' || m.toolCallId === 'c3'),
    );
    expect(settled.map((m) => m.content)).toEqual([
      notDispatchedResult('second', { toolName: 'first', toolCallId: 'c1' }),
      notDispatchedResult('third', { toolName: 'first', toolCallId: 'c1' }),
    ]);
    const brackets = h.events
      .slice(resumedFrom)
      .filter(
        (e) =>
          e.type === 'agentfootprint.stream.tool_start' ||
          e.type === 'agentfootprint.stream.tool_end',
      )
      .map((e) => `${e.type.split('.').pop()}:${String(e.payload.toolCallId)}`);
    expect(brackets).toEqual([
      'tool_end:c1',
      'tool_start:c2',
      'tool_end:c2',
      'tool_start:c3',
      'tool_end:c3',
    ]);
    const iterationEnd = ofType(h, 'agentfootprint.agent.iteration_end', resumedFrom)[0]!;
    expect(iterationEnd.payload.toolCallCount).toBe(3);
    // Both settled calls' brackets name the call the run paused on; the
    // paused call's own tool_end carries no field — it was dispatched.
    const markers = h.events
      .slice(resumedFrom)
      .filter(
        (e) =>
          e.type === 'agentfootprint.stream.tool_start' ||
          e.type === 'agentfootprint.stream.tool_end',
      )
      .map((e) => [String(e.payload.toolCallId), e.payload.notDispatched]);
    const pausedOnFirst = { pausedCall: { toolCallId: 'c1', toolName: 'first' } };
    expect(markers).toEqual([
      ['c1', undefined],
      ['c2', pausedOnFirst],
      ['c2', pausedOnFirst],
      ['c3', pausedOnFirst],
      ['c3', pausedOnFirst],
    ]);
  });

  it.each(KINDS)(
    '%s: a JSON-restored checkpoint on a FRESH agent settles the same — the batch is read from history, not carried',
    async (kind) => {
      const first = build(kind, 1);
      const paused = await first.agent.run({ message: 'go' });
      if (!isPaused(paused)) throw new Error('expected a pause');
      // A fresh instance, whose provider only answers: the resumed leg's one
      // model call is the first request it is handed.
      const restored = build(kind, 1, [{ content: 'done' }]);
      const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;
      let answer: unknown;
      if (kind === 'input') {
        if (!isInputPause(paused)) throw new Error('expected an input pause');
        answer = await restored.agent.resume(checkpoint, {
          requestId: paused.awaitingInput.requestId,
          values: { year: 2026 },
        });
      } else if (kind === 'consent') {
        restored.vault.granted = true; // the person consented, out of band
        answer = await restored.agent.resume(checkpoint, undefined);
      } else {
        answer = await restored.agent.resume(checkpoint, checkInApproved({ by: 'alice' }));
      }
      expect(answer).toBe('done');
      expect(restored.ran).not.toContain('third');
      const { uses, results } = usesAndResults(restored.requests[0]!);
      expect(uses).toEqual(['c1', 'c2', 'c3']);
      expect(results).toEqual(['c1', 'c2', 'c3']);
      const settled = restored.requests[0]!.messages.find((m) => m.toolCallId === 'c3');
      expect(settled).toEqual({
        role: 'tool',
        content: notDispatchedResult('third', { toolName: 'second', toolCallId: 'c2' }),
        toolCallId: 'c3',
        toolName: 'third',
      });
      const brackets = restored.events
        .filter(
          (e) =>
            e.type === 'agentfootprint.stream.tool_start' ||
            e.type === 'agentfootprint.stream.tool_end',
        )
        .map((e) => `${e.type.split('.').pop()}:${String(e.payload.toolCallId)}`);
      expect(brackets).toEqual(['tool_end:c2', 'tool_start:c3', 'tool_end:c3']);
      expect(ofType(restored, 'agentfootprint.agent.iteration_end')[0]!.payload.toolCallCount).toBe(
        2,
      );
      const stored = (sharedState(restored).history ?? []).find(
        (m) => m.role === 'tool' && m.toolCallId === 'c3',
      );
      expect(stored?.notDispatched).toEqual({
        pausedCall: { toolCallId: 'c2', toolName: 'second' },
      });
      // The fresh instance stamps the same marker on both halves of the
      // bracket — composed from the restored history, carried by nothing.
      expect(
        restored.events
          .filter((e) => e.payload.toolCallId === 'c3')
          .map((e) => e.payload.notDispatched),
      ).toEqual([stored?.notDispatched, stored?.notDispatched]);
    },
  );

  it('input: the marker a resume wrote survives a second pause and a restart — both settled calls stay out of the sequence', async () => {
    const batch = (prefix: string) => ({
      toolCalls: NAMES.map((name, i) => ({ id: `${prefix}${i + 1}`, name, args: {} })),
    });
    const legOne = build('input', 1, [batch('a'), batch('b'), { content: 'done' }]);
    const pausedA = await legOne.agent.run({ message: 'go' });
    if (!isInputPause(pausedA)) throw new Error('expected an input pause');
    const pausedB = await legOne.agent.resume(pausedA.checkpoint, {
      requestId: pausedA.awaitingInput.requestId,
      values: { year: 2026 },
    });
    if (!isInputPause(pausedB)) throw new Error('expected a second input pause');
    // a3 was settled on the first resume; the second pause's checkpoint carries it.
    const restored = build('input', 1, [{ content: 'done' }]);
    const answer = await restored.agent.resume(JSON.parse(JSON.stringify(pausedB.checkpoint)), {
      requestId: pausedB.awaitingInput.requestId,
      values: { year: 2027 },
    });
    expect(answer).toBe('done');
    const history = sharedState(restored).history ?? [];
    const markerOf = (id: string) =>
      history.find((m) => m.role === 'tool' && m.toolCallId === id)?.notDispatched;
    expect(markerOf('a3')).toEqual({ pausedCall: { toolCallId: 'a2', toolName: 'second' } });
    expect(markerOf('b3')).toEqual({ pausedCall: { toolCallId: 'b2', toolName: 'second' } });
    expect(extractSequence(history, 99).map((e) => e.name)).toEqual([
      'first',
      'second',
      'first',
      'second',
    ]);
    // Every tool_use on the wire has exactly one tool_result, across both
    // turns, and the wire never carries a marker.
    const wire = restored.requests[0]!.messages;
    const uses = wire.flatMap((m) => (m.toolCalls ?? []).map((c) => c.id));
    expect(wire.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual(uses);
    expect(wire.some((m) => m.notDispatched !== undefined)).toBe(false);
  });

  it('input: `continueFrom` a JSON-stored `AgentRunCheckpoint` keeps the marker — a policy sequence never sees the settled call', async () => {
    const legOne = build('input', 1);
    const paused = await legOne.agent.run({ message: 'go' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    await legOne.agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const stored = JSON.parse(JSON.stringify(legOne.agent.checkpoint()));
    const sequences: string[][] = [];
    const checker: PermissionChecker = {
      name: 'observer',
      check: (req) => {
        sequences.push((req.sequence ?? []).map((e) => e.name));
        return { result: 'allow' };
      },
    };
    const later = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'x1', name: 'first', args: {} }] }, { content: 'done' }],
      }),
      model: 'mock',
      permissionChecker: checker,
    })
      .tools(
        NAMES.map((name) =>
          defineTool({
            name,
            description: `the ${name} tool`,
            inputSchema: { type: 'object', properties: {} },
            execute: () => `${name} ran`,
          }),
        ),
      )
      .build();
    expect(await later.run({ message: 'more', continueFrom: stored })).toBe('done');
    expect(sequences).toEqual([['first', 'second']]);
  });

  it("armed `.findings()`: a settled call's bracket carries the args the batch loop would have peeled", async () => {
    // The reserved `_findings` argument never reaches a bracket on the batch
    // loop (`toolCalls.ts` · `peelCall`); a settled call's bracket is read off
    // the assistant turn, where the emission keeps it verbatim, so the same
    // peel has to happen there.
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'c1', name: 'collect', args: {} },
              { id: 'c2', name: 'lookup', args: { q: 'x', _findings: { basis: 'direct' } } },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'mock',
    })
      .tools([
        defineTool({
          name: 'collect',
          description: 'collect an input',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            }),
        }),
        defineTool({
          name: 'lookup',
          description: 'look something up',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute: () => 'looked up',
        }),
      ])
      .findings()
      .build();
    agent.on('*', (e) =>
      events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const paused = await agent.run({ message: 'go' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const start = events.filter(
      (e) => e.type === 'agentfootprint.stream.tool_start' && e.payload.toolCallId === 'c2',
    );
    expect(start.map((e) => e.payload.args)).toEqual([{ q: 'x' }]);
  });
});

// ─── 2. BYTE IDENTITY — nothing to settle, nothing changes ─────────────

const REFERENCE = resolve(__dirname, 'reference/batch-pause-last-call.json');

/** Everything a consumer can see of one pause-and-resume, timing removed and
 *  the run-minted request id replaced by a placeholder. */
function recordOf(h: Harness, requestId: string | undefined): unknown {
  const record = {
    requests: h.requests.map((r) => r.messages),
    eventTypes: h.events.map((e) => e.type),
    brackets: h.events
      .filter(
        (e) =>
          e.type === 'agentfootprint.stream.tool_start' ||
          e.type === 'agentfootprint.stream.tool_end' ||
          e.type === 'agentfootprint.agent.iteration_end',
      )
      .map((e) => {
        const { durationMs: _timing, ...rest } = e.payload;
        return { type: e.type, payload: rest };
      }),
    history: sharedState(h).history ?? [],
    toolResults: sharedState(h).toolResults ?? [],
  };
  const text = JSON.stringify(record);
  return JSON.parse(requestId === undefined ? text : text.split(requestId).join('<requestId>'));
}

describe('batch settlement — a batch whose LAST call pauses is byte-identical to 9.112.2', () => {
  it.each(KINDS)('%s', async (kind) => {
    const h = build(kind, 2);
    const { answer, requestId } = await pauseAndResume(h, kind);
    expect(answer).toBe('done');
    const record = recordOf(h, requestId);
    const all = existsSync(REFERENCE)
      ? (JSON.parse(readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>)
      : {};
    if (process.env.AF_BATCH_SETTLEMENT_REFERENCE === 'update') {
      all[kind] = record;
      mkdirSync(dirname(REFERENCE), { recursive: true });
      writeFileSync(REFERENCE, `${JSON.stringify(all, null, 2)}\n`);
      return;
    }
    expect(
      all[kind],
      `no reference for '${kind}' — generate it on the pre-change tree`,
    ).toBeDefined();
    expect(record).toEqual(all[kind]);
  });
});

// ─── 3. UNIT — the reader of the paused batch ─────────────────────────

describe('batch settlement — `pausedBatchOf` reads the paused turn, and only it', () => {
  const turn = (ids: readonly string[]): LLMMessage => ({
    role: 'assistant',
    content: '',
    toolCalls: ids.map((id) => ({ id, name: `t_${id}`, args: {} })),
  });
  const result = (id: string): LLMMessage => ({
    role: 'tool',
    content: 'ok',
    toolCallId: id,
    toolName: `t_${id}`,
  });

  it('returns the calls AFTER the paused one on the turn that proposed it, in call order', () => {
    const history = [turn(['a', 'b', 'c', 'd']), result('a'), result('b')];
    const batch = pausedBatchOf(history, 'b');
    expect(batch.size).toBe(4);
    expect(batch.undispatched.map((c) => c.id)).toEqual(['c', 'd']);
  });

  it('a paused LAST call leaves nothing to settle', () => {
    expect(pausedBatchOf([turn(['a', 'b']), result('a')], 'b')).toEqual({
      size: 2,
      undispatched: [],
    });
  });

  it('an id an earlier turn also used resolves to the LATEST turn that proposed it', () => {
    const history = [turn(['x', 'y']), result('x'), result('y'), turn(['x', 'z']), result('x')];
    expect(pausedBatchOf(history, 'x').undispatched.map((c) => c.id)).toEqual(['z']);
  });

  it('a history with no turn proposing the id settles nothing — never a guess', () => {
    expect(pausedBatchOf([turn(['a', 'b'])], 'q')).toEqual({ size: 0, undispatched: [] });
    expect(pausedBatchOf([], 'a')).toEqual({ size: 0, undispatched: [] });
  });

  it('a sibling history ALREADY answers is not settled again — one tool_result per tool_use', () => {
    // No library door answers a sibling before the resume, but a checkpoint
    // is data: an app that patched results into its stored history (say, to
    // work around the release before this one) must not get a SECOND result
    // for the same id, a shape a provider rejects. Read off history, never
    // assumed.
    const history = [turn(['a', 'b', 'c', 'd']), result('a'), result('b'), result('d')];
    const batch = pausedBatchOf(history, 'b');
    expect(batch.size).toBe(4);
    expect(batch.undispatched.map((c) => c.id)).toEqual(['c']);
  });

  it('only an answer AFTER the proposing turn counts — a reused id answered on an earlier turn is still settled', () => {
    // The rule is "no `role: 'tool'` message for the id after the turn that
    // proposed the batch", never "no message for the id anywhere": a
    // provider may reuse an id across turns, and an answer to the EARLIER
    // proposal of `c` answers nothing on this turn. Settled exactly once.
    const history = [
      turn(['c', 'x']),
      result('c'),
      result('x'),
      turn(['a', 'b', 'c']),
      result('a'),
      result('b'),
    ];
    const batch = pausedBatchOf(history, 'b');
    expect(batch.size).toBe(3);
    expect(batch.undispatched.map((call) => call.id)).toEqual(['c']);
  });

  it('a tool message naming the id is not a proposing turn', () => {
    // The paused call's own result sits after its turn on every resume path;
    // only an assistant turn's `toolCalls` can be the batch.
    const history = [turn(['a', 'b', 'c']), result('a'), result('b')];
    expect(pausedBatchOf(history, 'b').undispatched.map((c) => c.id)).toEqual(['c']);
  });
});

describe('batch settlement — the sentence, and the marker that says the same thing as data', () => {
  const settledC: LLMMessage = {
    role: 'tool',
    content: notDispatchedResult('t_c', { toolName: 't_b', toolCallId: 'b' }),
    toolCallId: 'c',
    toolName: 't_c',
    notDispatched: { pausedCall: { toolCallId: 'b', toolName: 't_b' } },
  };
  const proposing: LLMMessage = {
    role: 'assistant',
    content: '',
    toolCalls: ['a', 'b', 'c'].map((id) => ({ id, name: `t_${id}`, args: {} })),
  };
  const ranResult = (id: string): LLMMessage => ({
    role: 'tool',
    content: 'ok',
    toolCallId: id,
    toolName: `t_${id}`,
  });

  it('is pinned word for word: a change to it is a change to what the model reads', () => {
    // Every other assertion in this file compares against the composer itself,
    // so only this one would see a tense or a tail change.
    expect(notDispatchedResult('third', { toolName: 'second', toolCallId: 'c2' })).toBe(
      "Tool 'third' was not executed on that call: the run paused on call 'c2' to 'second', " +
        'earlier in the same batch, and resumed without executing the calls that followed it ' +
        'in that batch.',
    );
  });

  it('`extractSequence` leaves a settled call out and keeps every call that ran', () => {
    const history = [proposing, ranResult('a'), ranResult('b'), settledC];
    expect(extractSequence(history, 1).map((e) => e.name)).toEqual(['t_a', 't_b']);
  });

  describe('`extractSequence` pairs a settlement with the ONE proposal it answers — by position, never by id alone', () => {
    // Providers can reuse ids across turns — the library's own fallback ids
    // are minted per provider instance, so a restarted process mints them
    // again. A later turn proposes `c` once more, as a DIFFERENT tool, so the
    // sequence says which of the two proposals it counted.
    const reusing: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c', name: 'lookup', args: {} }],
    };
    const lookupRan: LLMMessage = {
      role: 'tool',
      content: 'ok',
      toolCallId: 'c',
      toolName: 'lookup',
    };
    const lookupSettled: LLMMessage = {
      ...lookupRan,
      content: notDispatchedResult('lookup', { toolName: 't_b', toolCallId: 'b' }),
      notDispatched: { pausedCall: { toolCallId: 'b', toolName: 't_b' } },
    };
    const deniedC: LLMMessage = {
      role: 'tool',
      content: `${SYNTHETIC_DENY_PREFIX} t_c]`,
      toolCallId: 'c',
      toolName: 't_c',
    };
    const names = (history: readonly LLMMessage[]) =>
      extractSequence(history, 2).map((e) => e.name);

    it('a settled call stays out when a later turn reuses its id for a call that RAN — and that call is in', () => {
      // Paired by id, the real lookup's result would answer the settled
      // proposal too, and a "verify before transfer" policy would be met by a
      // verify that never ran.
      expect(
        names([proposing, ranResult('a'), ranResult('b'), settledC, reusing, lookupRan]),
      ).toEqual(['t_a', 't_b', 'lookup']);
    });

    it('a call that RAN stays in when a later reuse of its id is settled — and the settled reuse is out', () => {
      expect(
        names([proposing, ranResult('a'), ranResult('b'), ranResult('c'), reusing, lookupSettled]),
      ).toEqual(['t_a', 't_b', 't_c']);
    });

    it('a denied call stays denied when a later reuse of its id is settled — a settlement is no result', () => {
      expect(
        names([proposing, ranResult('a'), ranResult('b'), deniedC, reusing, lookupSettled]),
      ).toEqual(['t_a', 't_b']);
    });

    it('a reuse still in flight is not answered by the settled message before it', () => {
      // The current turn's call has no result yet; the only message for its
      // id is the settlement of an EARLIER proposal.
      expect(names([proposing, ranResult('a'), ranResult('b'), settledC, reusing])).toEqual([
        't_a',
        't_b',
      ]);
    });

    it('an id proposed twice on ONE turn: each settlement answers its own call, in call order', () => {
      // A later turn's call that RAN under the same id gives the id a result,
      // so only the pairing — not the in-flight check — keeps both out.
      const twice: LLMMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 't_a', args: {} },
          { id: 'c', name: 't_c', args: {} },
          { id: 'c', name: 't_c', args: {} },
        ],
      };
      const settledAfterA: LLMMessage = {
        ...settledC,
        content: notDispatchedResult('t_c', { toolName: 't_a', toolCallId: 'a' }),
        notDispatched: { pausedCall: { toolCallId: 'a', toolName: 't_a' } },
      };
      expect(
        names([twice, ranResult('a'), settledAfterA, settledAfterA, reusing, lookupRan]),
      ).toEqual(['t_a', 'lookup']);
    });

    it('with no settlement anywhere, a reused id pairs as it always did — both proposals count', () => {
      // The additive law: a history the settlement never touched reads
      // exactly as it did before 9.113.0, reuse included.
      expect(
        names([proposing, ranResult('a'), ranResult('b'), ranResult('c'), reusing, lookupRan]),
      ).toEqual(['t_a', 't_b', 't_c', 'lookup']);
    });

    /** A small deterministic generator: the same histories on every run. */
    const seeded = (seed: number): (() => number) => {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    /** The rule this file had before 9.113.0: by id, the latest message decides. */
    const byIdAsBefore = (history: readonly LLMMessage[], iteration: number) => {
      const latest = new Map<string, string>();
      for (const m of history)
        if (m.role === 'tool' && m.toolCallId) latest.set(m.toolCallId, m.content);
      const sequence: { name: string; args: Record<string, unknown>; iteration: number }[] = [];
      let turn = 1;
      for (const m of history) {
        if (m.role !== 'assistant' || !m.toolCalls || m.toolCalls.length === 0) continue;
        for (const call of m.toolCalls) {
          const result = call.id ? latest.get(call.id) : undefined;
          if (result === undefined || result.startsWith(SYNTHETIC_DENY_PREFIX)) continue;
          sequence.push({ name: call.name, args: call.args, iteration: turn });
        }
        turn += 1;
      }
      const last = sequence.at(-1)?.iteration;
      if (last !== undefined && iteration > turn - 1) {
        for (let i = sequence.length - 1; i >= 0 && sequence[i]!.iteration === last; i--) {
          sequence[i]!.iteration = iteration;
        }
      }
      return sequence;
    };

    it('property: with no marker anywhere, the sequence is the by-id rule it always was (400 seeded histories)', () => {
      // Reused ids across and within turns, an empty id, denied calls, calls
      // still in flight, a result given twice, user turns and text-only turns.
      const ids = ['k1', 'k2', 'k3', ''];
      let reused = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const next = seeded(seed);
        const pick = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)]!;
        const history: LLMMessage[] = [];
        for (let turn = 0, turns = 1 + Math.floor(next() * 7); turn < turns; turn++) {
          const kind = next();
          if (kind < 0.15) {
            history.push(
              kind < 0.1
                ? { role: 'user', content: 'and then?' }
                : { role: 'assistant', content: '…' },
            );
            continue;
          }
          const calls = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
            id: pick(ids),
            name: pick(['verify', 'transfer', 'lookup']),
            args: {},
          }));
          history.push({ role: 'assistant', content: '', toolCalls: calls });
          for (const call of calls) {
            const answer = next();
            if (answer < 0.15) continue; // still in flight
            const content = answer < 0.35 ? `${SYNTHETIC_DENY_PREFIX} ${call.name}]` : 'ok';
            history.push({ role: 'tool', content, toolCallId: call.id, toolName: call.name });
            if (next() < 0.05) {
              history.push({
                role: 'tool',
                content: 'ok',
                toolCallId: call.id,
                toolName: call.name,
              });
            }
          }
        }
        const proposed = history.flatMap((m) => (m.toolCalls ?? []).map((c) => c.id));
        if (new Set(proposed).size < proposed.length) reused++;
        const iteration = 1 + (seed % 6);
        expect(extractSequence(history, iteration)).toEqual(byIdAsBefore(history, iteration));
      }
      // The generator did exercise reuse — the case the positional pairing is for.
      expect(reused).toBeGreaterThan(200);
    });

    it('property: histories as the library writes them — each call ran or was settled, ids reused within and across turns — hold exactly the calls that ran (400 seeds)', () => {
      // Every proposal is answered right after its turn, in call order, the
      // way the batch loop and the settlement write them. The call names are
      // unique, so the sequence says exactly which proposals it counted.
      for (let seed = 1; seed <= 400; seed++) {
        const next = seeded(seed * 7919);
        const history: LLMMessage[] = [];
        const ran: string[] = [];
        let label = 0;
        for (let turn = 0, turns = 1 + Math.floor(next() * 6); turn < turns; turn++) {
          const calls = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
            id: `k${1 + Math.floor(next() * 3)}`,
            name: `call_${label++}`,
            args: {},
          }));
          history.push({ role: 'assistant', content: '', toolCalls: calls });
          for (const call of calls) {
            const settle = next() < 0.4;
            if (!settle) ran.push(call.name);
            history.push({
              role: 'tool',
              content: settle
                ? notDispatchedResult(call.name, { toolName: 'p', toolCallId: 'p1' })
                : 'ok',
              toolCallId: call.id,
              toolName: call.name,
              ...(settle && { notDispatched: { pausedCall: { toolCallId: 'p1', toolName: 'p' } } }),
            });
          }
        }
        expect(extractSequence(history, 1).map((e) => e.name)).toEqual(ran);
      }
    });
  });

  it('`extractSequence` reads the marker, never the sentence: the words alone are a result that ran', () => {
    // The marker is the one owner of "not dispatched". A tool that returned
    // the same words ran, and prose is never parsed to decide otherwise.
    const { notDispatched: _marker, ...wordsOnly } = settledC;
    void _marker;
    const history = [proposing, ranResult('a'), ranResult('b'), wordsOnly];
    expect(extractSequence(history, 1).map((e) => e.name)).toEqual(['t_a', 't_b', 't_c']);
  });

  it('`stripFrameworkFields` takes the marker off before a request exists, and nothing else', () => {
    const history = [proposing, ranResult('a'), ranResult('b'), settledC];
    const wire = stripFrameworkFields(history);
    const { notDispatched: _marker, ...onTheWire } = settledC;
    void _marker;
    expect(wire).toEqual([proposing, ranResult('a'), ranResult('b'), onTheWire]);
    // Unmarked messages pass through by reference; a window with no marker at
    // all is handed back as the same array.
    expect(wire[0]).toBe(history[0]);
    const unmarked = [proposing, ranResult('a')];
    expect(stripFrameworkFields(unmarked)).toBe(unmarked);
  });
});

// ─── 4. READERS — a settled call is not a call that ran ───────────────

/**
 * The batch [c1 collect_input → raises `requestInput`, c2 verify_identity],
 * then — after the person answers — one call to transfer_funds. c2 is SETTLED
 * on resume, never run, so every reader that asks "did it run?" must say no.
 */
function precondition(opts: {
  readonly checker?: PermissionChecker;
  readonly transferCheckIn?: boolean;
}) {
  const ran: string[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const tool = (name: string) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      ...(name === 'transfer_funds' &&
        opts.transferCheckIn === true && { checkIn: 'always' as const }),
      execute: () => {
        if (name === 'collect_input') {
          return requestInput({
            id: 'acct',
            question: 'Which account?',
            fields: [{ id: 'acct', type: 'number', required: true }],
          });
        }
        ran.push(name);
        return `${name} ran`;
      },
    });
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'collect_input', args: {} },
            { id: 'c2', name: 'verify_identity', args: {} },
          ],
        },
        { toolCalls: [{ id: 'c3', name: 'transfer_funds', args: {} }] },
        { content: 'done' },
      ],
    }),
    model: 'mock',
    ...(opts.checker !== undefined && { permissionChecker: opts.checker }),
  })
    .tools(['collect_input', 'verify_identity', 'transfer_funds'].map(tool))
    .build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, ran, events };
}

/** Run to the input pause and answer it. */
async function answerTheInput(agent: Agent) {
  const paused = await agent.run({ message: 'go' });
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  return agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { acct: 7 },
  });
}

describe('batch settlement — a settled call is not a call that ran, to every reader that asks', () => {
  it("a permission policy's `sequence` holds only the calls that ran — a precondition is not met by a settled call", async () => {
    // `PermissionRequest.sequence` is "what the agent has already dispatched
    // this run". A settled verify_identity in it would satisfy this policy
    // with a call that never executed — the guard failing open.
    const sequences: Record<string, string[]> = {};
    const checker: PermissionChecker = {
      name: 'precondition-policy',
      check: (req) => {
        const names = (req.sequence ?? []).map((e) => e.name);
        if (req.target !== undefined) sequences[req.target] = names;
        return req.target === 'transfer_funds' && !names.includes('verify_identity')
          ? { result: 'deny', rationale: 'verify_identity must run first' }
          : { result: 'allow' };
      },
    };
    const { agent, ran } = precondition({ checker });
    expect(await answerTheInput(agent)).toBe('done');
    expect(sequences.transfer_funds).toEqual(['collect_input']);
    // So the transfer was refused: nothing but the input door ever executed.
    expect(ran).toEqual([]);
  });

  it('a halt: `PolicyHaltError.sequence` and `permission.halt.sequenceLength` do not count a settled call', async () => {
    const checker: PermissionChecker = {
      name: 'halt-policy',
      check: (req) =>
        req.target === 'transfer_funds'
          ? { result: 'halt', reason: 'security:transfer' }
          : { result: 'allow' },
    };
    const { agent, events } = precondition({ checker });
    const err = await answerTheInput(agent).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PolicyHaltError);
    expect((err as PolicyHaltError).sequence.map((e) => e.name)).toEqual([
      'collect_input',
      'transfer_funds',
    ]);
    // collect_input, plus the halted call's own synthetic result — the count
    // this run made before the settlement existed; the settled call adds none.
    const halts = events.filter((e) => e.type === 'agentfootprint.permission.halt');
    expect(halts.map((e) => e.payload.sequenceLength)).toEqual([2]);
  });

  it("the window's last-tool-result pin: a settled call does not move the pin off its tool's real result", async () => {
    // The audited shape `window/lastToolResult.ts` exists for: `whats_here`
    // once, then a batch that pauses, then nothing but the actuator, under
    // `slidingWindow({ keepRecentTurns: 2 })`. The pin keeps each tool's LAST
    // RESULT. A settled `whats_here` is not `whats_here` answering again (its
    // message carries `notDispatched`), so the real result must stay on the
    // wire exactly as long as it does when the batch held no second call.
    const HOLDS = 'HOLDS: aix-lab-01-rack-a, aix-lab-01-rack-b, aix-lab-02-rack-a';
    const holdsOnWire = async (batch: readonly string[]): Promise<boolean[]> => {
      const seen: boolean[] = [];
      let call = 0;
      const provider = {
        name: 'mock',
        complete: async (req: LLMRequest): Promise<LLMResponse> => {
          call++;
          seen.push(req.messages.some((m) => m.content.startsWith(HOLDS)));
          const reply = (toolCalls: LLMResponse['toolCalls'], content = ''): LLMResponse => ({
            content,
            toolCalls,
            usage: { input: 90_000, output: 5 },
            stopReason: 'end_turn',
          });
          if (call === 1) return reply([{ id: 'w1', name: 'whats_here', args: {} }]);
          if (call === 2)
            return reply(batch.map((name, i) => ({ id: `p${i + 1}`, name, args: {} })));
          if (call < 9) return reply([{ id: `m${call}`, name: 'move', args: {} }]);
          return reply([], 'done');
        },
      };
      const tool = (name: string, execute: () => unknown) =>
        defineTool({
          name,
          description: `the ${name} tool`,
          inputSchema: { type: 'object', properties: {} },
          execute,
        });
      const agent = Agent.create({ provider, model: 'mock', maxIterations: 14 })
        .tools([
          tool('whats_here', () => `${HOLDS} ${'x'.repeat(600)}`),
          tool('move', () => 'moved'),
          tool('collect_input', () =>
            requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            }),
          ),
        ])
        .window(slidingWindow({ keepRecentTurns: 2 }))
        .build();
      const paused = await agent.run({ message: 'Walk the floor; which rack is hottest?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');
      await agent.resume(paused.checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { year: 2026 },
      });
      return seen;
    };
    const settled = await holdsOnWire(['collect_input', 'whats_here']);
    const alone = await holdsOnWire(['collect_input']);
    expect(settled).toEqual(alone);
    // And the pin held it for real: past the two recent turns, into call 5.
    expect(settled.slice(0, 5)).toEqual([false, true, true, true, true]);
  });

  it('the check-in trail a person approves against lists only the calls that completed', async () => {
    // `CheckInTrail.toolCalls` is "the tool calls already completed this
    // run" — the receipts beside the consent. A settled call is not one.
    const { agent, ran } = precondition({ transferCheckIn: true });
    const checkIn = await answerTheInput(agent);
    if (!isPaused(checkIn)) throw new Error('expected the check-in to pause');
    expect(checkIn.checkIn?.evidence.trail).toEqual({
      iteration: 2,
      toolCalls: [{ name: 'collect_input', ok: true }],
      summary: '1 tool run over 2 iterations',
    });
    expect(ran).toEqual([]);
  });

  it("a fresh process that mints the settled call's id again for a call that RAN: the verify stays out, the transfer is refused", async () => {
    // The library's own fallback ids are minted per provider INSTANCE
    // (`adapters/llm/OllamaProvider.ts` · `nextToolCallId` → `ollama-call-N`),
    // so a fresh process resuming a stored checkpoint mints the ids it had
    // before. Here the settled verify's id comes back on a lookup that really
    // runs; paired by id alone, that lookup would count as the verify
    // (`extractSequence` · `settledProposals`).
    const perInstance = (script: readonly (readonly string[] | string)[]) => {
      let minted = 0;
      let step = 0;
      return {
        name: 'mock',
        complete: async (): Promise<LLMResponse> => {
          const next = script[Math.min(step++, script.length - 1)]!;
          return typeof next === 'string'
            ? {
                content: next,
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'end_turn',
              }
            : {
                content: '',
                toolCalls: next.map((name) => ({ id: `local-call-${++minted}`, name, args: {} })),
                usage: { input: 1, output: 1 },
                stopReason: 'tool_use',
              };
        },
      };
    };
    const ran: string[] = [];
    const sequences: Record<string, string[]> = {};
    const checker: PermissionChecker = {
      name: 'verify-before-transfer',
      check: (req) => {
        const names = (req.sequence ?? []).map((e) => e.name);
        if (req.target !== undefined) sequences[req.target] = names;
        return req.target === 'transfer_funds' && !names.includes('verify_identity')
          ? { result: 'deny', rationale: 'verify_identity must run first' }
          : { result: 'allow' };
      },
    };
    const processWith = (provider: ReturnType<typeof perInstance>) =>
      Agent.create({ provider, model: 'mock', permissionChecker: checker })
        .tools(
          ['collect_input', 'verify_identity', 'lookup', 'transfer_funds'].map((name) =>
            defineTool({
              name,
              description: `the ${name} tool`,
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                if (name === 'collect_input') {
                  return requestInput({
                    id: 'acct',
                    question: 'Which account?',
                    fields: [{ id: 'acct', type: 'number', required: true }],
                  });
                }
                ran.push(name);
                return `${name} ran`;
              },
            }),
          ),
        )
        .build();

    const before = processWith(perInstance([['collect_input', 'verify_identity']]));
    const paused = await before.run({ message: 'move my money' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const stored = JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;

    const after = processWith(
      perInstance([['lookup'], ['lookup'], ['transfer_funds'], 'transfer refused']),
    );
    const answer = await after.resume(stored, {
      requestId: paused.awaitingInput.requestId,
      values: { acct: 7 },
    });
    expect(answer).toBe('transfer refused');

    // The precondition: the verify was settled, and the fresh process minted
    // its id again for a lookup that really ran.
    const history = (after.getSnapshot()?.sharedState as { history: readonly LLMMessage[] })
      .history;
    const settledIds = history
      .filter((m) => m.notDispatched !== undefined)
      .map((m) => m.toolCallId);
    expect(settledIds).toEqual(['local-call-2']);
    const lookups = history.flatMap((m) =>
      (m.toolCalls ?? []).filter((c) => c.name === 'lookup').map((c) => c.id),
    );
    expect(lookups).toEqual(['local-call-1', 'local-call-2']);

    // The sequence at the transfer holds the calls that ran, and only them —
    // so the policy refused it, and neither the verify nor the transfer ran.
    expect(sequences.transfer_funds).toEqual(['collect_input', 'lookup', 'lookup']);
    expect(ran).toEqual(['lookup', 'lookup']);
  });
});

// ─── 5. THE FINDINGS OFFER — a settled call is not a result to judge ─────

/**
 * Under `.findings()` the model declares a standing on earlier RESULTS by id
 * (`_findings.previous`). The OFFER lists the ids it may name
 * (`findings/offer.ts` · `offeredResultIds`), the identity source resolves a
 * named id (`knownResults`), the piece counts the served results nobody
 * judged (`undeclared:`), the collapse tickets a result judged noise, and the
 * window's record keeps the standing of each result that left
 * (`WindowRecord.droppedStandings`), and a TURN's standing is its most
 * valuable result's (`WindowStrategyInput.standingOf`, the `'ledger-fact'`
 * pin). A settled call produced no result, so it is none of those: never
 * offered, never resolved (a model that names it anyway files `unknownId:
 * true`, as written), never undeclared, never collapsed, never listed among
 * the dropped, never ranked into its turn's standing. Read off the marker — the wire
 * has lost it, so the served-view rebuild reads the committed conversation
 * the same way the live request does.
 *
 * The script: x1 alone; then a batch whose first call judges x1 noise (so the
 * piece exists) and whose MIDDLE call asks a person; after the resume a call
 * that names the settled c3 as noise from outside the offer; then the answer.
 */
describe('batch settlement — under `.findings()` a settled call is not a result to judge', () => {
  const look = defineTool({
    name: 'look',
    description: 'look something up',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: (args: { q?: unknown }) => `RESULT for ${String(args.q ?? '')}`,
  } as never);
  const collect = defineTool({
    name: 'collect',
    description: 'ask the person for the year',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      requestInput({
        id: 'year',
        question: 'Which year?',
        fields: [{ id: 'year', type: 'number', required: true }],
      }),
  });
  const SCRIPT: readonly Partial<LLMResponse>[] = [
    { toolCalls: [{ id: 'x1', name: 'look', args: { q: 'x', _findings: { basis: 'direct' } } }] },
    {
      toolCalls: [
        {
          id: 'c1',
          name: 'look',
          args: {
            q: 'a',
            _findings: { basis: 'direct', previous: [{ toolCallId: 'x1', standing: 'noise' }] },
          },
        },
        { id: 'c2', name: 'collect', args: { _findings: { basis: 'direct' } } },
        { id: 'c3', name: 'look', args: { q: 'c', _findings: { basis: 'direct' } } },
      ],
    },
    {
      toolCalls: [
        {
          id: 'd1',
          name: 'look',
          args: {
            q: 'd',
            _findings: { basis: 'direct', previous: [{ toolCallId: 'c3', standing: 'noise' }] },
          },
        },
      ],
    },
    { content: 'done' },
  ];

  /** The ids `previous[].toolCallId` may take on this request's `look` schema. */
  const offerOf = (req: LLMRequest): unknown => {
    const schema = (req.tools ?? []).find((t) => t.name === 'look')!;
    const reserved = (schema.inputSchema.properties as Record<string, unknown>)[
      RESERVED_ARGUMENT
    ] as {
      properties: { previous: { items: { properties: { toolCallId: { enum?: unknown } } } } };
    };
    return reserved.properties.previous.items.properties.toolCallId.enum;
  };

  async function judgedRun(window?: 'evicting') {
    const requests: LLMRequest[] = [];
    const inner = mock({ replies: [...SCRIPT] });
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
      maxIterations: 8,
      ...(window === 'evicting' && { keepLastToolResults: false as const }),
    })
      .tools([look, collect])
      .findings();
    if (window === 'evicting') builder = builder.window(slidingWindow({ keepRecentTurns: 1 }));
    const agent = builder.build();
    const paused = await agent.run({ message: 'which year shipped late?' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const answer = await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const state = (agent.getSnapshot()?.sharedState ?? {}) as {
      findingsLedger?: readonly FindingsRow[];
      compactions?: readonly {
        droppedStandings?: readonly { toolCallId: string; standing?: string }[];
      }[];
    };
    return { agent, answer, requests, state };
  }

  it('the offer after the resume lists the calls that ran, never the settled one', async () => {
    const { answer, requests } = await judgedRun();
    expect(answer).toBe('done');
    expect(requests).toHaveLength(4);
    // Request 3 (the first after the resume) carries all three results on
    // the wire — one per tool_use — and offers only the two that are results.
    const wireIds = requests[2]!.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId);
    expect(wireIds).toEqual(['x1', 'c1', 'c2', 'c3']);
    expect(offerOf(requests[2]!)).toEqual(['c2', 'c1']);
    // …and so does every later request: d1 joins, c3 never does.
    expect(offerOf(requests[3]!)).toEqual(['d1', 'c2', 'c1']);
  });

  it('a model that names the settled id anyway files `unknownId`, as written — never resolved to a tool', async () => {
    const { state } = await judgedRun();
    const standings = (state.findingsLedger ?? []).filter(
      (row): row is StandingRow => row.kind === 'standing',
    );
    const c3 = standings.find((row) => row.toolCallId === 'c3');
    expect(c3).toMatchObject({ standing: 'noise', unknownId: true });
    expect(c3?.toolName).toBeUndefined();
    // The control: the result it named on the same ledger resolves as always.
    const x1 = standings.find((row) => row.toolCallId === 'x1');
    expect(x1).toMatchObject({ standing: 'noise', toolName: 'look' });
    expect(x1?.unknownId).toBeUndefined();
  });

  it('the piece never counts it undeclared, and the collapse never tickets its sentence', async () => {
    const { requests } = await judgedRun();
    // Request 3: x1 is judged, so the piece is served; the settled c3 is not
    // a served result nobody judged.
    expect(requests[2]!.systemPrompt).toContain(
      'undeclared: 2 results, served in full below (tool:c1, tool:c2)',
    );
    // Request 4: the model's own standing on c3 is quoted with the ledger
    // (it is what the model declared), but the settled message is not a
    // result, so the wire still carries the library's sentence for it.
    const settled = requests[3]!.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c3');
    expect(settled?.content).toBe(
      notDispatchedResult('look', { toolName: 'collect', toolCallId: 'c2' }),
    );
    // The control: x1, judged noise, IS collapsed to its ticket.
    const x1 = requests[3]!.messages.find((m) => m.role === 'tool' && m.toolCallId === 'x1');
    expect(x1?.content).toContain('"collapsed":true');
    expect(requests[3]!.systemPrompt).toContain(
      'undeclared: 3 results, served in full below (tool:c1, tool:c2, tool:d1)',
    );
    // And no request carried the marker. Requests 3 and 4 were built on the
    // COLLAPSE path (x1's ticket), which collapses the committed conversation
    // — marker and all — and strips afterwards (`callLLM.ts` ·
    // `buildCallLLMStage`); without that strip the marker reaches the provider.
    for (const request of requests) {
      expect(request.messages.some((m) => 'notDispatched' in m)).toBe(false);
    }
  });

  it("the served-view rebuild agrees with the wire: it reads the committed conversation's marker too", async () => {
    // The live request and the rebuild both stripped the marker BEFORE they
    // read the served ids; a reader that looked only at the stripped wire
    // would count the settled call undeclared in one and not the other.
    const { agent, requests } = await judgedRun();
    const views = servedViews(agent.getSnapshot()!);
    // The resumed run's snapshot holds its own epochs: requests 3 and 4.
    expect(views).toHaveLength(2);
    views.forEach((view, i) => {
      const sent = requests[2 + i]!;
      expect(view.system.text, `epoch ${view.epoch}`).toBe(sent.systemPrompt);
      expect(view.messages.asSent.map((m) => [m.toolCallId, m.content])).toEqual(
        sent.messages.map((m) => [m.toolCallId, m.content]),
      );
      expect(view.messages.asSent.some((m) => m.notDispatched !== undefined)).toBe(false);
    });
  });

  it("the window's record never lists it among the dropped results", async () => {
    const { answer, state } = await judgedRun('evicting');
    expect(answer).toBe('done');
    const dropped = (state.compactions ?? []).flatMap((r) => r.droppedStandings ?? []);
    // The batch turn left: its results are listed with the standing the model
    // declared (or none) — and the settled call, which had no result, is not.
    expect(dropped.map((d) => d.toolCallId)).toContain('c1');
    expect(dropped.map((d) => d.toolCallId)).not.toContain('c3');
  });

  it("a batch turn's standing is its RESULTS': a settled sibling is not an undeclared one", async () => {
    // `WindowStrategyInput.standingOf` — the public seam, and the rule the
    // `'ledger-fact'` pin ranks by (`window/ledgerFactPins.ts` ·
    // `turnStandingOf`) — gives a TURN its most valuable result's standing.
    // Ranked as an UNDECLARED result, the settled message would report a batch
    // whose every result the model judged noise as "the model said nothing".
    const lastSeen = async (withSettled: boolean) => {
      const script: readonly Partial<LLMResponse>[] = [
        {
          toolCalls: [
            { id: 'c1', name: 'look', args: { q: 'a', _findings: { basis: 'direct' } } },
            { id: 'c2', name: 'collect', args: { _findings: { basis: 'direct' } } },
            ...(withSettled
              ? [{ id: 'c3', name: 'look', args: { q: 'c', _findings: { basis: 'direct' } } }]
              : []),
          ],
        },
        {
          toolCalls: [
            {
              id: 'd1',
              name: 'look',
              args: {
                q: 'd',
                _findings: {
                  basis: 'direct',
                  previous: [
                    { toolCallId: 'c1', standing: 'noise' },
                    { toolCallId: 'c2', standing: 'noise' },
                  ],
                },
              },
            },
          ],
        },
        {
          toolCalls: [{ id: 'e1', name: 'look', args: { q: 'e', _findings: { basis: 'direct' } } }],
        },
        { content: 'done' },
      ];
      let seen: { ids: string[]; standing: Standing | undefined }[] = [];
      const probe: WindowStrategy = {
        name: 'standing-probe',
        async plan(input) {
          seen = input.turns.map((turn) => ({
            ids: turn.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId ?? ''),
            standing: input.standingOf?.(turn),
          }));
          return undefined;
        },
      };
      const agent = Agent.create({
        provider: mock({ replies: [...script] }),
        model: 'mock',
        maxIterations: 8,
      })
        .tools([look, collect])
        .findings()
        .window(probe)
        .build();
      const paused = await agent.run({ message: 'which year shipped late?' });
      if (!isInputPause(paused)) throw new Error('expected an input pause');
      expect(
        await agent.resume(paused.checkpoint, {
          requestId: paused.awaitingInput.requestId,
          values: { year: 2026 },
        }),
      ).toBe('done');
      // The window's last visit, after d1 filed both standings.
      return seen.find((turn) => turn.ids.includes('c1'));
    };
    // The control: the same batch without a third call is judged noise.
    expect(await lastSeen(false)).toEqual({ ids: ['c1', 'c2'], standing: 'noise' });
    // The settled message is IN the turn — it is served — and is no result.
    expect(await lastSeen(true)).toEqual({ ids: ['c1', 'c2', 'c3'], standing: 'noise' });
  });
});
