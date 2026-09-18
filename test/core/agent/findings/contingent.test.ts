/**
 * Integration — no towers on unverified lemmas (9.110.0): a value the model
 * USED that came only from results it had itself declared open, noise or
 * ruled-out is recorded as CONTINGENT, at two moments, through the one
 * writer, and served back as a `contingent:` line.
 *
 * Pattern: Test-as-specification, scenario style, on real agent runs over a
 *          scripted provider that keeps every request it was handed (the
 *          `findings-served.test.ts` harness).
 * Role:    Pin the rule and its fences —
 *
 *   • the ANSWER moment (`stages/route.ts · judgeEvidence`): a value the
 *     extractor found in the answer whose every carrier holds a set-aside
 *     standing files ONE row `{ declaredOn: 'answer' }` and ONE event; a
 *     value with a `fact` carrier, or with an undeclared carrier, files none;
 *   • the DISPATCH moment (`stages/toolCalls.ts`): a value in a call's
 *     arguments whose carrier the SAME call declared ruled-out files a row
 *     `{ declaredOn: { toolCallId } }`, and the next call is served the
 *     `contingent:` line byte-equal to `servedAt`'s rebuild, under the
 *     receipt law;
 *   • the LAST standing wins (the ledger's own fold): `open` then `fact` on
 *     one result, and the answer's use of its value stands;
 *   • the ARMS: one door or neither files nothing, emits nothing, and keeps
 *     its committed keys — and the instruction gains its line under BOTH
 *     doors only;
 *   • `AgentState.totalCacheReadTokens`: absent under a provider reporting no
 *     cache reads, summed across calls under one that does, on both chart
 *     shapes;
 *   • the pure rule (`findings/contingent.ts`): a truncated carrier list is
 *     not judged, a value is cut at `CONTINGENT_VALUE_CHARS` with the cut
 *     stated, one row per value however many leaves carried it.
 *
 * Test types (Convention 3): unit (the pure rule) / integration (every
 * scenario is a real run) / regression (the arms and the key sets) /
 * documentation (the served line's exact form is asserted as a string).
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  receiptAt,
  receiptHash,
  servedAt,
  servedViews,
  type ContingentRow,
  type FindingsRow,
} from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { AgentState } from '../../../../src/core/agent/types.js';
import {
  contingentRowsOf,
  groundedArgumentValues,
  hasSetAsideStanding,
} from '../../../../src/core/agent/findings/contingent.js';
import { foldLedger } from '../../../../src/core/agent/findings/ledger.js';
import { canonicalForm, lookupForms } from '../../../../src/core/agent/evidence/normalize.js';
import type { GroundedValue } from '../../../../src/core/agent/evidence/types.js';
import { findingsLedgerPiece } from '../../../../src/core/agent/findings/serve.js';
import {
  FINDINGS_CONTINGENT_LINE,
  FINDINGS_INSTRUCTION,
  findingsInstructionFor,
} from '../../../../src/core/agent/findings/reserved.js';
import {
  CONTINGENT_VALUE_CHARS,
  type FindingsLedger,
  type StandingRow,
} from '../../../../src/core/agent/findings/types.js';
import {
  evidenceFromHistory,
  MAX_CARRIERS,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import type { FindingsContingentPayload } from '../../../../src/events/payloads.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type ReactMode = 'dynamic' | 'dynamic-grouped';
type Usage = LLMResponse['usage'];

interface Run {
  readonly agent: Agent;
  readonly snapshot: Snapshot;
  /** Every request the provider was handed, verbatim, in call order. */
  readonly wire: readonly LLMRequest[];
  readonly events: FindingsContingentPayload[];
  readonly rows: readonly ContingentRow[];
  readonly answer: string;
}

/** A provider that answers from a script, keeps every request, and reports the usage it is told to. */
function scripted(script: readonly Reply[], usage: Usage = { input: 0, output: 0 }) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'contingent-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        wire.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return { content: reply.content, toolCalls: reply.toolCalls ?? [], usage };
      },
    },
  };
}

