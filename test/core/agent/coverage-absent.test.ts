/**
 * `absent()` — an absence that names its own coverage, through the REAL Agent
 * loop.
 *
 * The property under test is a DISTINCTION, not a feature: a result that says
 * "I looked and there is nothing" must never be readable as "I could not
 * look", in the shape, in the delivered status, in the record, or in the bytes
 * the model reads. The direction-of-error argument (an outage misread as
 * nothing-found declares a system healthy that was never checked) is what
 * makes every assertion below one-sided.
 *
 * Sections follow Convention 3: Unit (definition-time refusals + the strict
 * recognizer) · Functional (the rendered shape) · Integration (status, events,
 * history, the error contrast) · Security & containment (the evidence-corpus
 * laundering rule) · Edge · Regression.
 */

import { describe, expect, it } from 'vitest';
import {
  ABSENCE_MARKER,
  Agent,
  absent,
  coverage,
  defineTool,
  readAbsence,
  readCoverageResult,
  TOOL_RESULT_STATUSES,
  type ToolAbsence,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage } from '../../../src/adapters/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const DECL = {
  what: 'FLOGI entries on fc1/3',
  checked: ['shq-fab-a: the live fcns database', 'window: the last 24h'],
  notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
  cannotCover: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
} as const;

const call = (name: string, id = 't1', args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Ev = Record<string, unknown>;
const capture = () => {
  const absences: Ev[] = [];
  const declared: Ev[] = [];
  const toolEnds: Ev[] = [];
  const checks: Ev[] = [];
  const all: Array<{ name: string; payload: Ev }> = [];
  const recorder = {
    id: 'capture-absence',
    onEmit: (e: { name: string; payload?: Ev }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
      if (e.name === 'agentfootprint.tools.absent') absences.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.coverage_declared') declared.push(e.payload ?? {});
      if (e.name === 'agentfootprint.stream.tool_end') toolEnds.push(e.payload ?? {});
      if (e.name === 'agentfootprint.agent.evidence_checked') checks.push(e.payload ?? {});
    },
  };
  return { absences, declared, toolEnds, checks, all, recorder };
};

const buildAgent = (args: {
  replies: readonly unknown[];
  tools: readonly unknown[];
  reactMode?: 'dynamic' | 'dynamic-grouped' | 'classic';
  evidence?: boolean;
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 6,
    ...(args.reactMode && { reactMode: args.reactMode }),
  }).system('You are a SAN engineer.');
  for (const t of args.tools) builder = builder.tool(t as never);
  if (args.evidence) builder = builder.namesAndNumbersFromEvidence({ posture: 'assist' });
  return { agent: builder.watch(caps.recorder).build(), ...caps };
};

