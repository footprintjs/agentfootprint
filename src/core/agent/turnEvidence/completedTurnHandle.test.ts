import { describe, expect, it, vi } from 'vitest';

import type { AgentfootprintEventMap } from '../../../events/registry.js';
import {
  type CompletedAgentTurn,
  issueCompletedTurn,
  readCompletedTurn,
} from './completedTurnHandle.js';

const scope = { tenant: 'workspace', principal: 'operator', conversation: 'conversation-a' };
const owner = {};
const origin = {
  runId: 'turn-a',
  engineRunId: 'engine-leg-a',
  logAddress: { logRunId: 'engine-log-a', drillPath: [] },
};
const node = { id: 'reused-node', runId: origin.runId, logAddress: origin.logAddress };
const unavailable = { status: 'turn-unavailable' };

function evidence(run = origin) {
  const terminal: AgentfootprintEventMap['agentfootprint.agent.turn_end'] = {
    type: 'agentfootprint.agent.turn_end',
    payload: {
      turnIndex: 0,
      finalContent: 'fixture',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      iterationCount: 1,
      durationMs: 0,
    },
    meta: {
      runId: run.runId,
      runtimeStageId: 'final',
      subflowPath: [],
      compositionPath: [],
      wallClockMs: 0,
      runOffsetMs: 0,
      sourcePosition: {
        engineRunId: run.engineRunId,
        logRunId: run.logAddress.logRunId,
        drillPath: [],
        committedThroughIdx: 0,
      },
    },
  };
  return {
    snapshot: {
      runId: run.engineRunId,
      logAddress: run.logAddress,
      initialState: {},
      sharedState: {},
    },
    events: [terminal],
  };
}

describe('completed Agent turn capability', () => {
  it('retains exact provenance when multiple turns share an owner and raw node ID', async () => {
    const later = { ...origin, runId: 'turn-b', engineRunId: 'engine-leg-b' };
    const earlier = issueCompletedTurn({
      owner,
      origin,
      scope,
      source: { kind: 'live', recording: evidence() },
      allowed: (held) => held.conversation === scope.conversation,
    });
    const laterHandle = issueCompletedTurn({
      owner,
      origin: later,
      scope: { ...scope, conversation: 'conversation-b' },
      source: { kind: 'live', recording: evidence(later) },
      allowed: () => true,
    });
    expect(
      await readCompletedTurn(owner, laterHandle, { ...node, runId: later.runId }),
    ).toMatchObject({
      status: 'ready',
      turn: { terminal: { meta: { runId: later.runId } } },
    });
    expect(await readCompletedTurn(owner, earlier, node)).toMatchObject({
      status: 'ready',
      turn: { terminal: { meta: { runId: origin.runId } } },
    });
    expect(await readCompletedTurn(owner, earlier, { ...node, runId: later.runId })).toEqual(
      unavailable,
    );
  });

  it('refuses missing, forged and foreign handles without asking for the evidence', async () => {
    const allowed = vi.fn(() => true);
    const redeem = vi.fn(async () => ({
      ref: 'ref-a',
      originRunId: origin.runId,
      recording: evidence(),
    }));
    const handle = issueCompletedTurn({
      owner,
      origin,
      scope,
      allowed,
      source: { kind: 'saved', receiptRef: 'ref-a', redeem },
    });
    expect(await readCompletedTurn(owner, undefined)).toEqual(unavailable);
    expect(await readCompletedTurn(owner, {} as CompletedAgentTurn)).toEqual(unavailable);
    expect(await readCompletedTurn({}, handle)).toEqual(unavailable);
    expect(
      await readCompletedTurn(owner, handle, {
        ...node,
        logAddress: { ...node.logAddress, drillPath: ['foreign-mount'] },
      }),
    ).toEqual(unavailable);
    expect(allowed).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
  });

  it('asks for the original saved receipt and refuses a different ref with the same origin', async () => {
    let returnedRef = 'other-ref';
    const redeem = vi.fn(async () => ({
      ref: returnedRef,
      originRunId: origin.runId,
      recording: evidence(),
    }));
    const handle = issueCompletedTurn({
      owner,
      origin,
      scope,
      allowed: () => true,
      source: { kind: 'saved', receiptRef: 'ref-a', redeem },
    });
    expect(await readCompletedTurn(owner, handle, node)).toEqual(unavailable);
    expect(redeem).toHaveBeenCalledWith('ref-a');
    returnedRef = 'ref-a';
    expect(await readCompletedTurn(owner, handle, node)).toMatchObject({ status: 'ready' });
  });

  it('rejects revocation during saved redemption and refuses the next read before redemption', async () => {
    let allowed = true;
    const redeem = vi.fn(async () => {
      allowed = false;
      return { ref: 'ref-a', originRunId: origin.runId, recording: evidence() };
    });
    const handle = issueCompletedTurn({
      owner,
      origin,
      scope,
      allowed: () => allowed,
      source: { kind: 'saved', receiptRef: 'ref-a', redeem },
    });
    expect(await readCompletedTurn(owner, handle)).toEqual(unavailable);
    expect(await readCompletedTurn(owner, handle)).toEqual(unavailable);
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('rejects a selected snapshot using a different native log address', async () => {
    const recording = evidence();
    const events = vi.fn(() => recording.events);
    const handle = issueCompletedTurn({
      owner,
      origin,
      scope,
      allowed: () => true,
      source: {
        kind: 'live',
        recording: {
          get events() {
            return events();
          },
          snapshot: {
            ...recording.snapshot,
            logAddress: { logRunId: 'different-log', drillPath: [] },
          },
        },
      },
    });
    expect(await readCompletedTurn(owner, handle)).toEqual(unavailable);
    expect(events).not.toHaveBeenCalled();
  });
});