const answer = (content: string): Reply => ({ content });
const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

/** What each probe returns — DATA tokens (an identifier per result, one shared by two). */
const RESULTS: Record<string, string> = {
  p1: 'fc1/7 state=down sw-01 sw-02',
  p2: 'fc2/9 state=up sw-01',
  p3: 'fc3/3 state=up sw-02',
};

const probe = () =>
  defineTool({
    name: 'probe',
    description: 'the probe tool',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: (args: Record<string, unknown>) =>
      RESULTS[String(args.q)] ?? `nothing for ${String(args.q)}`,
  } as never);

/** An output schema that accepts any object — the door the answer's `_findings` rides through. */
const anyObject = { parse: (value: unknown) => value as { text: string } };

type Build = (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;

async function run(
  reactMode: ReactMode,
  script: readonly Reply[],
  build: Build,
  usage?: Usage,
): Promise<Run> {
  const { provider, wire } = scripted(script, usage);
  const agent = build(
    Agent.create({ provider: provider as never, model: 'mock', maxIterations: 8, reactMode }),
  ).build();
  const events: FindingsContingentPayload[] = [];
  agent.on('agentfootprint.findings.contingent', (e) => {
    events.push(e.payload);
  });
  const out = await agent.run({ message: 'which port is down?' });
  const ledger = (agent.findings() ?? []) as readonly FindingsRow[];
  return {
    agent,
    snapshot: agent.getSnapshot()!,
    wire,
    events,
    rows: ledger.filter((r): r is ContingentRow => r.kind === 'contingent'),
    answer: typeof out === 'string' ? out : JSON.stringify(out),
  };
}

const keysOf = (r: Run): string[] => Object.keys(r.snapshot.sharedState ?? {}).sort();
const stateOf = (r: Run): Partial<AgentState> => r.snapshot.sharedState as Partial<AgentState>;

const both: Build = (a) =>
  a.system('bot').tool(probe()).findings().namesAndNumbersFromEvidence({ posture: 'assist' });
const withSchema =
  (build: Build): Build =>
  (a) =>
    build(a).outputSchema(anyObject as never, { retries: 0 });

// ─── the scripts ─────────────────────────────────────────────────────

const ASSERT_C2 = {
  subject: { kind: 'port', id: 'fc2/9' },
  predicate: 'state',
  value: 'up',
};

/** Three probes, then a JSON answer declaring c1 noise and c2 fact (c3 unnamed) and quoting all five values. */
const ANSWER_MOMENT: readonly Reply[] = [
  call('c1', 'probe', { q: 'p1', _findings: { basis: 'exploratory' } }),
  call('c2', 'probe', { q: 'p2', _findings: { basis: 'exploratory' } }),
  call('c3', 'probe', { q: 'p3', _findings: { basis: 'exploratory' } }),
  answer(
    JSON.stringify({
      text: 'fc1/7 is down; fc2/9 is up; sw-01 carries both; fc3/3 is up; sw-02 too',
      _findings: {
        previous: [
          { toolCallId: 'c1', standing: 'noise' },
          { toolCallId: 'c2', standing: 'fact', sought: true, assertions: [ASSERT_C2] },
        ],
      },
    }),
  ),
];

/** c2 rules c1 out AND carries c1's value in its own arguments; c3 follows; a prose answer. */
const DISPATCH_MOMENT: readonly Reply[] = [
  call('c1', 'probe', { q: 'p1', _findings: { basis: 'exploratory' } }),
  call('c2', 'probe', {
    q: 'fc1/7',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c1', standing: 'ruled-out', line: 'p1 is not the port' }],
    },
  }),
  call('c3', 'probe', { q: 'p3', _findings: { basis: 'direct' } }),
  answer('done'),
];

