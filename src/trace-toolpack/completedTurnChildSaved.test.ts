import { expect, it, vi } from 'vitest';

import {
  held,
  owner,
  runChild,
  scope,
} from '../../test/trace-toolpack/completedTurnChildFixtures.js';
import { issueCompletedTurn } from '../core/agent/turnEvidence/completedTurnHandle.js';
import { explainCompletedTurn } from './completedTurnWhy.js';

it('rechecks a saved capability after the exact child read and holds the requested address across awaits', async () => {
  const { snapshot, path, node, raw } = await runChild();
  const mutable = { ...node, logAddress: { ...node.logAddress, drillPath: [...path] } };
  const { origin, recording } = held(snapshot);
  let allowed = true;
  const readChild = vi.fn(async () => {
    allowed = false;
    return raw;
  });
  const turn = issueCompletedTurn({
    owner,
    origin,
    scope,
    source: {
      kind: 'saved',
      receiptRef: 'fixture-recording',
      redeem: async (ref) => {
        mutable.logAddress.drillPath[0] = 'unrelated#0';
        return { ref, originRunId: origin.runId, recording, readChild };
      },
    },
    allowed: () => allowed,
  });
  expect(await explainCompletedTurn(owner, mutable, turn)).toEqual({ gaps: ['turn-unavailable'] });
  expect(readChild).toHaveBeenCalledExactlyOnceWith(path, expect.any(AbortSignal));
});

it('ignores request accessors before authorization or reading a saved child', async () => {
  const { snapshot, path, node, raw } = await runChild();
  const { origin, recording } = held(snapshot);
  const readChild = vi.fn(async () => raw);
  const allowed = vi.fn(() => true);
  const turn = issueCompletedTurn({
    owner,
    origin,
    scope,
    source: {
      kind: 'saved',
      receiptRef: 'fixture-recording',
      redeem: async (ref) => ({ ref, originRunId: origin.runId, recording, readChild }),
    },
    allowed,
  });

  const getter = vi.fn(() => path[0]);
  const drillPath = [...path];
  Object.defineProperty(drillPath, 0, { get: getter });
  const forged = { ...node, logAddress: { ...node.logAddress, drillPath } };
  expect(await explainCompletedTurn(owner, forged, turn)).toEqual({ gaps: ['turn-unavailable'] });
  expect(allowed).not.toHaveBeenCalled();
  expect(getter).not.toHaveBeenCalled();
  expect(readChild).not.toHaveBeenCalled();
});

it.each(['timely', 'stalled', 'revoked'] as const)(
  'settles a %s saved read at the child deadline even if the adapter ignores cancellation',
  async (outcome) => {
    const { snapshot, path, node, sourceId, raw } = await runChild();
    const { origin, recording } = held(snapshot);
    let finish: (result: unknown) => void = () => {
      throw Error('Expected a deferred child result');
    };
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const readChild = vi.fn((_path: readonly string[], _signal: AbortSignal) => pending);
    let authorized = true;
    const turn = issueCompletedTurn({
      owner,
      origin,
      scope,
      source: {
        kind: 'saved',
        receiptRef: 'fixture-recording',
        redeem: async (ref) => ({ ref, originRunId: origin.runId, recording, readChild }),
      },
      allowed: () => authorized,
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const settled = vi.fn();
      void explainCompletedTurn(owner, node, turn).then(settled);
      await vi.advanceTimersByTimeAsync(999);
      expect(readChild).toHaveBeenCalledExactlyOnceWith(path, expect.any(AbortSignal));
      const signal = readChild.mock.calls[0]?.[1];
      expect(signal?.aborted).toBe(false);
      expect(settled).not.toHaveBeenCalled();

      if (outcome === 'timely') {
        finish(raw);
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            facts: [expect.objectContaining({ from: node.id, to: sourceId })],
          }),
        );
        expect(signal?.aborted).toBe(false);
      } else {
        authorized = outcome !== 'revoked';
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        const gap = authorized ? 'subflow-evidence-unavailable' : 'turn-unavailable';
        expect(settled).toHaveBeenCalledExactlyOnceWith({ gaps: [gap] });
        finish(raw);
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toHaveBeenCalledExactlyOnceWith({ gaps: [gap] });
      }
    } finally {
      finish(raw);
      vi.useRealTimers();
    }
  },
);
