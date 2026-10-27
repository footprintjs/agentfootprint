import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reader } = vi.hoisted(() => ({ reader: vi.fn() }));
vi.mock('footprintjs/trace', () => ({ readStoredCapture: reader }));
import { readStoredCauseArtifacts } from '../../src/trace-toolpack/storedCause.js';
import { storedCauseAssessment } from '../../src/trace-toolpack/storedCauseBinding.js';

function history() {
  return {
    runId: 'test-run',
    capture: {
      version: 1,
      runId: 'test-run',
      scope: 'root-log',
      logAddress: { logRunId: 'test-run', drillPath: [] },
      commits: { from: 0, to: 0 },
      boundary: { status: 'completed' },
      modes: {
        readTracking: 'full',
        writeTracking: 'full',
        commitValues: 'full',
        writeProvenance: 'reads-prefix',
      },
      channels: {
        reads: 'captured',
        writes: 'captured',
        attention: 'captured',
        control: 'captured',
        readSources: 'not-collected',
      },
      persistence: 'memory-only',
      limitations: [
        'tracked-state-only',
        'final-attempt-views',
        'read-sources-not-collected',
        'child-scopes-not-attested',
        'storage-not-attested',
      ],
    },
    executionTree: { id: 'root', runtimeStageId: 'root#1' },
    recorders: [
      {
        name: 'control-dependencies',
        capture: { version: 1, runId: 'test-run', control: 'captured' },
        data: { controlDeps: {} },
      },
    ],
    commitLog: [],
    receipt: { status: 'durable' },
  };
}
beforeEach(() => {
  reader.mockReset();
  reader.mockImplementation(async () => ({ status: 'acknowledged', history: history() }));
});

describe('saved cause factory admission', () => {
  it('calls the public producer reader once with detached host options', async () => {
    const entries: unknown[] = [];
    const limits = { entries: 12 };
    const result = await readStoredCauseArtifacts(entries, {
      runId: 'test-run',
      readerLimits: limits,
      maxBytes: 1024,
    });
    expect(result.status).toBe('ready');
    expect(reader).toHaveBeenCalledExactlyOnceWith(entries, {
      runId: 'test-run',
      limits: { entries: 12, missingCommits: 4096, drillDepth: 64, addressLength: 2048 },
      maxBytes: 1024,
    });
    expect(reader.mock.calls[0][1].limits).not.toBe(limits);
    if (result.status !== 'ready') return;
    expect(result.cause.admission).toMatchObject({
      native: { status: 'admitted', persistence: 'memory-only', version: 1 },
      storage: { status: 'adapter-acknowledged-history', scope: 'root-log' },
    });
    expect(Object.isFrozen(result.cause)).toBe(true);
    expect(Object.isFrozen(result.cause.graph)).toBe(true);
    expect(storedCauseAssessment(result.cause).kind).toBe('stored');
    expect(storedCauseAssessment({ ...result.cause })).toEqual({ kind: 'invalid' });
    expect(storedCauseAssessment({ graph: result.cause.graph })).toEqual({ kind: 'none' });
  });

  it.each([0, -1, 1.2, Infinity, 8 * 1024 * 1024 + 1, null, NaN, '1024'])(
    'refuses invalid byte limit %s before admission',
    async (maxBytes) => {
      expect(
        await readStoredCauseArtifacts([], { runId: 'test-run', maxBytes: maxBytes as number }),
      ).toEqual({
        status: 'unknown',
        reason: 'invalid-data',
      });
      expect(reader).not.toHaveBeenCalled();
    },
  );

  it('never executes option accessors', async () => {
    const getter = vi.fn(() => 'test-run');
    expect(
      await readStoredCauseArtifacts(
        [],
        Object.defineProperty({}, 'runId', { get: getter }) as never,
      ),
    ).toEqual({ status: 'unknown', reason: 'invalid-data' });
    expect(getter).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it('withholds every v2 result without inventing attempt or namespace witnesses', async () => {
    const value = history();
    value.capture.version = 2;
    reader.mockResolvedValue({ status: 'acknowledged', history: value });
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'source-ownership-unproven',
    });
  });

  it('maps producer refusal and thrown messages to fixed words', async () => {
    reader.mockResolvedValue({ status: 'unknown', reason: 'PRIVATE_RECEIPT_ERROR' });
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'stored-admission',
    });
    reader.mockRejectedValue(Error('PRIVATE_PATH_AND_SECRET'));
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'unavailable',
    });
  });

  it('retains known partial capture without promoting storage to complete', async () => {
    const value = history();
    value.capture.boundary.status = 'failed';
    reader.mockResolvedValue({ status: 'acknowledged', history: value });
    const result = await readStoredCauseArtifacts([], { runId: 'test-run' });
    expect(result.status).toBe('ready');
    if (result.status === 'ready')
      expect(result.cause.admission.native).toMatchObject({
        status: 'incomplete',
        reason: 'run-not-completed',
      });
  });

  it('does not publish a late admitted graph after cancellation', async () => {
    const controller = new AbortController();
    reader.mockImplementation(async () => {
      controller.abort('PRIVATE');
      return { status: 'acknowledged', history: history() };
    });
    expect(
      await readStoredCauseArtifacts([], { runId: 'test-run', signal: controller.signal }),
    ).toEqual({ status: 'unknown', reason: 'cancelled' });
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('refuses ambiguous tree identities', async () => {
    const value = history();
    (value.executionTree as any).next = { id: 'other', runtimeStageId: 'root#1' };
    reader.mockResolvedValue({ status: 'acknowledged', history: value });
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'projection-incomplete',
    });
  });
});

