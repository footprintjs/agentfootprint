/**
 * Unit tests — traceToolpack (RFC-003 Part C, the introspection toolpack).
 *
 * Per-tool coverage over a real completed footprintjs run (the artifacts the
 * toolpack is built for) plus hand-built artifacts for cap/edge cases:
 *   - bounded outputs (previews, stage caps, value caps, hard caps)
 *   - honesty markers (⚠ untracked sources, truncated slices, missing lookups)
 *   - id validation: garbage ids → corrective model-visible messages,
 *     and strict schemas reject garbage args via #9 (callTraceTool mirrors
 *     the Agent's validation boundary)
 *   - nested-path keys round-trip in dot notation
 */

import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import type { RuntimeSnapshot, StageSnapshot } from 'footprintjs/advanced';
import { describe, expect, it } from 'vitest';

import {
  callTraceTool,
  TOOLPACK_HARD_CAPS,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../../../src/observe.js';
import type { Tool } from '../../../src/index.js';

// ─── Fixture: a real completed run with decision + nested write + long value ─

interface FixtureState {
  amount: number;
  income: number;
  ratio: number;
  customer: { address: { zip: string } };
  blob: string;
  outcome: string;
}

const LONG_BLOB = `BLOB-${'x'.repeat(600)}-END`;

async function runFixture(): Promise<{
  artifacts: TraceToolpackArtifacts;
  artifactsBare: TraceToolpackArtifacts; // no controlDeps, no narrative
}> {
  const chart = flowChart<FixtureState>(
    'Seed',
    async (scope) => {
      const args = scope.$getArgs<{ requestId: string }>();
      void args.requestId; // untracked read → honesty marker
      scope.amount = 1200;
      scope.income = 4000;
      scope.customer = { address: { zip: '00000' } };
      scope.blob = LONG_BLOB;
    },
    'seed',
    { description: 'Seed the figures' },
  )
    .addFunction(
      'Derive',
      async (scope) => {
        scope.ratio = scope.amount / scope.income;
        scope.customer.address.zip = '90210'; // deep write → nested path
      },
      'derive',
      'Compute the ratio',
    )
    .addDeciderFunction(
      'Classify',
      (scope) =>
        decide(
          scope as unknown as FixtureState,
          [{ when: { ratio: { lt: 0.5 } }, then: 'ok', label: 'Ratio under half' }],
          'bad',
        ),
      'classify',
      'Route on the ratio',
    )
    .addFunctionBranch('ok', 'Accept', async (scope) => {
      scope.outcome = 'ok';
    })
    .addFunctionBranch('bad', 'Reject', async (scope) => {
      scope.outcome = 'bad';
    })
    .end()
    .build();

  const executor = new FlowChartExecutor(chart);
  const ctrl = controlDepRecorder();
  executor.attachCombinedRecorder(ctrl);
  executor.enableNarrative();
  await executor.run({ input: { requestId: 'req-1' } });

  const snapshot = executor.getSnapshot();
  const narrative = executor.getNarrativeEntries().map((e) => e.text);
  return {
    artifacts: { snapshot, controlDeps: ctrl.asLookup(), narrative },
    artifactsBare: { snapshot },
  };
}

const fixture = await runFixture();

function tool(tools: Tool[], name: string): Tool {
  const found = tools.find((t) => t.schema.name === name);
  expect(found, `tool ${name} should exist`).toBeDefined();
  return found as Tool;
}

// ─── Hand-built artifacts for cap tests (many stages, no enum) ─────────────

function manyStageArtifacts(count: number): TraceToolpackArtifacts {
  const commitLog = [];
  let tree: StageSnapshot | undefined;
  let tail: StageSnapshot | undefined;
  for (let i = 0; i < count; i++) {
    const id = `stage-${i}#${i}`;
    commitLog.push({
      idx: i,
      stage: `Stage ${i}`,
      stageId: `stage-${i}`,
      runtimeStageId: id,
      trace: [{ path: `key${i}`, verb: 'set' as const }],
      redactedPaths: [],
      overwrite: { [`key${i}`]: i },
      updates: {},
    });
    const node: StageSnapshot = {
      id: `stage-${i}`,
      runtimeStageId: id,
      name: `Stage ${i}`,
      description: `does thing ${i}`,
      logs: {},
      errors: {},
      metrics: {},
      evals: {},
    };
    if (tail) tail.next = node;
    else tree = node;
    tail = node;
  }
  const snapshot = {
    sharedState: Object.fromEntries(Array.from({ length: count }, (_, i) => [`key${i}`, i])),
    executionTree: tree as StageSnapshot,
    commitLog,
    commitValues: 'full',
  } as unknown as RuntimeSnapshot;
  return { snapshot };
}

// ─── traceToolpack factory ─────────────────────────────────────────────────

describe('traceToolpack — factory', () => {
  it('returns the 6 core tools, plus read_narrative only when narrative is provided', () => {
    const withNarrative = traceToolpack(fixture.artifacts);
    expect(withNarrative.map((t) => t.schema.name)).toEqual([
      'run_overview',
      'trace_node',
      'trace_slice',
      'backtrack',
      'who_wrote',
      'get_value',
      'read_narrative',
    ]);
    const bare = traceToolpack(fixture.artifactsBare);
    expect(bare.map((t) => t.schema.name)).not.toContain('read_narrative');
    expect(bare).toHaveLength(6);
  });

  it('embeds an id enum in schemas for small runs (free #9 validation)', () => {
    const tools = traceToolpack(fixture.artifacts);
    const schema = tool(tools, 'trace_node').schema.inputSchema as {
      properties: { runtimeStageId: { enum?: string[] } };
    };
    expect(schema.properties.runtimeStageId.enum).toContain('seed#0');
    expect(schema.properties.runtimeStageId.enum).toContain('derive#1');
  });

  it('omits the id enum on long runs (token economy of the tools block)', () => {
    const tools = traceToolpack(manyStageArtifacts(60));
    const schema = tool(tools, 'trace_node').schema.inputSchema as {
      properties: { runtimeStageId: { enum?: string[] } };
    };
    expect(schema.properties.runtimeStageId.enum).toBeUndefined();
  });
});

// ─── run_overview ──────────────────────────────────────────────────────────

describe('run_overview', () => {
  it('serves a bounded entry-point summary: stages with descriptions, honesty, state keys', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'run_overview');
    expect(out).toContain('TRACE RUN OVERVIEW');
    expect(out).toContain('- seed ×1 — "Seed": Seed the figures');
    expect(out).toContain('- classify ×1'); // the decider stage is listed
    expect(out).toMatch(/HONESTY: ⚠ 1 step\(s\) consumed untracked inputs/);
    expect(out).toContain('SHARED STATE KEYS');
    expect(out).toContain('NARRATIVE:');
    // The overview NEVER embeds values.
    expect(out).not.toContain(LONG_BLOB.slice(0, 40));
  });

  it('caps the stage list and says so explicitly', async () => {
    const tools = traceToolpack(manyStageArtifacts(55));
    const out = await callTraceTool(tools, 'run_overview');
    expect(out).toContain('…and 15 more stages');
  });
});

