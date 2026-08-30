/**
 * runbookAsTool — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins (the phase-1 acceptance list):
 *   - Smallest legal call {name, description, procedure} → honest spine
 *   - Full triage-shaped procedure: decider evidence sentences in the walk,
 *     walk artifact minted `recording/chart-walk` with walk_segment 'full',
 *     verdict rowset via resultKind → ticket, coverage carried up from an
 *     inner ctx.tools call, declined rows → honesty ledger, rule_version in
 *     provenance sentence
 *   - Absence pass-through: an inner absent() returns VERBATIM
 *   - Projection selection: non-verdict resultKind ships NO rowset keys
 *   - PRESENTATION: omitting the dial ships the pre-9.80.0 envelope key for
 *     key; 'panel' ships NO `table` key at all and the opposite render law;
 *     the rowset half is identical across modes; an unknown value throws
 *   - Walk cap law: control flow survives, counters truthful
 *   - No store → descriptor present without ref, note names why
 *   - RECORDING MINT (9.79.0): opt-in files the inner chart's own
 *     `{snapshot, events, structure}` beside the walk and the spine carries
 *     `recording_ref`; opt-out says NOTHING about a recording; a refusing
 *     store costs the ref and states the absence; the byte ceiling refuses at
 *     its exact boundary; `redact` means the same for both artifacts;
 *     `origin.toolCallId` is the OUTER call on both
 *   - Declarations (GAP-8) forward verbatim into the Tool
 *   - composedOf drift gate at agent build; defineTool composedOf/gates
 *     asserts; MCP extras round trip
 *   - ctx.tools delivered on the real agent dispatch path
 *   - SPINE PRECEDENCE: a hostile `report` cannot displace a spine or
 *     projection key; every refused field is named in `report_note`
 *   - flowchartAsTool untouched (its own test file pins it byte-identically)
 *
 * Neutralize-proofs: dropping the coverage carry, the walk mint, the
 * projection selection, the spine's `recording_ref`, or the recording's
 * absence sentence turns a named test here red — each is asserted directly on
 * the envelope, not via a proxy.
 */

import { describe, expect, it } from 'vitest';
import { decide, flowChart, type DecideRule, type TypedScope } from 'footprintjs';
import {
  absent,
  Agent,
  bindArtifacts,
  CHART_WALK_ARTIFACT_KIND,
  coverage,
  DEFAULT_RECORDING_MAX_BYTES,
  defineTool,
  inMemoryArtifacts,
  PANEL_RENDER_NOTE,
  projectWalk,
  RECORDING_ARTIFACT_KIND,
  recordingPutInput,
  renderVerdictTable,
  runbookAsTool,
  VERDICT_RENDER_NOTE,
  type ArtifactRef,
  type RunbookEnvelope,
  type Tool,
  type ToolDispatch,
  type ToolExecutionContext,
} from '../../../src/index.js';
import { measureArtifactBytes } from '../../../src/artifacts/payload.js';
import {
  chartRecordingOf,
  mintChartRecording,
  resolveRecordingPolicy,
} from '../../../src/core/runbook/recording.js';
import { admitReport } from '../../../src/core/runbook/report.js';
import { mock } from '../../../src/llm-providers.js';
import { unconfiguredCredentialProvider } from '../../../src/identity.js';
import { readToolExtras, toolExtrasOf } from '../../../src/lib/mcp/toolExtras.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const baseToolCtx: ToolExecutionContext = {
  toolCallId: 'tc-1',
  iteration: 1,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
  artifacts: undefined as never,
  hasArtifacts: false,
  progress: () => {},
} as unknown as ToolExecutionContext;

/** A ctx with a REAL in-memory artifact store bound, so mints land. */
function ctxWithStore(extra: Partial<ToolExecutionContext> = {}): {
  ctx: ToolExecutionContext;
  artifacts: ReturnType<typeof bindArtifacts>;
} {
  const artifacts = bindArtifacts(inMemoryArtifacts(), { conversationId: 'test-run' });
  const ctx = {
    ...baseToolCtx,
    artifacts,
    hasArtifacts: true,
    ...extra,
  } as ToolExecutionContext;
  return { ctx, artifacts };
}

/** A hand-built dispatch over a name → Tool map (the structural seam the
 *  agent's real dispatch also implements). */
function dispatchOver(tools: Record<string, Tool>): ToolDispatch {
  return {
    has: (name) => name in tools,
    call: async (name, args) => {
      const tool = tools[name];
      if (!tool) throw new Error(`no such tool: ${name}`);
      return await tool.execute(args as Record<string, unknown>, baseToolCtx);
    },
  };
}

interface Subject {
  readonly subject: string;
  readonly lastBackupDays: number | null;
}

/** The inner inventory tool — answers with a coverage() ledger AND a carried
 *  provenance stamp, like a production source would. */
const inventoryTool = defineTool<Record<string, unknown>, unknown>({
  name: 'backup_inventory',
  description: 'List backup subjects with their last-backup age.',
  execute: () =>
    coverage(
      {
        af_provenance: { source: 'LOCAL SEED' },
        rows: [
          { subject: 'cluster-a', lastBackupDays: 2 },
          { subject: 'cluster-b', lastBackupDays: 30 },
          { subject: 'cluster-c', lastBackupDays: null },
        ] satisfies Subject[],
      },
      {
        checked: ['the seeded backup inventory, one row per job'],
        cannotCover: [{ what: 'WHY a protection was paused', why: 'no change record collected' }],
      },
    ),
});

interface TriageState {
  subjects: Subject[];
  subject_results?: unknown[];
  verdicts: { subject: string; verdict: string; age: number | null }[];
  coverage?: unknown;
  report?: unknown;
  [key: string]: unknown;
}

const POSTURE_RULES: DecideRule<Record<string, unknown>>[] = [
  {
    when: { age_known: { eq: false } },
    then: 'declined',
    label: 'the age signal is unreadable — no classification',
  },
  {
    when: { age_days: { gt: 7 } },
    then: 'unprotected',
    label: 'last backup older than the 7-day threshold',
  },
];

/** The chart for ONE subject — the decider whose branches speak the verdict
 *  vocabulary, with filter-rule evidence per decision (the NEO shape). */
function subjectChart(subject: Subject, index: number) {
  const land = (verdict: string) => (s: Record<string, unknown>) => {
    s.verdict = verdict;
    s.row = { subject: subject.subject, verdict, age: subject.lastBackupDays };
  };
  return flowChart<Record<string, unknown>>(
    `Read subject ${subject.subject}`,
    (s) => {
      s.age_known = subject.lastBackupDays !== null;
      s.age_days = subject.lastBackupDays ?? -1;
    },
    `subject-${index}`,
  )
    .addDeciderFunction(
      'Protection posture',
      (s: Record<string, unknown>) => decide(s, POSTURE_RULES, 'protected'),
      'posture',
      'Three declared outcomes, first match wins.',
    )
    .addFunctionBranch('declined', 'Declined — signal unreadable', land('declined'))
    .addFunctionBranch('unprotected', 'Unprotected — stale backup', land('unprotected'))
    .addFunctionBranch('protected', 'Protected — inside threshold', land('protected'))
    .end()
    .build();
}

