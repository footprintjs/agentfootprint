/**
 * The figures dial — `namesAndNumbersFromEvidence({ figures: true })`.
 *
 * The field case: "how full is the cluster?" over a capacity result whose pool
 * rows say 2,429 TB at 61.1% with 435.5 TB usable and 2,973.9 TB at 57.7% with
 * 1,090.8 TB usable. Two answers of one small model — "53.2% used, 6.3 TB free"
 * and "64.5% used, 24.8 TB usable" — state figures that are in no row and
 * derive from none, and the gate passed both CLEAN: every one of them is under
 * `minDigits`. The honest cluster total ("1,526.3 TB usable") is a sum, in no
 * row, and the gate flagged it as invented.
 *
 * Held here: the hole, pinned with the dial off (byte-identical); the dial on —
 * the extractor, the derivation set, the gate, the revision's late line, the
 * served view's rebuild of it, the event's `computed`, the answer's standing;
 * and the bounds that keep a prose number prose.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, receiptAt, servedAt } from '../../../../src/index.js';
import type { NamesAndNumbersOptions } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { extractCandidates } from '../../../../src/core/agent/evidence/extract.js';
import {
  LIBRARY_NOTE_OPENING,
  explainFigure,
  figureBasisOf,
  figureNumbersOf,
  figuresConclusionLine,
} from '../../../../src/core/agent/evidence/figures.js';
import { resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';

import { TIME_LINE_SOURCE } from '../../../../src/core/agent/arguments/serve.js';
import { validateCheckpoint } from '../../../../src/core/runCheckpoint.js';

const TB = 1e12;
/** The capacity tool's result, as the classic room serves it (rows inline). */
const RESULT = {
  clusters_matched: ['CLUSTER-A01'],
  rows: [
    {
      cluster: 'CLUSTER-A01',
      pool: 'f710_pool',
      total_tb: 2429.0,
      used_tb: 1484.1,
      used_pct: 61.1,
      usable_tb: 435.5,
      hot_spare_tb: 48.6,
    },
    {
      cluster: 'CLUSTER-A01',
      pool: 'h700_pool',
      total_tb: 2973.9,
      used_tb: 1715.9,
      used_pct: 57.7,
      usable_tb: 1090.8,
      hot_spare_tb: 59.5,
    },
  ],
  note: 'usable_tb subtracts the virtual hot spare — avail_bytes alone overstated one pool by 36x.',
};
const HAIKU_1 = 'CLUSTER-A01 is 53.2% used, with 6.3 TB free.';
const HAIKU_2 = 'CLUSTER-A01 is at 64.5% used, with 24.8 TB usable.';
const HONEST =
  'f710_pool is 61.1% used with 435.5 TB usable; h700_pool is 57.7% used with 1,090.8 TB usable.';
const TOTALS =
  'CLUSTER-A01 has 1,526.3 TB usable in total and is 59.2% used (3,200 of 5,402.9 TB).';

const toolMessage = (content: unknown) => ({
  role: 'tool' as const,
  toolCallId: 'c1',
  toolName: 'pscale_capacity',
  content: JSON.stringify(content),
});

describe('figures: rule 1 — a number wearing a unit is data', () => {
  it('reads the units glued or one space apart, thousands separators included', () => {
    expect([
      ...figureNumbersOf('53.2% used, 6.3 TB free, 24.8TB, 41,200 IOPS, 7 ms, 2 GB/s'),
    ]).toEqual(['53.2', '6.3', '24.8', '41200', '7', '2']);
  });

  it('leaves a count and a duration as prose', () => {
    expect([
      ...figureNumbersOf('3 issues over 24 hours on a 48-port switch, OneFS 9.5, 1.5x'),
    ]).toEqual([]);
  });

  it('off: the field answers state nothing the extractor reads (the hole, pinned)', () => {
    const off = resolveEvidenceGate({});
    expect(extractCandidates(HAIKU_1, off).map((c) => c.value)).toEqual(['cluster-a01']);
    expect(extractCandidates(HAIKU_2, off).map((c) => c.value)).toEqual(['cluster-a01']);
  });

  it('on: every figure is a candidate, shaped `figure`', () => {
    const on = resolveEvidenceGate({ figures: true });
    expect(extractCandidates(HAIKU_1, on, figureNumbersOf(HAIKU_1))).toEqual([
      { value: 'cluster-a01', shape: 'identifier' },
      { value: '53.2', shape: 'figure' },
      { value: '6.3', shape: 'figure' },
    ]);
    expect(extractCandidates('24.8TB usable', on, figureNumbersOf('24.8TB usable'))).toEqual([
      { value: '24.8', shape: 'figure', token: '24.8tb' },
    ]);
  });

  it('refuses a figures value that is not a boolean', () => {
    expect(() => resolveEvidenceGate({ figures: 'yes' as unknown as boolean })).toThrow(
      /figures must be a boolean/,
    );
  });
});

