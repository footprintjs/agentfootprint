/**
 * Engine runs for the sub-flow payload tests: one small chart per shape the
 * design review names, recorded the way `recordRun` records (the boundary
 * recorder, embeddings summarised unless kept, the redacted snapshot under a
 * policy), then detached through JSON as a stored recording is.
 */
import { FlowChartExecutor, flowChart, interrupt } from 'footprintjs';

import type { Recording } from '../../../../src/observe.js';
import { boundaryRecorder } from '../../../../src/recorders/observability/BoundaryRecorder.js';
import { summarizeEmbeddings } from '../../../../src/recorders/observability/embeddingSummary.js';

type Scope = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const vector = Array.from({ length: 8 }, (_, i) => i / 10);

const child = (tag: string) =>
  flowChart(
    `C-${tag}`,
    (s: Scope) => {
      s.out = `${String(s.input ?? 'x')}!${tag}`;
      s.docs = [{ id: 1, embedding: vector }];
    },
    `c-${tag}`,
  ).build();

const nestedChild = () =>
  flowChart('Outer', (s: Scope) => void (s.outerSeen = s.input), 'outer')
    .addSubFlowChartNext('sf-inner', child('inner'), 'Inner', {
      inputMapper: (s: Scope) => ({ input: s.input, apiKey: s.apiKey }),
      outputMapper: (c: Scope) => ({ innerOut: c.out }),
    })
    .addFunction('After', (s: Scope) => void (s.done = true), 'after')
    .build();

const seed = (s: Scope): void => {
  s.input = 'hi';
  s.apiKey = 'sk-1';
  s.user = { name: 'a', password: 'p' };
  s.i = 0;
};

/** The chart shapes, by name. */
export const SHAPES = {
  plain: () =>
    flowChart('Root', seed, 'root')
      .addSubFlowChartNext('sf-a', child('a'), 'A', {
        inputMapper: (s: Scope) => ({ input: s.input, user: s.user, apiKey: s.apiKey }),
        outputMapper: (c: Scope) => ({ aOut: c.out }),
      })
      .build(),
  emptySeed: () =>
    flowChart('Root', seed, 'root').addSubFlowChartNext('sf-a', child('a'), 'A').build(),
  nested: () =>
    flowChart('Root', seed, 'root')
      .addSubFlowChartNext('sf-outer', nestedChild(), 'Outer', {
        inputMapper: (s: Scope) => ({ input: s.input, apiKey: s.apiKey }),
        outputMapper: (c: Scope) => ({ o: c.outerSeen }),
      })
      .build(),
  loop: () =>
    flowChart('Root', seed, 'root')
      .addSubFlowChartNext('sf-a', child('a'), 'A', {
        inputMapper: (s: Scope) => ({ input: `${String(s.input)}${String(s.i)}` }),
        outputMapper: (c: Scope) => ({ aOut: c.out }),
      })
      .addDeciderFunction('Again', (s: Scope) => ((s.i = s.i + 1) < 3 ? 'again' : 'stop'), 'decide')
      .addFunctionBranch('again', 'Loop', () => {}, undefined, { loopTo: 'sf-a' })
      .addFunctionBranch('stop', 'Stop', () => {})
      .end()
      .build(),
  parallel: () =>
    flowChart('Root', seed, 'root')
      .addSubFlowChart('sf-p1', child('p'), 'P1', {
        inputMapper: (s: Scope) => ({ input: s.input }),
      })
      .addSubFlowChart('sf-p2', child('p'), 'P2', {
        inputMapper: (s: Scope) => ({ input: s.input }),
      })
      .addFunction('Join', () => {}, 'join')
      .build(),
  forEach: () =>
    flowChart('Root', (s: Scope) => void (s.items = ['a', 'b']), 'root')
      .addParallelForEach('Each', 'each', {
        items: (s: Scope) => s.items as string[],
        branch: () => child('fe'),
        maxBranches: 8,
        into: 'results',
      })
      .build(),
  paused: () =>
    flowChart('Root', seed, 'root')
      .addSubFlowChartNext(
        'sf-pause',
        flowChart(
          'P',
          (s: Scope) => void (s.answer = interrupt(s, { question: 'ok?' })),
          'p',
        ).build(),
        'Pause',
        { inputMapper: (s: Scope) => ({ input: s.input }) },
      )
      .build(),
} as const;

export type ShapeName = keyof typeof SHAPES;

export interface EngineRunOptions {
  readonly policy?: { readonly keys: readonly string[] };
  readonly keepEmbeddings?: boolean;
}

