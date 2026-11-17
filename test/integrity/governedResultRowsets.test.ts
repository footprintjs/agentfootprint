import type { AgentfootprintEvent } from '../../src/events.js';
/**
 * Behavior-first contract for declared, governed result rowsets.
 *
 * These tests deliberately use only the public doors and a real native Agent.
 * The original hosted baseline exercised structural declarations against the
 * unchanged runtime. Its assertions now use the reviewed public metadata type;
 * recorded baseline failures remain missed checks/refusals, not setup errors.
 *
 * No model, source service, application validator or additional query runs.
 * The bad published row is outside the clean inline preview. Reading that
 * preview instead of the complete current-call publication cannot pass.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  absent,
  allow,
  coverage,
  defineTool,
  deny,
  inMemoryArtifacts,
  withSourceEvidence,
  type ArtifactStore,
  type ToolExecutionContext,
  type ToolResultRowset,
} from '../../src/index.js';
import { recordRun } from '../../src/observe.js';
import { mock } from '../../src/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';

// The behavioral assertions are retained from the hosted failure-first baseline.
type RowsetDeclaration = ToolResultRowset;

const TOOL = 'read_vm_disks';
const CALL = 'native-disks-call';
const KIND = 'dataset/vm-disks';
const identity = { principal: 'fixture-owner', conversationId: 'governed-result-rowsets' };
const columns = { capacity_gb: 'number', is_rdm: 'boolean' } as const;
const clean = [
  { capacity_gb: 0, is_rdm: false },
  { capacity_gb: 8, is_rdm: true },
];
const badTail = [...clean, { capacity_gb: 'PRIVATE-TAIL-CANARY', is_rdm: false }];
const published: RowsetDeclaration = {
  key: 'disks',
  columns,
  source: {
    kind: 'published-dataset',
    refPath: ['result', 'datasets', 'disks', 'ref'],
    artifactKind: KIND,
    maxRows: 1000,
    maxBytes: 1048576,
  },
};
const inline: RowsetDeclaration = {
  key: 'disks',
  columns,
  source: { kind: 'inline', path: ['result', 'disks'] },
};
const boundary = { checked: ['fixture VM disks'], notChecked: [], cannotCover: [] };
const reasons = new Set([
  'rows',
  'empty',
  'declared-absence',
  'unsupported-shape',
  'source-missing',
  'publication-unavailable',
  'publication-changed',
  'wrong-kind',
  'source-over-bound',
  'result-withheld',
  'result-capped',
  'source-aborted',
  'store-unavailable',
]);

interface Settings {
  readonly source?: 'inline' | 'published';
  readonly rows?: readonly unknown[];
  readonly mode?: 'off' | 'warn' | 'enforce';
  readonly declarations?: readonly RowsetDeclaration[];
  readonly legacy?: boolean;
  readonly undeclared?: boolean;
  readonly sourceEvidence?: boolean;
  readonly governed?: 'deny' | 'remove-ref';
  readonly oldPublication?: boolean;
  readonly wrongKind?: boolean;
  readonly redacted?: boolean;
  readonly absent?: boolean;
  readonly placement?: boolean;
}

const payloadOf = (event: AgentfootprintEvent): Record<string, unknown> =>
  event.payload as unknown as Record<string, unknown>;

async function inspect(settings: Settings = {}) {
  const backend = inMemoryArtifacts();
  const reads: string[] = [];
  const store: ArtifactStore = {
    ...backend,
    async get(scope, ref) {
      reads.push(ref);
      return backend.get(scope, ref);
    },
  };
  let oldRef = '';
  if (settings.oldPublication) {
    oldRef = (
      await store.put(identity, {
        kind: KIND,
        mediaType: 'application/json',
        data: badTail,
        digest: 'sha-256',
        origin: { toolCallId: CALL }, // Claimed spelling is not native membership.
      })
    ).meta.ref;
  }
  let sourceCalls = 0;
  let datasetRef = '';
  const modelResults: string[] = [];
  const events: AgentfootprintEvent[] = [];
  const rowsets = settings.declarations ?? [settings.source === 'inline' ? inline : published];
  const options = {
    name: TOOL,
    description: 'Read the disks of a synthetic VM.',
    inputSchema: { type: 'object', properties: {} },
    ...(!settings.undeclared && !settings.legacy && { resultRowsets: rowsets }),
    ...(settings.legacy && { resultColumns: columns }),
    async execute(_args: Record<string, unknown>, context: ToolExecutionContext) {
      sourceCalls++;
      const rows = settings.rows ?? badTail;
      if (settings.absent) return absent({ what: 'fixture disks', ...boundary });
      if (settings.source === 'inline') return coverage({ disks: rows }, boundary);
      const meta = settings.oldPublication
        ? { ref: oldRef }
        : await context.artifacts.put({
            kind: settings.wrongKind ? 'dataset/other' : KIND,
            mediaType: 'application/json',
            data: rows,
            digest: 'sha-256',
          });
      datasetRef = meta.ref;
      return {
        content: coverage(
          { vm: 'fixture-vm', preview: rows.slice(0, 2), datasets: { disks: { ref: meta.ref } } },
          boundary,
        ),
        effects: [],
        status: 'partial' as const,
      };
    },
  };
  const tool = defineTool(options);
  const declaredTool = settings.sourceEvidence
    ? withSourceEvidence(tool, {
        datasets: [
          {
            key: 'disks',
            refPath: ['result', 'datasets', 'disks', 'ref'],
            kind: KIND,
            fields: { capacity_gb: ['capacity_gb'], is_rdm: ['is_rdm'] },
            maxRows: 1000,
            maxBytes: 1048576,
          },
        ],
        describe(_served, sources) {
          const disks = sources.disks;
          return disks
            ? [
                {
                  subject: { kind: 'vm', value: 'fixture-vm' },
                  operation: 'disks',
                  scope: {},
                  datasets: [
                    {
                      key: 'disks',
                      ref: disks.ref,
                      kind: KIND,
                      fields: { capacity_gb: ['capacity_gb'], is_rdm: ['is_rdm'] },
                    },
                  ],
                },
              ]
            : [];
        },
      })
    : tool;
  const provider = mock({
    respond(request) {
      const last = request.messages.at(-1);
      if (last?.role === 'tool') {
        modelResults.push(last.content);
        return 'Fixture checked.';
      }
      return { toolCalls: [{ id: CALL, name: TOOL, args: {} }] };
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 3,
    ...(settings.mode !== undefined && { checkColumnTypes: settings.mode }),
    artifacts: settings.placement ? { store, placement: { maxInlineChars: 1 } } : store,
    ...(settings.redacted && { redact: conversationRedaction({ keys: ['capacity_gb'] }) }),
  }).tool(declaredTool);
  if (settings.sourceEvidence) builder.sourceEvidence({ admit: (candidate) => candidate });
  if (settings.governed)
    builder.toolMiddleware({
      name: 'fixture-delivery-governance',
      onToolResult: () =>
        settings.governed === 'deny'
          ? deny('Fixture source was withheld.')
          : allow({ preview: clean }, 'Only the clean preview is permitted.'),
    });
  const agent = builder.build();
  agent.on('*', (event) => events.push(event));
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message: 'Read fixture disks.', identity });
    const rowsetChecks = events
      .filter((event) => String(event.type) === 'agentfootprint.tools.rowset_checked')
      .map(payloadOf);
    for (const check of rowsetChecks) {
      expect(typeof check.reason).toBe('string');
      expect(reasons.has(String(check.reason))).toBe(true);
    }
    return {
      answer,
      sourceCalls,
      datasetRef,
      reads,
      modelResults,
      events,
      rowsetChecks,
      findings: events
        .filter((event) => event.type === 'agentfootprint.integrity.context_error')
        .map(payloadOf),
      dispositions: events
        .filter((event) => event.type === 'agentfootprint.integrity.disposition')
        .flatMap((event) => (payloadOf(event).rows ?? []) as Record<string, unknown>[]),
      ends: events
        .filter((event) => event.type === 'agentfootprint.stream.tool_end')
        .map(payloadOf),
      sourceRefs: agent.checkpoint()?.sourceEvidence?.refs ?? [],
      recorded: JSON.stringify({
        recording: recorder.toRecording(),
        narrative: agent.getLastNarrativeEntries(),
      }),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

const mismatch = (result: Awaited<ReturnType<typeof inspect>>) =>
  result.findings.filter((finding) => finding.kind === 'column-type-mismatch');
const noCheckedPass = (result: Awaited<ReturnType<typeof inspect>>) =>
  expect(result.rowsetChecks.some((check) => check.disposition === 'checked-pass')).toBe(false);
function notApplicable(result: Awaited<ReturnType<typeof inspect>>) {
  for (const check of ['column-type-mismatch', 'missing-column']) {
    const row = result.dispositions.find((item) => item.check === check);
    expect(row).toMatchObject({
      checked: 0,
      findings: 0,
      unreachable: 0,
    });
    expect(row?.notApplicable).toBeGreaterThanOrEqual(1);
  }
}

describe('baseline control: legacy bare-array declaration does not read a wrapper or ticket', () => {
  it.each(['inline', 'published'] as const)('honestly skips a %s wrapper', async (source) => {
    const result = await inspect({ source, legacy: true, mode: 'warn' });
    expect(result.sourceCalls).toBe(1);
    expect(mismatch(result)).toEqual([]);
    expect(result.reads).toEqual([]);
    expect(result.rowsetChecks).toEqual([]);
    notApplicable(result);
  });
});

describe('regression: judge the explicitly declared final rowset', () => {
  it('reads the declared inline path through a coverage wrapper', async () => {
    const result = await inspect({ source: 'inline', mode: 'warn' });
    expect(mismatch(result)).toMatchObject([{ predicate: 'capacity_gb', rowset: 'disks' }]);
    expect(result.rowsetChecks).toMatchObject([
      { rowset: 'disks', source: 'inline', disposition: 'checked-fail', delivery: 'unchanged' },
    ]);
    expect(result.reads).toEqual([]);
  });

  it('finds a bad type after the clean preview in one current-call published dataset', async () => {
    const result = await inspect({ mode: 'warn' });
    expect(result.sourceCalls).toBe(1);
    expect(mismatch(result)).toMatchObject([{ predicate: 'capacity_gb', rowset: 'disks' }]);
    expect(result.reads.filter((ref) => ref === result.datasetRef)).toHaveLength(1);
    expect(result.rowsetChecks).toMatchObject([
      {
        toolCallId: CALL,
        rowset: 'disks',
        source: 'published-dataset',
        disposition: 'checked-fail',
        delivery: 'unchanged',
      },
    ]);
    expect(result.modelResults[0]).not.toContain('PRIVATE-TAIL-CANARY');
    expect(result.ends[0]?.status).toBe('partial');
    expect(result.sourceRefs).toEqual([]); // Checking creates no historical source index.
  });

  it('enforce replaces a broken full dataset with invalid teaching, without another query', async () => {
    const result = await inspect({ mode: 'enforce' });
    expect(result.modelResults[0]).toMatch(/^Result rejected:/);
    expect(result.modelResults[0]).toContain('No data was returned.');
    expect(result.modelResults[0]).not.toContain(result.datasetRef);
    expect(result.ends[0]?.status).toBe('invalid');
    expect(result.rowsetChecks[0]?.delivery).toBe('refused');
    expect(result.sourceCalls).toBe(1);
  });

  it('zero and false are valid values; checking a produced partial dataset does not claim completeness', async () => {
    const result = await inspect({ rows: clean, mode: 'enforce' });
    expect(mismatch(result)).toEqual([]);
    expect(result.rowsetChecks).toMatchObject([
      { rowset: 'disks', disposition: 'checked-pass', delivery: 'unchanged' },
    ]);
    expect(result.ends[0]?.status).toBe('partial');
  });

  it('keeps same-column findings distinct for named rowsets with delimiter-like keys', async () => {
    const keys = ['disks:a|b', 'disks:a%7Cb'];
    const result = await inspect({
      source: 'inline',
      mode: 'warn',
      declarations: keys.map((key) => ({ ...inline, key })),
    });
    expect(mismatch(result).map((finding) => finding.rowset)).toEqual(keys);
    expect(result.rowsetChecks.map((check) => check.rowset)).toEqual(keys);
    const row = result.dispositions.find((item) => item.check === 'column-type-mismatch');
    expect(row).toMatchObject({ checked: 2, findings: 2 });
  });

  it('separates ambiguous column/rowset joins instead of treating the delimiter as structure', async () => {
    const result = await inspect({
      source: 'inline',
      mode: 'warn',
      rows: [{ 'capacity_gb|left': 'wrong', capacity_gb: 'wrong' }],
      declarations: [
        { ...inline, key: 'right', columns: { 'capacity_gb|left': 'number' } },
        { ...inline, key: 'left|right', columns: { capacity_gb: 'number' } },
      ],
    });
    expect(mismatch(result).map(({ predicate, rowset }) => [predicate, rowset])).toEqual([
      ['capacity_gb|left', 'right'],
      ['capacity_gb', 'left|right'],
    ]);
  });

  it.each([{ rows: [] }, { absent: true }])(
    'keeps known absence not-applicable (%j)',
    async (item) => {
      const result = await inspect({ ...item, mode: 'enforce' });
      expect(result.findings).toEqual([]);
      expect(result.rowsetChecks[0]?.disposition).toBe('not-applicable');
      expect(result.ends[0]?.status).not.toBe('invalid');
      noCheckedPass(result);
      notApplicable(result);
    },
  );
});

describe('admission: unavailable is explicit and never a clean subset', () => {
  it.each([
    { oldPublication: true },
    { wrongKind: true },
    { governed: 'remove-ref' as const },
    { governed: 'deny' as const },
    { placement: true },
    {
      declarations: [
        { ...published, source: { ...published.source, maxRows: 2 } },
      ] as readonly RowsetDeclaration[],
    },
  ])('warn preserves native governance and records unavailable (%j)', async (item) => {
    const result = await inspect({ ...item, mode: 'warn' });
    expect(mismatch(result)).toEqual([]);
    expect(result.rowsetChecks).toMatchObject([
      { rowset: 'disks', disposition: 'unavailable', delivery: 'unchanged' },
    ]);
    expect(result.modelResults[0]).not.toMatch(/^Result rejected:/);
    noCheckedPass(result);
    notApplicable(result);
    if ('oldPublication' in item || 'governed' in item || 'wrongKind' in item)
      expect(result.reads).toEqual([]);
  });

  it('enforce refuses an unavailable promised source using fixed text without a fabricated type finding', async () => {
    const result = await inspect({ oldPublication: true, mode: 'enforce' });
    expect(result.findings).toEqual([]);
    expect(result.modelResults[0]).toMatch(/^Result rejected:/);
    expect(result.modelResults[0]).toContain('No data was returned.');
    expect(result.modelResults[0]).not.toContain('PRIVATE-TAIL-CANARY');
    expect(result.ends[0]?.status).toBe('invalid');
    expect(result.rowsetChecks).toMatchObject([
      { disposition: 'unavailable', delivery: 'refused' },
    ]);
    expect(result.reads).toEqual([]);
    notApplicable(result);
  });

  it('availability events contain only coordinates, static declaration names and finite verdicts', async () => {
    const result = await inspect({ mode: 'warn' });
    expect(result.rowsetChecks).toHaveLength(1);
    const allowed = new Set([
      'toolName',
      'toolCallId',
      'iteration',
      'rowset',
      'source',
      'disposition',
      'reason',
      'delivery',
    ]);
    for (const key of Object.keys(result.rowsetChecks[0]!)) expect(allowed.has(key)).toBe(true);
    expect(JSON.stringify(result.rowsetChecks)).not.toContain('PRIVATE-TAIL-CANARY');
    expect(result.rowsetChecks[0]).not.toHaveProperty('rows');
    expect(result.rowsetChecks[0]).not.toHaveProperty('sample');
    expect(result.rowsetChecks[0]).not.toHaveProperty('bytes');
  });

  it('record redaction masks retained content while the authorized backend check still enforces', async () => {
    const result = await inspect({ mode: 'enforce', redacted: true });
    expect(result.reads.filter((ref) => ref === result.datasetRef)).toHaveLength(1);
    expect(result.modelResults[0]).toMatch(/^Result rejected:/);
    expect(result.ends[0]?.status).toBe('invalid');
    expect(result.recorded).not.toContain('PRIVATE-TAIL-CANARY');
    expect(JSON.stringify(result.events)).not.toContain('PRIVATE-TAIL-CANARY');
  });
});

describe('off and existing native source retention remain separate', () => {
  it.each([undefined, 'off'] as const)(
    'the %s dial does no reads or new checking',
    async (mode) => {
      const declared = await inspect({ mode });
      const undeclared = await inspect({ mode, undeclared: true });
      expect(declared.reads).toEqual([]);
      expect(declared.rowsetChecks).toEqual([]);
      expect(declared.findings).toEqual([]);
      expect(declared.dispositions).toEqual(undeclared.dispositions);
      expect(declared.modelResults[0]?.replace(/art_[a-zA-Z0-9_-]+/g, '<REF>')).toBe(
        undeclared.modelResults[0]?.replace(/art_[a-zA-Z0-9_-]+/g, '<REF>'),
      );
    },
  );

  it('column checking and SourceEvidence both consume one current-call publication finalization', async () => {
    const result = await inspect({ rows: clean, mode: 'warn', sourceEvidence: true });
    expect(result.rowsetChecks[0]?.disposition).toBe('checked-pass');
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.sourceCalls).toBe(1);
    // Each native reader may inspect its own declared fields; neither steals
    // the destructive publication receipt or invokes the producer again.
  });
});

describe('definition refuses ambiguous contracts before execution', () => {
  it('rejects simultaneous legacy resultColumns and new resultRowsets', () => {
    const ambiguous = {
      name: TOOL,
      description: 'Ambiguous fixture declaration.',
      resultColumns: columns,
      resultRowsets: [inline],
      execute: () => clean,
    };
    expect(() => defineTool(ambiguous)).toThrow(
      /resultColumns.*resultRowsets|resultRowsets.*resultColumns/,
    );
  });

  it('rejects duplicate named rowsets instead of silently merging identity', () => {
    const duplicate = {
      name: TOOL,
      description: 'Duplicate fixture declaration.',
      resultRowsets: [inline, inline],
      execute: () => clean,
    };
    expect(() => defineTool(duplicate)).toThrow(/rowset/i);
  });
});