// ─── trace_node ────────────────────────────────────────────────────────────

describe('trace_node', () => {
  it('shows writes (verb + bounded preview + true size), reads, parents, and ⚠ markers', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'seed#0' });
    expect(out).toContain('STEP seed#0 — "Seed"');
    expect(out).toContain('description: Seed the figures');
    expect(out).toContain('- amount (set): 1200');
    // Long value is previewed, never dumped: true size + fetch hint.
    expect(out).not.toContain(LONG_BLOB);
    expect(out).toMatch(/chars total — get_value\('seed#0', 'blob'\) for full/);
    // Untracked-args honesty marker.
    expect(out).toContain('⚠ this step also consumed args');
  });

  it('resolves data parents and the control parent (with the decide() rule label)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'ok#3' });
    expect(out).toContain('STEP ok#3 — "Accept"');
    expect(out).toContain('- control: routed here by classify#2 — rule "Ratio under half"');
    const derive = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'derive#1' });
    expect(derive).toContain('- data: amount ← seed#0 "Seed"');
    expect(derive).toContain('- data: income ← seed#0 "Seed"');
  });

  it('says when the control-dependence lookup is missing instead of staying silent', async () => {
    const tools = traceToolpack(fixture.artifactsBare);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'ok#3' });
    expect(out).toContain('⚠ control-dependence lookup not provided');
  });

  it('rejects a garbage id with a corrective message naming real executions', async () => {
    // Direct execute — the tool's OWN guard (the #9 schema enum already
    // rejects garbage ids upstream on small runs; long runs have no enum
    // and rely on this layer).
    const traceNode = tool(traceToolpack(fixture.artifacts), 'trace_node');
    const out = String(
      await traceNode.execute({ runtimeStageId: 'derive#99' } as never, undefined as never),
    );
    expect(out).toContain("unknown runtimeStageId 'derive#99'");
    expect(out).toContain('derive#1'); // the real execution is suggested
  });

  it('shows deep writes as a merge on the parent key — the delimiter never leaks', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'derive#1' });
    expect(out).toMatch(/- customer \(merge\): .*90210/);
    expect(out).not.toContain('\u001F'); // the engine delimiter never leaks
  });
});