describe('saved factory policy boundaries', () => {
  it('refuses a detached tree beyond the 4096-node projection budget', async () => {
    const value = history();
    Object.assign(value.executionTree, {
      children: Array.from({ length: 4096 }, (_, index) => ({
        id: `stage-${index}`,
        runtimeStageId: `stage-${index}#1`,
      })),
    });
    reader.mockResolvedValue({ status: 'acknowledged', history: value });
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'projection-incomplete',
    });
  });

  it.each(['future version', 'future limitation', 'foreign run', 'resumed segment'])(
    'refuses %s without a graph',
    async (kind) => {
      const value = history();
      if (kind === 'future version') value.capture.version = 3;
      if (kind === 'future limitation') value.capture.limitations.push('future-limit');
      if (kind === 'foreign run') value.capture.runId = 'other-run';
      if (kind === 'resumed segment') value.capture.commits.from = 1;
      reader.mockResolvedValue({ status: 'acknowledged', history: value });
      expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
        status: 'unknown',
        reason: 'native-capture',
      });
    },
  );

  it('refuses a pre-cancelled call before importing or reading evidence', async () => {
    const controller = new AbortController();
    controller.abort('PRIVATE');
    expect(
      await readStoredCauseArtifacts([], { runId: 'test-run', signal: controller.signal }),
    ).toEqual({ status: 'unknown', reason: 'cancelled' });
    expect(reader).not.toHaveBeenCalled();
  });
});

describe('pre-admission structural limits', () => {
  it('supplies conservative resolved limits instead of the upstream allocation defaults', async () => {
    await readStoredCauseArtifacts([], { runId: 'test-run' });
    expect(reader.mock.calls[0][1].limits).toEqual({
      entries: 16_384,
      missingCommits: 4096,
      drillDepth: 64,
      addressLength: 2048,
    });
  });
  it.each([
    ['entries', 65_537],
    ['entries', Infinity],
    ['missingCommits', 4097],
    ['missingCommits', Infinity],
    ['drillDepth', 65],
    ['drillDepth', Infinity],
    ['addressLength', 2049],
    ['addressLength', Infinity],
    ['entries', -1],
    ['entries', 0.5],
  ] as const)('refuses %s=%s before reading any entries', async (key, limit) => {
    expect(
      await readStoredCauseArtifacts([], { runId: 'test-run', readerLimits: { [key]: limit } }),
    ).toEqual({ status: 'unknown', reason: 'invalid-data' });
    expect(reader).not.toHaveBeenCalled();
  });
  it('allows lower and zero work allowances and the documented maximum entry ceiling', async () => {
    const readerLimits = { entries: 65_536, missingCommits: 0, drillDepth: 0, addressLength: 1 };
    expect((await readStoredCauseArtifacts([], { runId: 'test-run', readerLimits })).status).toBe(
      'ready',
    );
    expect(reader.mock.calls[0][1].limits).toEqual(readerLimits);
  });
});

describe('present captured-view shape', () => {
  it.each([
    ['stageReads', null],
    ['stageReads', []],
    ['stageReads', 42],
    ['stageWrites', null],
    ['stageWrites', []],
    ['stageWrites', 42],
  ])('never upgrades malformed %s=%s to captured-empty', async (field, invalid) => {
    const value = history();
    Object.assign(value.executionTree, { [field as string]: invalid });
    reader.mockResolvedValue({ status: 'acknowledged', history: value });
    expect(await readStoredCauseArtifacts([], { runId: 'test-run' })).toEqual({
      status: 'unknown',
      reason: 'projection-incomplete',
    });
  });
});