/** c1 declared open on call 2, then fact on the answer; the answer quotes c1's value. */
const LAST_STANDING_WINS: readonly Reply[] = [
  call('c1', 'probe', { q: 'p1', _findings: { basis: 'exploratory' } }),
  call('c2', 'probe', {
    q: 'p2',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c1', standing: 'open', settles: 'a second read' }],
    },
  }),
  answer(
    JSON.stringify({
      text: 'fc1/7 is down',
      _findings: {
        previous: [
          {
            toolCallId: 'c1',
            standing: 'fact',
            sought: true,
            assertions: [
              { subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state', value: 'down' },
            ],
          },
        ],
      },
    }),
  ),
];

// ─── 1. the answer moment ────────────────────────────────────────────

describe('contingent — the answer moment', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: ONE row for the value whose only carrier the answer declared noise; none for a fact carrier, a value shared with a fact, a value shared with an undeclared result, an undeclared carrier`, async () => {
      const r = await run(reactMode, ANSWER_MOMENT, withSchema(both));
      expect(r.rows).toEqual([
        {
          kind: 'contingent',
          declaredOn: 'answer',
          value: 'fc1/7',
          carriers: [{ toolCallId: 'c1', standing: 'noise' }],
          iteration: 4,
        },
      ]);
      // fc2/9 — its one carrier c2 is a fact; sw-01 — carried by c1 (noise)
      // AND c2 (fact), one fact carrier stands; fc3/3 — c3 has no standing;
      // sw-02 — carried by c1 (noise) AND c3 (UNDECLARED): the rule says
      // nothing about c3, so the value stands (the mixed case).
      expect(r.rows.map((row) => row.value)).not.toContain('fc2/9');
      expect(r.rows.map((row) => row.value)).not.toContain('sw-01');
      expect(r.rows.map((row) => row.value)).not.toContain('fc3/3');
      expect(r.rows.map((row) => row.value)).not.toContain('sw-02');
      expect(r.events).toEqual([
        {
          iteration: 4,
          declaredOn: 'answer',
          carriers: 1,
          standings: ['noise'],
          valueChars: 5,
        },
      ]);
      // The answer went out unchanged — detection only, under 'assist'.
      expect(JSON.parse(r.answer)).toEqual({
        text: 'fc1/7 is down; fc2/9 is up; sw-01 carries both; fc3/3 is up; sw-02 too',
      });
    });
  }

  it('the row is on the record after the standings that made it, through the one writer', async () => {
    const r = await run('dynamic', ANSWER_MOMENT, withSchema(both));
    const ledger = r.agent.findings()!;
    const kinds = ledger.map((row) => row.kind);
    expect(kinds.lastIndexOf('standing')).toBeLessThan(kinds.indexOf('contingent'));
    expect(kinds.filter((k) => k === 'contingent')).toHaveLength(1);
    // The fold is untouched by the new kind: c1 noise, c2 fact, no c3.
    const fold = foldLedger([...ledger]);
    expect(fold.standingOf.get('c1')?.standing).toBe('noise');
    expect(fold.standingOf.get('c2')?.standing).toBe('fact');
    expect(fold.standingOf.has('c3')).toBe(false);
  });
});

// ─── 2. the dispatch moment ──────────────────────────────────────────

describe('contingent — the dispatch moment', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: a call whose arguments carry a value it just ruled out files a row on that call, and the next call is served the line`, async () => {
      const r = await run(reactMode, DISPATCH_MOMENT, both);
      expect(r.rows).toEqual([
        {
          kind: 'contingent',
          declaredOn: { toolCallId: 'c2' },
          value: 'fc1/7',
          carriers: [{ toolCallId: 'c1', standing: 'ruled-out' }],
          iteration: 2,
        },
      ]);
      expect(r.events).toEqual([
        {
          iteration: 2,
          declaredOn: 'tool-call',
          toolCallId: 'c2',
          carriers: 1,
          standings: ['ruled-out'],
          valueChars: 5,
        },
      ]);
      // The line, in the ledger's own vocabulary, on the call AFTER the one
      // that filed it — on the wire, and byte-equal on the rebuild.
      const line =
        '\ncontingent (read off the record):\ntool:c2 used fc1/7 from tool:c1 (ruled-out)';
      expect(r.wire[1]!.systemPrompt).not.toContain('\ncontingent (read off the record):\n');
      expect(r.wire[2]!.systemPrompt).toContain(line);
      const view = servedAt(r.snapshot, 3)!;
      expect(view.system.text).toBe(r.wire[2]!.systemPrompt);
      expect(view.system.text).toContain(line);
      const piece = view.system.pieces.find((p) => p.source === 'findings')!;
      expect(piece.text).toContain(line);
      // The section sits after the buckets and before the count lines.
      const at = piece.text.indexOf('\ncontingent (read off the record):\n');
      expect(at).toBeGreaterThan(piece.text.indexOf('limitations (declared by the model):'));
      expect(at).toBeLessThan(piece.text.indexOf('undeclared:'));
    });
  }

  it('the receipt law holds at every epoch: the system hash is the hash of the served text, line included', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, both);
    for (const view of servedViews(r.snapshot)) {
      const receipt = receiptAt(r.snapshot, view.epoch)!;
      const hash = (content: string): string => receiptHash(receipt.basis.runId, content);
      expect(hash(view.system.text), `epoch ${view.epoch}`).toBe(receipt.system.hash);
      expect(hash(r.wire[view.epoch - 1]!.systemPrompt ?? '')).toBe(receipt.system.hash);
    }
  });

  it('both chart shapes serve byte-equal system text at every epoch', async () => {
    const flat = await run('dynamic', DISPATCH_MOMENT, both);
    const grouped = await run('dynamic-grouped', DISPATCH_MOMENT, both);
    for (const view of servedViews(flat.snapshot)) {
      expect(servedAt(grouped.snapshot, view.epoch)!.system.text).toBe(view.system.text);
    }
  });

  it('the row rides before `tool_start` for the call, after its basis row', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, both);
    const ledger = r.agent.findings()!;
    const basisC2 = ledger.findIndex((row) => row.kind === 'basis' && row.toolCallId === 'c2');
    const contingent = ledger.findIndex((row) => row.kind === 'contingent');
    expect(basisC2).toBeGreaterThan(-1);
    expect(contingent).toBe(basisC2 + 1);
  });
});

