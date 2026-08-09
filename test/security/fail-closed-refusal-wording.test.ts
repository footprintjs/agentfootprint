/**
 * What a fail-closed refusal SAYS to the model (9.4.0).
 *
 * A permission checker that throws is treated as deny-by-default — something
 * that did not answer did not say yes. That part is old and right. What the
 * model was TOLD was the checker's own thrown message, and those are written
 * for operators: "not available right now", "ECONNREFUSED", "timed out". A
 * model reads weather and waits for it to change. In a real deployment one did
 * exactly that — re-called the same tool until `maxIterations` ran out and
 * returned the empty string, with the reason nowhere a human was looking.
 *
 * The refusal is now terminal, in the bracketed `[permission denied: …]` form
 * the local policy has always used and that models adapt to cleanly. The thrown
 * message stays where operators actually look: the typed event's `rationale`.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import type {
  LLMProvider,
  LLMResponse,
  PermissionChecker,
  PermissionDecision,
} from '../../src/adapters/types.js';

/** The exact shape of message that taught a model to wait. */
const TRANSIENT = "Tool 'refund' is not available right now.";

function scripted(...responses: LLMResponse[]): LLMProvider {
  let index = 0;
  return { name: 'mock', complete: async () => responses[Math.min(index++, responses.length - 1)] };
}

function reply(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 10, output: 5 },
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

/** A checker that cannot answer — the shape of every unreachable policy engine. */
const unreachable: PermissionChecker = {
  name: 'unreachable',
  check(): Promise<PermissionDecision> {
    return Promise.reject(new Error(TRANSIENT));
  },
};

async function runAgainst(checker: PermissionChecker) {
  let ran = false;
  const rationales: string[] = [];
  const agent = Agent.create({
    provider: scripted(reply('', [{ id: 't1', name: 'refund', args: {} }]), reply('understood')),
    model: 'mock',
    permissionChecker: checker,
  })
    .system('')
    .tool({
      schema: { name: 'refund', description: '', inputSchema: { type: 'object' } },
      execute: () => {
        ran = true;
        return 'refunded';
      },
    })
    .build();

  agent.on('agentfootprint.permission.check', (e) => {
    const payload = (e as { payload: { rationale?: string } }).payload;
    if (payload.rationale) rationales.push(payload.rationale);
  });
  await agent.run({ message: 'refund it' });
  return { ran, rationales, transcript: JSON.stringify(agent.checkpoint()?.history ?? []) };
}

// ── unit ────────────────────────────────────────────────────────────

describe('a permission checker that cannot answer', () => {
  it('still fails closed — the tool does not run', async () => {
    const { ran } = await runAgainst(unreachable);
    expect(ran).toBe(false);
  });

  it('tells the model in the bracketed form, and says the answer will not change', async () => {
    const { transcript } = await runAgainst(unreachable);
    expect(transcript).toContain("[permission denied: Tool 'refund'");
    expect(transcript).toMatch(/will not change during this run/);
    expect(transcript).toMatch(/do not call it again/i);
  });

  it('gives the model something to do instead of retrying', async () => {
    const { transcript } = await runAgainst(unreachable);
    // A refusal that only says "no" leaves the loop with one move: try again.
    expect(transcript).toMatch(/continue without it|say what you are unable to do/i);
  });
});

// ── security — an operator's fact is not a model's fact ─────────────

describe('the thrown message', () => {
  it('never reaches the model, however transient it reads', async () => {
    const { transcript } = await runAgainst(unreachable);
    expect(transcript).not.toContain(TRANSIENT);
    expect(transcript).not.toContain('right now');
  });

  it('does reach the operator, on the typed event where it was always going', async () => {
    const { rationales } = await runAgainst(unreachable);
    expect(rationales.join('\n')).toContain(TRANSIENT);
    expect(rationales.join('\n')).toContain('permission-checker threw');
  });

  it('takes infrastructure detail out of the transcript with it', async () => {
    const leaky: PermissionChecker = {
      name: 'leaky',
      check(): Promise<PermissionDecision> {
        return Promise.reject(
          new Error('connect ECONNREFUSED 10.0.3.14:8443 (policy-svc.internal)'),
        );
      },
    };
    const { transcript, rationales } = await runAgainst(leaky);
    expect(transcript).not.toContain('10.0.3.14');
    expect(transcript).not.toContain('policy-svc.internal');
    expect(rationales.join('\n')).toContain('10.0.3.14');
  });
});

// ── boundary — an explicit decision still speaks for itself ─────────

describe('the change is scoped to the checker that THREW', () => {
  it('an explicit deny still carries its own rationale to the model', async () => {
    const denies: PermissionChecker = {
      name: 'denies',
      check: () => ({ result: 'deny' as const, rationale: 'needs a supervisor' }),
    };
    const { transcript, ran } = await runAgainst(denies);
    expect(ran).toBe(false);
    // A checker that ANSWERED chose its words; those still reach the model.
    expect(transcript).toContain('needs a supervisor');
  });

  it("an explicit deny's own tellLLM still wins", async () => {
    const denies: PermissionChecker = {
      name: 'denies',
      check: () => ({
        result: 'deny' as const,
        rationale: 'telemetry only',
        tellLLM: 'Refunds are handled by a person.',
      }),
    };
    const { transcript } = await runAgainst(denies);
    expect(transcript).toContain('Refunds are handled by a person.');
    expect(transcript).not.toContain('telemetry only');
  });
});
