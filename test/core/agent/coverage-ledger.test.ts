/**
 * `coverage()` — the ledger of what a clean result does NOT rule out, and
 * `.limitsTravelWithTheAnswer()`, which makes it survive into the answer.
 *
 * The property under test is SURVIVAL. A ledger the model can drop is
 * worthless, and dropping it is invisible: an answer with no caveat and an
 * answer whose caveat was omitted read identically. So the block is composed
 * by the framework and appended — the model never writes it, which is exactly
 * why the assertions below can use a model that says nothing about limits at
 * all.
 *
 * Sections follow Convention 3: Unit (refusals + the strict recognizer) ·
 * Functional (the rendered wrapper) · Integration (the record, the appended
 * block, both chart shapes) · Edge (folding, empty runs) · Regression
 * (recording without appending; the model cannot suppress it).
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  absent,
  coverage,
  COVERAGE_BLOCK_HEADING,
  COVERAGE_MARKER,
  defineTool,
  readCoverageLedger,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const LEDGER = {
  checked: ['SRDF pair state on all 4 arrays (live query)'],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
  cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
} as const;

const call = (name: string, id = 't1') => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

/** The answer the field cares about: confident, clean, and silent about its
 *  own boundary. The model never mentions a limit anywhere below. */
const CONFIDENT = 'Replication is healthy. Everything looks fine.';

type Ev = Record<string, unknown>;
const capture = () => {
  const declared: Ev[] = [];
  const absences: Ev[] = [];
  const all: Array<{ name: string; payload: Ev }> = [];
  const recorder = {
    id: 'capture-ledger',
    onEmit: (e: { name: string; payload?: Ev }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
      if (e.name === 'agentfootprint.tools.coverage_declared') declared.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.absent') absences.push(e.payload ?? {});
    },
  };
  return { declared, absences, all, recorder };
};

const healthTool = defineTool({
  name: 'replication_health',
  description: 'Replication health across the estate',
  inputSchema: { type: 'object', properties: {} },
  execute: () => coverage({ verdict: 'all pairs synchronized' }, LEDGER),
});

const buildAgent = (args: {
  replies: readonly unknown[];
  tools?: readonly unknown[];
  travel?: boolean;
  reactMode?: 'dynamic' | 'dynamic-grouped' | 'classic';
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 6,
    ...(args.reactMode && { reactMode: args.reactMode }),
  }).system('You are a storage engineer.');
  for (const t of args.tools ?? [healthTool]) builder = builder.tool(t as never);
  if (args.travel) builder = builder.limitsTravelWithTheAnswer();
  return { agent: builder.watch(caps.recorder).build(), ...caps };
};

const declaredOf = (agent: Agent): readonly Ev[] =>
  ((agent.getLastSnapshot()?.sharedState as { coverageDeclared?: Ev[] }).coverageDeclared ??
    []) as readonly Ev[];

// ─────────────────────────────────────────────────────────────────────────
// Unit
// ─────────────────────────────────────────────────────────────────────────

describe('unit: coverage() refusals teach at the call site', () => {
  it('refuses a ledger that declares no boundary — it would look like one while saying nothing', () => {
    expect(() => coverage('ok', {})).toThrow(
      /all three lists are empty[\s\S]*worse than saying[\s\S]*return the result bare/,
    );
    expect(() => coverage('ok', { checked: [], notChecked: [], cannotCover: [] })).toThrow(
      /all three lists are empty/,
    );
  });

  it('refuses a `cannotCover` entry with no reason, exactly as absent() does — one validator, two doors', () => {
    expect(() => coverage('ok', { cannotCover: ['the ESX hosts'] })).toThrow(/needs a `why`/);
  });

  it('refuses a declaration that is not one', () => {
    expect(() => coverage('ok', null as never)).toThrow(/takes the result and its boundary/);
  });
});

