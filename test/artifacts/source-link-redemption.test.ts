import assert from 'node:assert/strict';
import { findLastWriter } from 'foottrace';
import { createRecordGraph } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import { expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  isPlacedToolResult,
  pauseHere,
  placedResultKind,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { sourceLinksOf } from '../../src/trace-toolpack/sourceLinks.js';
import { openSubflow } from '../../src/trace-toolpack/subflowRecords.js';
import { storedCallOccurrenceField } from '../../src/lib/callOccurrence.js';

const payload = 'fixture payload '.repeat(200);
const argument = 'report/key~1';
const kind = placedResultKind('get_report');
const getReport = defineTool({
  name: 'get_report',
  description: 'Get a report',
  execute: () => payload,
});

async function run({
  mode,
  redact,
  rewrite,
  rewriteHistory,
  ruled,
  pause,
}: {
  mode?: 'dynamic-grouped';
  redact?: boolean;
  rewrite?: boolean;
  rewriteHistory?: boolean;
  ruled?: boolean;
  pause?: boolean;
} = {}) {
  const store = inMemoryArtifacts();
  const redeem = vi.spyOn(store, 'get');
  const consume = vi.fn((args: Record<typeof argument, string>) => {
    expect(args[argument]).toBe(payload);
    if (ruled) expect(args).toHaveProperty('window', 7722);
    return ruled ? '4417 records consumed' : 'consumed';
  });
  const consumeReport = defineTool({
    name: 'consume_report',
    description: 'Consume a report from an artifact',
    inputSchema: {
      type: 'object',
      properties: {
        [argument]: { type: 'string' },
        ...(ruled && { window: { type: 'number' } }),
      },
      required: [argument],
    },
    wants: { [argument]: kind },
    ...(ruled && { askOrAssume: { window: { assume: 7722 } } }),
    execute: consume,
  });
  let placedRef: string | undefined;
  const provider = mock({
    respond: (request) => {
      const results = request.messages.filter((message) => message.role === 'tool');
      if (results.length === 0) {
        return { content: '', toolCalls: [{ id: 'reused', name: 'get_report', args: {} }] };
      }
      if (results.length === 1) {
        const placed: unknown = JSON.parse(results[0]!.content);
        assert(isPlacedToolResult(placed));
        placedRef = placed.ref;
        return {
          content: '',
          toolCalls: [
            {
              id: 'reused',
              name: 'consume_report',
              args: { [argument]: rewrite ? 'original proposal' : placed.ref },
            },
          ],
        };
      }
      if (pause && results.length === 2) {
        return {
          content: '',
          toolCalls: [{ id: 'pause', name: 'ask_label', args: {} }],
        };
      }
      return { content: ruled ? '4417 records consumed.' : 'done', toolCalls: [] };
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    artifacts: { store, placement: { maxInlineChars: 1600 } },
    ...(mode === undefined ? {} : { reactMode: mode }),
    ...(redact && { redact: { fields: { history: ['2.content'] } } }),
  })
    .tool(getReport)
    .tool(consumeReport);
  if (ruled) builder.findings({ argumentSources: true }).namesAndNumbersFromEvidence();
  if (pause) {
    builder.tool(
      defineTool({
        name: 'ask_label',
        description: 'Ask the user for a label',
        inputSchema: { type: 'object' },
        execute: () => pauseHere({ question: 'What is the label?' }),
      }),
    );
  }
  if (rewrite || rewriteHistory) {
    builder.toolMiddleware({
      name: 'replace-proposal-reference',
      onToolCall: (call) => {
        if (call.toolName !== 'consume_report' || placedRef === undefined) return allow();
        if (rewrite) Reflect.set(call.args, argument, placedRef);
        if (rewriteHistory) {
          const message = call.history.find((row) => row.role === 'tool');
          if (message !== undefined) Reflect.set(message, 'content', 'replacement history body');
        }
        return allow();
      },
    });
  }
  const agent = builder.build();
  try {
    const result = await agent.run({ message: 'Fetch and consume the report' });
    const beforeResume = pause ? agent.getSnapshot() : undefined;
    if (pause) {
      assert(isPaused(result));
      const checkpoint = JSON.parse(JSON.stringify(result.checkpoint)) as typeof result.checkpoint;
      expect(await agent.resume(checkpoint, 'report label')).toBe('done');
    } else {
      expect(result).toBe(ruled ? '4417 records consumed.' : 'done');
    }
    expect(consume).toHaveBeenCalledOnce();
    expect(redeem).toHaveBeenCalledOnce();
    const snapshot = agent.getLastSnapshot();
    assert(snapshot?.logAddress);
    return { snapshot, address: snapshot.logAddress, beforeResume };
  } finally {
    await agent.shutdown();
  }
}

it('records the exact redeemed proposal argument beside its one native check', async () => {
  const { snapshot, address } = await run();
  const { commitLog, initialState, sharedState } = snapshot;
  const reads: Record<string, readonly string[]> = {};
  function visit(stage: StageSnapshot | undefined): void {
    if (stage === undefined) return;
    if (stage.runtimeStageId && stage.stageReads)
      reads[stage.runtimeStageId] = Object.keys(stage.stageReads);
    for (const child of stage.children ?? []) visit(child);
    visit(stage.next);
  }
  visit(snapshot.executionTree);
  const scope = { address, commitLog, initialState, reads };
  const sourceLinks = sourceLinksOf(scope);
  const [link] = sourceLinks?.links ?? [];
  assert(link);
  const witnessCommit = commitLog[link.witness.commitIdx];
  const outputCommit = commitLog[link.output.commitIdx];
  expect(witnessCommit?.stageId).toBe('tool-calls');
  expect(reads[link.witness.runtimeStageId]).toContain('llmLatestToolCalls');
  expect(outputCommit?.stageId).toBe('call-llm');
  expect(link).toMatchObject({
    linkBasis: 'reference',
    check: 'redeemed',
    output: {
      key: 'llmLatestToolCalls',
      checkedIn: 'read',
      element: 0,
      pointer: '/args/report~1key~01',
    },
    input: { key: 'history', element: 2 },
  });
  expect(sharedState.sourceLinkRows).toHaveLength(1);
  const graph = createRecordGraph([{ ...scope, sourceLinks }], { sourceLinkPolicy: () => true });
  const page = await graph.parents(graph.nodeId(address, link.output), {
    signal: new AbortController().signal,
  });
  expect(page.sourceLinks).toMatchObject([
    { standing: 'witnessed', check: 'redeemed', linkBasis: 'reference' },
  ]);
  expect(page.sourceLinkGaps).toBeUndefined();
  const history = sharedState.history as readonly { role: string }[];
  expect(storedCallOccurrenceField(history[2]!)).toHaveProperty('callOccurrenceKey');
  expect(history[2]?.role).toBe('tool');
});

it('keeps the same-scope links while a native inputs subflow resolves a ruled argument', async () => {
  const { snapshot } = await run({ ruled: true });
  const commits = snapshot.commitLog;
  const mounts = commits.filter(
    ({ stageId, trace }) =>
      stageId === 'sf-inputs' && trace.some(({ path }) => path === 'argumentResolutions'),
  );
  expect(mounts.length).toBeGreaterThan(0);
  for (const mount of mounts) {
    const child = openSubflow(snapshot, mount.runtimeStageId);
    assert(typeof child !== 'string');
    expect(
      child.commitLog.some(({ trace }) => trace.some(({ path }) => path === 'sourceLinkRows')),
    ).toBe(false);
  }
  expect(snapshot.sharedState.sourceLinkRows).toMatchObject([
    { linkBasis: 'reference', check: 'redeemed', output: { pointer: '/args/report~1key~01' } },
    { linkBasis: 'match', check: 'value-found', output: { key: 'llmLatestContent' } },
  ]);
});

it('does not reopen the earlier artifact link from a resumed leg’s seed', async () => {
  const { snapshot, address, beforeResume } = await run({ pause: true });
  assert(beforeResume?.logAddress);
  expect(beforeResume.logAddress).not.toEqual(address);
  expect(beforeResume.sharedState.sourceLinkRows).toMatchObject([
    { linkBasis: 'reference', check: 'redeemed' },
  ]);
  expect(snapshot.initialState).toHaveProperty(
    'sourceLinkRows',
    beforeResume.sharedState.sourceLinkRows,
  );
  expect(
    sourceLinksOf({ address, commitLog: snapshot.commitLog, initialState: snapshot.initialState }),
  ).toBeUndefined();
  expect(findLastWriter([...snapshot.commitLog], 'sourceLinkRows')).toBeUndefined();
});

it.each([
  { label: 'grouped chart', mode: 'dynamic-grouped' as const },
  { label: 'protected input', redact: true },
  { label: 'middleware-supplied reference', rewrite: true },
  { label: 'rewritten history body', rewriteHistory: true },
])(
  'keeps redemption behavior without producing a link for a $label',
  async ({ label: _label, ...options }) => {
    const { snapshot } = await run(options);
    expect(findLastWriter([...snapshot.commitLog], 'sourceLinkRows')).toBeUndefined();
    expect(snapshot.sharedState.sourceLinkRows).toBeUndefined();
  },
);
