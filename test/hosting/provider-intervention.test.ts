import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { streamHandler } from '../../src/hosting/streamHandler.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import { agUiSerializer } from '../../src/ag-ui/serializer.js';
import { REFUSAL_STATUS } from '../../src/hosting/refusalStatus.js';
import type { RunSettlement } from '../../src/hosting/protocolAdapter.js';

describe('provider intervention stays distinct on public hosting surfaces', () => {
  for (const [outcome, code, word] of [
    ['blocked', 'ERR_PROVIDER_BLOCKED', 'blocked'],
    ['unknown', 'ERR_PROVIDER_INTERVENTION_UNKNOWN', 'unknown'],
  ] as const) {
    it(`${outcome} has a closed non-crash status`, () => {
      expect(REFUSAL_STATUS[code]).toBe(422);
    });
    it(`${outcome} has fixed AG-UI words and its own code`, () => {
      const serializer = agUiSerializer({ threadId: 'thread', runId: 'run' });
      const events = serializer.settle({ kind: 'failed', refusal: code } as RunSettlement);
      expect(events).toContainEqual({
        type: 'RUN_ERROR',
        code,
        message: expect.stringContaining(word),
      });
      expect(events.some((event) => event.type === 'RUN_FINISHED')).toBe(false);
    });
    it(`${outcome} survives an in-process stream-handler request without timers or raw text`, async () => {
      const handle = streamHandler({
        heartbeatMs: 0,
        adapter: agUi(),
        agent: () =>
          Agent.create({
            model: 'scripted',
            provider: {
              name: 'scripted',
              complete: async () => ({
                content: 'PRIVATE_UNUSABLE_DRAFT',
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'content_filter',
                intervention: { outcome, code: 'guardrail_intervened', filters: [] },
              }),
            },
          }).build(),
      });
      const reply = await handle(
        new Request('http://localhost/api/agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            threadId: 't',
            runId: 'r',
            messages: [{ id: 'u1', role: 'user', content: 'hello' }],
            tools: [],
            context: [],
          }),
        }),
      );
      const wire = await reply.text();
      expect(wire).toContain(code);
      expect(wire).not.toContain('PRIVATE_UNUSABLE_DRAFT');
      expect(wire).not.toContain('RUN_FINISHED');
    });
  }
});
