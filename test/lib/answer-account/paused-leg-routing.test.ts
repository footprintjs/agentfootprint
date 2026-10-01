/**
 * A resumed answer's ROUTING is read from its record — the verdict RouteTurn
 * committed before the pause (take 3 of the demo video, agentfootprint 9.134.4).
 *
 * The field case: a routed agent (`continuity: 'conversation'`, a menu verdict) paused on
 * the time ask and resumed. "In plain words" said "The routing happened before the pause
 * and is not in this record", "Anything wrong" listed the decided-delivered check as
 * unreachable ("the routing is not in this record") and named the routing among what
 * "cannot be told here".
 *
 * Layer by layer: the record holds the verdict. RouteTurn writes `turnRoute` (by, from, to,
 * the rule's witness, the offered menu) and the scorer's `entryScores` / `entryScorer` to
 * the committed state BEFORE the loop; the run pauses later; the resumed leg's recording
 * carries that state as `snapshot.initialState` (the state the run paused with) and on into
 * `sharedState`. Only the `skill.turn_routed` EVENT belongs to the paused leg. The first
 * wrong layer is the account's fold (`facts/understood.ts`), which read the event alone.
 * One reader now (`routingVerdictOf`): the event, else the verdict the paused state holds.
 *
 * Test types:
 *   functional  — real paused-and-resumed routed runs (an intent verdict; the field's menu
 *                 verdict): "It understood" names the routing, read from the state, with the
 *                 held chip; the decided-delivered check runs; the routing is not named as lost;
 *   integration — every pointer resolves and every var is an allow-listed leaf (P1/P7),
 *                 including the new `turnRoute` / `entryScores` state leaves;
 *   negative    — a record whose state lacks the verdict (stripped) keeps "not in this record"
 *                 and the unreachable check — the one case they are true;
 *   regression  — a leg that never paused reads the event exactly as before.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  coverage,
  defineTool,
  inMemoryArtifacts,
  isInputPause,
  requestInput,
  type Tool,
} from '../../../src/index.js';
import { defineSkill, keywordScorer, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import type {
  AnswerAccount,
  AnswerAccountDeclarations,
  RowId,
} from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7 } from './helpers.js';

const SCOPE = { conversationId: 'paused-leg-routing' };

const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);
const rowLines = (a: AnswerAccount, id: RowId) => a.rows.find((r) => r.id === id)!.lines;
const allIds = (a: AnswerAccount) => a.rows.flatMap((r) => r.lines.map((l) => l.template.id));

function explainChecked(
  recording: Recording,
  runId: string,
  declarations: AnswerAccountDeclarations = {},
): AnswerAccount {
  const account = accountForAnswer(recording, declarations, { runId });
  assertP1(account, recording, declarations);
  assertP7(account, recording, declarations);
  return account;
}

const skill = (id: string, description: string) =>
  defineSkill({ id, description, body: `${id} body` });

/** billing / shipping intents, one keyword classifier — the cascade test's graph. */
const supportGraph = () =>
  skillGraph()
    .entry(skill('billing', 'refunds and charges'), {
      match: { intent: 'customer wants a refund', examples: ['refund my order'] },
    })
    .entry(skill('shipping', 'parcel delivery'), {
      match: { intent: 'customer asks about delivery', examples: ['track my order delivery'] },
    })
    .classify(keywordScorer())
    .build();

/** A tool that asks the person (a pause) before it answers. */
const askYear = (): Tool =>
  defineTool({
    name: 'ask_year',
    description: 'Which year?',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      requestInput({
        id: 'year',
        question: 'Which year?',
        fields: [{ id: 'year', type: 'number', required: true }],
      }),
  }) as Tool;

type Reply = {
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
};

/** Run → a tool's ask pauses it → the person answers → the resumed leg's own recording. */
async function routedLeg(message: string, replies: readonly Reply[]) {
  const store = inMemoryArtifacts();
  const agent = Agent.create({
    provider: mock({ replies: [...replies] as never }),
    model: 'mock',
    maxIterations: 6,
    artifacts: { store, recordings: true },
  })
    .system('You are support.')
    .skillGraph(supportGraph(), { continuity: 'conversation' })
    .tools([askYear()])
    .build();
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const ref = (e.payload as { ref?: string }).ref;
    if (ref !== undefined) refs.push(ref);
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const paused = await agent.run({ message, identity: SCOPE } as never);
    if (!isInputPause(paused)) throw new Error('expected the tool’s ask to pause the run');
    const p = paused as unknown as { checkpoint: unknown; awaitingInput: { requestId: string } };
    const done = await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: { year: 2026 },
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  const legs: { recording: Recording; runId: string }[] = [];
  for (const ref of refs) {
    const record = await store.get(SCOPE, ref);
    if (record?.meta.kind !== 'recording/run') continue;
    legs.push({
      recording: JSON.parse(record.data as string) as Recording,
      runId: record.meta.origin?.runId as string,
    });
  }
  expect(legs).toHaveLength(1); // a paused run mints nothing; the resumed leg mints its own
  return legs[0]!;
}

