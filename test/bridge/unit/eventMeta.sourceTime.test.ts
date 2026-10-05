import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEventMeta } from '../../../src/bridge/eventMeta.js';

const run = { runId: 'agent-run', runStartMs: 100, compositionPath: [] };

afterEach(() => vi.restoreAllMocks());

describe('buildEventMeta source origin', () => {
  it.each([0, 125])('uses the supplied timestamp %s, including zero', (timestamp) => {
    vi.spyOn(Date, 'now').mockReturnValue(900);
    const origin = { runtimeStageId: 'stage#1', timestamp };
    const meta = buildEventMeta(origin, run);
    expect(meta.wallClockMs).toBe(timestamp);
    expect(meta.runOffsetMs).toBe(timestamp - run.runStartMs);
  });

  it('passes an already projected source position without replacing run identity', () => {
    const sourcePosition = Object.freeze({
      engineRunId: 'engine-leg',
      logRunId: 'engine-log',
      drillPath: Object.freeze(['mount#1']),
      committedThroughIdx: -1,
    });
    const origin = { runtimeStageId: 'stage#1', sourcePosition };
    const meta = buildEventMeta(origin, run);
    expect(meta.sourcePosition).toBe(sourcePosition);
    expect(meta.runId).toBe('agent-run');
  });

  it('keeps arrival-time behavior and no coordinates for origins with neither field', () => {
    vi.spyOn(Date, 'now').mockReturnValue(900);
    const meta = buildEventMeta({ runtimeStageId: 'stage#1' }, run);
    expect(meta.wallClockMs).toBe(900);
    expect(meta.runOffsetMs).toBe(800);
    expect(meta).not.toHaveProperty('sourcePosition');
  });
});