/** The triage-shaped procedure: inner tool call → bounded fan-out with one
 *  decider pass per subject (isolated branch subflows, the NEO shape) →
 *  rowset + coverage + report collected on the root state. */
function triageProcedure(tools: ToolDispatch) {
  return flowChart<TriageState>(
    'backup-protection-triage',
    async (scope) => {
      const inner = (await tools.call('backup_inventory', {})) as {
        result: { rows: Subject[] };
      };
      scope.subjects = inner.result.rows;
    },
    'inventory',
  )
    .addParallelForEach<Subject>('Assess each subject', 'per-subject', {
      items: (scope: TriageState) => scope.subjects ?? [],
      branch: (item, index) => subjectChart(item, index),
      maxBranches: 50,
      into: 'subject_results',
    })
    .addFunction(
      'Collect',
      (scope: TypedScope<TriageState>) => {
        const results = (scope.subject_results ?? []) as {
          row?: { subject: string; verdict: string; age: number | null };
        }[];
        scope.verdicts = results
          .map((result) => result?.row)
          .filter(
            (row): row is { subject: string; verdict: string; age: number | null } =>
              row !== undefined,
          );
        scope.coverage = {
          not_checked: [
            {
              what: 'subjects on uncollected clusters',
              why: 'the fan-out is bounded by construction',
            },
          ],
        };
        scope.report = { stale_after_days: 7, subjects_total: scope.subjects.length };
      },
      'collect',
    )
    .build();
}

function triageTool(overrides: Record<string, unknown> = {}) {
  return runbookAsTool({
    name: 'backup_triage',
    description: 'Assess backup protection posture for every subject.',
    resultKind: 'verdict/backup-posture',
    rules: { name: 'health-signal', version: 'v1' },
    verdicts: { decider: 'Protection posture' },
    composedOf: ['backup_inventory'],
    procedure: triageProcedure,
    ...overrides,
  });
}

async function runTriage(extraCtx: Partial<ToolExecutionContext> = {}) {
  const { ctx, artifacts } = ctxWithStore({
    tools: dispatchOver({ backup_inventory: inventoryTool }),
    ...extraCtx,
  } as Partial<ToolExecutionContext>);
  const tool = triageTool();
  const envelope = (await tool.execute({}, ctx)) as RunbookEnvelope;
  return { envelope, artifacts };
}

// ─── 1. UNIT — definition-time shape ──────────────────────────────

