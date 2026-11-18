/** Native inner-run observation dials change retained views, never business state or privacy. */
import { describe, expect, it } from 'vitest';
import { flowChart, type RedactionPolicy, type RunDials } from 'footprintjs';
import { stateAt } from 'foottrace';
import { Agent, flowchartAsTool, runbookAsTool, type LLMRequest } from '../../src/index.js';
import { innerRunsOf } from '../../src/observe.js';
import { mock } from '../../src/llm-providers.js';
import { conversationRedaction } from '../../src/doors/security.js';

const ROWS = [
  { subject: 'item-17', verdict: 'healthy' },
  { subject: 'item-29', verdict: 'healthy' },
];
const SECRET = 'private-inner-value-7093';
const SUMMARY = { readTracking: 'summary', writeTracking: 'summary' } as const;
type Kind = 'flowchart' | 'runbook';
type Dials = Pick<RunDials, 'readTracking' | 'writeTracking' | 'commitValues' | 'writeProvenance'>;
type NodeView = {
  stageReads?: Record<string, unknown>;
  stageWrites?: Record<string, unknown>;
  next?: NodeView;
};
type Snapshot = {
  sharedState: Record<string, unknown>;
  executionTree: NodeView;
  commitLog: unknown[];
  commitValues: string;
  writeProvenance: string;
  subflowResults?: Record<
    string,
    {
      treeContext: {
        globalContext: Record<string, unknown>;
        history: unknown[];
        initialState: unknown;
        stageContexts: NodeView;
      };
    }
  >;
};

async function observe(
  kind: Kind,
  observability?: Dials,
  callerRedact?: RedactionPolicy,
  options: { nested?: boolean; ownMarks?: boolean; afterDefine?: () => void } = {},
) {
  let executed = 0;
  const builder = flowChart<Record<string, unknown>>(
    'Seed public and private state',
    (scope) => {
      scope.rows = ROWS;
      if (options.ownMarks) {
        scope.$setValue('apiKey', SECRET, true);
        scope.$setValue('privateRecord', { value: SECRET }, true);
      } else scope.apiKey = SECRET;
      scope.verdicts = ROWS;
    },
    'seed',
  );
  if (options.nested)
    builder.addParallelForEach('Visit each public subject', 'subjects', {
      items: () => ROWS,
      branch: (row) =>
        flowChart<Record<string, unknown>>(
          'Seed one subject',
          (scope) => {
            scope.subject = row.subject;
            scope.rows = [row];
          },
          'subject-seed',
        )
          .addFunction(
            'Read one subject',
            (scope) => {
              scope.count = (scope.rows as typeof ROWS).length;
              return { subject: row.subject, count: 1 };
            },
            'subject-read',
          )
          .build(),
      maxBranches: 2,
      into: 'subject_results',
    });
  const chart = builder
    .addFunction(
      'Read and derive',
      (scope) => {
        const rows = scope.rows as typeof ROWS;
        scope.count = rows.length;
        scope.usedSecret = (scope.apiKey as string).length;
        if (options.ownMarks) scope.privateCopy = scope.privateRecord;
        scope.report = { count: rows.length };
        executed++;
      },
      'derive',
    )
    .build();
  const base = {
    name: `observe_${kind}`,
    description: 'Observe the declared inner run.',
    keepRecord: true,
    ...(observability !== undefined && { observability }),
  };
  const tool =
    kind === 'flowchart'
      ? flowchartAsTool({ ...base, flowchart: chart })
      : runbookAsTool({ ...base, resultKind: 'verdict/observed', procedure: () => chart });
  options.afterDefine?.();
  const requests: LLMRequest[] = [];
  const agent = Agent.create({
    provider: mock({
      respond(request) {
        requests.push(request);
        return requests.length === 1
          ? { content: '', toolCalls: [{ id: 'observed-call', name: tool.schema.name, args: {} }] }
          : { content: 'The declared procedure completed.', toolCalls: [] };
      },
    }),
    model: 'mock',
    maxIterations: 3,
    redact: callerRedact,
  })
    .tool(tool)
    .build();
  await agent.run({ message: 'Run the procedure.' });
  const message = requests
    .flatMap((request) => request.messages)
    .find((entry) => entry.role === 'tool' && entry.toolName === tool.schema.name);
  expect(
    message,
    'the actual next provider request must carry the executed tool result',
  ).toBeDefined();
  const record = innerRunsOf(tool)?.get('observed-call');
  expect(record?.outcome).toBe('ok');
  expect(record?.problem).toBeUndefined();
  expect(executed).toBe(1);
  return { snapshot: record!.recording!.snapshot as Snapshot, requests, content: message!.content };
}