/** One recorded engine run of `shape`, as a parsed (stored) recording. */
export async function engineRecording(
  shape: ShapeName,
  options: EngineRunOptions = {},
): Promise<Recording> {
  const executor = new FlowChartExecutor(SHAPES[shape](), { commitValues: 'delta' });
  if (options.policy) executor.setRedactionPolicy({ keys: [...options.policy.keys] });
  let commits = 0;
  const boundary = boundaryRecorder({
    getCommitCount: () => commits++,
    ...(options.keepEmbeddings === true && { recordEmbeddings: true }),
  });
  executor.attachCombinedRecorder(boundary);
  await executor.run();
  return detach(executor, options);
}

/**
 * A recorder shared by a second executor while an outer sub-flow is open
 * (`BoundaryRecorder.ts · runIdGuard`): the inner executor's own counter writes
 * `sf-a#1` a second time into the same row, with the same `subflowId`.
 */
export async function sharedRecorderRecording(): Promise<Recording> {
  let commits = 0;
  const boundary = boundaryRecorder({ getCommitCount: () => commits++ });
  const host = flowChart(
    'Host',
    async (s: Scope) => {
      const inner = new FlowChartExecutor(
        flowChart('IR', (t: Scope) => void (t.input = 'inner'), 'root')
          .addSubFlowChartNext('sf-a', child('inner'), 'A', {
            inputMapper: (t: Scope) => ({ input: t.input }),
          })
          .build(),
      );
      inner.attachCombinedRecorder(boundary);
      await inner.run();
      s.hosted = true;
    },
    'host',
  ).build();
  const chart = flowChart('Root', (s: Scope) => void (s.input = 'outer'), 'root')
    .addSubFlowChartNext('sf-a', child('outer'), 'A', {
      inputMapper: (s: Scope) => ({ input: s.input }),
    })
    .addSubFlowChartNext('sf-host', host, 'Host', {
      inputMapper: (s: Scope) => ({ input: s.input }),
    })
    .build();
  const executor = new FlowChartExecutor(chart, { commitValues: 'delta' });
  executor.attachCombinedRecorder(boundary);
  await executor.run();
  return detach(executor, {});
}

/**
 * A sub-flow that pauses, resumed on the same executor: the paused mount has
 * no result (`part: null`); the resumed mount is a new execution, seeded from
 * the pause's capture.
 */
export async function resumedRecording(): Promise<Recording> {
  const chart = flowChart('Root', (s: Scope) => void (s.input = 'hi'), 'root')
    .addSubFlowChartNext(
      'sf-pause',
      flowChart(
        'P',
        (s: Scope) => {
          s.answer = interrupt(s, { question: 'ok?' });
          s.out = `${String(s.input)}:${String(s.answer)}`;
        },
        'p',
      ).build(),
      'Pause',
      {
        inputMapper: (s: Scope) => ({ input: s.input }),
        outputMapper: (c: Scope) => ({ out: c.out }),
      },
    )
    .build();
  const executor = new FlowChartExecutor(chart, { commitValues: 'delta' });
  let commits = 0;
  executor.attachCombinedRecorder(boundaryRecorder({ getCommitCount: () => commits++ }));
  await executor.run();
  const checkpoint = executor.getCheckpoint();
  if (checkpoint === undefined) throw new Error('the run did not pause');
  await executor.resume(checkpoint, 'yes');
  return detach(executor, {});
}

function detach(executor: FlowChartExecutor, options: EngineRunOptions): Recording {
  const raw = options.policy ? executor.getSnapshot({ redact: true }) : executor.getSnapshot();
  const snapshot = options.keepEmbeddings === true ? raw : summarizeEmbeddings(raw);
  return JSON.parse(JSON.stringify({ snapshot, events: [], structure: null })) as Recording;
}

/** The recording's one BoundaryEvents row's events (parsed data). */
export function boundaryEvents(recording: Recording): Record<string, unknown>[] {
  const snapshot = recording.snapshot as { recorders: { name: string; data: unknown[] }[] };
  const row = snapshot.recorders.find((r) => r.name === 'BoundaryEvents');
  if (!row) throw new Error('no BoundaryEvents row');
  return row.data as Record<string, unknown>[];
}

/** The sub-flow boundary events that carry a payload. */
export function payloadEvents(recording: Recording): Record<string, unknown>[] {
  return boundaryEvents(recording).filter(
    (e) => String(e.type).startsWith('subflow.') && 'payload' in e,
  );
}