const historyOf = (agent: Agent): readonly LLMMessage[] =>
  (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;

/** The gate reports `{ value, shape }` rows; the tests here argue about the
 *  values. */
const unsupportedValuesOf = (verdict: Ev | undefined): readonly string[] =>
  ((verdict?.unsupported as Array<{ value: string }> | undefined) ?? []).map((u) => u.value);

const declaredOf = (agent: Agent): readonly Ev[] =>
  ((agent.getLastSnapshot()?.sharedState as { coverageDeclared?: Ev[] }).coverageDeclared ??
    []) as readonly Ev[];

// ─────────────────────────────────────────────────────────────────────────
// Unit — a declaration this library cannot honor is refused where it is typed
// ─────────────────────────────────────────────────────────────────────────

describe('unit: absent() refusals teach at the call site', () => {
  it('refuses an absence that names no coverage — the whole point is that a null cannot say where it looked', () => {
    expect(() => absent({ what: 'x', checked: [] })).toThrow(
      /at least one source[\s\S]*null with extra steps[\s\S]*could not look/,
    );
    expect(() => absent({ what: 'x' } as never)).toThrow(/at least one source/);
  });

  it('refuses an absence that cannot say what it did not find', () => {
    expect(() => absent({ what: '  ', checked: ['a source'] })).toThrow(
      /`what` must say what was looked for/,
    );
  });

  it('refuses a `cannotCover` entry with no reason — a permanent blind spot is a claim about capability', () => {
    expect(() =>
      absent({ what: 'x', checked: ['a source'], cannotCover: ['the peer fabric'] }),
    ).toThrow(/needs a `why`[\s\S]*cannot act on, escalate or disprove[\s\S]*notChecked/);
    expect(() =>
      absent({ what: 'x', checked: ['a source'], cannotCover: [{ what: 'peer' }] }),
    ).toThrow(/has no `why`/);
  });

  it('refuses an entry that names no ground at all', () => {
    expect(() => absent({ what: 'x', checked: [''] })).toThrow(/names no ground/);
    expect(() => absent({ what: 'x', checked: [{ what: 'a', why: '  ' }] })).toThrow(
      /`why` that says nothing/,
    );
    expect(() => absent({ what: 'x', checked: 'a source' as never })).toThrow(/must be an array/);
  });
});

describe('unit: the recognizer is strict, which is the zero-cost guarantee', () => {
  it('recognizes only what absent() minted', () => {
    expect(readAbsence(absent(DECL))).toBeDefined();
    for (const notOne of [
      undefined,
      null,
      'no rows',
      42,
      [],
      [absent(DECL)],
      {},
      { af_absent: 'yes', checked: ['x'] },
      { af_absent: true },
      { af_absent: true, checked: [] },
      { not_found: true, count: 0 },
    ]) {
      expect(readAbsence(notOne)).toBeUndefined();
    }
  });

  it('readCoverageResult sees the absence inside a ledger, and still calls the outcome absent', () => {
    const both = readCoverageResult(coverage(absent(DECL), { checked: ['one array'] }));
    expect(both?.status).toBe('absent');
    expect(both?.declared.map((d) => d.kind)).toEqual(['ledger', 'absence']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the rendered shape is what the model reads
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the rendered absence', () => {
  const a: ToolAbsence = absent(DECL);

  it('carries the coverage, the marker, and the retry-is-futile clause as DATA and as prose', () => {
    expect(a[ABSENCE_MARKER]).toBe(true);
    expect(a.outcome).toBe('nothing_found');
    expect(a.retry_returns_the_same).toBe(true);
    expect(a.checked).toEqual([
      { what: 'shq-fab-a: the live fcns database' },
      { what: 'window: the last 24h' },
    ]);
    expect(a.not_checked?.[0]).toEqual({
      what: 'the archived FLOGI history',
      why: 'older than the 24h window',
    });
    expect(a.note).toMatch(/calling this tool again with the same arguments returns this same/i);
  });

  it('reads as an ANSWER, never as a failure — outside the note, no field wears the vocabulary of a broken call', () => {
    const { note: _note, ...fields } = a;
    const text = JSON.stringify(fields).toLowerCase();
    for (const word of ['error', 'failed', 'failure', 'exception', 'unavailable', 'timed out']) {
      expect(text).not.toContain(word);
    }
    expect(a.outcome).toBe('nothing_found');
    // The note mentions error and failure exactly once each, to DENY them —
    // the sentence a model has to read to stop treating an empty answer as an
    // outage.
    expect(a.note).toMatch(/this is an answer, not an error: nothing failed/i);
  });

  it('never interpolates the sought text into the note — the note is the same bytes for every absence', () => {
    const other = absent({ what: 'something else entirely', checked: ['a source'] });
    expect(other.note).toBe(a.note);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the loop, the status, the record, and the contrast with error
// ─────────────────────────────────────────────────────────────────────────

const absentTool = defineTool({
  name: 'flogi_for_port',
  description: 'FLOGI entries for one interface',
  inputSchema: { type: 'object', properties: { port: { type: 'string' } } },
  execute: () => absent(DECL),
});

const brokenTool = defineTool({
  name: 'flogi_for_port_broken',
  description: 'FLOGI entries for one interface',
  inputSchema: { type: 'object', properties: { port: { type: 'string' } } },
  execute: () => {
    throw new Error('collector unreachable: shq-fab-a timed out');
  },
});

describe('integration: an absence is delivered as an answer, not a failure', () => {
  it('declares the `absent` status, files tools.absent, and never marks the call in error', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port'), final('Nothing is logged in on that port.')],
      tools: [absentTool],
    });
    await t.agent.run('any FLOGI on fc1/3?');

    expect(t.toolEnds).toHaveLength(1);
    expect(t.toolEnds[0]?.status).toBe('absent');
    // The one-sided assertion: an absence must never wear the words that send
    // an engineer to investigate a healthy collector.
    expect(t.toolEnds[0]?.status).not.toBe('failure');
    expect(t.toolEnds[0]?.error).toBeUndefined();

    expect(t.absences).toHaveLength(1);
    expect(t.absences[0]).toMatchObject({
      toolName: 'flogi_for_port',
      lookedFor: 'FLOGI entries on fc1/3',
      checked: [{ what: 'shq-fab-a: the live fcns database' }, { what: 'window: the last 24h' }],
      cannotCover: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
    });
    // No error channel fired at all.
    expect(t.all.filter((e) => e.name.startsWith('agentfootprint.error.'))).toHaveLength(0);
  });

  it('the model reads the coverage and the retry clause in the tool turn itself', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port'), final('done')],
      tools: [absentTool],
    });
    await t.agent.run('any FLOGI on fc1/3?');
    const toolTurn = historyOf(t.agent).find((m) => m.role === 'tool');
    expect(toolTurn?.content).toContain('"af_absent":true');
    expect(toolTurn?.content).toContain('the live fcns database');
    expect(toolTurn?.content).toMatch(/returns this same result/);
  });

  it('THE DISTINCTION: a thrown tool and an absence do not share one byte of shape', async () => {
    const broken = buildAgent({
      replies: [call('flogi_for_port_broken'), final('The collector is down.')],
      tools: [brokenTool],
    });
    await broken.agent.run('any FLOGI on fc1/3?');
    const brokenEnd = broken.toolEnds[0];
    // An error: error:true, no absent status, no absence event, no coverage.
    expect(brokenEnd?.error).toBe(true);
    expect(brokenEnd?.status).not.toBe('absent');
    expect(broken.absences).toHaveLength(0);
    expect(declaredOf(broken.agent)).toHaveLength(0);
    const brokenTurn = historyOf(broken.agent).find((m) => m.role === 'tool');
    expect(brokenTurn?.content).not.toContain(ABSENCE_MARKER);

    const found = buildAgent({
      replies: [call('flogi_for_port'), final('Nothing on that port.')],
      tools: [absentTool],
    });
    await found.agent.run('any FLOGI on fc1/3?');
    // …and an absence: no error flag, the absent status, the event, the record.
    expect(found.toolEnds[0]?.error).toBeUndefined();
    expect(found.toolEnds[0]?.status).toBe('absent');
    expect(found.absences).toHaveLength(1);
    expect(declaredOf(found.agent)).toHaveLength(1);
  });

  it("'absent' is a word onToolStatus can key on — it is in the closed vocabulary", () => {
    expect(TOOL_RESULT_STATUSES).toContain('absent');
    expect(TOOL_RESULT_STATUSES).toContain('failure');
    expect(new Set(TOOL_RESULT_STATUSES).size).toBe(TOOL_RESULT_STATUSES.length);
  });

  it('the coverage lands in tracked state, where the answer is read beside it', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port'), final('done')],
      tools: [absentTool],
    });
    await t.agent.run('any FLOGI on fc1/3?');
    const rows = declaredOf(t.agent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'absence', toolName: 'flogi_for_port' });
    expect(typeof rows[0]?.iteration).toBe('number');
  });

  it('works the same in the grouped chart — the dispatch boundary is shared, not copied', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port'), final('done')],
      tools: [absentTool],
      reactMode: 'dynamic-grouped',
    });
    await t.agent.run('any FLOGI on fc1/3?');
    expect(t.absences).toHaveLength(1);
    expect(t.toolEnds[0]?.status).toBe('absent');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security & containment — a failed lookup is the cheapest laundering machine
