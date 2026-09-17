/**
 * Integration — tool choice by classifier on a real agent run (9.105.0,
 * `.toolChoice()`).
 *
 * Every test drives `Agent` end to end with the scripted mock provider and a
 * `mockClassifier`; nothing here calls a hosted classifier. What is pinned:
 *
 *   - WHEN: one classifier call per model call, made BEFORE the call (the
 *     provider snapshots `classifier.calls.length` on every call), over the
 *     merged wire minus the doors, by description;
 *   - WHAT: a `pick` row before and an `outcome` row after every call, on
 *     `sharedState.toolChoices`, in both chart shapes;
 *   - ADVISORY: the wire is byte for byte the unarmed twin's — every request
 *     the provider saw is equal — and the committed keys are the twin's plus
 *     `toolChoices`;
 *   - NARROWING: the served list is exactly top-N + the doors, in offered
 *     order; the request's tools, the receipt's `tools.schemaHashes` and the
 *     served view's `tools.schemas` all name that list; the record holds
 *     `served` on the row;
 *   - the four skips on the real loop: a failed classifier (an error row, the
 *     full set), too few candidates, the call after a miss, the wrap-up;
 *   - a MISS: a narrowed-away tool the model names anyway is recorded as a
 *     miss, answered by the dispatcher's off-wire path exactly as before
 *     (`tools.answered_off_wire`), and the next call serves the full wire;
 *   - the events carry identities, enums and numbers — never the
 *     descriptions, never the message;
 *   - refusals: a second `.toolChoice()`, a non-Classifier, a bad `top`,
 *     `reactMode: 'classic'`.
 *
 * Byte identity for the unarmed record is `test/core/tools/byte-identity.test.ts`;
 * the one armed reference is `agent-tool-choice` there.
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  epochLocations,
  receiptAt,
  servedAt,
  type ToolChoiceEntry,
  type ToolChoiceOutcomeRow,
  type ToolChoiceRow,
} from '../../../../src/index.js';
import { defineTool } from '../../../../src/core/tools.js';
import { mock } from '../../../../src/llm-providers.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import {
  ClassifierError,
  mockClassifier,
  type ClassifyRequest,
  type ClassifyResult,
} from '../../../../src/classify/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';

type Row = { type: string; payload: Record<string, unknown> };

const TOOLS = ['lookup', 'charge', 'ship', 'invoice'] as const;
const tool = (name: string) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: () => `${name} result`,
  } as never);

/** A classifier answer that ranks `names` highest first and picks the first. */
const rankAnswer = (...names: string[]): ClassifyResult => ({
  model: 'jev-1.13.0',
  answers: {
    tool: {
      type: 'choice',
      choice: names[0]!,
      confidence: 0.8,
      probabilities: Object.fromEntries(names.map((n, i) => [n, 0.9 - i * 0.2])),
    },
  },
  usage: { inputTokens: 100, outputTokens: 8 },
  latencyMs: 5,
});

const call = (id: string, name: string): Partial<LLMResponse> => ({
  toolCalls: [{ id, name, args: { q: 'x' } }],
});

/** A provider that answers from a script and records every request and how many classifier calls had been made. */
function scripted(
  turns: readonly Partial<LLMResponse>[],
  classifier?: { calls: readonly ClassifyRequest[] },
) {
  const seen: number[] = [];
  const requests: LLMRequest[] = [];
  let i = 0;
  const provider = mock({
    respond: (req: LLMRequest) => {
      seen.push(classifier?.calls.length ?? 0);
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      return turn;
    },
  });
  return { provider, seen, requests };
}

