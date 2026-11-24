import type { RuntimeSnapshot } from 'footprintjs';
import { expect } from 'vitest';
import { readCallOccurrenceKey } from '../../../src/lib/callOccurrence.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { epochLocations, readAtCall } from '../../../src/time-travel/index.js';

type CommitCopy = { overwrite: Record<string, unknown>; trace: unknown[] };

/** Reverse only the consumer writes proved by the native call and its ordered history. */
export function removeVerifiedSourceLinkConsumers(
  snapshot: RuntimeSnapshot,
  priorLog: readonly CommitCopy[],
  epochs = epochLocations(snapshot),
): void {
  expect(priorLog).toHaveLength(snapshot.commitLog.length);
  const key = 'sourceLinkConsumer';
  for (const [index, bundle] of snapshot.commitLog.entries()) {
    const servedIndex = bundle.trace.findIndex(({ path }) => path === 'sourceLinkServedRows');
    const writes = bundle.trace.filter(({ path }) => path === key);
    if (servedIndex === -1) {
      expect(writes).toEqual([]);
      expect(Object.hasOwn(bundle.overwrite, key)).toBe(false);
      expect(Object.hasOwn(bundle.updates, key)).toBe(false);
      continue;
    }
    const location = epochs.find(
      ({ callRuntimeStageId, callIdx }) =>
        callRuntimeStageId === bundle.runtimeStageId && callIdx === index,
    );
    if (!location) throw new Error('Expected a native model call for the served row.');
    expect(bundle.stageId).toBe('call-llm');
    expect(writes).toEqual([{ path: key, verb: 'set' }]);
    const consumerIndex = bundle.trace.findIndex(({ path }) => path === key);
    expect(consumerIndex).toBeGreaterThan(servedIndex);
    for (const output of ['llmLatestContent', 'llmLatestToolCalls']) {
      const outputIndex = bundle.trace.findIndex(({ path }) => path === output);
      if (outputIndex !== -1) expect(consumerIndex).toBeLessThan(outputIndex);
    }
    expect(Object.hasOwn(bundle.updates, key)).toBe(false);
    const history = readAtCall(location, 'history') as readonly LLMMessage[];
    const positions = history.flatMap((message, element) => {
      const occurrence = message.role === 'tool' ? readCallOccurrenceKey(message) : undefined;
      return typeof occurrence === 'string' ? [{ occurrence, element }] : [];
    });
    expect(bundle.overwrite[key]).toEqual({
      consumer: bundle.runtimeStageId,
      historyPositions: positions,
      runId: snapshot.runId,
    });
    const prior = priorLog[index]!;
    expect(prior.trace[consumerIndex]).toEqual({ path: key, verb: 'set' });
    expect(Object.hasOwn(prior.overwrite, key)).toBe(true);
    delete prior.overwrite[key];
    prior.trace.splice(consumerIndex, 1);
  }
}
