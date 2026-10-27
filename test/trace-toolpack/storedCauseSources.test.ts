import { createRecordGraph } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import { traceCauseTools } from '../../src/trace-toolpack/causeTools.js';
import { readStoredCauseArtifacts } from '../../src/trace-toolpack/storedCause.js';
import { callTraceTool } from '../../src/trace-toolpack/traceToolpack.js';
import {
  noteData,
  rehashStoredFixture,
  requireStoredHistory,
  storedCauseFixture,
} from './storedCauseFixtures.js';

async function fixture(options: Parameters<typeof storedCauseFixture>[0] = {}) {
  const value = await storedCauseFixture({ readSources: true, ...options });
  const history = await requireStoredHistory(value.entries, value.runId);
  expect(history.readSources?.version).toBe(2);
  return { ...value, history };
}

async function ready(options: Parameters<typeof storedCauseFixture>[0] = {}) {
  const value = await fixture(options);
  const result = await readStoredCauseArtifacts(value.entries, { runId: value.runId });
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error('saved source fixture not admitted');
  return { ...value, cause: result.cause };
}

describe('saved exact read sources from the public producer', () => {
  it('retains unknowns after genuine producer source-budget exhaustion', async () => {
    const value = await ready({ readSourceLimit: 1 });
    expect(value.history.readSources?.status).toBe('partial');
    expect(value.cause.admission.native.status).toBe('incomplete');
    const bundle = value.history.commitLog.find((entry) => entry.stageId === 'choose')!;
    const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
    });
    for (const tool of ['attention_list', 'root_cause', 'impact']) {
      const answer = JSON.parse(
        await callTraceTool(
          traceCauseTools(value.cause),
          tool,
          tool === 'attention_list' ? {} : { nodeId },
        ),
      );
      expect(answer.finding.confidence).toBe('incomplete');
      expect(answer.finding.gaps.length).toBeGreaterThan(0);
      expect(answer.finding.rootCause).toBeUndefined();
    }
  });

  it('admits independently witnessed namespaces and actual retry invocations after JSON storage', async () => {
    const value = await ready();
    expect(value.cause.admission).toMatchObject({
      native: { version: 2, status: 'admitted', persistence: 'memory-only' },
      storage: { status: 'adapter-acknowledged-history', scope: 'root-log' },
      readSources: 'captured',
    });
    const bundle = value.history.commitLog.find((entry) => entry.stageId === 'choose')!;
    const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
      commitIdx: value.history.commitLog.indexOf(bundle),
    });
    const tools = traceCauseTools(value.cause);
    const root = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(root.finding.confidence, JSON.stringify(root)).toBe('complete');
    expect(root.finding.rootCause).toBeDefined();
    expect(root.finding.gaps).toEqual([]);
    expect(root.capture.readSources).toBe('captured');
    expect(root.interpretation).not.toContain('exact read versions, child scopes');
    expect(JSON.stringify(root)).not.toContain('PRIVATE_CAPTURE_FIXTURE_ERROR');
    const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
    expect(impact.finding.confidence).toBe('complete');
    expect(impact.finding.edges.length).toBeGreaterThan(0);
  });

  it('never upgrades a read-before-write observation into proof that an output used it', async () => {
    const value = await ready();
    const bundle = value.history.commitLog.find((entry) => entry.stageId === 'choose')!;
    const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
      commitIdx: value.history.commitLog.indexOf(bundle),
      key: 'decision',
    });
    const answer = JSON.parse(
      await callTraceTool(traceCauseTools(value.cause), 'root_cause', { nodeId }),
    );
    expect(answer.finding.confidence).toBe('incomplete');
    expect(answer.finding.rootCause).toBeUndefined();
    expect(answer.finding.gaps).toContainEqual(expect.objectContaining({ code: 'conservative' }));
  });

  it('requires zero-read ownership too, without inventing an absent attempt 1', async () => {
    const value = await ready({ plain: true });
    expect(value.history.readSources!.version).toBe(2);
    if (value.history.readSources!.version !== 2) throw Error('ownership missing');
    const executions = value.history.readSources!.ownership.executions;
    expect(executions).toHaveLength(2);
    expect(executions.every((execution) => execution.attemptIds.length === 1)).toBe(true);
    expect(value.history.executionTree.readSourceCounts?.observed).toBe(0);
    expect(value.cause.admission.native.status).toBe('admitted');
  });

  it('keeps recorded unavailable sources as gaps rather than a supported root', async () => {
    const value = await ready({ readOnlyMissing: true });
    const bundle = value.history.commitLog.find((entry) => entry.stageId === 'missing-read-0')!;
    const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
    });
    const answer = JSON.parse(
      await callTraceTool(traceCauseTools(value.cause), 'root_cause', { nodeId }),
    );
    expect(answer.finding.confidence).toBe('incomplete');
    expect(answer.finding.rootCause).toBeUndefined();
    expect(answer.finding.gaps.length).toBeGreaterThan(0);
  });

  it('does not upgrade partial capture even when storage and ownership are retained', async () => {
    const value = await fixture();
    const data = noteData(value.entries, 'capture-history') as any;
    data.readSources.limitations = ['untracked-read'];
    data.readSources.status = data.capture.channels.readSources = 'partial';
    await rehashStoredFixture(value.entries, value.history);
    expect(await requireStoredHistory(value.entries, value.runId)).toBeDefined();
    const result = await readStoredCauseArtifacts(value.entries, { runId: value.runId });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('safe incomplete projection missing');
    expect(result.cause.admission.native.status).toBe('incomplete');
    expect(result.cause.admission.readSources).toBe('partial');
    const bundle = value.history.commitLog.find((entry) => entry.stageId === 'choose')!;
    const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
    });
    const answer = JSON.parse(
      await callTraceTool(traceCauseTools(result.cause), 'root_cause', { nodeId }),
    );
    expect(answer.finding.confidence).toBe('incomplete');
    expect(answer.finding.rootCause).toBeUndefined();
  });

  it.each(['legacy envelope', 'unknown ownership'])(
    'never self-authorizes a %s from its source rows',
    async (attack) => {
      const value = await fixture({ plain: true });
      const data = noteData(value.entries, 'capture-history') as any;
      if (attack === 'legacy envelope') {
        data.readSources.version = 1;
        delete data.readSources.ownership;
      } else {
        data.readSources.ownership.status = 'unknown';
        data.readSources.ownership.limitations = ['attempt-unavailable'];
      }
      await rehashStoredFixture(value.entries, value.history);
      expect(await requireStoredHistory(value.entries, value.runId)).toBeDefined();
      expect(await readStoredCauseArtifacts(value.entries, { runId: value.runId })).toEqual({
        status: 'unknown',
        reason: 'source-ownership-unproven',
      });
    },
  );

  it.each([
    'namespace',
    'attempt',
    'count',
    'first commit',
    'zero-read owner',
    'future source',
    'witness run',
    'witness segment',
  ])(
    'uses the public producer refusal for inconsistent %s evidence, even after rehashing',
    async (attack) => {
      const value = await fixture({ plain: true });
      const data = noteData(value.entries, 'capture-history') as any;
      const sources = data.readSources;
      if (attack === 'namespace') sources.record.occurrences[0].stateAddress = ['foreign'];
      if (attack === 'attempt') sources.record.occurrences[0].attemptId = 'forged';
      if (attack === 'count') data.executionTree.next.readSourceInvocations++;
      if (attack === 'first commit') sources.ownership.executions[0].firstCommit++;
      if (attack === 'zero-read owner') sources.ownership.executions.shift();
      if (attack === 'future source') sources.record.occurrences[0].source.commitIdx = 1;
      if (attack === 'witness run') sources.ownership.runId = 'foreign-run';
      if (attack === 'witness segment') sources.ownership.segment++;
      await rehashStoredFixture(value.entries, value.history);
      const answer = await readStoredCauseArtifacts(value.entries, { runId: value.runId });
      expect(answer).toEqual({ status: 'unknown', reason: 'stored-admission' });
      expect(answer).not.toHaveProperty('cause');
    },
  );

  it.each(['capture missing', 'receipt missing', 'failed run', 'control absent'])(
    'never uses source evidence to hide %s',
    async (boundary) => {
      const value = await fixture({
        fail: boundary === 'failed run',
        withoutControl: boundary === 'control absent',
      });
      if (boundary === 'capture missing')
        value.entries.splice(
          0,
          value.entries.length,
          ...value.entries.filter(
            (entry) => (entry as { note?: string }).note !== 'capture-history',
          ),
        );
      if (boundary === 'receipt missing')
        value.entries.splice(
          0,
          value.entries.length,
          ...value.entries.filter(
            (entry) => (entry as { note?: string }).note !== 'capture-receipt',
          ),
        );
      const result = await readStoredCauseArtifacts(value.entries, { runId: value.runId });
      if (result.status === 'unknown') return expect(result).not.toHaveProperty('cause');
      expect(result.cause.admission.native.status).toBe('incomplete');
      const bundle = value.history.commitLog.find((entry) => entry.stageId === 'choose')!;
      const nodeId = createRecordGraph([]).nodeId(value.snapshot.logAddress!, {
        runtimeStageId: bundle.runtimeStageId,
      });
      const answer = JSON.parse(
        await callTraceTool(traceCauseTools(result.cause), 'root_cause', { nodeId }),
      );
      expect(answer.finding.rootCause).toBeUndefined();
      expect(answer.finding.confidence).toBe('incomplete');
    },
  );

  it('cannot transfer source admission by copying the cause or replacing its display assessment', async () => {
    const value = await ready();
    const forged = {
      ...value.cause,
      admission: { ...value.cause.admission, readSources: 'captured' as const },
    };
    for (const tool of ['attention_list', 'root_cause', 'impact']) {
      const args = tool === 'attention_list' ? {} : { nodeId: 'forged' };
      const answer = JSON.parse(await callTraceTool(traceCauseTools(forged), tool, args));
      expect(answer.gaps).toEqual([{ code: 'invalid-data', evidence: [] }]);
      expect(answer.finding).toBeUndefined();
    }
  });
});