// ─── trace_slice ───────────────────────────────────────────────────────────

describe('trace_slice', () => {
  it('returns the causal chain with control edges labeled and ids drillable', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_slice', { runtimeStageId: 'ok#3' });
    expect(out).toContain('CAUSAL SLICE from ok#3');
    expect(out).toContain('[control: Ratio under half]');
    expect(out).toContain('(derive#1)');
    expect(out).toContain('(seed#0)');
    expect(out).toContain('⚠ also consumed args — slice may be incomplete here');
  });

  it('marks truncation explicitly when the node budget cuts the slice', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_slice', {
      runtimeStageId: 'ok#3',
      maxNodes: 2,
    });
    expect(out).toContain('⚠ slice truncated');
  });

  it('clamps per-call params to the hard caps', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_slice', {
      runtimeStageId: 'ok#3',
      maxDepth: 99999,
      maxNodes: 99999,
    });
    expect(out).toContain(
      `(maxDepth ${TOOLPACK_HARD_CAPS.sliceMaxDepth}, maxNodes ${TOOLPACK_HARD_CAPS.sliceMaxNodes})`,
    );
  });

  it('restricts the slice to one key when asked', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_slice', {
      runtimeStageId: 'classify#2',
      key: 'ratio',
    });
    expect(out).toContain("for key 'ratio'");
    expect(out).toContain('(derive#1)');
  });

  it('says when control edges are unavailable instead of silently omitting them', async () => {
    const tools = traceToolpack(fixture.artifactsBare);
    const out = await callTraceTool(tools, 'trace_slice', { runtimeStageId: 'ok#3' });
    expect(out).toContain('⚠ control edges unavailable');
  });
});

// ─── who_wrote ─────────────────────────────────────────────────────────────

describe('who_wrote', () => {
  it('names the writer with verb and bounded preview', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'who_wrote', { key: 'ratio' });
    expect(out).toContain('\'ratio\' was last written by derive#1 — "Derive" (verb: set): 0.3');
  });

  it('respects beforeStageId (strictly-before semantics)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'who_wrote', {
      key: 'customer',
      beforeStageId: 'derive#1',
    });
    expect(out).toContain('was last written by seed#0');
  });

  it('is honest about keys the commit log cannot see', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'who_wrote', { key: 'nonexistent' });
    expect(out).toContain("no tracked write to 'nonexistent'");
    expect(out).toContain('⚠');
    expect(out).toContain('Known keys include:');
  });
});

