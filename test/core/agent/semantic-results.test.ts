/**
 * The semantic envelope through the REAL Agent loop (9.53.0).
 *
 * The property under test is the SPLIT at the dispatch funnel: the model
 * reads the compact rendering-free projection, the record keeps the full
 * envelope, the envelope's coverage flows through the one coverage channel,
 * and every non-envelope result is byte-identical to 9.52.0. Plus the
 * deliberate ceiling extension: the ceiling measures what the model reads,
 * and the caveats are on the record BEFORE it fires — an oversized result
 * cannot silently delete its own grain and provenance.
 *
 * Sections follow Convention 3: Integration (projection, event, coverage
 * absorb, composition with effects, the ceiling order) · Security &
 * containment (zero-cost, malformed markers stay data) · Regression
 * (persistRecording round trip; resultClass definition-time refusals).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  defineTool,
  semantic,
  SEMANTICS_NOTE,
  type ToolSemantics,
} from '../../../src/index.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../../src/recorders/observability/fileRecordingSink.js';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-semantics-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

// ── Toolkit ──────────────────────────────────────────────────────────────

const PROVENANCE = {
  measured_at: '2026-08-19T02:00:00Z',
  age_seconds: 30000,
  source: 'nightly RVTools export',
  source_export_date: '2026-08-18',
};

const DECL = {
  series: [
    { t: '2026-08-19T01:30:00Z', entity: 'fc1/3', metric: 'avg_iops', value: 18450 },
    { t: '2026-08-19T02:00:00Z', entity: 'fc1/3', metric: 'avg_iops', value: 17200 },
  ],
  grain: { interval: '30m', aggregation: 'avg', is_counter: false },
  provenance: PROVENANCE,
  coverage: {
    checked: ['shq-fab-a: all 48 FC ports'],
    notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
  },
  render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
} as const;

const call = (name: string, id = 't1', args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Ev = Record<string, unknown>;
const capture = () => {
  const semantics: Ev[] = [];
  const declared: Ev[] = [];
  const toolEnds: Ev[] = [];
  const refused: Ev[] = [];
  const recorder = {
    id: 'capture-semantics',
    onEmit: (e: { name: string; payload?: Ev }) => {
      if (e.name === 'agentfootprint.tools.semantics_declared') semantics.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.coverage_declared') declared.push(e.payload ?? {});
      if (e.name === 'agentfootprint.stream.tool_end') toolEnds.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.result_refused') refused.push(e.payload ?? {});
    },
  };
  return { semantics, declared, toolEnds, refused, recorder };
};

const buildAgent = (args: {
  replies: readonly unknown[];
  tools: readonly unknown[];
  limits?: boolean;
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 6,
  }).system('You are a SAN engineer.');
  for (const t of args.tools) builder = builder.tool(t as never);
  if (args.limits) builder = builder.limitsTravelWithTheAnswer();
  return { agent: builder.watch(caps.recorder).build(), ...caps };
};

const historyOf = (agent: Agent): readonly LLMMessage[] =>
  (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;

const toolTurnOf = (agent: Agent): string => {
  const turn = historyOf(agent).find((m) => m.role === 'tool');
  expect(turn).toBeDefined();
  return typeof turn?.content === 'string' ? turn.content : JSON.stringify(turn?.content);
};

const portIops = (overrides: Partial<Record<string, unknown>> = {}) =>
  defineTool({
    name: 'port_iops',
    description: 'Per-port IOPS over the last window',
    inputSchema: { type: 'object', properties: {} },
    execute: () => semantic(DECL),
    ...overrides,
  });

// ─────────────────────────────────────────────────────────────────────────
// Integration — the split at the dispatch funnel
// ─────────────────────────────────────────────────────────────────────────

describe('integration: the model reads the projection, the record keeps the envelope', () => {
  it('history carries the compact rendering-free projection — data + caveats, never marker/render/coverage detail', async () => {
    const { agent } = buildAgent({
      replies: [call('port_iops'), final('fc1/3 averaged 17.8k IOPS.')],
      tools: [portIops()],
    });
    await agent.run({ message: 'How busy is fc1/3?' });
    const text = toolTurnOf(agent);
    // The caveats travel with the numbers…
    expect(text).toContain('avg_iops');
    expect(text).toContain('"interval":"30m"');
    expect(text).toContain('"is_counter":false');
    expect(text).toContain('nightly RVTools export');
    expect(text).toContain('the peer fabric — this collector is scoped to one fabric');
    expect(text).toContain(SEMANTICS_NOTE.slice(0, 40));
    // …and the machine/UI-only fields never reach the model.
    expect(text).not.toContain('af_semantics');
    expect(text).not.toContain('render');
    expect(text).not.toContain('"coverage"');
    expect(text).not.toContain('"checked"');
  });

  it('tools.semantics_declared carries the FULL envelope — grain, provenance, coverage, render, marker', async () => {
    const { agent, semantics } = buildAgent({
      replies: [call('port_iops', 'tc-9'), final('done')],
      tools: [portIops()],
    });
    await agent.run({ message: 'go' });
    expect(semantics).toHaveLength(1);
    const p = semantics[0]!;
    expect(p.toolName).toBe('port_iops');
    expect(p.toolCallId).toBe('tc-9');
    expect(typeof p.iteration).toBe('number');
    const env = p.semantics as ToolSemantics;
    expect(env.af_semantics).toBe(true);
    expect(env.grain).toEqual(DECL.grain);
    expect(env.provenance).toEqual(PROVENANCE);
    expect(env.render).toEqual(DECL.render);
    expect(env.coverage?.checked?.[0]?.what).toBe('shq-fab-a: all 48 FC ports');
    expect(env.series).toHaveLength(2);
  });

  it("the envelope's coverage flows through the ONE coverage channel: event, tracked state, the answer block", async () => {
    const { agent, declared } = buildAgent({
      replies: [call('port_iops'), final('fc1/3 is fine.')],
      tools: [portIops()],
      limits: true,
    });
    const answer = await agent.run({ message: 'go' });
    // The tools.coverage_declared event — the coverage() channel, absorbed.
    expect(declared).toHaveLength(1);
    expect((declared[0]!.notChecked as Ev[])[0]!.what).toBe('the peer fabric');
    // Tracked state — a limit is a fact about the ANSWER.
    const rows = (agent.getLastSnapshot()?.sharedState as { coverageDeclared?: Ev[] })
      .coverageDeclared;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.kind).toBe('ledger');
    // …and .limitsTravelWithTheAnswer() appends it to the final answer.
    expect(answer).toContain('Coverage of this answer');
    expect(answer).toContain('the peer fabric');
  });

  it('effects + semantics compose on ONE result: status routes, projection lands, envelope rides the event', async () => {
    const both = defineTool({
      name: 'both_channels',
      description: 'Returns an effects envelope whose content is a semantic envelope',
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({ content: semantic(DECL), effects: [], status: 'partial' as const }),
    });
    const { agent, semantics, toolEnds } = buildAgent({
      replies: [call('both_channels'), final('done')],
      tools: [both],
    });
    await agent.run({ message: 'go' });
    // The effects channel kept its status…
    expect(toolEnds[0]!.status).toBe('partial');
    // …the semantic channel kept its envelope…
    expect(semantics).toHaveLength(1);
    expect((semantics[0]!.semantics as ToolSemantics).grain).toEqual(DECL.grain);
    // …and the model read the projection of the CONTENT.
    const text = toolTurnOf(agent);
    expect(text).toContain('"is_counter":false');
    expect(text).not.toContain('af_semantics');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the ceiling extension: measure the model's view, record first
// ─────────────────────────────────────────────────────────────────────────

describe('integration: resultCeiling accounts for the envelope deliberately', () => {
  const bigDecl = () => ({
    ...DECL,
    facts: Array.from({ length: 40 }, (_, i) => ({
      entity: `vm-${String(i)}`,
      datastore: 'RN-PM01-PR-EPIC-NR-DS-06',
      prov_tb: 0.42,
    })),
  });

  it('the ceiling measures the PROJECTION — an envelope whose render/coverage overhead crosses the line is not refused for it', async () => {
    const sem = semantic(DECL);
    const projectionSize = JSON.stringify({
      series: sem.series,
      grain: sem.grain,
      provenance: sem.provenance,
      not_covered: sem.not_covered,
      note: sem.note,
    }).length;
    const fullSize = JSON.stringify(sem).length;
    const ceiling = Math.ceil((projectionSize + fullSize) / 2);
    expect(projectionSize).toBeLessThan(ceiling);
    expect(fullSize).toBeGreaterThan(ceiling);
    const { agent, refused } = buildAgent({
      replies: [call('port_iops'), final('done')],
      tools: [portIops({ resultCeiling: { maxChars: ceiling } })],
    });
    await agent.run({ message: 'go' });
    expect(refused).toHaveLength(0);
    expect(toolTurnOf(agent)).toContain('avg_iops');
  });

  it('an oversized projection IS refused — but grain and provenance are already on the record', async () => {
    const big = defineTool({
      name: 'port_iops',
      description: 'Per-port IOPS over the last window',
      inputSchema: { type: 'object', properties: {} },
      resultCeiling: { maxChars: 300, narrowBy: ['entity'] },
      execute: () => semantic(bigDecl()),
    });
    const { agent, semantics, refused } = buildAgent({
      replies: [call('port_iops'), final('done')],
      tools: [big],
    });
    await agent.run({ message: 'go' });
    // The model read the teaching refusal, not the data…
    const text = toolTurnOf(agent);
    expect(text).toContain('Result too large');
    expect(text).toContain("'entity'");
    expect(refused).toHaveLength(1);
    // …but the record kept the caveats whole: the semantics event fired
    // BEFORE the ceiling, so nothing about the envelope was silently lost.
    expect(semantics).toHaveLength(1);
    const env = semantics[0]!.semantics as ToolSemantics;
    expect(env.grain).toEqual(DECL.grain);
    expect(env.provenance).toEqual(PROVENANCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security & containment — zero-cost and the strictness law
// ─────────────────────────────────────────────────────────────────────────

describe('containment: everything that is not a well-formed envelope keeps its bytes', () => {
  it('a plain tool result is untouched and files no semantics event', async () => {
    const plain = defineTool({
      name: 'plain',
      description: 'Plain result',
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({ rows: [1, 2, 3], note: 'no markers here' }),
    });
    const { agent, semantics, declared } = buildAgent({
      replies: [call('plain'), final('done')],
      tools: [plain],
    });
    await agent.run({ message: 'go' });
    expect(semantics).toEqual([]);
    expect(declared).toEqual([]);
    expect(toolTurnOf(agent)).toContain('"rows":[1,2,3]');
  });

  it('a marker-bearing envelope with faults stays DATA — never half-applied', async () => {
    const broken = defineTool({
      name: 'broken',
      description: 'Hand-built envelope missing its grain and provenance',
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({
        af_semantics: true,
        series: [{ t: 1, entity: 'fc1/3', metric: 'iops', value: 5 }],
      }),
    });
    const { agent, semantics } = buildAgent({
      replies: [call('broken'), final('done')],
      tools: [broken],
    });
    await agent.run({ message: 'go' });
    expect(semantics).toEqual([]); // not recognized ⇒ not declared
    expect(toolTurnOf(agent)).toContain('af_semantics'); // bytes kept — the data path
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the archive and the definition-time refusal
// ─────────────────────────────────────────────────────────────────────────

describe('regression: the envelope survives to the archived recording', () => {
  it('persistRecording keeps the full envelope with grain + provenance intact, re-read as bytes', async () => {
    const { agent } = buildAgent({
      replies: [call('port_iops', 'tc-arc'), final('done')],
      tools: [portIops()],
    });
    const rec = recordRun(agent);
    await agent.run({ message: 'archive me' });
    const directory = tempDir();
    await persistRecording(rec, {
      sink: fileRecordingSink({ directory }),
      run: { complete: true },
    });
    rec.stop();

    const files = readdirSync(directory).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const envelope = JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as {
      recording: { events: Array<{ type: string; payload: Ev }> };
    };
    const rows = envelope.recording.events.filter(
      (e) => e.type === 'agentfootprint.tools.semantics_declared',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.toolCallId).toBe('tc-arc');
    const sem = rows[0]!.payload.semantics as ToolSemantics;
    expect(sem.grain).toEqual({ interval: '30m', aggregation: 'avg', is_counter: false });
    expect(sem.provenance).toEqual(PROVENANCE);
    expect(sem.render).toEqual(DECL.render);
  });
});

describe('regression: resultClass is validated where it is typed', () => {
  it('accepts the closed set and stores it on the tool', () => {
    const t = defineTool({
      name: 'vm_backup_status',
      description: 'Backup posture for one VM',
      resultClass: 'triage',
      execute: () => 'ok',
    });
    expect(t.resultClass).toBe('triage');
  });

  it('refuses a class outside the set, naming the tool and the vocabulary', () => {
    expect(() =>
      defineTool({
        name: 'vm_backup_status',
        description: 'x',
        resultClass: 'metric' as never,
        execute: () => 'ok',
      }),
    ).toThrow(/'vm_backup_status'[\s\S]*'metric'[\s\S]*triage, inventory/);
  });
});