describe('unit: the recognizer is strict', () => {
  it('recognizes only what coverage() minted', () => {
    expect(readCoverageLedger(coverage('ok', LEDGER))).toBeDefined();
    for (const notOne of [
      undefined,
      null,
      'ok',
      [],
      {},
      { af_coverage: 'checked everything', result: 'ok' },
      { af_coverage: { checked: [] } },
      { coverage: { checked: [{ what: 'x' }] }, result: 'ok' },
    ]) {
      expect(readCoverageLedger(notOne)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the rendered wrapper
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the rendered ledger', () => {
  it('puts the boundary FIRST and leaves the tool’s own answer untouched', () => {
    const wrapped = coverage({ verdict: 'all pairs synchronized' }, LEDGER);
    expect(Object.keys(wrapped)).toEqual([COVERAGE_MARKER, 'result']);
    expect(wrapped.result).toEqual({ verdict: 'all pairs synchronized' });
    expect(wrapped.af_coverage.not_checked).toEqual([
      { what: 'NDM migration sessions', why: 'the API timed out — ask again' },
    ]);
    expect(wrapped.af_coverage.note).toMatch(/NOT evidence about either/);
  });

  it('omits the sections that say nothing rather than shipping empty lists', () => {
    const wrapped = coverage('ok', { checked: ['the one table'] });
    expect(wrapped.af_coverage.not_checked).toBeUndefined();
    expect(wrapped.af_coverage.cannot_cover).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the record always, the answer on request
// ─────────────────────────────────────────────────────────────────────────

describe('integration: recording is unconditional', () => {
  it('files tools.coverage_declared and tracks the ledger even with the option OFF', async () => {
    const t = buildAgent({ replies: [call('replication_health'), final(CONFIDENT)] });
    const out = await t.agent.run('is replication healthy?');
    expect(out).toBe(CONFIDENT);
    expect(t.declared).toHaveLength(1);
    expect(t.declared[0]).toMatchObject({
      toolName: 'replication_health',
      cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
    });
    expect(declaredOf(t.agent)).toHaveLength(1);
  });
});

describe('integration: .limitsTravelWithTheAnswer() — the model cannot drop what it did not write', () => {
  it('appends the boundary to an answer that never mentions one', async () => {
    const t = buildAgent({
      replies: [call('replication_health'), final(CONFIDENT)],
      travel: true,
    });
    const out = await t.agent.run('is replication healthy?');

    // The model's own words survive verbatim…
    expect(out.startsWith(CONFIDENT)).toBe(true);
    // …and the boundary it never wrote arrives with them.
    expect(out).toContain(COVERAGE_BLOCK_HEADING);
    expect(out).toContain('Checked:');
    expect(out).toContain('- SRDF pair state on all 4 arrays (live query)');
    expect(out).toContain('Not checked:');
    expect(out).toContain('- NDM migration sessions — the API timed out — ask again');
    expect(out).toContain('Cannot cover:');
    expect(out).toContain('- host-side multipathing — no collector runs on the ESX hosts');
  });

  it('the appended block is the SAME answer every reader sees — the caller, turn_end and the record agree', async () => {
    const t = buildAgent({
      replies: [call('replication_health'), final(CONFIDENT)],
      travel: true,
    });
    const out = await t.agent.run('is replication healthy?');
    // One composition, filed once: an observer that reads `turn_end` and a
    // caller that reads the return value must never disagree about what the
    // answer was — which is why the fold happens at the capture and not in a
    // stage after it.
    const turnEnd = t.all.find((e) => e.name === 'agentfootprint.agent.turn_end');
    expect(turnEnd?.payload.finalContent).toBe(out);
    // Composed once, not once per reader.
    expect(out.match(new RegExp(COVERAGE_BLOCK_HEADING, 'g'))).toHaveLength(1);
  });

  it('an ABSENCE contributes its boundary too — the two primitives fold into one block', async () => {
    const searchTool = defineTool({
      name: 'ndm_sessions',
      description: 'NDM migration sessions',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        absent({
          what: 'NDM migration sessions',
          checked: ['the migration collector'],
          cannotCover: [{ what: 'sessions on the peer estate', why: 'a different collector' }],
        }),
    });
    const t = buildAgent({
      replies: [call('ndm_sessions'), final('No migrations are running.')],
      tools: [searchTool],
      travel: true,
    });
    const out = await t.agent.run('any migrations?');
    expect(out).toContain('- the migration collector');
    expect(out).toContain('- sessions on the peer estate — a different collector');
  });

  it('works in the grouped chart too — both builders mount the same swapped stage', async () => {
    const t = buildAgent({
      replies: [call('replication_health'), final(CONFIDENT)],
      travel: true,
      reactMode: 'dynamic-grouped',
    });
    const out = await t.agent.run('is replication healthy?');
    expect(out).toContain(COVERAGE_BLOCK_HEADING);
    expect(out).toContain('- host-side multipathing — no collector runs on the ESX hosts');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: folding and emptiness', () => {
  it('two tools naming the same limit say it once', async () => {
    const a = defineTool({
      name: 'array_health',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        coverage('fine', {
          cannotCover: [{ what: 'host-side multipathing', why: 'no collector on the hosts' }],
        }),
    });
    const b = defineTool({
      name: 'fabric_health',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        coverage('fine', {
          cannotCover: [{ what: 'host-side multipathing', why: 'no collector on the hosts' }],
        }),
    });
    const t = buildAgent({
      replies: [call('array_health', 'a'), call('fabric_health', 'b'), final('All fine.')],
      tools: [a, b],
      travel: true,
    });
    const out = await t.agent.run('status?');
    expect(out.match(/host-side multipathing/g)).toHaveLength(1);
    expect(declaredOf(t.agent)).toHaveLength(2);
  });

  it('a run whose tools declared nothing appends nothing, option or not', async () => {
    const plain = defineTool({
      name: 'plain',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({ rows: 3 }),
    });
    const t = buildAgent({
      replies: [call('plain'), final(CONFIDENT)],
      tools: [plain],
      travel: true,
    });
    const out = await t.agent.run('status?');
    expect(out).toBe(CONFIDENT);
    expect(out).not.toContain(COVERAGE_BLOCK_HEADING);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression
// ─────────────────────────────────────────────────────────────────────────

describe('regression: the survival guarantee does not depend on the model', () => {
  it('a model that explicitly claims full coverage still ships the limits that contradict it', async () => {
    const t = buildAgent({
      replies: [
        call('replication_health'),
        final('I checked everything. There are no gaps in coverage.'),
      ],
      travel: true,
    });
    const out = await t.agent.run('is replication healthy?');
    expect(out).toContain('Cannot cover:');
    expect(out).toContain('host-side multipathing');
  });

  it('with the option OFF the answer is exactly the model’s own words — the append is opt-in', async () => {
    const t = buildAgent({ replies: [call('replication_health'), final(CONFIDENT)] });
    const out = await t.agent.run('is replication healthy?');
    expect(out).toBe(CONFIDENT);
  });
});
