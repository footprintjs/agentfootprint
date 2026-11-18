/**
 * A tool that pauses again on a RESUMED dispatch is refused as an error — the
 * resume has no second checkpoint to give. Three doors reach that refusal
 * (`execution/resumedInvocation.ts` · `resolveCredentialAndExecute`): an
 * approved check-in, an approved middleware ask, and granted credential
 * consent. The sentence the model, the history and the narrative read used
 * to name "an approved check-in" on all three, so an ask or a credential
 * resume reported a gate that was never involved. It now names the door the
 * call actually came through; the check-in sentence is unchanged.
 */

import { describe, expect, it } from 'vitest';

import { Agent, ask, checkInApproved, defineTool, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { pauseHere } from '../../../src/core/pause.js';
import { bearer } from '../../../src/identity.js';
import type { CredentialProvider } from '../../../src/identity.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

type Door = 'checkIn' | 'ask' | 'credential';

function build(door: Door, vault?: { granted: boolean }) {
  const toolResults: string[] = [];
  const credentials: CredentialProvider = {
    id: 'vault',
    async getCredential() {
      return vault?.granted
        ? { status: 'issued', credential: bearer('synthetic-token') }
        : {
            status: 'authorization-required',
            authorizationUrl: 'https://consent.example.test/authorize',
            sessionId: 's1',
          };
    },
  };
  let builder = Agent.create({
    provider: mock({
      respond: (req: LLMRequest) => {
        for (const m of req.messages) if (m.role === 'tool') toolResults.push(m.content);
        return req.messages.some((m) => m.role === 'tool')
          ? { content: 'done' }
          : { toolCalls: [{ id: 'c1', name: 'refund', args: {} }] };
      },
    }),
    model: 'mock',
    ...(door === 'credential' && { credentials }),
  }).tool(
    defineTool({
      name: 'refund',
      description: 'refunds',
      inputSchema: { type: 'object', properties: {} },
      ...(door === 'checkIn' && { checkIn: 'always' as const }),
      ...(door === 'credential' && { needs: { credential: 'billing' } }),
      execute: () => pauseHere({ question: 'one more thing?' }),
    }),
  );
  if (door === 'ask') {
    builder = builder.toolMiddleware({
      name: 'approvals',
      onToolCall: () => ask({ question: 'refund?' }),
    });
  }
  return { agent: builder.build(), toolResults };
}

async function refusalThrough(door: Door): Promise<string> {
  const vault = { granted: false };
  const { agent, toolResults } = build(door, vault);
  const paused = await agent.run({ message: 'go' });
  if (!isPaused(paused)) throw new Error(`expected the ${door} pause`);
  vault.granted = true;
  const answer =
    door === 'credential'
      ? undefined
      : checkInApproved({ request: pausedRequest(paused), by: 'alice' });
  await agent.resume(paused.checkpoint, answer);
  return toolResults.find((r) => r.includes('requested a pause')) ?? '(none)';
}

describe('the refusal names the door the call came through', () => {
  it('an approved check-in keeps its sentence (control)', async () => {
    expect(await refusalThrough('checkIn')).toBe(
      "tool 'refund' requested a pause while resuming an approved check-in, which is not supported",
    );
  });

  it('an approved middleware ask says ask, not check-in', async () => {
    expect(await refusalThrough('ask')).toBe(
      "tool 'refund' requested a pause while resuming an approved ask, which is not supported",
    );
  });

  it('granted credential consent says so, not check-in', async () => {
    expect(await refusalThrough('credential')).toBe(
      "tool 'refund' requested a pause while resuming granted credential consent, which is not supported",
    );
  });
});