describe('figures: rule 2 — a number no result carried is asked for a derivation', () => {
  const basis = figureBasisOf([toolMessage(RESULT)]);
  const how = (v: string) => explainFigure(v, basis)?.derivation;

  it('reconstructs the honest cluster figures', () => {
    expect(explainFigure('1526.3', basis)).toEqual({
      derivation: 'column-sum',
      from: 'sum of rows[].usable_tb',
    });
    expect(how('3200')).toBe('column-sum');
    expect(explainFigure('59.2', basis)).toEqual({
      derivation: 'column-ratio',
      from: '100 × rows[].used_tb ÷ rows[].total_tb',
    });
    expect(how('5402.9')).toBe('column-sum');
    expect(how('61')).toBe('rounded'); // 61.1, at the answer's precision
    expect(how('38.9')).toBe('complement'); // 100 − 61.1
    expect(how('2202.9')).toBe('column-difference'); // total − used
  });

  it('finds none for the field answers', () => {
    for (const v of ['53.2', '6.3', '64.5', '24.8'])
      expect(explainFigure(v, basis)).toBeUndefined();
  });

  it('compares at the answer precision, never looser', () => {
    expect(how('61.0')).toBeUndefined(); // 61.1 is not 61.0
    expect(how('1526')).toBe('column-sum'); // 1526.3 rounds to 1526
    expect(how('1527')).toBeUndefined();
  });

  it('converts bytes at 1000 and 1024 steps', () => {
    const bytes = figureBasisOf([toolMessage({ avail_bytes: 435.5 * TB, used: 2 * 1024 ** 4 })]);
    expect(explainFigure('435.5', bytes)?.derivation).toBe('unit-scale');
    expect(explainFigure('2', bytes)?.derivation).toBe('unit-scale');
    expect(explainFigure('2.2', bytes)?.derivation).toBe('unit-scale'); // 2 TiB is 2.2 TB
    expect(explainFigure('6.3', bytes)).toBeUndefined();
  });

  it('sums a group of rows sharing one text value', () => {
    const fleet = figureBasisOf([
      toolMessage({
        rows: [
          { cluster: 'A', usable_tb: 10.5 },
          { cluster: 'A', usable_tb: 4.25 },
          { cluster: 'B', usable_tb: 99 },
        ],
      }),
    ]);
    expect(explainFigure('14.75', fleet)).toEqual({
      derivation: 'column-sum',
      from: 'sum of rows[cluster=A].usable_tb',
    });
  });
});

/** One agent run over the capacity result, scripted. */
function run(answers: readonly string[], options: NamesAndNumbersOptions, layer = false) {
  const requests: LLMRequest[] = [];
  const events: Record<string, unknown>[] = [];
  const replies: Partial<LLMResponse>[] = [
    { toolCalls: [{ id: 'c1', name: 'pscale_capacity', args: { cluster: 'A01' } }] },
    ...answers.map((content) => ({ content })),
  ];
  const provider = {
    name: 'scripted',
    complete: async (request: LLMRequest): Promise<LLMResponse> => {
      const reply = replies[requests.length];
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      if (reply === undefined) throw new Error('Unexpected additional model call');
      return { content: '', toolCalls: [], usage: { input: 1, output: 1 }, ...reply };
    },
  };
  let builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 6,
    recordSystemPrompt: true,
  })
    .system('Answer storage questions from tool results.')
    .tool(
      defineTool({
        name: 'pscale_capacity',
        description: 'capacity per pool',
        inputSchema: { type: 'object', properties: { cluster: { type: 'string' } } },
        execute: async () => structuredClone(RESULT),
      }),
    )
    .namesAndNumbersFromEvidence(options)
    .watch({
      id: 'figures-test',
      onEmit: (e) => {
        if (e.name === 'agentfootprint.agent.evidence_checked') {
          events.push((e.payload ?? {}) as Record<string, unknown>);
        }
      },
    });
  if (layer) builder = builder.answerLayer();
  return { agent: builder.build(), requests, events };
}