// ─────────────────────────────────────────────────────────────────────────

describe('security: an absence grounds its COVERAGE, and nothing else', () => {
  /** The tool echoes the model's own argument back, exactly as a real absence
   *  would ("no FLOGI entries on <what you asked for>"). */
  const echoTool = defineTool<{ port?: string }, ToolAbsence>({
    name: 'flogi_echo',
    description: 'FLOGI entries for one interface',
    inputSchema: { type: 'object', properties: { port: { type: 'string' } } },
    execute: ({ port }) =>
      absent({
        what: `FLOGI entries on ${String(port)}`,
        checked: ['shq-fab-a: the live fcns database'],
      }),
  });

  it('an identifier the MODEL invented does not become grounded by handing it to a tool that found nothing', async () => {
    const t = buildAgent({
      // The model invents the port, hands it to the tool, gets an absence, and
      // then asserts a fact about the value it invented.
      replies: [
        call('flogi_echo', 't1', { port: 'fc1/33' }),
        final('Port fc1/33 has no fabric logins.'),
      ],
      tools: [echoTool],
      evidence: true,
    });
    await t.agent.run('check the fabric');
    const verdict = t.checks.at(-1);
    expect(unsupportedValuesOf(verdict)).toContain('fc1/33');
  });

  it('but the COVERAGE it named is real evidence — an answer may cite where the search looked', async () => {
    const t = buildAgent({
      replies: [
        call('flogi_echo', 't1', { port: 'fc1/33' }),
        final('shq-fab-a was searched and returned nothing.'),
      ],
      tools: [echoTool],
      evidence: true,
    });
    await t.agent.run('check the fabric');
    const verdict = t.checks.at(-1);
    expect(unsupportedValuesOf(verdict)).not.toContain('shq-fab-a');
  });

  it('a value the USER supplied stays exempt even when only an absence mentions it', async () => {
    const t = buildAgent({
      replies: [
        call('flogi_echo', 't1', { port: 'fc1/33' }),
        final('Port fc1/33 has no fabric logins.'),
      ],
      tools: [echoTool],
      evidence: true,
    });
    await t.agent.run('any FLOGI on fc1/33?');
    const verdict = t.checks.at(-1);
    expect(unsupportedValuesOf(verdict)).not.toContain('fc1/33');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: absences that carry less', () => {
  it('a minimal absence — coverage only — still declares its status and its record', async () => {
    const bare = defineTool({
      name: 'bare_lookup',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () => absent({ what: 'rows', checked: ['the only table there is'] }),
    });
    const t = buildAgent({ replies: [call('bare_lookup'), final('none')], tools: [bare] });
    await t.agent.run('go');
    expect(t.toolEnds[0]?.status).toBe('absent');
    expect(t.absences[0]?.notChecked).toBeUndefined();
    expect(t.absences[0]?.cannotCover).toBeUndefined();
  });

  it('a tool that returns an absence twice files it twice — the record counts calls, not distinct answers', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port', 'a'), call('flogi_for_port', 'b'), final('none anywhere')],
      tools: [absentTool],
    });
    await t.agent.run('go');
    expect(t.absences).toHaveLength(2);
    expect(declaredOf(t.agent)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression
// ─────────────────────────────────────────────────────────────────────────

describe('regression: an absence is not retried, refused or re-asked by anything', () => {
  it('the loop does not spend an extra iteration on it, and the answer ships unchanged', async () => {
    const t = buildAgent({
      replies: [call('flogi_for_port'), final('Nothing on fc1/3.')],
      tools: [absentTool],
    });
    const out = await t.agent.run('any FLOGI on fc1/3?');
    expect(out).toBe('Nothing on fc1/3.');
    const iterationEnds = t.all.filter(
      (e) => e.name === 'agentfootprint.agent.iteration_end',
    ).length;
    expect(iterationEnds).toBe(2);
  });
});
