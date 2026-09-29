/**
 * "In progress" — the third outcome, on `coverage()` (honesty layer 3).
 *
 * A vendor state machine has at least three outcomes: settled-ok, in progress,
 * failed. A tool that counts the middle one as a failure escalates a backup two
 * hours into its run, or an array whose 96 in-flight sessions read as "non-OK".
 * `coverage(value, { checked, inProgress })` lets the TOOL say which items it
 * saw still running; the library never reads a vendor state name.
 *
 * The properties under test:
 *   1. THE MINT. `inProgress` items are strings or { what, why?, short?, count? };
 *      a malformed list, a `kind`, an unknown key, a bad `count`, and an
 *      `inProgress` without `checked` (empty or not) are refused at the call.
 *      An empty list is omitted from the wire. `absent()` and
 *      `describedResult()` refuse the key (their vocabularies lack it).
 *   2. READ, NEVER REPAIRED. The dispatch door reads a foreign `in_progress`
 *      by the same rules (extra item keys ride); a malformed one is left off
 *      the record, dev-warned once per tool, and served as written.
 *   3. SERVED. The model reads `in_progress` (minus the record-only `short`,
 *      with `count`) and ONE static clause after the note; the tool's own
 *      output keeps `COVERAGE_NOTE`; the evidence projection drops the clause.
 *   4. RECORDED. `tools.coverage_declared` and the `coverageDeclared` row carry
 *      the items; `.limitsTravelWithTheAnswer()` prints them (prose) or carries
 *      them as `answerCoverage.inProgress` (typed).
 *   5. LABEL-ONLY. The answer's standing is the same with and without the
 *      declaration — no reason, no check.
 *   6. BYTE IDENTITY. A `coverage()` with no `inProgress` mints and serves the
 *      bytes it always did.
 *
 * Sections: Unit · Recognition · Served · Scenario · Property · Byte identity.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { z } from 'zod';

import {
  absent,
  Agent,
  coverage,
  COVERAGE_NOTE,
  defineTool,
  describedResult,
  IN_PROGRESS_CLAUSE,
  IN_PROGRESS_SECTION_LABEL,
  readCoverageResult,
  type DeclaredCoverage,
  type InProgressInput,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { servedToModel, withoutServedPeriod } from '../../../src/core/agent/coverage/read.js';
import {
  _resetInProgressWarnings,
  withInProgressServed,
  withoutInProgressServed,
} from '../../../src/core/agent/coverage/inProgress.js';

const CHECKED = ['every replication session on the array (live query)'];
const SUMMARY = { failed: 0, settled: 135 };

afterEach(() => {
  disableDevMode();
  _resetInProgressWarnings();
  vi.restoreAllMocks();
});

// ── 1. Unit — the mint ───────────────────────────────────────────────────

describe('unit — coverage({ inProgress }) mints the list', () => {
  it('strings and items, normalized, after the lists and before the period', () => {
    const v = coverage(SUMMARY, {
      checked: CHECKED,
      cannotCover: [{ what: 'host-side paths', why: 'no collector on the hosts' }],
      inProgress: [
        '  vm-42 backup  ',
        { what: 'sessions still synchronizing', count: 96, short: 'syncing', why: ' since 08:10 ' },
      ],
      period: {
        queried: { from: '2026-09-29T08:00:00Z', to: '2026-09-29T09:00:00Z' },
        held: 'unknown',
      },
    });
    expect(Object.keys(v.af_coverage)).toEqual([
      'checked',
      'cannot_cover',
      'in_progress',
      'period',
      'note',
    ]);
    expect(v.af_coverage.in_progress).toEqual([
      { what: 'vm-42 backup' },
      { what: 'sessions still synchronizing', why: 'since 08:10', short: 'syncing', count: 96 },
    ]);
    // The tool's own output keeps the static note: the clause is the door's.
    expect(v.af_coverage.note).toBe(COVERAGE_NOTE);
  });

  it('an empty list is omitted from the wire — nothing is running, nothing is said', () => {
    const v = coverage(SUMMARY, { checked: CHECKED, inProgress: [] });
    expect('in_progress' in v.af_coverage).toBe(false);
    expect(JSON.stringify(v)).toBe(JSON.stringify(coverage(SUMMARY, { checked: CHECKED })));
  });

  it('null reads as omitted (a JSON producer’s None)', () => {
    const v = coverage(SUMMARY, { checked: CHECKED, inProgress: null as never });
    expect('in_progress' in v.af_coverage).toBe(false);
  });

  const refusals: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ['a non-array', 'vm-42', /^refused: `inProgress` must be an array/],
    ['a blank string', ['  '], /^refused: inProgress\[0\] is blank/],
    ['an item with no what', [{ why: 'x' }], /^refused: inProgress\[0\] names nothing/],
    ['a kind', [{ what: 'a', kind: 'scope' }], /has `kind` — it names ground a call did NOT reach/],
    [
      'a misspelt why',
      [{ what: 'a', wy: 'b' }],
      /unknown key 'wy' — the fields are what, why, short, count/,
    ],
    ['a zero count', [{ what: 'a', count: 0 }], /`count` must be a whole number of at least 1/],
    ['a fractional count', [{ what: 'a', count: 1.5 }], /`count` must be a whole number/],
    ['a string count', [{ what: 'a', count: '3' }], /`count` must be a whole number/],
    ['a blank why', [{ what: 'a', why: ' ' }], /has a `why` that says nothing/],
    ['a short longer than what', [{ what: 'a', short: 'abc' }], /`short` is longer than `what`/],
  ];
  for (const [name, list, message] of refusals) {
    it(`refuses ${name}`, () => {
      expect(() => coverage(SUMMARY, { checked: CHECKED, inProgress: list as never })).toThrow(
        message,
      );
    });
  }

  it('refuses inProgress without checked — empty or not, so the rule is not data-dependent', () => {
    for (const list of [[], ['vm-42 backup']]) {
      expect(() => coverage(SUMMARY, { inProgress: list })).toThrow(
        /^refused: `inProgress` needs `checked` beside it/,
      );
    }
  });

  it('refuses the snake_case spelling at the camelCase door, naming the one meant', () => {
    expect(() => coverage(SUMMARY, { checked: CHECKED, in_progress: ['x'] } as never)).toThrow(
      /'in_progress' is not a field this vocabulary has — did you mean `inProgress`\?/,
    );
  });

  it('absent() and describedResult() do not take it — their vocabularies lack the key', () => {
    expect(() =>
      absent({ what: 'failed backups', checked: CHECKED, inProgress: ['x'] } as never),
    ).toThrow(/'inProgress' is not a field this vocabulary has/);
    expect(() =>
      describedResult({
        facts: [{ entity: 'vm-42' }],
        provenance: { measuredAt: '2026-09-29T09:00:00Z', source: 'backup API' },
        coverage: { checked: CHECKED, inProgress: ['x'] } as never,
      }),
    ).toThrow(/'coverage\.inProgress' is not a field this vocabulary has/);
  });
});

// ── 2. Recognition — read, never repaired ────────────────────────────────

describe('recognition — the dispatch door reads in_progress by the same rules', () => {
  it('carries the items on the ledger fact', () => {
    const v = coverage(SUMMARY, {
      checked: CHECKED,
      inProgress: [{ what: 'sessions still synchronizing', count: 96, short: 'syncing' }],
    });
    expect(readCoverageResult(v)?.declared).toEqual([
      {
        kind: 'ledger',
        coverage: { checked: [{ what: CHECKED[0] }], notChecked: [], cannotCover: [] },
        inProgress: [{ what: 'sessions still synchronizing', count: 96, short: 'syncing' }],
      },
    ]);
  });

  it('a foreign item key rides (the tool’s own knowledge) and is not copied', () => {
    const foreign = {
      af_coverage: {
        checked: [{ what: 'sessions' }],
        in_progress: [{ what: 'sess-7', state: 'SYNCHRONIZING' }],
        note: COVERAGE_NOTE,
      },
      result: {},
    };
    expect(readCoverageResult(foreign)?.declared[0]?.inProgress).toEqual([{ what: 'sess-7' }]);
  });

  it('a malformed foreign list is left off the record, warned once per tool, served as written', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const foreign = {
      af_coverage: {
        checked: [{ what: 's' }],
        in_progress: [{ what: 'x', count: 0 }],
        note: COVERAGE_NOTE,
      },
      result: {},
    };
    expect(readCoverageResult(foreign, 'sessions')?.declared[0]?.inProgress).toBeUndefined();
    readCoverageResult(foreign, 'sessions');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "tool 'sessions' returned an in_progress list",
    );
    // Served as written — no clause for a list the record could not read.
    expect(servedToModel(foreign)).toBe(foreign);
  });
});

// ── 3. Served ────────────────────────────────────────────────────────────

describe('served — the list, minus short, and one clause after the note', () => {
  const v = coverage(SUMMARY, {
    checked: CHECKED,
    inProgress: [{ what: 'sessions still synchronizing', count: 96, short: 'syncing' }],
  });

  it('the model reads the items (count kept, short removed) and the clause', () => {
    const served = servedToModel(v) as typeof v;
    expect(served.af_coverage.in_progress).toEqual([
      { what: 'sessions still synchronizing', count: 96 },
    ]);
    expect(served.af_coverage.note).toBe(`${COVERAGE_NOTE} ${IN_PROGRESS_CLAUSE}`);
    expect(served.result).toBe(v.result);
  });

  it('the clause sits before a period clause, and the evidence reader peels both', () => {
    const both = coverage(SUMMARY, {
      checked: CHECKED,
      inProgress: ['vm-42 backup'],
      period: {
        queried: { from: '2026-09-29T08:00:00Z', to: '2026-09-29T09:00:00Z' },
        held: 'unknown',
      },
    });
    const served = servedToModel(both) as typeof both;
    expect(served.af_coverage.note.startsWith(`${COVERAGE_NOTE} ${IN_PROGRESS_CLAUSE} `)).toBe(
      true,
    );
    const peeled = withoutServedPeriod(served) as typeof both;
    expect(peeled.af_coverage.note).toBe(COVERAGE_NOTE);
  });

  it('served once is served: the door does not append twice', () => {
    const once = servedToModel(v) as typeof v;
    expect(withInProgressServed(once.af_coverage)).toBe(once.af_coverage);
  });

  it('the inverse is the same reference when there is no clause', () => {
    const plain = { note: COVERAGE_NOTE };
    expect(withoutInProgressServed(plain)).toBe(plain);
  });
});

// ── 4. Scenario — one agent run ──────────────────────────────────────────

const call = (name: string, id: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

function sessionsTool(inProgress: readonly InProgressInput[] | undefined) {
  return defineTool({
    name: 'replication_sessions',
    description: 'Replication sessions on one array: settled, in flight, failed.',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      coverage(SUMMARY, {
        checked: CHECKED,
        ...(inProgress !== undefined && { inProgress }),
      }),
  });
}

const DECLARED: readonly InProgressInput[] = [
  {
    what: 'sessions still synchronizing',
    count: 96,
    why: 'the array reports them transferring',
    short: 'syncing',
  },
];

function run(opts: {
  inProgress?: readonly InProgressInput[];
  typed?: boolean;
  limits?: boolean;
  answerLayer?: boolean;
}) {
  const answer =
    opts.typed === true
      ? JSON.stringify({ unhealthy: 0 })
      : 'No session has failed; 96 are still transferring.';
  let b = Agent.create({
    provider: mock({
      replies: [call('replication_sessions', 'c1'), final(answer)] as never,
      chunkDelayMs: 0,
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You are a storage engineer.')
    .tool(sessionsTool(opts.inProgress));
  if (opts.typed === true) b = b.outputSchema(z.object({ unhealthy: z.number() }).strict());
  if (opts.limits !== false) b = b.limitsTravelWithTheAnswer();
  if (opts.answerLayer === true) b = b.answerLayer();
  const agent = b.build();
  const declaredEvents: unknown[] = [];
  const turnEnds: Array<Record<string, unknown>> = [];
  agent.on('agentfootprint.tools.coverage_declared', (e) => declaredEvents.push(e.payload));
  agent.on('agentfootprint.agent.turn_end', (e) =>
    turnEnds.push(e.payload as Record<string, unknown>),
  );
  return { agent, declaredEvents, turnEnds };
}

type State = {
  coverageDeclared?: readonly DeclaredCoverage[];
  answerCoverage?: Record<string, unknown>;
  history?: ReadonlyArray<{ role: string; content: unknown }>;
};
const stateOf = (agent: Agent): State => (agent.getLastSnapshot()?.sharedState ?? {}) as State;

describe('scenario — a replication tool that sees 96 sessions still synchronizing', () => {
  it('the event and the row carry the items (short included — the record’s field)', async () => {
    const { agent, declaredEvents } = run({ inProgress: DECLARED });
    await agent.run({ message: 'Any unhealthy replication sessions?' });
    const item = {
      what: 'sessions still synchronizing',
      why: 'the array reports them transferring',
      short: 'syncing',
      count: 96,
    };
    expect(declaredEvents).toHaveLength(1);
    expect((declaredEvents[0] as { inProgress?: unknown }).inProgress).toEqual([item]);
    expect(stateOf(agent).coverageDeclared?.[0]?.inProgress).toEqual([item]);
  });

  it('the model read in_progress and the clause, never the short form', async () => {
    const { agent } = run({ inProgress: DECLARED });
    await agent.run({ message: 'Any unhealthy replication sessions?' });
    const tool = stateOf(agent).history?.find((m) => m.role === 'tool');
    const text = typeof tool?.content === 'string' ? tool.content : JSON.stringify(tool?.content);
    expect(text).toContain('"in_progress":[{"what":"sessions still synchronizing"');
    expect(text).toContain('"count":96');
    expect(text).toContain(IN_PROGRESS_CLAUSE.slice(0, 40));
    expect(text).not.toContain('syncing"');
  });

  it('a prose answer carries the section under .limitsTravelWithTheAnswer()', async () => {
    const { agent } = run({ inProgress: DECLARED });
    const out = await agent.run({ message: 'Any unhealthy replication sessions?' });
    expect(String(out)).toContain(
      `${IN_PROGRESS_SECTION_LABEL}:\n- replication_sessions: sessions still synchronizing (96) — the array reports them transferring`,
    );
  });

  it('without the option the answer is the model’s own', async () => {
    const { agent } = run({ inProgress: DECLARED, limits: false });
    const out = await agent.run({ message: 'Any unhealthy replication sessions?' });
    expect(String(out)).toBe('No session has failed; 96 are still transferring.');
  });

  it('a typed answer carries answerCoverage.inProgress, one entry per declaring call', async () => {
    const { agent, turnEnds } = run({ inProgress: DECLARED, typed: true });
    await agent.run({ message: 'Any unhealthy replication sessions?' });
    const expected = [
      {
        toolName: 'replication_sessions',
        toolCallId: 'c1',
        items: [
          {
            what: 'sessions still synchronizing',
            why: 'the array reports them transferring',
            short: 'syncing',
            count: 96,
          },
        ],
      },
    ];
    expect(stateOf(agent).answerCoverage?.inProgress).toEqual(expected);
    expect((turnEnds[0]?.answerCoverage as { inProgress?: unknown }).inProgress).toEqual(expected);
  });

  it('label-only: the standing is the same with and without the declaration', async () => {
    const withIt = run({ inProgress: DECLARED, answerLayer: true });
    const without = run({ answerLayer: true });
    await withIt.agent.run({ message: 'q' });
    await without.agent.run({ message: 'q' });
    const a = withIt.agent.assessment();
    const b = without.agent.assessment();
    expect(a).toBeDefined();
    expect(a?.standing).toBe(b?.standing);
    expect(a?.reasons).toEqual(b?.reasons);
    expect(a?.checked).toEqual(b?.checked);
  });
});

// ── 5. Property — a seeded generator (no fast-check in the tree) ─────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('property — mint → wire → record round-trips; the serve inverts', () => {
  it('200 generated lists', () => {
    const next = rng(20260929);
    const word = () => ['vm', 'backup', 'session', 'sync', 'array', 'job'][Math.floor(next() * 6)]!;
    for (let n = 0; n < 200; n++) {
      const list: InProgressInput[] = [];
      const len = 1 + Math.floor(next() * 4);
      for (let i = 0; i < len; i++) {
        const what = `${word()} ${word()}-${n}-${i}`;
        list.push(
          next() < 0.3
            ? what
            : {
                what,
                ...(next() < 0.5 && { why: `${word()} ${word()}` }),
                ...(next() < 0.5 && { short: word() }),
                ...(next() < 0.5 && { count: 1 + Math.floor(next() * 500) }),
              },
        );
      }
      const minted = coverage({ n }, { checked: CHECKED, inProgress: list });
      const wire = JSON.parse(JSON.stringify(minted)) as unknown;
      const expected = list.map((i) => (typeof i === 'string' ? { what: i } : i));
      expect(readCoverageResult(wire)?.declared[0]?.inProgress).toEqual(expected);
      const served = servedToModel(wire) as { af_coverage: { note: string } };
      expect((withoutServedPeriod(served) as typeof served).af_coverage.note).toBe(COVERAGE_NOTE);
    }
  });
});

// ── 6. Byte identity ─────────────────────────────────────────────────────

describe('byte identity — no inProgress, the bytes it always minted', () => {
  it('coverage() without the key mints the pre-change bytes and serves the same reference', () => {
    const v = coverage(SUMMARY, { checked: ['a'], notChecked: [{ what: 'b', why: 'c' }] });
    expect(JSON.stringify(v)).toBe(
      JSON.stringify({
        af_coverage: {
          checked: [{ what: 'a' }],
          not_checked: [{ what: 'b', why: 'c' }],
          note: COVERAGE_NOTE,
        },
        result: SUMMARY,
      }),
    );
    expect(servedToModel(v)).toBe(v);
  });
});
