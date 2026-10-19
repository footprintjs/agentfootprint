import type { Attention, CommitBundle } from 'foottrace';
import { createRecordGraph, type RecordScope } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import {
  ArtifactDetailError,
  artifactDetailTool,
  bindArtifacts,
  inMemoryArtifacts,
  type ToolExecutionContext,
} from '../../src/index.js';
import {
  callTraceTool,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../../src/doors/observe.js';

function authorizedRecord(complete: boolean) {
  const address = { logRunId: 'synthetic:viewer-cause', drillPath: [] };
  const commit = (index: number, stage: string, key: string, reads: string[]): CommitBundle => ({
    idx: index,
    stage,
    stageId: stage,
    runtimeStageId: `${stage}#${index + 1}`,
    trace: [{ path: key, verb: 'set', readKeys: reads }],
    overwrite: { [key]: 'synthetic' },
    updates: {},
    redactedPaths: [],
  });
  const timeout: Attention = {
    kind: 'timeout',
    reason: 'TIMEOUT_RECORDED',
    evidence: ['proof:synthetic-attempt'],
  };
  // This synthetic producer, not the viewer, attests capture completeness.
  const scope: RecordScope = {
    address,
    commitLog: [commit(0, 'source', 'sample', []), commit(1, 'derive', 'statistic', ['sample'])],
    reads: { 'source#1': [], 'derive#2': ['sample'] },
    controlDeps: {},
    attention: { 'source#1': [timeout] },
    complete,
  };
  const graph = createRecordGraph([scope]);
  const sourceId = graph.nodeId(address, {
    runtimeStageId: 'source#1',
    commitIdx: 0,
    key: 'sample',
  });
  const targetId = graph.nodeId(address, {
    runtimeStageId: 'derive#2',
    commitIdx: 1,
    key: 'statistic',
  });
  const artifacts: TraceToolpackArtifacts = {
    snapshot: {
      runId: 'synthetic:viewer-shell',
      commitLog: [],
      sharedState: {},
      executionTree: { id: 'shell', logs: {}, errors: {}, metrics: {}, evals: {} },
      commitValues: 'full',
      writeProvenance: 'reads-prefix',
    },
    cause: { graph, nodeIds: [sourceId] },
  };
  return { artifacts, sourceId, targetId };
}

describe('opt-in artifact detail over actual recorded cause results', () => {
  it.each([true, false])(
    'retains a complete returned cause result with capture completeness %s before navigation',
    async (complete) => {
      const fixture = authorizedRecord(complete);
      // This is the actual public cause query, under its unchanged default caps.
      const text = await callTraceTool(traceToolpack(fixture.artifacts), 'root_cause', {
        nodeId: fixture.targetId,
      });
      const finding = JSON.parse(text);
      if (complete) {
        expect(finding.finding.rootCause).toBe(fixture.sourceId);
        expect(finding.interpretation).toContain('not proof of a provider-internal physical cause');
      } else {
        expect(finding.finding.rootCause).toBeUndefined();
        expect(finding.finding.gaps).toContainEqual(
          expect.objectContaining({ code: 'not-collected' }),
        );
      }

      const artifacts = bindArtifacts(
        inMemoryArtifacts(),
        { tenant: 'synthetic', conversationId: 'cause-viewer' },
        { origin: { runId: 'current-run', toolCallId: 'cause-producer' } },
      );
      // A known producer explicitly parses its own JSON response. The generic
      // viewer must not parse arbitrary source strings or retain results itself.
      const issued = await artifacts.put({
        kind: 'evidence/recorded-cause',
        mediaType: 'application/json',
        data: finding,
        digest: 'sha-256',
      });
      const ctx = { runId: 'current-run', hasArtifacts: true, artifacts } as ToolExecutionContext;
      let admissions = 0;
      const viewer = artifactDetailTool({
        name: 'recorded_cause_detail',
        async admit(ref, current) {
          admissions++;
          const head = await current.artifacts.head(ref);
          if (
            current.runId !== 'current-run' ||
            ref !== issued.ref ||
            head?.kind !== issued.kind ||
            head.digest !== issued.digest ||
            head.bytes !== issued.bytes ||
            head.origin?.runId !== 'current-run' ||
            head.origin.toolCallId !== 'cause-producer'
          )
            throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_UNAVAILABLE');
          const record = await current.artifacts.get(ref);
          if (!record || JSON.stringify(record.meta) !== JSON.stringify(head))
            throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_UNAVAILABLE');
          return record.data;
        },
        context(root) {
          return { interpretation: (root as { interpretation: string }).interpretation };
        },
      });
      expect(await viewer.execute({ ref: issued.ref, path: '/finding' }, ctx)).toEqual(
        expect.objectContaining({
          mode: 'value',
          value: finding.finding,
          context: { interpretation: finding.interpretation },
        }),
      );
      expect(await viewer.execute({ ref: issued.ref, path: '/interpretation' }, ctx)).toEqual(
        expect.objectContaining({ mode: 'value', value: finding.interpretation }),
      );
      await expect(
        viewer.execute({ ref: issued.ref, path: '/finding' }, { ...ctx, runId: 'old-run' }),
      ).rejects.toMatchObject({ code: 'ERR_ARTIFACT_DETAIL_UNAVAILABLE' });
      expect(admissions).toBe(3);
    },
  );
});