// ─── 3. the last standing wins ───────────────────────────────────────

describe('contingent — the last standing per result is the current one', () => {
  it('c1 declared open on call 2 and fact on the answer: the answer stands on it', async () => {
    const r = await run('dynamic', LAST_STANDING_WINS, withSchema(both));
    const standings = r.agent
      .findings()!
      .filter((row): row is StandingRow => row.kind === 'standing');
    expect(standings.map((s) => s.standing)).toEqual(['open', 'fact']);
    expect(r.rows).toEqual([]);
    expect(r.events).toEqual([]);
  });
});

// ─── 4. the arms ─────────────────────────────────────────────────────

describe('contingent — the arms', () => {
  const findingsOnly: Build = (a) => a.system('bot').tool(probe()).findings();
  const gateOnly: Build = (a) =>
    a.system('bot').tool(probe()).namesAndNumbersFromEvidence({ posture: 'assist' });
  const neither: Build = (a) => a.system('bot').tool(probe());

  it('`.findings()` without the gate: no row, no event, the instruction as it was, the keys the both-armed run commits', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, findingsOnly);
    expect(r.rows).toEqual([]);
    expect(r.events).toEqual([]);
    for (const req of r.wire) {
      expect(req.systemPrompt).toContain(FINDINGS_INSTRUCTION);
      expect(req.systemPrompt).not.toContain(FINDINGS_CONTINGENT_LINE);
      expect(req.systemPrompt).not.toContain('\ncontingent (read off the record):\n');
    }
    // The rows live inside `findingsLedger`; the packet adds no key.
    const armed = await run('dynamic', DISPATCH_MOMENT, both);
    expect(keysOf(r)).toEqual(keysOf(armed));
  });

  it('the gate without `.findings()`: no row, no event, no ledger, the keys of an agent with neither door', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, gateOnly);
    expect(r.rows).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.agent.findings()).toBeUndefined();
    for (const req of r.wire) expect(req.systemPrompt).not.toContain(FINDINGS_CONTINGENT_LINE);
    const plain = await run('dynamic', DISPATCH_MOMENT, neither);
    expect(keysOf(r)).toEqual(keysOf(plain));
  });

  it('under both doors the instruction is FINDINGS_INSTRUCTION plus the one line, in either order of the two calls', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, both);
    expect(r.wire[0]!.systemPrompt).toContain(findingsInstructionFor({ contingent: true }));
    const gateFirst: Build = (a) =>
      a.system('bot').tool(probe()).namesAndNumbersFromEvidence({ posture: 'assist' }).findings();
    const g = await run('dynamic', DISPATCH_MOMENT, gateFirst);
    expect(g.wire[0]!.systemPrompt).toBe(r.wire[0]!.systemPrompt);
    expect(findingsInstructionFor({ contingent: true })).toBe(
      `${FINDINGS_INSTRUCTION}\n${FINDINGS_CONTINGENT_LINE}`,
    );
    expect(findingsInstructionFor({ contingent: false })).toBe(FINDINGS_INSTRUCTION);
  });
});