type Build = (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;

async function run(
  turns: readonly Partial<LLMResponse>[],
  build: Build,
  options: {
    classifier?: ReturnType<typeof mockClassifier>;
    reactMode?: 'dynamic' | 'dynamic-grouped';
    maxIterations?: number;
    message?: string;
  } = {},
) {
  const { provider, seen, requests } = scripted(turns, options.classifier);
  const events: Row[] = [];
  const agent = build(
    Agent.create({
      provider,
      model: 'mock',
      maxIterations: options.maxIterations ?? 6,
      ...(options.reactMode !== undefined && { reactMode: options.reactMode }),
    }),
  ).build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  const answer = await agent.run({ message: options.message ?? 'refund order 42' });
  const snapshot = agent.getSnapshot()!;
  const rows = (snapshot.sharedState as { toolChoices?: readonly ToolChoiceEntry[] }).toolChoices;
  return { agent, answer, seen, requests, events, snapshot, rows: rows ?? [] };
}

const withTools: Build = (a) => TOOLS.reduce((b, name) => b.tool(tool(name)), a.system('bot'));
const picks = (rows: readonly ToolChoiceEntry[]) =>
  rows.filter((r): r is ToolChoiceRow => r.kind === 'pick');
const outcomes = (rows: readonly ToolChoiceEntry[]) =>
  rows.filter((r): r is ToolChoiceOutcomeRow => r.kind === 'outcome');

const TWO_CALLS: readonly Partial<LLMResponse>[] = [
  call('c1', 'lookup'),
  call('c2', 'charge'),
  { content: 'refunded' },
];

describe('advisory — a second reading beside the model’s call', () => {
  it('asks once per model call, BEFORE the call, over the wire minus the doors, by description', async () => {
    const classifier = mockClassifier([
      rankAnswer('lookup', 'charge'),
      rankAnswer('charge', 'invoice'),
      rankAnswer('invoice', 'ship'),
    ]);
    const { answer, seen, rows } = await run(
      TWO_CALLS,
      (a) => withTools(a).toolChoice({ classifier }),
      { classifier },
    );
    expect(answer).toBe('refunded');
    // Model call 1 saw 1 classifier call already made; call 2 saw 2; call 3 saw 3.
    expect(seen).toEqual([1, 2, 3]);
    expect(classifier.calls).toHaveLength(3);
    expect(classifier.calls[0]).toEqual({
      state: { message: 'refund order 42' },
      questions: {
        tool: {
          type: 'choice',
          instructions: expect.stringMatching(/ONE tool/),
          criteria: {
            lookup: 'the lookup tool',
            charge: 'the charge tool',
            ship: 'the ship tool',
            invoice: 'the invoice tool',
          },
        },
      },
    });
    expect(rows.map((r) => `${r.kind}:${r.iteration}`)).toEqual([
      'pick:1',
      'outcome:1',
      'pick:2',
      'outcome:2',
      'pick:3',
      'outcome:3',
    ]);
  });

  it('the pick row holds the ranking as sent, the provider’s pick, its cost, and the FULL served list', async () => {
    const classifier = mockClassifier([
      rankAnswer('lookup', 'charge'),
      rankAnswer('charge', 'invoice'),
      rankAnswer('invoice', 'ship'),
    ]);
    const { rows } = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
    });
    expect(picks(rows)[0]).toEqual({
      kind: 'pick',
      iteration: 1,
      source: 'classifier',
      classifier: { name: 'mock', model: 'jev-1.13.0' },
      offered: ['lookup', 'charge', 'ship', 'invoice'],
      ranked: [
        { name: 'lookup', score: 0.9 },
        { name: 'charge', score: 0.7 },
      ],
      chosen: 'lookup',
      confidence: 0.8,
      usage: { inputTokens: 100, outputTokens: 8 },
      latencyMs: 5,
      served: ['lookup', 'charge', 'ship', 'invoice'],
      narrowed: false,
    });
  });

  it('the outcome row: called in order, firstAgrees against the pick, absent on the answer', async () => {
    const classifier = mockClassifier([
      rankAnswer('lookup', 'charge'),
      rankAnswer('invoice', 'charge'),
      rankAnswer('invoice', 'ship'),
    ]);
    const { rows } = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
    });
    expect(outcomes(rows)).toEqual([
      { kind: 'outcome', iteration: 1, called: ['lookup'], firstAgrees: true },
      { kind: 'outcome', iteration: 2, called: ['charge'], firstAgrees: false },
      { kind: 'outcome', iteration: 3, called: [] },
    ]);
  });

  it('the unarmed twin: keys(on) = keys(off) + toolChoices, and every request is byte-identical', async () => {
    const classifier = mockClassifier(() => rankAnswer('lookup', 'charge'));
    const off = await run(TWO_CALLS, withTools);
    const on = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
    });
    expect(on.requests).toEqual(off.requests);
    const keysOf = (s: { sharedState: Record<string, unknown> }) =>
      Object.keys(s.sharedState).sort();
    expect(keysOf(on.snapshot as never)).toEqual(
      [...keysOf(off.snapshot as never), 'toolChoices'].sort(),
    );
    expect(off.rows).toEqual([]);
    // The unarmed twin makes no classifier call and files no event.
    expect(off.events.some((e) => e.type.startsWith('agentfootprint.tool_choice.'))).toBe(false);
  });

  it('the grouped chart records the same rows on the outer snapshot', async () => {
    const classifier = mockClassifier(() => rankAnswer('charge', 'lookup'));
    const { rows } = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
      reactMode: 'dynamic-grouped',
    });
    expect(rows.map((r) => `${r.kind}:${r.iteration}`)).toEqual([
      'pick:1',
      'outcome:1',
      'pick:2',
      'outcome:2',
      'pick:3',
      'outcome:3',
    ]);
    expect(outcomes(rows).map((r) => r.firstAgrees)).toEqual([false, true, undefined]);
  });

  it('the events carry identities, enums and numbers — never a description, never the message', async () => {
    const classifier = mockClassifier(() => rankAnswer('lookup', 'charge'));
    const { events } = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
    });
    const mine = events.filter((e) => e.type.startsWith('agentfootprint.tool_choice.'));
    expect(mine.map((e) => e.type)).toEqual([
      'agentfootprint.tool_choice.picked',
      'agentfootprint.tool_choice.outcome',
      'agentfootprint.tool_choice.picked',
      'agentfootprint.tool_choice.outcome',
      'agentfootprint.tool_choice.picked',
      'agentfootprint.tool_choice.outcome',
    ]);
    expect(mine[0]!.payload).toEqual({
      iteration: 1,
      chosen: 'lookup',
      confidence: 0.8,
      offered: 4,
      served: 4,
      narrowed: false,
      latencyMs: 5,
      inputTokens: 100,
      outputTokens: 8,
    });
    expect(mine[1]!.payload).toEqual({ iteration: 1, called: ['lookup'], firstAgrees: true });
    expect(JSON.stringify(mine)).not.toMatch(/the lookup tool|refund order 42/);
  });
});