/** A decisive intent verdict: `billing`, then the ask, then the answer. */
const intentLeg = () =>
  routedLeg('please refund my order', [
    { content: '', toolCalls: [{ id: 'c1', name: 'ask_year', args: {} }] },
    { content: 'Your refund for 2026 is on its way.' },
  ]);

/** The field's shape: a near-tie → a MENU; the model opens a skill, then the ask, then the answer. */
const menuLeg = () =>
  routedLeg('my order', [
    { content: '', toolCalls: [{ id: 'c0', name: 'read_skill', args: { id: 'billing' } }] },
    { content: '', toolCalls: [{ id: 'c1', name: 'ask_year', args: {} }] },
    { content: 'Your order for 2026 is billed.' },
  ]);

describe('a resumed routed answer — the routing verdict is read from the paused state', () => {
  it('the record holds it: `turnRoute` in the state the run paused with, no `turn_routed` event in the leg', async () => {
    const leg = await intentLeg();
    const snapshot = leg.recording.snapshot as {
      initialState?: { turnRoute?: unknown };
      sharedState?: { turnRoute?: unknown };
    };
    expect(snapshot.initialState?.turnRoute).toMatchObject({ by: 'intent', to: 'billing' });
    expect(snapshot.sharedState?.turnRoute).toEqual(snapshot.initialState?.turnRoute);
    expect(
      leg.recording.events.filter((e) => e.type === 'agentfootprint.skill.turn_routed'),
    ).toHaveLength(0);
  });

  it('an intent verdict: "It understood" names the routing, read from the state, and the check runs', async () => {
    const leg = await intentLeg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(a.run.value?.resumedLeg).toBe(true);
    const understood = rowText(a, 'understood');
    expect(understood).toContain("The library's routing picked the billing skill.");
    expect(understood.join('\n')).not.toContain('is not in this record');
    expect(allIds(a)).not.toContain('understood.resumed');
    // The line says where it was read from.
    const line = rowLines(a, 'understood').find((l) => l.template.id === 'understood.intent')!;
    expect(line.chips?.map((c) => c.text)).toContain(
      'before the pause — read from the state this record holds',
    );
    expect(line.pointers).toContainEqual({ kind: 'state', key: 'turnRoute', path: '/by' });
    expect(a.facts.routing.verdict).toMatchObject({
      status: 'recorded',
      value: { by: 'intent', to: 'billing', scorer: 'keyword' },
    });
    // Check 1 ran: the decided skill was given to the model on this leg.
    expect(a.facts.checks.reachable).toContain('decided-delivered');
    expect(rowText(a, 'understood')).toContain(
      'The skill was given to the model before it answered.',
    );
    expect(a.unreachable.map((u) => u.sentence.template.id)).not.toContain('unreachable.decided');
  });

  it('the field’s menu verdict: the offer is named, and the routing is not listed as what cannot be told', async () => {
    const leg = await menuLeg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(rowText(a, 'understood')).toEqual(
      expect.arrayContaining([
        'No routing rule decided; the model was offered 2 skills to choose from.',
      ]),
    );
    expect(allIds(a)).not.toContain('understood.resumed');
    expect(allIds(a)).not.toContain('wrong.beforePause.held');
    expect(allIds(a)).toContain('wrong.beforePause.held.events');
    expect(rowText(a, 'anything-wrong').join('\n')).not.toContain('how it was routed');
    expect(a.unreachable.map((u) => u.sentence.template.id)).not.toContain('unreachable.decided');
  });

  it('NEGATIVE: a record whose state lacks the verdict keeps "not in this record" — the one case it is true', async () => {
    const leg = await intentLeg();
    const snapshot = leg.recording.snapshot as Record<string, Record<string, unknown>>;
    const strip = (state: Record<string, unknown>) => {
      const { turnRoute: _r, entryScores: _s, entryScorer: _n, ...rest } = state;
      return rest;
    };
    const recording = {
      ...leg.recording,
      snapshot: {
        ...snapshot,
        initialState: strip(snapshot.initialState!),
        sharedState: strip(snapshot.sharedState!),
      },
    } as Recording;
    const a = explainChecked(recording, leg.runId);
    expect(rowText(a, 'understood')).toContain(
      'The routing happened before the pause and is not in this record.',
    );
    expect(a.unreachable.map((u) => u.sentence.template.id)).toContain('unreachable.decided');
    expect(allIds(a)).toContain('wrong.beforePause.held');
  });

  it('REGRESSION: a leg that never paused reads the event, as before', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'Refund started.' }),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .skillGraph(supportGraph(), { continuity: 'conversation' })
      .build();
    let ref: string | undefined;
    agent.on('agentfootprint.artifacts.minted', (e) => {
      const p = e.payload as { ref?: string; kind?: string };
      if (p.kind === 'recording/run') ref = p.ref;
    });
    await agent.run({ message: 'please refund my order', identity: SCOPE } as never);
    const record = await store.get(SCOPE, ref!);
    const recording = JSON.parse(record!.data as string) as Recording;
    const a = explainChecked(recording, record!.meta.origin?.runId as string);
    const line = rowLines(a, 'understood').find((l) => l.template.id === 'understood.intent')!;
    expect(line.text).toBe("The library's routing picked the billing skill.");
    expect(line.pointers[0]).toMatchObject({
      kind: 'event',
      type: 'agentfootprint.skill.turn_routed',
    });
    expect(line.chips ?? []).toEqual([]);
    expect(a.facts.routing.verdict.value).toMatchObject({ decisive: true });
  });
});