// ─── 5. cache reads as a cost ────────────────────────────────────────

describe('totalCacheReadTokens — a first-class cost, value-conditional', () => {
  it('absent under a provider that reports no cache reads (the mock)', async () => {
    const r = await run('dynamic', DISPATCH_MOMENT, both);
    expect(stateOf(r).totalCacheReadTokens).toBeUndefined();
    expect(keysOf(r)).not.toContain('totalCacheReadTokens');
  });

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: present and summed across every call under a provider that reports cacheRead`, async () => {
      const r = await run('dynamic', DISPATCH_MOMENT, both, {
        input: 10,
        output: 2,
        cacheRead: 7,
      });
      // Four calls: three probes and the answer.
      expect(r.wire).toHaveLength(4);
      expect(stateOf(r).totalInputTokens).toBe(40);
      expect(stateOf(r).totalCacheReadTokens).toBe(28);
      const g = await run(reactMode, DISPATCH_MOMENT, both, { input: 10, output: 2, cacheRead: 7 });
      expect(stateOf(g).totalCacheReadTokens).toBe(28);
    });
  }
});

// ─── 6. the pure rule ────────────────────────────────────────────────

describe('contingent — the rule (findings/contingent.ts)', () => {
  const standing = (toolCallId: string, kind: StandingRow['standing']): StandingRow => ({
    kind: 'standing',
    toolCallId,
    standing: kind,
    assertions: [],
    declaredOn: { toolCallId: 'c9' },
    iteration: 2,
  });
  const foldOf = (rows: readonly StandingRow[]) => foldLedger(rows as FindingsLedger).standingOf;
  const result = (toolCallId: string, content: string) => ({
    role: 'tool' as const,
    content,
    toolCallId,
    toolName: 'probe',
  });
  const user = { role: 'user' as const, content: 'go' };

  it('hasSetAsideStanding: facts alone are no reason to walk a corpus', () => {
    expect(hasSetAsideStanding(foldOf([standing('c1', 'fact')]))).toBe(false);
    expect(hasSetAsideStanding(foldOf([standing('c1', 'fact'), standing('c2', 'open')]))).toBe(
      true,
    );
    expect(hasSetAsideStanding(new Map())).toBe(false);
  });

  /** A grounded value looked up under its own spelling only (the `lookupForms` forms). */
  const g = (value: string): GroundedValue => ({ value, forms: [...lookupForms(value)] });

  it('every carrier must be set aside: one fact carrier, or one undeclared, and the value stands', () => {
    const corpus = evidenceFromHistory([
      user,
      result('c1', 'fc1/7 sw-01 sw-02'),
      result('c2', 'fc2/9 sw-01'),
      result('c3', 'fc3/3 sw-02'),
    ]);
    const standingOf = foldOf([standing('c1', 'noise'), standing('c2', 'ruled-out')]);
    const rows = contingentRowsOf(
      ['fc1/7', 'sw-01', 'fc3/3', 'fc2/9', 'sw-02'].map(g),
      corpus,
      standingOf,
      'answer',
      3,
    );
    expect(rows.map((r) => r.value)).toEqual(['fc1/7', 'sw-01', 'fc2/9']);
    // sw-01: two set-aside carriers, both named, in wire order.
    expect(rows[1]!.carriers).toEqual([
      { toolCallId: 'c1', standing: 'noise' },
      { toolCallId: 'c2', standing: 'ruled-out' },
    ]);
    // fc3/3: c3 undeclared — the rule says nothing about it. sw-02: the
    // MIXED case, c1 (noise) beside c3 (undeclared) — the value stands.
    const withFact = foldOf([standing('c1', 'noise'), standing('c2', 'fact')]);
    expect(contingentRowsOf([g('sw-01')], corpus, withFact, 'answer', 3)).toEqual([]);
  });

  it('a corpus whose token ceiling was hit files NOTHING — a fact carrier past the cut is invisible (B1)', () => {
    // c1 carries the value and is declared noise; a huge result exhausts the
    // index; c3 carries the same value and is declared FACT — but c3 sits
    // past the cut, so the index never saw it. Judging the prefix would file
    // a false row; the rule refuses the truncated corpus outright.
    const big = Array.from({ length: 200_001 }, (_, i) => `t${i}`).join(' ');
    const corpus = evidenceFromHistory([
      user,
      result('c1', 'fc1/7'),
      result('cbig', big),
      result('c3', 'fc1/7'),
    ]);
    expect(corpus.truncated).toBe(true);
    expect(corpus.carriers.get('fc1/7')?.toolCallIds).toEqual(['c1']);
    const standingOf = foldOf([standing('c1', 'noise'), standing('c3', 'fact')]);
    expect(contingentRowsOf([g('fc1/7')], corpus, standingOf, 'answer', 3)).toEqual([]);
    expect(contingentRowsOf([g('fc1/7')], corpus, standingOf, { toolCallId: 'c4' }, 3)).toEqual([]);
  });

  it('a value the corpus lists more than MAX_CARRIERS results for is not judged', () => {
    const history = [
      user,
      ...Array.from({ length: MAX_CARRIERS + 1 }, (_, i) => result(`c${i + 1}`, 'fc1/7')),
    ];
    const corpus = evidenceFromHistory(history);
    expect(corpus.carriers.get('fc1/7')).toEqual({
      toolCallIds: Array.from({ length: MAX_CARRIERS }, (_, i) => `c${i + 1}`),
      truncated: true,
    });
    const standingOf = foldOf(
      Array.from({ length: MAX_CARRIERS + 1 }, (_, i) => standing(`c${i + 1}`, 'noise')),
    );
    expect(contingentRowsOf([g('fc1/7')], corpus, standingOf, 'answer', 3)).toEqual([]);
    // One fewer, and the whole list is judged.
    const eight = evidenceFromHistory(history.slice(0, -1));
    expect(eight.carriers.get('fc1/7')?.truncated).toBeUndefined();
    expect(contingentRowsOf([g('fc1/7')], eight, standingOf, 'answer', 3)).toHaveLength(1);
  });

  it('a value is cut at CONTINGENT_VALUE_CHARS with the cut stated; one row per VALUE — two spellings of one value share a canonical form (N3)', () => {
    const long = `0x${'a1'.repeat(80)}`;
    const corpus = evidenceFromHistory([user, result('c1', `${long} ef0101`)]);
    const standingOf = foldOf([standing('c1', 'open')]);
    const rows = contingentRowsOf(
      [long, long, '0xef0101', 'ef0101'].map(g),
      corpus,
      standingOf,
      { toolCallId: 'c2' },
      2,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.value).toBe(
      `${long.slice(0, CONTINGENT_VALUE_CHARS)} …[clipped ${
        long.length - CONTINGENT_VALUE_CHARS
      } chars]`,
    );
    expect(rows[0]!.declaredOn).toEqual({ toolCallId: 'c2' });
    // `0xef0101` and `ef0101` in one answer: ONE row (canonical `ef0101`),
    // the value as first written; the result carried `ef0101`.
    expect(canonicalForm('0xef0101')).toBe('ef0101');
    expect(rows[1]!.value).toBe('0xef0101');
    expect(rows[1]!.carriers).toEqual([{ toolCallId: 'c1', standing: 'open' }]);
    // …and in the other order the row keeps the spelling that came first.
    const reversed = contingentRowsOf(
      ['ef0101', '0xef0101'].map(g),
      corpus,
      standingOf,
      'answer',
      2,
    );
    expect(reversed.map((r) => r.value)).toEqual(['ef0101']);
  });

  it('a glued-unit value is met under the spelling the result carried, and never wider (N4)', () => {
    // The answer's `1007us` asks for `1007` AND `1007us`; the result carried
    // `1007us`, so the carrier is found. A bare `2024` asks for `2024` alone
    // and a result's `2024ms` does not carry it — the index is never widened.
    const gate = resolveEvidenceGate({});
    const corpus = evidenceFromHistory([user, result('c1', 'node-1: 1007us latency 2024ms')]);
    const standingOf = foldOf([standing('c1', 'noise')]);
    const glued = groundedArgumentValues({ q: '1007us' }, gate, corpus, new Set());
    expect(glued).toEqual([{ value: '1007', forms: ['1007', '1007us'] }]);
    expect(contingentRowsOf(glued, corpus, standingOf, 'answer', 2).map((r) => r.value)).toEqual([
      '1007',
    ]);
    expect(groundedArgumentValues({ q: 'in 2024' }, gate, corpus, new Set())).toEqual([]);
  });

  it('groundedArgumentValues reads the extractor’s rule over every string leaf and skips exempt values', () => {
    const gate = resolveEvidenceGate({});
    const corpus = evidenceFromHistory([user, result('c1', 'fc1/7 41200 sw-01 up')]);
    const values = groundedArgumentValues(
      { q: 'fc1/7', nested: { list: ['41,200 iops', 'up', 'fc9/9'] }, n: 41200 },
      gate,
      corpus,
      new Set(['sw-01']),
    );
    // `up` is prose, `fc9/9` is not in the corpus, `n` is a number leaf.
    expect(values.map((v) => v.value)).toEqual(['fc1/7', '41200']);
    expect(groundedArgumentValues({ q: 'sw-01' }, gate, corpus, new Set(['sw-01']))).toEqual([]);
  });

  it('the served section quotes every row in order and caps at the bucket cap', () => {
    const rows: FindingsRow[] = [
      standing('c1', 'noise'),
      {
        kind: 'contingent',
        declaredOn: 'answer',
        value: 'fc1/7',
        carriers: [
          { toolCallId: 'c1', standing: 'noise' },
          { toolCallId: 'c4', standing: 'open' },
        ],
        iteration: 3,
      },
      {
        kind: 'contingent',
        declaredOn: { toolCallId: 'c5' },
        value: '41200',
        carriers: [{ toolCallId: 'c1', standing: 'noise' }],
        iteration: 4,
      },
    ];
    const piece = findingsLedgerPiece(rows as FindingsLedger, ['c1'])!.rawContent;
    expect(piece).toContain(
      'contingent (read off the record):\nanswer used fc1/7 from tool:c1 (noise), tool:c4 (open)\ntool:c5 used 41200 from tool:c1 (noise)',
    );
    const many: FindingsRow[] = [
      standing('c1', 'noise'),
      ...Array.from({ length: 70 }, (_, i) => ({
        kind: 'contingent' as const,
        declaredOn: 'answer' as const,
        value: `v${1000 + i}`,
        carriers: [{ toolCallId: 'c1', standing: 'noise' as const }],
        iteration: 3,
      })),
    ];
    const capped = findingsLedgerPiece(many as FindingsLedger, ['c1'])!.rawContent;
    expect(capped).toContain('+6 more (cap 64)');
    expect(capped.split('\n').filter((l) => l.startsWith('answer used ')).length).toBe(64);
  });
});
