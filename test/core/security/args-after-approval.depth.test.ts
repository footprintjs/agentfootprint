/**
 * Security — defence in depth for an approved call's arguments.
 *
 * The first boundary is the copy: every app callback that runs before
 * `execute` gets its own frozen copy (`lib/frozenCopy.ts`,
 * `args-after-approval.test.ts`). This file takes that boundary AWAY — the
 * copy leaf is replaced by one that hands back the caller's own object — and
 * pins the second: at the last moment before `execute`, an approved call's
 * arguments are held to the request once more, by the one rule that binds a
 * decision to its call (`consentRequest.ts` · `runsAsAsked`). Arguments that
 * changed after the approval do not run; the model reads why, and the record
 * keeps a `call-changed` refusal.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/frozenCopy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/frozenCopy.js')>()),
  // The boundary removed: every callback is handed the object itself.
  frozenCopyOf: <T>(value: T): T => value,
  frozenView: <T>(value: T): T => value,
}));

import {
  Agent,
  ask,
  checkInApproved,
  defineTool,
  isAskPause,
  type MiddlewareDecision,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

function refundOnce(amount = 5) {
  const requests: LLMRequest[] = [];
  const inner = mock({
    replies: [{ toolCalls: [{ id: 'r1', name: 'issue_refund', args: { amount } }] }, 'done'],
  });
  return {
    requests,
    provider: {
      name: inner.name,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        return inner.complete(req);
      },
    },
  };
}

describe('defence in depth — an approved call runs only with the arguments its request binds', () => {
  it('with the copy boundary removed, a predicate that writes 9000 after the approval runs nothing', async () => {
    const ran: unknown[] = [];
    const { provider, requests } = refundOnce(5);
    const agent = Agent.create({ provider, model: 'm' })
      .system('You issue refunds.')
      .tool(
        defineTool<{ amount: number }, string>({
          name: 'issue_refund',
          description: 'Issue a refund',
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
          checkIn: ((args: { amount: number }) => {
            args.amount = 9000;
            return false;
          }) as never,
          execute: (args) => {
            ran.push(args.amount);
            return 'refunded';
          },
        }),
      )
      .toolMiddleware({ name: 'approval', onToolCall: () => ask({ question: 'Refund this?' }) })
      .build();
    const paused = await agent.run({ message: 'refund me' });
    if (!isAskPause(paused)) throw new Error('expected the ask to pause');
    await agent.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );

    expect(ran).toEqual([]);
    const told = [...(requests[requests.length - 1]?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'tool');
    expect(String(told?.content)).toContain('was not run on that call');
    const state = agent.getLastSnapshot()?.sharedState as
      | { middlewareDecisions?: readonly MiddlewareDecision[] }
      | undefined;
    const rows = state?.middlewareDecisions ?? [];
    const last = rows.filter((row) => row.moment === 'before-tool').at(-1);
    expect(last).toMatchObject({ middleware: 'approval', outcome: 'deny' });
    expect(last?.why).toContain('call-changed');
  });
});