describe('narrowing — serve: { top: N }', () => {
  it('serves exactly top-N + the doors in offered order; the request, the receipt and the served view agree', async () => {
    const classifier = mockClassifier([
      rankAnswer('charge', 'lookup', 'ship', 'invoice'),
      rankAnswer('ship', 'charge', 'lookup', 'invoice'),
      rankAnswer('invoice', 'ship', 'lookup', 'charge'),
    ]);
    const { rows, requests, snapshot } = await run(
      TWO_CALLS,
      (a) =>
        withTools(a)
          .skill(defineSkill({ id: 'billing', description: 'billing', body: 'B' }))
          .toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    // read_skill rides the static list AFTER the `.tool()`s (a door): never
    // offered as a candidate, always served, in the wire's own order.
    expect(picks(rows)[0]!.offered).toEqual(['lookup', 'charge', 'ship', 'invoice']);
    expect(picks(rows).map((r) => r.served)).toEqual([
      ['lookup', 'charge', 'read_skill'],
      ['charge', 'ship', 'read_skill'],
      ['ship', 'invoice', 'read_skill'],
    ]);
    expect(picks(rows).every((r) => r.narrowed)).toBe(true);
    // The wire the provider saw IS the narrowed list.
    expect(requests.map((r) => (r.tools ?? []).map((t) => t.name))).toEqual([
      ['lookup', 'charge', 'read_skill'],
      ['charge', 'ship', 'read_skill'],
      ['ship', 'invoice', 'read_skill'],
    ]);
    // The receipt hashes the narrowed list and the served view rebuilds it — byte-equal, by construction.
    for (const { epoch } of epochLocations(snapshot)) {
      const receipt = receiptAt(snapshot, epoch)!;
      const view = servedAt(snapshot, epoch)!;
      const served = picks(rows).find((r) => r.iteration === epoch)!.served;
      expect(Object.keys(receipt.tools.schemaHashes)).toEqual(served);
      expect(view.tools.schemas.map((t) => t.name)).toEqual(served);
      expect(view.tools.names).toEqual(served);
      expect(view.tools.schemas).toEqual(requests[epoch - 1]!.tools);
    }
  });

  it('the slot record follows the served list — one toolsInjections record per served tool', async () => {
    const classifier = mockClassifier(() => rankAnswer('charge', 'lookup', 'ship', 'invoice'));
    const { snapshot } = await run(
      [{ content: 'done' }],
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    const records = (
      snapshot.sharedState as { toolsInjections?: { sourceId: string; position: number }[] }
    ).toolsInjections!;
    expect(records.map((r) => [r.sourceId, r.position])).toEqual([
      ['lookup', 0],
      ['charge', 1],
    ]);
  });

  it('a failed classifier is an error row and the full set is served — fail open, never fail narrow', async () => {
    let n = 0;
    const classifier = mockClassifier((_req, i) => {
      n = i;
      if (i === 0) throw new ClassifierError('overloaded', { status: 529, retryable: true });
      return rankAnswer('charge', 'lookup');
    });
    const { rows, requests, answer } = await run(
      TWO_CALLS,
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    expect(answer).toBe('refunded');
    expect(n).toBe(2);
    expect(rows[0]).toEqual({
      kind: 'pick-error',
      iteration: 1,
      source: 'classifier',
      classifier: { name: 'mock' },
      status: 529,
      message: 'overloaded',
      latencyMs: expect.any(Number),
      served: ['lookup', 'charge', 'ship', 'invoice'],
      narrowedSkipped: 'unavailable',
    });
    expect(requests[0]!.tools!.map((t) => t.name)).toEqual(['lookup', 'charge', 'ship', 'invoice']);
    // The outcome row still pairs with the attempt; no chosen, so no agreement.
    expect(rows[1]).toEqual({ kind: 'outcome', iteration: 1, called: ['lookup'] });
    // The second call narrowed as normal.
    expect(picks(rows)[0]).toMatchObject({
      iteration: 2,
      narrowed: true,
      served: ['lookup', 'charge'],
    });
  });

  it('advisory (serve: "all"): a failed classifier files an error row with no narrowedSkipped — nothing was ever going to narrow', async () => {
    const classifier = mockClassifier((_req, i) => {
      if (i === 0) throw new ClassifierError('overloaded', { status: 529, retryable: true });
      return rankAnswer('charge', 'lookup');
    });
    const { rows } = await run(TWO_CALLS, (a) => withTools(a).toolChoice({ classifier }), {
      classifier,
    });
    expect(rows[0]).toEqual({
      kind: 'pick-error',
      iteration: 1,
      source: 'classifier',
      classifier: { name: 'mock' },
      status: 529,
      message: 'overloaded',
      latencyMs: expect.any(Number),
      served: ['lookup', 'charge', 'ship', 'invoice'],
    });
    expect(rows[0]).not.toHaveProperty('narrowedSkipped');
  });

  it('too-few: with N + 1 candidates not offered, the full set is served with the reason', async () => {
    const classifier = mockClassifier(() => rankAnswer('lookup', 'charge'));
    const { rows, requests } = await run(
      [{ content: 'done' }],
      (a) =>
        a
          .system('bot')
          .tool(tool('lookup'))
          .tool(tool('charge'))
          .toolChoice({
            classifier,
            serve: { top: 2 },
          }),
      { classifier },
    );
    expect(picks(rows)[0]).toMatchObject({
      narrowed: false,
      narrowedSkipped: 'too-few',
      served: ['lookup', 'charge'],
    });
    expect(requests[0]!.tools!.map((t) => t.name)).toEqual(['lookup', 'charge']);
  });

  it('unavailable: a ranking with fewer scored names than N serves the full set', async () => {
    const classifier = mockClassifier(() => rankAnswer('lookup'));
    const { rows } = await run(
      [{ content: 'done' }],
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    expect(picks(rows)[0]).toMatchObject({ narrowed: false, narrowedSkipped: 'unavailable' });
  });

  it('a miss: the model names a narrowed-away tool — recorded, answered off-wire as before, full set next call', async () => {
    const classifier = mockClassifier(() => rankAnswer('charge', 'lookup', 'ship', 'invoice'));
    const { rows, requests, events, snapshot } = await run(
      [call('c1', 'invoice'), call('c2', 'charge'), { content: 'done' }],
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    // Call 1 was narrowed to charge + lookup; the model asked for invoice.
    expect(picks(rows)[0]).toMatchObject({ narrowed: true, served: ['lookup', 'charge'] });
    expect(outcomes(rows)[0]).toEqual({
      kind: 'outcome',
      iteration: 1,
      called: ['invoice'],
      firstAgrees: false,
      miss: { wanted: ['invoice'] },
    });
    // The call RAN — the dispatcher's off-wire path, exactly as before — and said so.
    const history = (snapshot.sharedState as { history: { role: string; content: string }[] })
      .history;
    expect(history.some((m) => m.role === 'tool' && m.content === 'invoice result')).toBe(true);
    expect(
      events.find((e) => e.type === 'agentfootprint.tools.answered_off_wire')?.payload,
    ).toMatchObject({ toolName: 'invoice', toolCallId: 'c1', iteration: 1 });
    expect(events.find((e) => e.type === 'agentfootprint.tool_choice.outcome')?.payload).toEqual({
      iteration: 1,
      called: ['invoice'],
      firstAgrees: false,
      missed: ['invoice'],
    });
    // Call 2 serves the full wire (after-miss); call 3 narrows again.
    expect(picks(rows)[1]).toMatchObject({
      iteration: 2,
      narrowed: false,
      narrowedSkipped: 'after-miss',
      served: ['lookup', 'charge', 'ship', 'invoice'],
    });
    expect(requests[1]!.tools!.map((t) => t.name)).toEqual(['lookup', 'charge', 'ship', 'invoice']);
    expect(picks(rows)[2]).toMatchObject({ iteration: 3, narrowed: true });
  });

  it('wrap-up: the out-of-budget call files a pick but never narrows', async () => {
    const classifier = mockClassifier(() => rankAnswer('charge', 'lookup', 'ship', 'invoice'));
    const { rows, requests } = await run(
      [call('c1', 'charge'), call('c2', 'charge'), call('c3', 'charge')],
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 } }),
      { classifier, maxIterations: 1 },
    );
    const last = picks(rows)[picks(rows).length - 1]!;
    expect(last).toMatchObject({ narrowed: false, narrowedSkipped: 'wrap-up' });
    // …and the tools came off at assembly, as they always did on that call.
    expect(requests[requests.length - 1]!.tools).toBeUndefined();
  });

  it('the app’s own doors ride every narrowed call and are never offered', async () => {
    const classifier = mockClassifier(() => rankAnswer('charge', 'lookup', 'ship'));
    const { rows } = await run(
      [{ content: 'done' }],
      (a) => withTools(a).toolChoice({ classifier, serve: { top: 2 }, alwaysServe: ['invoice'] }),
      { classifier },
    );
    expect(picks(rows)[0]).toMatchObject({
      offered: ['lookup', 'charge', 'ship'],
      served: ['lookup', 'charge', 'invoice'],
      narrowed: true,
    });
  });

  it('a call with nothing to choose among makes no classifier call and files no row', async () => {
    const classifier = mockClassifier(() => rankAnswer('x'));
    const { rows } = await run(
      [{ content: 'done' }],
      (a) => a.system('bot').toolChoice({ classifier, serve: { top: 2 } }),
      { classifier },
    );
    expect(classifier.calls).toHaveLength(0);
    expect(rows).toEqual([]);
  });
});

describe('refusals at build', () => {
  const classifier = mockClassifier(() => rankAnswer('lookup'));
  it('a second .toolChoice() is refused', () => {
    expect(() =>
      Agent.create({ provider: mock(), model: 'm' })
        .toolChoice({ classifier })
        .toolChoice({ classifier }),
    ).toThrow(/already set/);
  });
  it('a classifier that is not a Classifier is refused by name', () => {
    expect(() =>
      Agent.create({ provider: mock(), model: 'm' }).toolChoice({ classifier: {} as never }),
    ).toThrow(/classifier must be a Classifier/);
  });
  it('top must be an integer ≥ 1', () => {
    for (const top of [0, -1, 1.5, 'two'] as const) {
      expect(() =>
        Agent.create({ provider: mock(), model: 'm' }).toolChoice({
          classifier,
          serve: { top: top as never },
        }),
      ).toThrow(/serve must be 'all' or \{ top: <integer ≥ 1> \}/);
    }
  });
  it('alwaysServe must be an array of non-empty names', () => {
    expect(() =>
      Agent.create({ provider: mock(), model: 'm' }).toolChoice({
        classifier,
        alwaysServe: ['a', ''] as never,
      }),
    ).toThrow(/alwaysServe/);
  });
  it("reactMode 'classic' is refused — the slot would run once and a narrowed list would be served forever", () => {
    expect(() =>
      Agent.create({ provider: mock(), model: 'm', reactMode: 'classic' })
        .toolChoice({ classifier })
        .build(),
    ).toThrow(/requires per-iteration slot recomposition/);
  });
  it('the option form goes through the same door', () => {
    expect(() =>
      Agent.create({ provider: mock(), model: 'm', toolChoice: { classifier, serve: { top: 0 } } }),
    ).toThrow(/serve must be/);
  });
});