describe('runbookAsTool — unit', () => {
  it('smallest legal call yields a Tool with default schema', () => {
    const tool = runbookAsTool({
      name: 'noop_runbook',
      description: 'noop',
      procedure: () =>
        flowChart<{ done: boolean }>('noop', (s) => void (s.done = true), 'only').build(),
    });
    expect(tool.schema.name).toBe('noop_runbook');
    expect(tool.schema.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('refuses missing name / description / procedure', () => {
    const procedure = () => flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build();
    expect(() => runbookAsTool({ name: '', description: 'd', procedure })).toThrow(/`name`/);
    expect(() => runbookAsTool({ name: 'ok', description: '', procedure })).toThrow(
      /`description`/,
    );
    expect(() =>
      runbookAsTool({ name: 'ok', description: 'd', procedure: undefined as never }),
    ).toThrow(/`procedure`/);
  });

  it('refuses a procedure that returns an unbuilt chart', () => {
    expect(() =>
      runbookAsTool({
        name: 'unbuilt',
        description: 'd',
        procedure: (() => ({})) as never,
      }),
    ).toThrow(/BUILT chart/);
  });

  it('refuses malformed rules / verdicts / walk / keepRecordLimit dials', () => {
    const procedure = () => flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build();
    expect(() =>
      runbookAsTool({ name: 'r', description: 'd', procedure, rules: { name: '', version: 'v1' } }),
    ).toThrow(/`rules`/);
    expect(() =>
      runbookAsTool({ name: 'r', description: 'd', procedure, verdicts: { decider: ' ' } }),
    ).toThrow(/`verdicts.decider`/);
    expect(() =>
      runbookAsTool({ name: 'r', description: 'd', procedure, walk: { cap: 0 } }),
    ).toThrow(/`walk.cap`/);
    expect(() =>
      runbookAsTool({ name: 'r', description: 'd', procedure, keepRecordLimit: 5 }),
    ).toThrow(/keepRecord/);
    expect(() =>
      runbookAsTool({
        name: 'r',
        description: 'd',
        procedure,
        walk: { recording: 'yes' as never },
      }),
    ).toThrow(/`walk.recording`/);
    // An array and `null` are both `typeof 'object'` — refused BY NAME rather
    // than silently resolving to the defaults.
    for (const bad of [[] as never, null as never]) {
      expect(() =>
        runbookAsTool({ name: 'r', description: 'd', procedure, walk: { recording: bad } }),
      ).toThrow(/`walk.recording`/);
    }
    expect(() =>
      runbookAsTool({
        name: 'r',
        description: 'd',
        procedure,
        walk: { recording: { maxBytes: 0 } },
      }),
    ).toThrow(/`walk.recording.maxBytes`/);
  });

  it('recording policy: `undefined`/`false` are OFF; `true` takes the declared ceiling', () => {
    // The off-switch is the whole zero-cost claim — everything the feature
    // does sits behind this returning `undefined`.
    expect(resolveRecordingPolicy(undefined)).toBeUndefined();
    expect(resolveRecordingPolicy(false)).toBeUndefined();
    expect(resolveRecordingPolicy(true)).toEqual({ maxBytes: DEFAULT_RECORDING_MAX_BYTES });
    expect(resolveRecordingPolicy({})).toEqual({ maxBytes: DEFAULT_RECORDING_MAX_BYTES });
    expect(resolveRecordingPolicy({ maxBytes: 10, label: 'nightly' })).toEqual({
      maxBytes: 10,
      label: 'nightly',
    });
    // A declared number, not a magic one.
    expect(DEFAULT_RECORDING_MAX_BYTES).toBe(5_000_000);
  });

  it('report admission is a PARTITION with spread semantics, not assignment', () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": true}, "af_provenance": 1, "keep": 2}',
    ) as Record<string, unknown>;
    const admitted = admitReport(hostile, ['af_provenance', 'rule_version', 'walk']);
    expect(admitted.refused).toEqual(['af_provenance']);
    // Admitted exactly as the spread this replaced would have: `__proto__`
    // stays a DATA key instead of reaching the prototype setter.
    expect(Object.getOwnPropertyNames(admitted.fields).sort()).toEqual(['__proto__', 'keep']);
    expect(Object.getPrototypeOf(admitted.fields)).toBe(Object.prototype);
    // The ledger's name and the note's own key are reserved without being
    // passed in — they are the envelope's, whatever the run assembled.
    const forged = admitReport({ af_coverage: 1, report_note: 2, fine: 3 }, []);
    expect(forged.refused).toEqual(['af_coverage', 'report_note']);
    expect(forged.fields).toEqual({ fine: 3 });
  });

  it('GAP-8: rail-read declarations forward verbatim into the Tool', () => {
    const tool = triageTool({
      resultClass: 'triage',
      owner: { kind: 'custom', id: 'ops' },
      resultCeiling: { maxChars: 50_000 },
      argumentsFrom: ['backup_inventory'],
    });
    expect(tool.resultKind).toBe('verdict/backup-posture');
    expect(tool.resultClass).toBe('triage');
    expect(tool.owner).toEqual({ kind: 'custom', id: 'ops' });
    expect(tool.resultCeiling).toEqual({ maxChars: 50_000 });
    expect(tool.argumentsFrom).toEqual(['backup_inventory']);
    expect(tool.composedOf).toEqual(['backup_inventory']);
  });

  it('inputSchema: explicit wins; a plain contract schema lifts; parseable falls back', () => {
    const jsonSchema = { type: 'object', properties: { cluster: { type: 'string' } } };
    const withContract = runbookAsTool({
      name: 'contracted',
      description: 'd',
      procedure: () => {
        const chart = flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build();
        (chart as { inputSchema?: unknown }).inputSchema = jsonSchema;
        return chart;
      },
    });
    expect(withContract.schema.inputSchema).toEqual(jsonSchema);

    const explicit = { type: 'object', properties: { other: { type: 'number' } } };
    const withExplicit = runbookAsTool({
      name: 'explicit',
      description: 'd',
      inputSchema: explicit,
      procedure: () => {
        const chart = flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build();
        (chart as { inputSchema?: unknown }).inputSchema = jsonSchema;
        return chart;
      },
    });
    expect(withExplicit.schema.inputSchema).toEqual(explicit);

    const withParseable = runbookAsTool({
      name: 'parseable',
      description: 'd',
      procedure: () => {
        const chart = flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build();
        (chart as { inputSchema?: unknown }).inputSchema = { safeParse: () => ({ success: true }) };
        return chart;
      },
    });
    expect(withParseable.schema.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('defineTool: composedOf and gates asserted at definition', () => {
    expect(() =>
      defineTool({ name: 't', description: 'd', composedOf: [], execute: () => 'x' }),
    ).toThrow(/composedOf/);
    expect(() =>
      defineTool({ name: 't', description: 'd', composedOf: ['t'], execute: () => 'x' }),
    ).toThrow(/its own ingredient/);
    expect(() =>
      defineTool({ name: 't', description: 'd', gates: 'yes' as never, execute: () => 'x' }),
    ).toThrow(/`gates`/);
    const ok = defineTool({
      name: 't',
      description: 'd',
      composedOf: ['a', 'b'],
      gates: true,
      execute: () => 'x',
    });
    expect(ok.composedOf).toEqual(['a', 'b']);
    expect(ok.gates).toBe(true);
  });

  it('MCP extras: composedOf and gates travel and are judged on ingest', () => {
    const tool = defineTool({
      name: 'served',
      description: 'd',
      composedOf: ['a'],
      gates: true,
      execute: () => 'x',
    });
    const extras = toolExtrasOf(tool);
    expect(extras).toMatchObject({ composedOf: ['a'], gates: true });
    const readBack = readToolExtras(
      { agentfootprint: { composedOf: ['a'], gates: true } },
      { server: 's', tool: 'served' },
    );
    expect(readBack).toMatchObject({ composedOf: ['a'], gates: true });
    const rejected = readToolExtras(
      { agentfootprint: { composedOf: 'not-a-list', gates: 'yes' } },
      { server: 's', tool: 'served-bad' },
    );
    expect(rejected.composedOf).toBeUndefined();
    expect(rejected.gates).toBeUndefined();
  });
});

// ─── 2. SCENARIO — the triage shape end to end (the acceptance run) ─

describe('runbookAsTool — scenario: the triage-shaped procedure', () => {
  it('SPINE: coverage carried up from the inner ctx.tools call', async () => {
    const { envelope } = await runTriage();
    // NEUTRALIZE-PROOF (coverage carry): these entries exist ONLY because the
    // inner tool's ledger folded upward through the dispatch records.
    const checked = envelope.af_coverage.checked ?? [];
    expect(checked.some((i) => i.what.includes('seeded backup inventory'))).toBe(true);
    const cannot = envelope.af_coverage.cannot_cover ?? [];
    expect(cannot.some((i) => i.what.includes('WHY a protection was paused'))).toBe(true);
    // The chart's OWN declared coverage merged too.
    const notChecked = envelope.af_coverage.not_checked ?? [];
    expect(notChecked.some((i) => i.what.includes('uncollected clusters'))).toBe(true);
  });

  it('SPINE: rule provenance — version in result, name+version in the sentence', async () => {
    const { envelope } = await runTriage();
    expect(envelope.result.rule_version).toBe('v1');
    expect(envelope.af_coverage.sentence).toContain('health-signal v1');
    // Provenance re-emitted FIRST, carrying the inner LOCAL SEED stamp.
    expect(Object.keys(envelope.result)[0]).toBe('af_provenance');
    expect(envelope.result.af_provenance.source).toBe('LOCAL SEED');
    expect(envelope.result.af_provenance.tool).toBe('backup_triage');
  });

  it('WALK: minted as recording/chart-walk, walk_segment full, evidence in the rows', async () => {
    const { envelope, artifacts } = await runTriage();
    const walk = envelope.result.walk;
    // NEUTRALIZE-PROOF (walk mint): the descriptor must carry a real ref of
    // the declared kind, and the artifact must exist in the store.
    expect(walk.ref).toBeDefined();
    expect(walk.kind).toBe(CHART_WALK_ARTIFACT_KIND);
    expect(walk.walk_segment).toBe('full');
    expect(walk.steps_executed).toBeGreaterThan(0);
    const record = await artifacts.get(walk.ref as never);
    expect(record).not.toBeNull();
    expect(record?.meta.kind).toBe(CHART_WALK_ARTIFACT_KIND);
    const rows = JSON.parse(String(record?.data)) as { type: string; text: string }[];
    expect(rows.length).toBe(walk.rows);
    // Decider evidence sentences ride the condition rows.
    const conditions = rows.filter((row) => row.type === 'condition');
    expect(conditions.length).toBeGreaterThan(0);
    expect(conditions.some((row) => row.text.includes('7'))).toBe(true);
  });

  it('PROJECTION: verdict rowset with truthful counters, one-cap table, generated meanings', async () => {
    const { envelope } = await runTriage();
    // NEUTRALIZE-PROOF (projection selection): resultKind 'verdict/*' ships
    // the rowset.
    expect(envelope.result.verdicts).toBeDefined();
    const verdicts = envelope.result.verdicts ?? [];
    expect(verdicts.map((row) => row.verdict).sort()).toEqual([
      'declined',
      'protected',
      'unprotected',
    ]);
    expect(envelope.result.rows_shown).toBe(3);
    expect(envelope.result.rows_total).toBe(3);
    expect(envelope.result.rows_complete).toBe(true);
    expect(envelope.result.table).toContain('cluster-a');
    expect(envelope.result.render_note).toContain('VERBATIM');
    // Meanings GENERATED from evidence rule labels + declared branches.
    const meanings = envelope.result.verdict_meanings ?? {};
    expect(meanings.unprotected).toContain('7-day threshold');
    expect(meanings.declined).toContain('no classification');
  });

  it('THREE OUTCOMES: declined rows land in the ledger as not-checked ground', async () => {
    const { envelope } = await runTriage();
    const notChecked = envelope.af_coverage.not_checked ?? [];
    expect(
      notChecked.some((i) => i.what.includes('NO classification') && i.what.includes('1')),
    ).toBe(true);
    expect(envelope.af_coverage.sentence).toContain('1 declined');
  });

  it('REPORT: the chart-written report bag spreads into result', async () => {
    const { envelope } = await runTriage();
    expect(envelope.result.stale_after_days).toBe(7);
    expect(envelope.result.subjects_total).toBe(3);
    // The clean path pays nothing: no refusal note when nothing collided.
    expect(envelope.result.report_note).toBeUndefined();
  });
});

// ─── 2b. SCENARIO — presentation: who renders the rowset ──────────

/** Run the triage tool with extra declarations, against a real store. */
async function runTriageWith(overrides: Record<string, unknown>): Promise<RunbookEnvelope> {
  const { ctx } = ctxWithStore({
    tools: dispatchOver({ backup_inventory: inventoryTool }),
  } as Partial<ToolExecutionContext>);
  return (await triageTool(overrides).execute({}, ctx)) as RunbookEnvelope;
}

/** The walk's ref is minted fresh per run — everything else is the wire. */
function withoutWalkRef(envelope: RunbookEnvelope): unknown {
  return JSON.parse(
    JSON.stringify(envelope, (key, value) => (key === 'ref' ? '<minted>' : value)),
  ) as unknown;
}

/** The `result` key list the pre-9.80.0 wire shipped, in order. */
const PROSE_RESULT_KEYS = [
  'af_provenance',
  'rule_version',
  'stale_after_days',
  'subjects_total',
  'verdicts',
  'rows_shown',
  'rows_total',
  'rows_complete',
  'table',
  'render_note',
  'verdict_meanings',
  'walk',
];

describe('runbookAsTool — scenario: presentation names who renders the rowset', () => {
  it('DEFAULT: omitting `presentation` ships the pre-9.80.0 envelope, key for key', async () => {
    const envelope = await runTriageWith({});
    // NEUTRALIZE-PROOF (default preservation): the wire's own key list, in
    // order — a projection key added, dropped or reordered turns this red.
    expect(Object.keys(envelope.result)).toEqual(PROSE_RESULT_KEYS);
    expect(envelope.result.render_note).toBe(VERDICT_RENDER_NOTE);
    expect(envelope.result.table).toBe(renderVerdictTable(envelope.result.verdicts ?? []));
    // And the default IS 'prose' — not a third, unnamed behaviour.
    const explicit = await runTriageWith({ presentation: 'prose' });
    expect(withoutWalkRef(explicit)).toEqual(withoutWalkRef(envelope));
  });

  it('PANEL: no `table` KEY at all, and render_note states the opposite law', async () => {
    const envelope = await runTriageWith({ presentation: 'panel' });
    // Absent, not empty: a `table: ''` would still be a table field the model
    // can be told to output.
    expect('table' in envelope.result).toBe(false);
    expect(Object.keys(envelope.result)).not.toContain('table');
    expect(envelope.result.render_note).toBe(PANEL_RENDER_NOTE);
    expect(PANEL_RENDER_NOTE).not.toBe(VERDICT_RENDER_NOTE);
  });

  it('PANEL: the rowset half is identical to prose for the same run', async () => {
    const prose = await runTriageWith({});
    const panel = await runTriageWith({ presentation: 'panel' });
    // The dial says who RENDERS the rows, never which rows there are.
    expect(panel.result.verdicts).toEqual(prose.result.verdicts);
    expect(panel.result.rows_shown).toBe(prose.result.rows_shown);
    expect(panel.result.rows_total).toBe(prose.result.rows_total);
    expect(panel.result.rows_complete).toBe(prose.result.rows_complete);
    expect(panel.result.verdict_meanings).toEqual(prose.result.verdict_meanings);
    expect(panel.af_coverage.sentence).toBe(prose.af_coverage.sentence);
  });

  it('PANEL: `table` stays RESERVED, so a report field cannot put one back', async () => {
    // The mode's promise (no table reaches the model) outranks the freed name.
    const tool = runbookAsTool({
      name: 'panel_report_collision',
      description: 'd',
      resultKind: 'verdict/backup-posture',
      presentation: 'panel',
      procedure: () =>
        flowChart<TriageState>(
          'collide',
          (scope) => {
            scope.verdicts = [{ subject: 'cluster-a', verdict: 'protected', age: 1 }];
            scope.report = { table: '| all | good |' };
          },
          'act',
        ).build(),
    });
    const { ctx } = ctxWithStore();
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
    expect('table' in out.result).toBe(false);
    expect(out.result.report_note).toContain('`table`');
  });

  it('an unknown presentation is REFUSED at definition, never read as prose', () => {
    expect(() => triageTool({ presentation: 'table' })).toThrow(/`presentation`/);
    expect(() => triageTool({ presentation: 'panel ' })).toThrow(/`presentation`/);
    expect(() => triageTool({ presentation: null })).toThrow(/`presentation`/);
  });

  it('PANEL_RENDER_NOTE states the four commitments a panel host needs', () => {
    // The note is the only thing the model reads about the rowset's surface,
    // so its content is the contract — asserted here, not on a literal.
    expect(PANEL_RENDER_NOTE).toMatch(/already/i);
    expect(PANEL_RENDER_NOTE).toMatch(/table/i);
    expect(PANEL_RENDER_NOTE).toMatch(/bullet/i);
    expect(PANEL_RENDER_NOTE).toMatch(/one sentence per row/i);
    expect(PANEL_RENDER_NOTE).toMatch(/VERBATIM/);
    expect(PANEL_RENDER_NOTE).toMatch(/byte-for-byte/i);
  });
});

// ─── 3. SCENARIO — the three outcomes + selection + walk policy ────

describe('runbookAsTool — scenario: outcomes and projections', () => {
  it('ABSENCE PASS-THROUGH: an inner absent() returns verbatim', async () => {
    const emptySource = defineTool({
      name: 'empty_source',
      description: 'finds nothing',
      execute: () =>
        absent({
          what: 'per-job protection rows',
          checked: ['the seeded inventory'],
          tryInstead: 'Call the inventory directly.',
        }),
    });
    const tool = runbookAsTool({
      name: 'triage_over_nothing',
      description: 'd',
      procedure: (tools) =>
        flowChart<{ rows: unknown }>(
          'c',
          async (scope) => {
            scope.rows = await tools.call('empty_source', {});
          },
          'fetch',
        ).build(),
    });
    const { ctx } = ctxWithStore({
      tools: dispatchOver({ empty_source: emptySource }),
    } as Partial<ToolExecutionContext>);
    const out = (await tool.execute({}, ctx)) as Record<string, unknown>;
    expect(out.af_absent).toBe(true);
    expect(out.looked_for).toBe('per-job protection rows');
    expect(out.try_instead).toBe('Call the inventory directly.');
    // NOT wrapped in the envelope — the absence IS the answer.
    expect(out.af_coverage).toBeUndefined();
  });

  it('allowAbsent: a survivable absence reaches the stage raw', async () => {
    const emptySource = defineTool({
      name: 'empty_source',
      description: 'finds nothing',
      execute: () => absent({ what: 'rows', checked: ['the store'] }),
    });
    const tool = runbookAsTool({
      name: 'survives_absence',
      description: 'd',
      procedure: (tools) =>
        flowChart<{ sawAbsence: boolean }>(
          'c',
          async (scope) => {
            const raw = (await tools.call('empty_source', {}, { allowAbsent: true })) as {
              af_absent?: boolean;
            };
            scope.sawAbsence = raw.af_absent === true;
          },
          'fetch',
        ).build(),
    });
    const { ctx } = ctxWithStore({
      tools: dispatchOver({ empty_source: emptySource }),
    } as Partial<ToolExecutionContext>);
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
    expect(out.af_coverage).toBeDefined();
    // The absence's own coverage still folded upward.
    expect((out.af_coverage.checked ?? []).some((i) => i.what === 'the store')).toBe(true);
  });

  it('PROJECTION SELECTION: a non-verdict kind ships the spine and NO rowset keys', async () => {
    const tool = runbookAsTool({
      name: 'action_runbook',
      description: 'd',
      resultKind: 'actions/restart-record',
      procedure: () =>
        flowChart<TriageState>(
          'restart',
          (scope) => {
            // A verdicts state key EXISTS — the projection must still not ship.
            scope.verdicts = [{ subject: 'x', verdict: 'protected', age: 1 }];
            scope.report = { restarted: ['svc-a'] };
          },
          'act',
        ).build(),
    });
    const { ctx } = ctxWithStore();
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
    expect(out.result.verdicts).toBeUndefined();
    expect(out.result.table).toBeUndefined();
    expect(out.result.rows_total).toBeUndefined();
    expect(out.result.restarted).toEqual(['svc-a']);
    expect(out.result.walk.ref).toBeDefined();
    expect(out.result.rule_version).toBe('undeclared');
  });

  it('WALK CAP LAW: control flow survives, counters stay truthful', async () => {
    const tool = runbookAsTool({
      name: 'wide_runbook',
      description: 'd',
      walk: { cap: 20 },
      procedure: () =>
        flowChart<Record<string, unknown>>(
          'wide',
          (s) => {
            for (let i = 0; i < 40; i += 1) s[`key_${i}`] = i;
          },
          'writes',
        )
          .addDeciderFunction(
            'The one decision',
            (s: Record<string, unknown>) =>
              decide(
                s,
                [{ when: { key_1: { gt: 0 } }, then: 'go', label: 'key_1 positive' }],
                'stop',
              ),
            'the-decision',
          )
          .addFunctionBranch('go', 'Go', (s) => void (s.went = true))
          .addFunctionBranch('stop', 'Stop', (s) => void (s.went = false))
          .end()
          .build(),
    });
    const { ctx, artifacts } = ctxWithStore();
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
    const walk = out.result.walk;
    expect(walk.projection).toBe('control-flow');
    expect(walk.complete).toBe(false);
    expect(walk.total).toBeGreaterThan(walk.shown);
    expect(walk.note).toContain('CONTROL-FLOW');
    const record = await artifacts.get(walk.ref as never);
    const rows = JSON.parse(String(record?.data)) as { type: string }[];
    // The head-slice failure mode: writes first, decision last. The
    // projection must keep the decision.
    expect(rows.some((row) => row.type === 'condition')).toBe(true);
    expect(rows.every((row) => row.type !== 'step')).toBe(true);
  });

  it('NO STORE: descriptor present without ref, note names why, answer intact', async () => {
    const tool = triageTool();
    const out = (await tool.execute(
      {},
      { ...baseToolCtx, tools: dispatchOver({ backup_inventory: inventoryTool }) },
    )) as RunbookEnvelope;
    const walk = out.result.walk;
    expect(walk.ref).toBeUndefined();
    expect(walk.note).toContain('No artifact store');
    expect(walk.steps_executed).toBeGreaterThan(0);
    expect(out.result.verdicts).toBeDefined();
  });

  it('NO DISPATCH: a procedure that calls tools refuses teachingly', async () => {
    const tool = triageTool();
    await expect(tool.execute({}, baseToolCtx)).rejects.toThrow(/no dispatch was delivered/);
  });
});

// ─── 3b. SCENARIO — the recording mint, opt-in (9.79.0) ────────────

/** A two-stage procedure with a real decider, so the filed `structure`
 *  carries a graph worth drawing rather than one node. */
function recordedProcedure() {
  return flowChart<Record<string, unknown>>(
    'recorded-procedure',
    (s) => {
      s.age_days = 30;
      s.apiKey = 'secret-bytes';
    },
    'read',
  )
    .addDeciderFunction(
      'Posture',
      (s: Record<string, unknown>) =>
        decide(
          s,
          [{ when: { age_days: { gt: 7 } }, then: 'stale', label: 'over 7 days' }],
          'fresh',
        ),
      'posture',
    )
    .addFunctionBranch('stale', 'Stale', (s) => void (s.report = { verdict: 'stale' }))
    .addFunctionBranch('fresh', 'Fresh', (s) => void (s.report = { verdict: 'fresh' }))
    .end()
    .build();
}

function recordedTool(overrides: Record<string, unknown> = {}) {
  return runbookAsTool({
    name: 'recorded_runbook',
    description: 'A runbook that files its own chart recording.',
    procedure: recordedProcedure,
    ...overrides,
  });
}

describe('runbookAsTool — scenario: the chart recording beside the walk', () => {
  it('OPT-IN: both artifacts minted; the spine ref redeems a real {snapshot, events, structure}', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool({ walk: { recording: true } }).execute(
      {},
      ctx,
    )) as RunbookEnvelope;
    const walk = out.result.walk;

    // NEUTRALIZE-PROOF (the spine carries the ref): drop `recording_ref` from
    // the descriptor in recording.ts and every assertion below dies at the
    // first line — the ref is the ONLY route a consumer has to the parcel.
    expect(walk.recording_ref).toBeDefined();
    expect(walk.recording_kind).toBe(RECORDING_ARTIFACT_KIND);
    // BOTH artifacts, and they are not the same one.
    expect(walk.ref).toBeDefined();
    expect(walk.kind).toBe(CHART_WALK_ARTIFACT_KIND);
    expect(walk.recording_ref).not.toBe(walk.ref);

    // The parcel is REDEEMABLE and carries the three keys a viewer mounts.
    const record = await artifacts.get(walk.recording_ref as ArtifactRef);
    expect(record).not.toBeNull();
    expect(record?.meta.kind).toBe(RECORDING_ARTIFACT_KIND);
    const parcel = JSON.parse(String(record?.data)) as {
      snapshot?: unknown;
      events?: unknown;
      structure?: unknown;
    };
    expect(Object.keys(parcel).sort()).toEqual(['events', 'snapshot', 'structure']);
    expect(parcel.snapshot).toBeDefined();
    expect(parcel.structure).toBeDefined();
    // `structure` is the piece the ROW PROJECTION cannot carry and the only
    // route to a drawable graph — so it must be the chart, with its nodes.
    expect((parcel.structure as { name?: string }).name).toBe('recorded-procedure');
    expect(JSON.stringify(parcel.structure)).toContain('posture');
    // `events` is empty BY CONSTRUCTION: a chart run is not an agent turn.
    expect(parcel.events).toEqual([]);
    // The size is stated, so a consumer can decide before redeeming.
    expect(walk.recording_bytes).toBe(record?.meta.bytes);
    expect(walk.recording_note).toContain('structure');
    // The answer itself is untouched by any of this.
    expect(out.result.verdict).toBe('stale');
  });

  it('OPT-OUT: only the walk is minted, and the descriptor says NOTHING about a recording', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool().execute({}, ctx)) as RunbookEnvelope;
    const walk = out.result.walk;
    expect(walk.ref).toBeDefined();
    // Absent = byte-identical to before the feature: not a note explaining an
    // absence nobody asked about, not an empty string — nothing at all.
    expect(walk.recording_ref).toBeUndefined();
    expect(walk.recording_kind).toBeUndefined();
    expect(walk.recording_bytes).toBeUndefined();
    expect(walk.recording_note).toBeUndefined();
    expect(Object.keys(walk).some((key) => key.startsWith('recording_'))).toBe(false);
    // And no `recording/run` parcel was filed — the walk is the only artifact.
    const listed = await artifacts.list();
    expect(listed.artifacts.map((item) => item.kind)).toEqual([CHART_WALK_ARTIFACT_KIND]);

    // `recording: false` is the same off-switch as absent.
    const off = (await recordedTool({ walk: { recording: false } }).execute(
      {},
      ctxWithStore().ctx,
    )) as RunbookEnvelope;
    expect(Object.keys(off.result.walk).some((key) => key.startsWith('recording_'))).toBe(false);
  });

  it('REFUSING STORE: the answer is intact, the walk still mints, the absence is STATED', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const guarded = {
      ...artifacts,
      put: async (input: Parameters<typeof artifacts.put>[0]) => {
        if (input.kind === RECORDING_ARTIFACT_KIND) throw new Error('the store is full');
        return artifacts.put(input);
      },
    };
    const out = (await recordedTool({ walk: { recording: true } }).execute({}, {
      ...ctx,
      artifacts: guarded,
    } as ToolExecutionContext)) as RunbookEnvelope;
    const walk = out.result.walk;

    // The answer and the walk are untouched — a failed mint costs the REF.
    expect(out.result.verdict).toBe('stale');
    expect(walk.ref).toBeDefined();
    expect(walk.steps_executed).toBeGreaterThan(0);
    expect(walk.recording_ref).toBeUndefined();
    // NEUTRALIZE-PROOF (the absence is stated): make the failed mint silent —
    // return `{}` from the catch in mintChartRecording — and these two lines
    // go red. A missing ref with no sentence is a reader guessing.
    expect(walk.recording_note).toBeDefined();
    expect(walk.recording_note).toContain('the store is full');
    expect(walk.recording_note).toContain('never the answer');
  });

  it('NO STORE: the recording absence names the missing store, and the answer survives', async () => {
    const out = (await recordedTool({ walk: { recording: true } }).execute(
      {},
      baseToolCtx,
    )) as RunbookEnvelope;
    const walk = out.result.walk;
    expect(walk.ref).toBeUndefined();
    expect(walk.recording_ref).toBeUndefined();
    expect(walk.recording_note).toContain('No artifact store');
    expect(out.result.verdict).toBe('stale');
  });

  it('SIZE CEILING: refused at its exact boundary, never truncated, both numbers named', async () => {
    const { ctx } = ctxWithStore();
    const recording = chartRecordingOf({ sharedState: { a: 1 }, commitLog: [] }, { name: 'c' });
    // The bytes the mint will measure: `data` is JSON.stringify(recording),
    // and nothing about the label changes it.
    const bytes = measureArtifactBytes(
      recordingPutInput(recording, { toolCallId: 'tc-1' }).data as string,
    );
    const facts = { toolName: 'sized', toolCallId: 'tc-1' } as const;

    // EQUAL fits — the ceiling is a maximum, not an exclusive bound.
    const atBoundary = await mintChartRecording(ctx, recording, {
      ...facts,
      policy: { maxBytes: bytes },
    });
    expect(atBoundary.recording_ref).toBeDefined();
    expect(atBoundary.recording_bytes).toBe(bytes);

    // ONE BYTE over is refused — and says what it measured, what the ceiling
    // was, and which option raises it.
    const overBoundary = await mintChartRecording(ctx, recording, {
      ...facts,
      policy: { maxBytes: bytes - 1 },
    });
    expect(overBoundary.recording_ref).toBeUndefined();
    expect(overBoundary.recording_bytes).toBe(bytes);
    expect(overBoundary.recording_note).toContain(String(bytes));
    expect(overBoundary.recording_note).toContain(String(bytes - 1));
    expect(overBoundary.recording_note).toContain('walk.recording.maxBytes');
    // Refused, NOT truncated: nothing was filed under a name that would make
    // a partial bundle look like a whole one.
    expect(overBoundary.recording_kind).toBeUndefined();
  });

  it('SIZE CEILING end to end: an unmeetable ceiling costs the ref, never the answer', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool({ walk: { recording: { maxBytes: 1 } } }).execute(
      {},
      ctx,
    )) as RunbookEnvelope;
    const walk = out.result.walk;
    expect(out.result.verdict).toBe('stale');
    expect(walk.ref).toBeDefined();
    expect(walk.recording_ref).toBeUndefined();
    expect(walk.recording_bytes).toBeGreaterThan(1);
    expect(walk.recording_note).toContain('NOT filed');
    // Nothing of kind recording/run reached the store.
    const listed = await artifacts.list();
    expect(listed.artifacts.some((item) => item.kind === RECORDING_ARTIFACT_KIND)).toBe(false);
  });

  it('REDACTION: one policy, the same meaning for the walk AND the recording', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool({
      redact: { keys: ['apiKey'] },
      walk: { recording: true },
    }).execute({}, ctx)) as RunbookEnvelope;
    const walk = out.result.walk;

    // NEUTRALIZE-PROOF (the redacted mirror): swap
    // `executor.getSnapshot({ redact: true })` for the raw `getSnapshot()` in
    // runbookAsTool and this test goes red — the raw snapshot IS the live
    // working memory and carries the secret verbatim.
    const recordingRecord = await artifacts.get(walk.recording_ref as ArtifactRef);
    const recordingText = String(recordingRecord?.data);
    expect(recordingText).not.toContain('secret-bytes');
    // Scrubbed, not stripped: the key is still there, so a reader sees that a
    // value existed and was redacted rather than that nothing was written.
    expect(recordingText).toContain('REDACTED');
    // The walk parcel is clean by the same policy, and so is the envelope.
    const walkRecord = await artifacts.get(walk.ref as ArtifactRef);
    expect(String(walkRecord?.data)).not.toContain('secret-bytes');
    expect(JSON.stringify(out)).not.toContain('secret-bytes');
  });

  it('ORIGIN: both parcels stamp the OUTER tool call, so a consumer can join them', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool({ walk: { recording: true } }).execute(
      {},
      ctx,
    )) as RunbookEnvelope;
    const walk = out.result.walk;
    const recordingMeta = await artifacts.head(walk.recording_ref as ArtifactRef);
    const walkMeta = await artifacts.head(walk.ref as ArtifactRef);
    // 'tc-1' is baseToolCtx.toolCallId — the OUTER call, the id the envelope's
    // own provenance carries.
    expect(recordingMeta?.origin?.toolCallId).toBe('tc-1');
    expect(walkMeta?.origin?.toolCallId).toBe('tc-1');
    expect(recordingMeta?.origin?.toolCallId).toBe(out.result.af_provenance.toolCallId);
    expect(recordingMeta?.label).toBe('recorded_runbook recording');
  });

  it('LABEL: an operator label is used verbatim, never decorated', async () => {
    const { ctx, artifacts } = ctxWithStore();
    const out = (await recordedTool({
      walk: { recording: { label: 'nightly posture sweep' } },
    }).execute({}, ctx)) as RunbookEnvelope;
    const meta = await artifacts.head(out.result.walk.recording_ref as ArtifactRef);
    expect(meta?.label).toBe('nightly posture sweep');
  });
});

