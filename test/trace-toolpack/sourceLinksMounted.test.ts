import assert from 'node:assert/strict';
import { createRecordGraph } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import { expect, it } from 'vitest';
import { Agent, defineTool, Sequence } from '../../src/index.js';
import { openRecording, recordRun } from '../../src/observe.js';
import { mock } from '../../src/providers.js';
import { snapshotCauseArtifacts } from '../../src/trace-toolpack/causeSnapshot.js';
import { sourceLinksOf } from '../../src/trace-toolpack/sourceLinks.js';
import { openSubflow } from '../../src/trace-toolpack/subflowRecords.js';

it('witnesses a mounted Agent answer entirely inside its own native record', async () => {
  const answer = 'The storage pool has 4200 GB.';
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
        { content: answer },
      ],
    }),
  })
    .tool(
      defineTool({
        name: 'capacity',
        description: 'Read the storage capacity.',
        inputSchema: { type: 'object' },
        execute: () => answer,
      }),
    )
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();

  const sequence = Sequence.create().step('answer', agent).build();
  const recorder = recordRun(sequence);

  try {
    expect(await sequence.run('What is the capacity?')).toBe(answer);
    const root = sequence.getSnapshot();
    const mount = root?.commitLog.find((commit) => commit.stageId === 'step-answer');
    assert(root?.logAddress && mount);
    const saved = openRecording(JSON.parse(JSON.stringify(recorder.toRecording())));

    for (const snapshot of [root, saved.snapshot]) {
      expect(
        snapshot.commitLog.flatMap((commit) => commit.trace.map(({ path }) => path)),
      ).not.toContain('sourceLinkRows');
      const child = openSubflow(snapshot, mount.runtimeStageId);
      assert(typeof child !== 'string' && child.logAddress);
      expect(child.logAddress).toEqual({
        logRunId: root.logAddress.logRunId,
        drillPath: [mount.runtimeStageId],
      });

      const nodes = new Map<string, StageSnapshot>();
      const visit = (stage: StageSnapshot | undefined): void => {
        if (stage === undefined) return;
        if (stage.runtimeStageId !== undefined) nodes.set(stage.runtimeStageId, stage);
        for (const child of stage.children ?? []) visit(child);
        visit(stage.next);
      };
      visit(child.executionTree);

      const reads = Object.fromEntries(
        [...nodes].map(([id, stage]) => [id, Object.keys(stage.stageReads ?? {})]),
      );
      const channel = sourceLinksOf({ address: child.logAddress, ...child, reads });
      assert(channel);
      expect(channel.links).toHaveLength(1);
      const link = channel.links[0]!;
      expect(child.commitLog[link.witness.commitIdx]?.stageId).toMatch(/(?:^|\/)sf-route$/);
      expect(child.commitLog[link.output.commitIdx]?.stageId).toMatch(/(?:^|\/)call-llm$/);
      expect(link.consumer.runtimeStageId).toBe(link.output.runtimeStageId);

      const projection = snapshotCauseArtifacts(
        { snapshot: child, sourceLinkPolicy: () => true },
        nodes,
      );
      assert(projection && projection !== 'truncated');
      const output = createRecordGraph([]).nodeId(child.logAddress, link.output);
      const page = await projection.graph.parents(output, { signal: new AbortController().signal });
      const start = answer.indexOf('4200');
      expect(page.sourceLinks).toMatchObject([
        {
          standing: 'witnessed',
          output: { selection: { key: 'llmLatestContent', span: [start, start + 4] } },
          input: { view: { key: 'history', element: 2 } },
        },
      ]);
    }
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
});