describe.each(['flowchart', 'runbook'] as const)('%s native inner observability', (kind) => {
  it('summary reads and writes retain markers while full commits replay the actual state', async () => {
    const { snapshot, content } = await observe(kind, SUMMARY);
    expect(snapshot.executionTree.next?.stageReads?.rows).toMatchObject({
      __readSummary: true,
      type: 'array',
      size: 2,
    });
    expect(snapshot.executionTree.stageWrites?.rows).toMatchObject({
      __writeSummary: true,
      type: 'array',
      size: 2,
    });
    expect(snapshot.commitValues).toBe('full');
    expect(snapshot.writeProvenance).toBe('off');
    expect(snapshot.sharedState).toMatchObject({ rows: ROWS, count: 2 });
    expect(snapshot.commitLog.length).toBeGreaterThan(0);
    expect(stateAt(snapshot as never, snapshot.commitLog.length - 1).state).toMatchObject({
      rows: ROWS,
      count: 2,
    });
    expect(JSON.parse(content)).toMatchObject(
      kind === 'flowchart' ? { count: 2 } : { result: { count: 2, rows_total: 2 } },
    );
  });

  it('omitted and empty options preserve the native full-view defaults', async () => {
    for (const option of [undefined, {}]) {
      const { snapshot } = await observe(kind, option);
      expect(snapshot.executionTree.next?.stageReads?.rows).toEqual(ROWS);
      expect(snapshot.executionTree.stageWrites?.rows).toEqual(ROWS);
      expect(snapshot.commitValues).toBe('full');
      expect(snapshot.writeProvenance).toBe('off');
    }
  });

  it('caller privacy still masks records and provider bytes under summary observation', async () => {
    const { snapshot, requests, content } = await observe(kind, SUMMARY, { keys: ['apiKey'] });
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    expect(JSON.stringify(requests)).not.toContain(SECRET);
    expect(content).not.toContain(SECRET);
    expect(snapshot.sharedState.apiKey).toBe('REDACTED');
    expect(snapshot.executionTree.next?.stageReads?.apiKey).toBe('[REDACTED]');
    expect(snapshot.executionTree.stageWrites?.apiKey).toBe('[REDACTED]');
    expect(snapshot.sharedState.usedSecret).toBe(SECRET.length);
  });

  it('explicit delta encoding and read-prefix provenance are forwarded natively', async () => {
    const { snapshot } = await observe(kind, {
      commitValues: 'delta',
      writeProvenance: 'reads-prefix',
    });
    expect(snapshot.commitValues).toBe('delta');
    expect(snapshot.writeProvenance).toBe('reads-prefix');
    expect(stateAt(snapshot as never, snapshot.commitLog.length - 1).state).toMatchObject({
      count: 2,
      rows: ROWS,
    });
    expect(snapshot.commitLog.some((entry) => JSON.stringify(entry).includes('readKeys'))).toBe(
      true,
    );
  });

  it('nested fan-out keeps summary views and full child commits with actual subject identities', async () => {
    const { snapshot } = await observe(kind, SUMMARY, undefined, { nested: true });
    const branches = new Map(
      Object.values(snapshot.subflowResults ?? {}).map((entry) => [
        entry.treeContext.globalContext.subject,
        entry.treeContext,
      ]),
    );
    expect([...branches.keys()].sort()).toEqual(ROWS.map((row) => row.subject).sort());
    for (const row of ROWS) {
      const child = branches.get(row.subject)!;
      expect(child.stageContexts.stageWrites?.rows).toMatchObject({
        __writeSummary: true,
        type: 'array',
        size: 1,
      });
      expect(child.stageContexts.next?.stageReads?.rows).toMatchObject({
        __readSummary: true,
        type: 'array',
        size: 1,
      });
      expect(child.history.length).toBeGreaterThan(0);
      const replay = stateAt(
        { initialState: child.initialState, commitLog: child.history } as never,
        child.history.length - 1,
      );
      expect(replay.state).toMatchObject({ subject: row.subject, rows: [row], count: 1 });
    }
  });

  it('copies authored settings at definition rather than retaining a mutable option alias', async () => {
    const settings: Dials = { ...SUMMARY };
    const { snapshot } = await observe(kind, settings, undefined, {
      afterDefine() {
        settings.readTracking = 'off';
        settings.writeTracking = 'off';
      },
    });
    expect(snapshot.executionTree.next?.stageReads?.rows).toMatchObject({ __readSummary: true });
    expect(snapshot.executionTree.stageWrites?.rows).toMatchObject({ __writeSummary: true });
  });

  it('preserves the internal caller-policy watcher and chart-owned identity marks', async () => {
    const { snapshot, requests } = await observe(kind, SUMMARY, conversationRedaction(), {
      ownMarks: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    expect(JSON.stringify(requests)).not.toContain(SECRET);
    expect(snapshot.sharedState.apiKey).toBe('REDACTED');
    expect(snapshot.sharedState.privateRecord).toBe('REDACTED');
    expect(snapshot.sharedState.privateCopy).toBe('REDACTED');
    expect(snapshot.sharedState.usedSecret).toBe(SECRET.length);
  });
});
