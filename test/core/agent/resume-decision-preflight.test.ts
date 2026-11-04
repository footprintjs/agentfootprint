import { describe, expect, it, vi } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../src/core/agent/types.js';
import type { ToolCallsHandlerDeps } from '../../../src/core/agent/stages/toolCalls/contracts/handlerDeps.js';
import type { ToolCallOperations } from '../../../src/core/agent/stages/toolCalls/compose.js';
import { buildToolResume } from '../../../src/core/agent/stages/toolCalls/resume/handler.js';
import { mintConsentRequest, watchDecisionUse } from '../../../src/core/consentRequest.js';

describe('resume resource preflight and an unused consent decision', () => {
  for (const gate of ['ask', 'checkIn'] as const) {
    it.each(['facts', 'restore'] as const)(
      gate + ': a %s refusal leaves the approval unused before any provider or durable effect',
      async (refusal) => {
        const minted = mintConsentRequest({
          gate,
          tool: 'refund',
          toolCallId: 'held-refund',
          party: { channel: 'static' },
          args: { amount: 10 },
          ...(gate === 'ask' ? { middleware: 'approval', askIndex: 0, chain: ['approval'] } : {}),
        });
        if (minted === undefined) throw new Error('fixture request did not bind');
        const error = new Error('resource preflight refused');
        const watch = watchDecisionUse(minted.request.id);
        const restore = vi.fn(() => {
          throw error;
        });
        const prepareProviderTools = vi.fn();
        const awaitDurable = vi.fn();
        const resumeAsk = vi.fn();
        const resumeCheckIn = vi.fn();
        const readEnvironment = vi.fn();
        const facts = vi.fn(() => {
          if (refusal === 'facts') throw error;
          return {};
        });
        const deps = {
          resources: { restore },
          prepareProviderTools,
          awaitDurable,
        } as unknown as ToolCallsHandlerDeps;
        const operations = {
          resourceFactsOf: facts,
          resumeAsk,
          resumeCheckIn,
        } as unknown as ToolCallOperations;
        const scope = {
          ...(gate === 'ask' ? { pausedAsk: true } : { pausedCheckIn: true }),
          $getValue: (key: string) => (key === 'pausedRequest' ? minted.request : undefined),
          $getEnv: readEnvironment,
        } as unknown as TypedScope<AgentState>;
        try {
          await expect(buildToolResume(deps, operations)(scope, undefined)).rejects.toBe(error);
          expect(await watch.mayHaveBeenUsed()).toBe(false);
          expect(facts).toHaveBeenCalledOnce();
          expect(restore).toHaveBeenCalledTimes(refusal === 'restore' ? 1 : 0);
          expect(readEnvironment).not.toHaveBeenCalled();
          expect(awaitDurable).not.toHaveBeenCalled();
          expect(prepareProviderTools).not.toHaveBeenCalled();
          expect(resumeAsk).not.toHaveBeenCalled();
          expect(resumeCheckIn).not.toHaveBeenCalled();
        } finally {
          watch.release();
        }
      },
    );
  }
});