describe('figures: the gate, end to end', () => {
  it('off: an invented "53.2% used, 6.3 TB free" ships clean — byte-identical to before', async () => {
    const { agent, events } = run([HAIKU_1], { posture: 'guard' });
    expect(await agent.run({ message: 'How full is CLUSTER-A01?' })).toBe(HAIKU_1);
    expect(events).toEqual([
      expect.objectContaining({ action: 'grounded', candidates: 1, lookedUp: 0, unsupported: [] }),
    ]);
    expect(events[0]).not.toHaveProperty('computed');
  });

  it('on (guard): the figures are named back, the conclusion is the LAST line, and a revision that still invents ships flagged', async () => {
    const { agent, requests, events } = run([HAIKU_1, HAIKU_2], {
      posture: 'guard',
      figures: true,
    });
    expect(await agent.run({ message: 'How full is CLUSTER-A01?' })).toBe(HAIKU_2);
    expect(events.map((e) => e.action)).toEqual(['revision-asked', 'flagged']);
    expect(events[0]!.unsupported).toEqual([
      { value: '53.2', shape: 'figure' },
      { value: '6.3', shape: 'figure' },
    ]);
    expect(events[1]).toMatchObject({
      unsupported: [
        { value: '64.5', shape: 'figure' },
        { value: '24.8', shape: 'figure' },
      ],
      computed: [],
    });
    const revision = requests[2]!;
    const last = revision.messages[revision.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe(
      figuresConclusionLine([
        { value: '53.2', shape: 'figure' },
        { value: '6.3', shape: 'figure' },
      ]),
    );
    expect(String(last.content)).toContain('53.2, 6.3');
    // Request-only: the first answer's request had none, and history never holds it.
    expect(JSON.stringify(requests[1]!.messages)).not.toContain('The evidence check');
    const history = (agent.getLastSnapshot()!.sharedState as { history: unknown }).history;
    expect(JSON.stringify(history)).not.toContain('The evidence check');
    // The served view rebuilds the line byte for byte, and the receipt counts it.
    const snapshot = agent.getLastSnapshot()!;
    const served = servedAt(snapshot, 3)!;
    expect(served.messages.requestOnly).toEqual([
      { role: 'user', text: last.content, reason: 'evidence-conclusion' },
    ]);
    expect(receiptAt(snapshot, 3)).toBeDefined();
  });

  it('on: the honest per-pool answer and the derived totals stand, the totals named with their derivation', async () => {
    const honest = run([HONEST], { posture: 'guard', figures: true });
    expect(await honest.agent.run({ message: 'How full is CLUSTER-A01?' })).toBe(HONEST);
    expect(honest.events).toEqual([
      expect.objectContaining({ action: 'grounded', unsupported: [], computed: [] }),
    ]);

    const totals = run([TOTALS], { posture: 'guard', figures: true });
    expect(await totals.agent.run({ message: 'How full is CLUSTER-A01?' })).toBe(TOTALS);
    expect(totals.events).toHaveLength(1);
    expect(totals.events[0]).toMatchObject({ action: 'grounded', unsupported: [] });
    expect(totals.events[0]!.computed).toEqual([
      {
        value: '1526.3',
        shape: 'number',
        derivation: 'column-sum',
        from: 'sum of rows[].usable_tb',
      },
      {
        value: '59.2',
        shape: 'figure',
        derivation: 'column-ratio',
        from: '100 × rows[].used_tb ÷ rows[].total_tb',
      },
      { value: '3200', shape: 'number', derivation: 'column-sum', from: 'sum of rows[].used_tb' },
      {
        value: '5402.9',
        shape: 'number',
        derivation: 'column-sum',
        from: 'sum of rows[].total_tb',
      },
    ]);
    expect(totals.events[0]!.lookedUp).toBe(4);
  });

  it('on (assist): the invented answer stands NOT SURE, for the flagged value', async () => {
    const { agent } = run([HAIKU_1], { posture: 'assist', figures: true }, true);
    await agent.run({ message: 'How full is CLUSTER-A01?' });
    const a = await agent.assessment();
    expect(a?.standing).toBe('not-sure');
    expect(a?.reasons.map((r) => r.reason)).toContain('value-unsupported');
  });

  it('off (assist): the same answer is never NOT SURE for a value — the check had nothing to read', async () => {
    const { agent } = run([HAIKU_1], { posture: 'assist' }, true);
    await agent.run({ message: 'How full is CLUSTER-A01?' });
    const a = await agent.assessment();
    expect(a?.reasons.map((r) => r.reason)).not.toContain('value-unsupported');
  });
});

describe('figures: the late line', () => {
  it('opens with the measured library-note opening of the time line', () => {
    expect(LIBRARY_NOTE_OPENING).toBe(TIME_LINE_SOURCE);
    expect(
      figuresConclusionLine([{ value: '53.2', shape: 'figure' }])!.startsWith(TIME_LINE_SOURCE),
    ).toBe(true);
  });

  it('names no identifier — a flagged name gets the instruction alone', () => {
    expect(figuresConclusionLine([{ value: 'fc1/3', shape: 'identifier' }])).toBeUndefined();
  });
});

describe('figures: a pending revision keeps its late line across a checkpoint', () => {
  const base = {
    version: 1 as const,
    runId: 'r1',
    lastCompletedIteration: 1,
    originalInput: { message: 'hi' },
    history: [{ role: 'user', content: 'hi' }],
  };
  it('accepts the conclusion beside the instruction', () => {
    const recovery = { revisionSpent: true, pending: { instruction: 'i', conclusion: 'c' } };
    expect(() => validateCheckpoint({ ...base, evidenceRecovery: recovery })).not.toThrow();
  });
  it('refuses a conclusion that is not a non-empty string', () => {
    for (const conclusion of ['', 7, null]) {
      const recovery = { revisionSpent: true, pending: { instruction: 'i', conclusion } };
      expect(() => validateCheckpoint({ ...base, evidenceRecovery: recovery })).toThrow(
        /evidenceRecovery/,
      );
    }
  });
});