// ─── 4. INTEGRATION — the real agent dispatch path ────────────────

describe('runbookAsTool — integration: Agent delivers ctx.tools', () => {
  it('runbook calls its ingredient through the REAL dispatch; envelope is recognized', async () => {
    let innerRan = 0;
    const inner = defineTool({
      name: 'backup_inventory',
      description: 'inventory',
      execute: () => {
        innerRan += 1;
        return coverage(
          { rows: [{ subject: 'cluster-a', lastBackupDays: 2 }] },
          { checked: ['the live inventory'] },
        );
      },
    });
    const runbook = runbookAsTool({
      name: 'backup_triage',
      description: 'triage',
      resultKind: 'verdict/backup-posture',
      composedOf: ['backup_inventory'],
      rules: { name: 'health-signal', version: 'v1' },
      procedure: (tools) =>
        flowChart<TriageState>(
          'triage',
          async (scope) => {
            const result = (await tools.call('backup_inventory', {})) as {
              result: { rows: Subject[] };
            };
            scope.verdicts = result.result.rows.map((row) => ({
              subject: row.subject,
              verdict: 'protected',
              age: row.lastBackupDays,
            }));
          },
          'assess',
        ).build(),
    });

    let calls = 0;
    const provider = mock({
      respond: () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-run', name: 'backup_triage', args: {} }],
          };
        }
        return { content: 'Triage complete.', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .tool(inner)
      .tool(runbook)
      .build();
    const coverageEvents: unknown[] = [];
    agent.on('agentfootprint.tools.coverage_declared', (event) => coverageEvents.push(event));

    const result = await agent.run({ message: 'triage the estate' });
    expect(result).toBe('Triage complete.');
    expect(innerRan).toBe(1);
    // The envelope's af_coverage was recognized at the dispatch boundary —
    // the runbook's honesty rides the same rails as any coverage() tool.
    expect(coverageEvents.length).toBeGreaterThan(0);
  });

  it('the recording is minted on the REAL agent path, stamped with the outer tool call', async () => {
    const store = inMemoryArtifacts();
    const runbook = recordedTool({ walk: { recording: true } });
    let calls = 0;
    const provider = mock({
      respond: () => {
        calls += 1;
        return calls === 1
          ? { content: '', toolCalls: [{ id: 'tc-outer', name: 'recorded_runbook', args: {} }] }
          : { content: 'Done.', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5, artifacts: store })
      .tool(runbook)
      .build();

    const minted: { ref: string; kind: string; origin?: { toolCallId?: string } }[] = [];
    agent.on('agentfootprint.artifacts.minted', (event) =>
      minted.push(event.payload as unknown as (typeof minted)[number]),
    );
    expect(await agent.run({ message: 'run the procedure' })).toBe('Done.');

    // On the real path the FRAMEWORK stamps origin (it discards whatever a
    // caller put there), and it stamps the outer call — the same id either
    // way, which is the point: a consumer joins the parcel to the tool call.
    const recording = minted.find((m) => m.kind === RECORDING_ARTIFACT_KIND);
    const walk = minted.find((m) => m.kind === CHART_WALK_ARTIFACT_KIND);
    expect(recording).toBeDefined();
    expect(walk).toBeDefined();
    expect(recording?.origin?.toolCallId).toBe('tc-outer');
    expect(walk?.origin?.toolCallId).toBe('tc-outer');
  });

  it('composedOf drift gate: unknown ingredient refuses the BUILD by name', () => {
    const runbook = runbookAsTool({
      name: 'orphan_runbook',
      description: 'd',
      composedOf: ['renamed_inventory'],
      procedure: () => flowChart<{ x: number }>('c', (s) => void (s.x = 1), 'a').build(),
    });
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    expect(() => Agent.create({ provider, model: 'mock' }).tool(runbook).build()).toThrow(
      /composedOf ingredient 'renamed_inventory'/,
    );
    // With the ingredient registered, the same agent builds.
    const inventory = defineTool({
      name: 'renamed_inventory',
      description: 'd',
      execute: () => 'rows',
    });
    expect(() =>
      Agent.create({ provider, model: 'mock' }).tool(inventory).tool(runbook).build(),
    ).not.toThrow();
  });
});

// ─── 5. PROPERTY + SECURITY ───────────────────────────────────────

describe('runbookAsTool — properties and security', () => {
  it('fresh chart per call: no state leaks between invocations', async () => {
    let built = 0;
    const tool = runbookAsTool({
      name: 'counter',
      description: 'd',
      procedure: () => {
        built += 1;
        return flowChart<{ n: number }>('c', (s) => void (s.n = 1), 'a').build();
      },
    });
    const { ctx } = ctxWithStore();
    const a = (await tool.execute({}, ctx)) as RunbookEnvelope;
    const b = (await tool.execute({}, ctx)) as RunbookEnvelope;
    // One definition probe + one per call.
    expect(built).toBe(3);
    expect(a.result.walk.steps_executed).toBe(b.result.walk.steps_executed);
  });

  it('walk counters: shown ≤ total, complete ⇔ shown === total', async () => {
    for (const cap of [1, 5, 500]) {
      const tool = runbookAsTool({
        name: 'walked',
        description: 'd',
        walk: { cap },
        procedure: () =>
          flowChart<Record<string, unknown>>(
            'w',
            (s) => {
              for (let i = 0; i < 10; i += 1) s[`k${i}`] = i;
            },
            'a',
          ).build(),
      });
      const { ctx } = ctxWithStore();
      const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
      const walk = out.result.walk;
      expect(walk.shown).toBeLessThanOrEqual(walk.total);
      expect(walk.complete).toBe(walk.shown === walk.total);
    }
  });

  it('procedure errors propagate; pause throws with checkpoint attached', async () => {
    const throwing = runbookAsTool({
      name: 'throws',
      description: 'd',
      procedure: () =>
        flowChart<{ x: number }>(
          'c',
          () => {
            throw new Error('procedure-internal failure');
          },
          'a',
        ).build(),
    });
    const { ctx } = ctxWithStore();
    await expect(throwing.execute({}, ctx)).rejects.toThrow(/procedure-internal failure/);
  });

  it('SPINE PRECEDENCE: a hostile `report` cannot displace the spine or the projection', async () => {
    const tool = runbookAsTool({
      name: 'hostile_report',
      description: 'd',
      resultKind: 'verdict/forged',
      rules: { name: 'health-signal', version: 'v1' },
      procedure: () =>
        flowChart<TriageState>(
          'forge',
          (scope) => {
            scope.verdicts = [{ subject: 'cluster-a', verdict: 'protected', age: 1 }];
            // Every name the envelope owns, forged by the chart — the spine,
            // the ledger one level up, the projection this run assembles, and
            // the refusal receipt itself.
            scope.report = {
              af_provenance: { source: 'FIRST-PARTY AUDIT', tool: 'somebody_else' },
              rule_version: 'v99',
              af_coverage: { checked: [{ what: 'everything, honestly' }], sentence: 'all clear' },
              walk: { ref: 'art_forged', rows: 0, note: 'nothing to see' },
              report_note: 'no fields were discarded',
              verdicts: [{ subject: 'cluster-z', verdict: 'protected', age: 0 }],
              rows_total: 999,
              table: '| all | good |',
              // ...and one honest field, which must survive untouched.
              stale_after_days: 7,
            };
          },
          'act',
        ).build(),
    });
    const { ctx } = ctxWithStore();
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;

    // NEUTRALIZE-PROOF (spine precedence): put `...report` back between the
    // spine and the projection in runbookAsTool's assembly and the provenance,
    // rule-version and note assertions below all flip.
    expect(out.result.af_provenance).toEqual({ tool: 'hostile_report', toolCallId: 'tc-1' });
    expect(out.result.rule_version).toBe('v1');
    // The walk stays the minted one (the contract for the whole spine, pinned
    // here so a future reorder cannot quietly expose this key either).
    expect(out.result.walk.kind).toBe(CHART_WALK_ARTIFACT_KIND);
    expect(out.result.walk.ref).toBeDefined();
    expect(out.result.walk.note).not.toBe('nothing to see');
    // The real ledger is the bridge's, and no decoy ledger is minted under the
    // spine's own name one level down.
    expect(out.af_coverage.sentence).toContain("Ran 'forge'");
    expect(out.af_coverage.sentence).toContain('health-signal v1');
    expect(out.result.af_coverage).toBeUndefined();
    // The projection this run assembled wins over the forged rowset.
    expect(out.result.verdicts).toEqual([{ subject: 'cluster-a', verdict: 'protected', age: 1 }]);
    expect(out.result.rows_total).toBe(1);
    expect(out.result.table).toContain('cluster-a');
    expect(out.result.table).not.toContain('all | good');
    // Discarded, and SAID SO — the note names every refused field, and the
    // chart could not forge the note either.
    const note = out.result.report_note;
    expect(typeof note).toBe('string');
    expect(note).not.toBe('no fields were discarded');
    for (const name of [
      'af_provenance',
      'rule_version',
      'af_coverage',
      'walk',
      'report_note',
      'verdicts',
      'rows_total',
      'table',
    ]) {
      expect(note).toContain(`\`${name}\``);
    }
    // The honest field rides along, verbatim.
    expect(out.result.stale_after_days).toBe(7);
  });

  it('redact: a redacted key never reaches the envelope report or walk values', async () => {
    const tool = runbookAsTool({
      name: 'redacting',
      description: 'd',
      redact: { keys: ['apiKey'] },
      procedure: () =>
        flowChart<{ apiKey: string; report: unknown }>(
          'c',
          (s) => {
            s.apiKey = 'secret-bytes';
            s.report = { touched: true };
          },
          'a',
        ).build(),
    });
    const { ctx } = ctxWithStore();
    const out = (await tool.execute({}, ctx)) as RunbookEnvelope;
    expect(JSON.stringify(out)).not.toContain('secret-bytes');
  });
});

// ─── 6. PERFORMANCE ───────────────────────────────────────────────

describe('runbookAsTool — performance', () => {
  it(
    'walk projection scales linearly with entry count',
    { timeout: 30_000, retry: 2 },
    async () => {
      const entriesOf = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          type: i % 3 === 0 ? 'condition' : 'step',
          text: `entry ${i}`,
          depth: 0,
        }));
      const small = entriesOf(1_000);
      const large = entriesOf(10_000);
      await expectScalesLinearly({
        small: () => void projectWalk(small, 500),
        large: () => void projectWalk(large, 500),
        scale: 10,
        why: 'the walk projection is one filter + one slice — linear in the narrative length',
      });
    },
  );
});

// ─── 7. ROI — the deletion claim ──────────────────────────────────

describe('runbookAsTool — ROI: the envelope the first caller hand-rolled', () => {
  it('one bridge call carries every spine field the hand-rolled tool built itself', async () => {
    const { envelope } = await runTriage();
    // The hand-rolled envelope's load-bearing fields, all present from ONE
    // declaration bag: the ledger, the sentence with rule provenance, the
    // provenance-first result, the rowset with truthful counters, the
    // pre-rendered table with its render law, generated meanings, and the
    // walk descriptor with its counters and segment.
    expect(envelope.af_coverage.note).toBeDefined();
    expect(envelope.af_coverage.sentence).toBeDefined();
    expect(envelope.result.af_provenance).toBeDefined();
    expect(envelope.result.rule_version).toBe('v1');
    expect(envelope.result.verdicts).toBeDefined();
    expect(envelope.result.rows_complete).toBe(true);
    expect(envelope.result.table).toBeDefined();
    expect(envelope.result.render_note).toBeDefined();
    expect(envelope.result.verdict_meanings).toBeDefined();
    expect(envelope.result.walk.walk_segment).toBe('full');
    expect(envelope.result.walk.projection).toBe('full');
  });
});