// ─── get_value ─────────────────────────────────────────────────────────────

describe('get_value', () => {
  it('serves small values in full', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'derive#1',
      key: 'ratio',
    });
    expect(out).toContain("VALUE of 'ratio' as of derive#1");
    expect(out).toContain('0.3');
  });

  it('reconstructs merged objects (deep write folded onto the seed value)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'derive#1',
      key: 'customer',
    });
    expect(out).toContain('"90210"'); // the deep write landed in the merge
  });

  it('truncates at maxChars with an explicit notice (never silent)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'seed#0',
      key: 'blob',
      maxChars: 60,
    });
    expect(out).toMatch(/⚠ truncated: served 60 of \d+ chars/);
    expect(out).not.toContain('-END'); // the tail stayed unserved
  });

  it('clamps maxChars to the hard cap', async () => {
    const big = manyStageArtifacts(3);
    (big.snapshot.commitLog[0].overwrite as Record<string, unknown>).key0 = 'y'.repeat(9000);
    const tools = traceToolpack(big);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'stage-0#0',
      key: 'key0',
      maxChars: 999999,
    });
    expect(out).toContain(`served ${TOOLPACK_HARD_CAPS.valueMaxChars} of`);
  });

  it('is honest about unknown keys and pre-run values', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'seed#0',
      key: 'ghost',
    });
    expect(out).toContain("no tracked write to 'ghost' anywhere in the commit log");
    expect(out).toContain('⚠');
  });

  it('says when a key had no value YET as of an early step', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'seed#0',
      key: 'ratio',
    });
    expect(out).toContain("'ratio' has no value as of seed#0");
    expect(out).toContain('derive#1');
  });
});

// ─── read_narrative ────────────────────────────────────────────────────────

describe('read_narrative', () => {
  it('paginates with explicit continuation hints', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'read_narrative', { maxLines: 3 });
    expect(out).toMatch(/NARRATIVE lines 0–2 of \d+/);
    expect(out).toContain('read_narrative({ offset: 3 })');
    const page2 = await callTraceTool(tools, 'read_narrative', { offset: 3, maxLines: 3 });
    expect(page2).toMatch(/NARRATIVE lines 3–5 of \d+/);
  });

  it('caps maxLines to the hard cap', async () => {
    const longNarrative = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const tools = traceToolpack({ ...fixture.artifactsBare, narrative: longNarrative });
    const out = await callTraceTool(tools, 'read_narrative', { maxLines: 5000 });
    expect(out).toContain(`lines 0–${TOOLPACK_HARD_CAPS.narrativeMaxLines - 1} of 500`);
  });
});

// ─── callTraceTool — the #9 validation boundary for scripted sessions ──────

describe('callTraceTool — #9 arg validation', () => {
  it('rejects wrong-typed args with the model-visible correction (never executes)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 42 });
    expect(out).toContain("Invalid arguments for tool 'trace_node'");
    expect(out).toContain('runtimeStageId');
  });

  it('rejects missing required args', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'get_value', { runtimeStageId: 'seed#0' });
    expect(out).toContain("Invalid arguments for tool 'get_value'");
    expect(out).toContain('key');
  });

  it('rejects garbage ids via the schema enum on small runs', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'DROP TABLE;' });
    expect(out).toContain('Invalid arguments');
  });

  it('rejects extra args (additionalProperties: false)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    const out = await callTraceTool(tools, 'run_overview', { surprise: true });
    expect(out).toContain('Invalid arguments');
  });

  it('throws on a tool name that does not exist (caller bug, not model retry)', async () => {
    const tools = traceToolpack(fixture.artifacts);
    await expect(callTraceTool(tools, 'no_such_tool')).rejects.toThrow(/no tool named/);
  });
});
