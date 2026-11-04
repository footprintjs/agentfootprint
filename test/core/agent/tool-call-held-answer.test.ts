import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../src/core/agent/types.js';
import type { ToolMiddleware } from '../../../src/core/agent/middleware/types.js';
import {
  gatedCallOf,
  heldDecision,
  inMemoryDecisionLedger,
  mintConsentRequest,
  type GatedCall,
} from '../../../src/core/consentRequest.js';
import { checkInApproved } from '../../../src/core/checkin.js';
import { ResumeDecisionError, type ConsentGateKind } from '../../../src/core/pause.js';
import { buildHeldAnswer } from '../../../src/core/agent/stages/toolCalls/access/heldAnswer.js';

/** Pure held-decision fixture; the native dispatch/resume lifecycle is tested separately. */
function paused(gate: ConsentGateKind) {
  const ledger = inMemoryDecisionLedger();
  const call: GatedCall = {
    gate,
    tool: 'issue_refund',
    toolCallId: 'refund-1',
    party: { channel: 'static' },
    args: { amount: 500 },
    ...(gate === 'ask' && {
      middleware: 'approval',
      askIndex: 0,
      chain: ['approval', 'limit'],
    }),
  };
  const bound = mintConsentRequest(call, ledger);
  assert.ok(bound);
  const state: Record<string, unknown> = {
    pausedToolName: call.tool,
    pausedToolCallId: call.toolCallId,
    pausedToolParty: call.party,
    pausedRequest: bound.request,
    ...(gate === 'ask'
      ? {
          pausedAskArgs: bound.args,
          pausedAskMiddleware: call.middleware,
          pausedAskIndex: call.askIndex,
          pausedAskChain: call.chain,
        }
      : { pausedCheckInArgs: bound.args }),
  };
  const reads: string[] = [];
  const read = (key: string): unknown => {
    reads.push(key);
    return state[key];
  };
  // Only the read port is exercised: this is not a fabricated native run.
  const scope = { $getValue: read } as unknown as TypedScope<AgentState>;
  const decision = checkInApproved({ request: bound.request, by: 'tester' });
  return { ledger, bound, read, reads, scope, decision };
}

const middleware = (name: string): ToolMiddleware => ({
  name,
  onToolCall: () => {
    throw new Error('holding a decision must never dispatch a middleware');
  },
});

it('qualifies the paused fixture through the canonical decision holder', () => {
  const p = paused('ask');
  const held = heldDecision(
    p.decision,
    { kind: 'ask', toolName: 'issue_refund', middleware: 'approval' },
    p.bound.request,
    gatedCallOf(p.read, 'ask'),
    ['approval', 'limit'],
    p.ledger,
  );
  assert.deepEqual(held, p.decision);
});

it.each(['checkIn', 'ask'] as const)(
  'holds a valid %s decision using the current chain',
  (gate) => {
    const p = paused(gate);
    let callbackReads = 0;
    const hold = buildHeldAnswer(() => {
      callbackReads++;
      assert.ok(p.reads.includes('pausedRequest'));
      return [middleware('approval'), middleware('limit')];
    }, p.ledger);
    assert.equal(callbackReads, 0, 'construction must not read the live chain');
    assert.deepEqual(hold(p.scope, p.decision, gate), p.decision);
    assert.equal(callbackReads, 1);
  },
);

it('refuses an ask when the chain changes after the holder is constructed', () => {
  const p = paused('ask');
  let liveChain: readonly ToolMiddleware[] = [middleware('approval'), middleware('limit')];
  const hold = buildHeldAnswer(() => liveChain, p.ledger);
  liveChain = [middleware('approval')];
  assert.throws(
    () => hold(p.scope, p.decision, 'ask'),
    (error: unknown) =>
      error instanceof ResumeDecisionError &&
      error.reason === 'chain-changed' &&
      error.code === 'ERR_RESUME_DECISION',
  );
});