// ─── The take-3 shape, whole: menu → the person is asked → the call runs → present ──────────

/** Rows wrapped in a declared boundary, under `result.rows` — the field tool's shape. */
const clientHealth = (): Tool =>
  defineTool({
    name: 'pscale_client_health',
    description: 'Clients with slow operations on a cluster.',
    inputSchema: {
      type: 'object',
      properties: { cluster: { type: 'string' }, window: { type: 'string' } },
    },
    askOrAssume: { window: { ask: 'Which window?' } },
    execute: () =>
      coverage(
        {
          cluster: 'SHISOLPLPAP006',
          rows: [{ client: 'shsectraplw101' }, { client: 'shsectraplw102' }],
        },
        {
          checked: [{ what: 'ps_client over the window' }],
          notChecked: [{ what: 'the other operation classes', kind: 'scope' }],
        },
      ),
  }) as Tool;

async function take3Leg() {
  const store = inMemoryArtifacts();
  const { meta: stored } = await store.put(SCOPE, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: '[{"client":"shsectraplw101"},{"client":"shsectraplw102"}]',
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'c0', name: 'read_skill', args: { id: 'billing' } }] },
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'pscale_client_health', args: { cluster: 'SHISOLPLPAP006' } },
          ],
        },
        {
          content: '',
          toolCalls: [{ id: 'c2', name: 'present', args: { ref: stored.ref, as: 'table' } }],
        },
        { content: 'Two clients on SHISOLPLPAP006 were slow; the table is on the Data panel.' },
      ] as never,
    }),
    model: 'mock',
    maxIterations: 8,
    artifacts: { store, recordings: true },
  })
    .skillGraph(supportGraph(), { continuity: 'conversation' })
    .tools([clientHealth()])
    .build();
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const p = e.payload as { ref?: string; kind?: string };
    if (p.kind === 'recording/run' && p.ref !== undefined) refs.push(p.ref);
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const paused = await agent.run({ message: 'my order', identity: SCOPE } as never);
    if (!isInputPause(paused)) throw new Error('expected the arguments ask to pause the run');
    const p = paused as unknown as {
      checkpoint: unknown;
      awaitingInput: { requestId: string; fields: { id: string }[] };
    };
    const done = await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: Object.fromEntries(p.awaitingInput.fields.map((f) => [f.id, 'the last hour'])),
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  expect(refs).toHaveLength(1);
  const record = await store.get(SCOPE, refs[0]!);
  return {
    recording: JSON.parse(record!.data as string) as Recording,
    runId: record!.meta.origin?.runId as string,
  };
}

describe('the take-3 shape — the tone is computed, not left unknown by the pause', () => {
  // The app declares where the field tool keeps its rows (the boundary's wrapped `result.rows`).
  const declarations: AnswerAccountDeclarations = {
    tools: { pscale_client_health: { rowsAt: 'rows' } },
  };

  it('routing read from the paused state; the presentation receipt is not judged as an empty result', async () => {
    const leg = await take3Leg();
    const a = explainChecked(leg.recording, leg.runId, declarations);
    expect(rowText(a, 'understood')).toContain(
      'No routing rule decided; the model was offered 2 skills to choose from.',
    );
    expect(a.unreachable).toEqual([]);
    expect(a.facts.checks.unreachable).toEqual([]);
    expect(a.facts.checks.reachable).toEqual(['existence', 'empty-results']);
    expect(a.summary.tone).toBe('ok');
    expect(a.summary.sentence.text).toBe(
      'Nothing this report looks for turned up in the record. This answer continued after a ' +
        "pause; this record holds the state the run kept from before it, not that part's events.",
    );
    expect(rowText(a, 'found')).toContain('present returned a result.');
  });

  it('NEGATIVE: without the app’s rows key the field tool’s shape is still unreachable — said, never guessed', async () => {
    const leg = await take3Leg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(a.unreachable.map((u) => u.sentence.text)).toEqual([
      'It cannot be told whether the result of pscale_client_health was empty: its shape is not declared.',
    ]);
    expect(a.summary.tone).toBe('unknown');
  });
});
