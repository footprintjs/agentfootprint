/** 101 — recorded cause and impact, then a cited mock summary.
 * Run: npm run example examples/features/101-recorded-cause-and-impact.ts
 * Synthetic evidence only. No network, model API, payment or business rerun. */
import type { Attention, CommitBundle } from 'foottrace';
import { createRecordGraph, type CauseResult, type RecordScope } from 'foottrace/cause';
import {
  callTraceTool,
  traceDebugAgent,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/101-recorded-cause-and-impact',
  title: 'Recorded cause and impact — proof before a mock summary',
  group: 'features',
  description:
    'Read an authorized synthetic record with public cause tools; keep ties and capture gaps uncertain, then cite the returned proof in a mock debugger answer.',
  defaultInput: 'What recorded dependency explains this shipping decision, and what did it affect?',
  providerSlots: [],
  tags: ['feature', 'trace', 'debugging', 'evidence', 'mock'],
};

function commit(index: number, stage: string, key: string, reads: string[]): CommitBundle {
  return {
    idx: index,
    stage,
    stageId: stage,
    runtimeStageId: `${stage}#${index + 1}`,
    trace: [{ path: key, verb: 'set', readKeys: reads }],
    overwrite: { [key]: 'synthetic' },
    updates: {},
    redactedPaths: [],
  };
}

/** This fixture author, not an absence of errors, attests the complete capture. */
function authorizedFixture(name: string, tied = false, complete = true) {
  // #region authorized-record
  const address = { logRunId: `synthetic:${name}`, drillPath: [] };
  const timeout: Attention = {
    kind: 'timeout',
    reason: 'TIMEOUT_RECORDED',
    evidence: ['proof:synthetic-timeout-attempt'],
  };
  const scope: RecordScope = {
    address,
    commitLog: [
      commit(0, 'quote', 'quote', []),
      commit(1, 'stock', 'stock', []),
      commit(2, 'choose', 'decision', tied ? ['quote', 'stock'] : ['quote']),
      commit(3, 'prepare', 'preparation', ['decision']),
    ],
    reads: {
      'quote#1': [],
      'stock#2': [],
      'choose#3': tied ? ['quote', 'stock'] : ['quote'],
      'prepare#4': ['decision'],
    },
    controlDeps: {}, // Captured and checked: no control edges in this fixture.
    attention: {
      'quote#1': [timeout],
      ...(tied
        ? {
            'stock#2': [
              {
                kind: 'error',
                reason: 'ERROR_RECORDED',
                evidence: ['proof:synthetic-stock-error'],
              } as Attention,
            ],
          }
        : {}),
    },
    complete, // A host must verify capture coverage and the end marker before setting true.
  };
  const graph = createRecordGraph([scope]); // Public reader; no application walker.
  const target = graph.nodeId(address, {
    runtimeStageId: 'choose#3',
    commitIdx: 2,
    key: 'decision',
  });
  const root = graph.nodeId(address, { runtimeStageId: 'quote#1', commitIdx: 0, key: 'quote' });
  const affected = graph.nodeId(address, {
    runtimeStageId: 'prepare#4',
    commitIdx: 3,
    key: 'preparation',
  });
  const artifacts: TraceToolpackArtifacts = {
    // This empty snapshot is just the toolpack shell; the explicit authorized
    // graph below is the synthetic source of this example's cause evidence.
    snapshot: {
      runId: `synthetic-shell:${name}`,
      commitLog: [],
      executionTree: { id: 'synthetic-shell', logs: {}, errors: {}, metrics: {}, evals: {} },
      sharedState: {},
      commitValues: 'full',
      writeProvenance: 'reads-prefix',
    },
    cause: { graph, nodeIds: [root] }, // A preauthorized capability, never a model-supplied location.
  };
  // #endregion authorized-record
  return { artifacts, target, root, affected };
}

interface ToolFinding<T> {
  readonly finding: T;
}

export async function run(input: string | null = meta.defaultInput) {
  const fixture = authorizedFixture('supported');
  // #region recorded-questions
  const tools = traceToolpack(fixture.artifacts, {
    cause: { maxNodes: 25, maxEdges: 100, maxCalls: 100, timeoutMs: 1000 },
  });
  const root = JSON.parse(
    await callTraceTool(tools, 'root_cause', { nodeId: fixture.target }),
  ) as ToolFinding<CauseResult>;
  const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId: fixture.target }));
  const tied = authorizedFixture('tied', true);
  const alternatives = JSON.parse(
    await callTraceTool(traceToolpack(tied.artifacts), 'root_cause', { nodeId: tied.target }),
  ) as ToolFinding<CauseResult>;
  const unfinished = authorizedFixture('missing-end-marker', false, false);
  const gap = JSON.parse(
    await callTraceTool(traceToolpack(unfinished.artifacts), 'root_cause', {
      nodeId: unfinished.target,
    }),
  ) as ToolFinding<CauseResult>;
  // #endregion recorded-questions
  if (root.finding.rootCause !== fixture.root || !impact.finding.nodes.includes(fixture.affected))
    throw new Error('Expected the synthetic recorded root and downstream write.');
  if (
    alternatives.finding.rootCause !== undefined ||
    alternatives.finding.alternatives.length !== 2
  )
    throw new Error('A tied finding must retain both alternatives without selecting a root.');
  if (
    gap.finding.rootCause !== undefined ||
    !gap.finding.gaps.some((item) => item.code === 'not-collected')
  )
    throw new Error('Missing capture must stay incomplete rather than asserting a root.');

  // #region mock-summary
  const plan = [
    { name: 'attention_list', args: { nodeIds: [fixture.root] } },
    { name: 'root_cause', args: { nodeId: fixture.target } },
    { name: 'impact', args: { nodeId: fixture.target } },
  ];
  let next = 0;
  let citedProof: string | undefined;
  const provider = mock({
    respond: (request) => {
      const step = plan[next++];
      if (step !== undefined) return { toolCalls: [{ id: `read-${next}`, ...step }] };
      // The mock reads the ACTUAL tool results; it does not invent a proof ID.
      const results = request.messages
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content));
      const finding = results.find((result) => result.tool === 'root_cause').finding as CauseResult;
      const downstream = results.find((result) => result.tool === 'impact').finding
        .nodes as string[];
      citedProof = results.find((result) => result.tool === 'attention_list').finding.nodes[0]
        .attention[0].evidence[0];
      return (
        `The unique recorded dependency root is ${finding.rootCause}. Proof: ${citedProof}. ` +
        `The recorded path is ${finding.path.join(' -> ')}. ` +
        `The recorded downstream write is ${downstream.join(', ')}. ` +
        'This does not establish why a provider timed out internally.'
      );
    },
  });
  const debuggerAgent = traceDebugAgent({
    artifacts: fixture.artifacts,
    provider,
    model: 'mock',
    maxIterations: 5,
  });
  const result = await debuggerAgent.run({ message: input ?? meta.defaultInput! });
  if (typeof result !== 'string') throw new Error('The mock debugger must finish without pausing.');
  const summary = result;
  // This is a demo assertion for a scripted mock, not general prose validation.
  if (
    citedProof === undefined ||
    !summary.includes(citedProof) ||
    !summary.includes(fixture.root) ||
    !summary.includes(fixture.affected)
  )
    throw new Error('The mock summary must cite the returned node and proof.');
  // #endregion mock-summary
  return {
    root: root.finding,
    impact: impact.finding,
    alternatives: alternatives.finding,
    gap: gap.finding,
    summary,
  };
}

if (isCliEntry(import.meta.url))
  run()
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
