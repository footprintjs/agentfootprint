import { describe, expect, it, vi } from 'vitest';
import { projectClosedHistory } from './index.js';

/** Consumer-policy examples AFTER producer admission, not replacement wire-validator fixtures. */
function admitted() {
  return {
    capture: { boundary: { status: 'failed' } },
    closure: {
      version: 1,
      policy: 'native-root-prefix-v1',
      scope: 'root-log',
      status: 'closed',
      boundary: 'failed',
      runId: 'test-run',
      logAddress: { logRunId: 'test-run', drillPath: [] },
      commits: { from: 0, to: 2 },
      selectedFailure: {
        kind: 'invocation',
        runId: 'test-run',
        runtimeStageId: 'work#1',
        attemptId: 'work#1@2',
      },
      limitations: ['unobserved-work-not-attested', 'producer-not-authenticated'],
    },
  };
}

describe('supported saved closure policy projection', () => {
  it('projects only admitted facts into a detached frozen display assessment', () => {
    const history = admitted();
    const result = projectClosedHistory(history, 'test-run', 2);
    expect(result).toMatchObject({
      boundary: 'failed',
      selectedFailure: history.closure.selectedFailure,
    });
    if (result === undefined || result === 'unsupported') throw Error('expected a projection');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selectedFailure)).toBe(true);
    expect(Object.isFrozen(result.limitations)).toBe(true);
    expect(result.selectedFailure).not.toBe(history.closure.selectedFailure);
    expect(result.limitations).not.toBe(history.closure.limitations);
    history.closure.selectedFailure.attemptId = 'different';
    history.closure.limitations.length = 0;
    expect(result.selectedFailure.attemptId).toBe('work#1@2');
    expect(result.limitations).toHaveLength(2);
  });

  it.each([
    [
      'future layout',
      (h: ReturnType<typeof admitted>) => {
        h.closure.version = 2;
      },
    ],
    [
      'future policy',
      (h: ReturnType<typeof admitted>) => {
        h.closure.policy = 'native-root-prefix-v2';
      },
    ],
    [
      'open prefix',
      (h: ReturnType<typeof admitted>) => {
        h.closure.status = 'unverified';
      },
    ],
    [
      'nonfailed boundary',
      (h: ReturnType<typeof admitted>) => {
        h.closure.boundary = 'paused';
      },
    ],
    [
      'child prefix',
      (h: ReturnType<typeof admitted>) => {
        h.closure.logAddress.drillPath.push('inner#0' as never);
      },
    ],
    [
      'different run',
      (h: ReturnType<typeof admitted>) => {
        h.closure.runId = 'other';
      },
    ],
    [
      'different log',
      (h: ReturnType<typeof admitted>) => {
        h.closure.logAddress.logRunId = 'other';
      },
    ],
    [
      'partial start',
      (h: ReturnType<typeof admitted>) => {
        h.closure.commits.from = 1;
      },
    ],
    [
      'partial end',
      (h: ReturnType<typeof admitted>) => {
        h.closure.commits.to = 1;
      },
    ],
    [
      'commit selection',
      (h: ReturnType<typeof admitted>) => {
        h.closure.selectedFailure.kind = 'commit';
      },
    ],
    [
      'different selected run',
      (h: ReturnType<typeof admitted>) => {
        h.closure.selectedFailure.runId = 'other';
      },
    ],
    [
      'missing stage',
      (h: ReturnType<typeof admitted>) => {
        h.closure.selectedFailure.runtimeStageId = '';
      },
    ],
    [
      'missing attempt',
      (h: ReturnType<typeof admitted>) => {
        h.closure.selectedFailure.attemptId = '';
      },
    ],
    [
      'unbounded limitations',
      (h: ReturnType<typeof admitted>) => {
        h.closure.limitations = Array(17).fill('gap');
      },
    ],
  ])('withholds %s even when a future producer reader admitted it', (_name, edit) => {
    const history = admitted();
    edit(history);
    expect(projectClosedHistory(history, 'test-run', 2)).toBe('unsupported');
  });

  it('does not borrow closure facts from an older reader or a completed snapshot', () => {
    expect(
      projectClosedHistory({ capture: { boundary: { status: 'failed' } } }, 'test-run', 2),
    ).toBeUndefined();
    const history = admitted();
    history.capture.boundary.status = 'completed';
    expect(projectClosedHistory(history, 'test-run', 2)).toBeUndefined();
  });

  it('reads only own data descriptors, never an attached getter', () => {
    const getter = vi.fn(() => 'native-root-prefix-v1');
    const history = admitted();
    Object.defineProperty(history.closure, 'policy', { get: getter });
    expect(() => projectClosedHistory(history, 'test-run', 2)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
