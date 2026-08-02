/**
 * llmSwarm — the classic Swarm with the LLM doing the routing.
 *
 * LAW tests. The one-call sugar has to keep every promise `swarm()`
 * already makes, plus its own:
 *
 *   - integration: a hand-off happens and the swarm halts on the
 *                  router's final answer
 *   - property:    one routing call per turn, plus one to start
 *   - honesty:     an id the roster doesn't contain follows swarm()'s
 *                  existing done/fallback law — nobody is picked instead
 *   - budget:      maxHandoffs still bounds the loop
 *   - adapter:     identical mock script ⇒ identical run (af's founding
 *                  pattern — the whole thing runs with no network)
 */

import { describe, it, expect } from 'vitest';
import { llmSwarm } from '../../../src/patterns/LlmSwarm.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** Router provider: answers from a script, remembers every request. */
function scriptedRouter(replies: readonly string[]): LLMProvider & { readonly seen: LLMRequest[] } {
  const seen: LLMRequest[] = [];
  let i = 0;
  return {
    name: 'scripted-router',
    seen,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      seen.push(req);
      const reply = replies[Math.min(i, replies.length - 1)] ?? '';
      i += 1;
      return { content: reply, toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' };
    },
  };
}

/** Specialist provider: tags what it was asked, counts its turns. */
function specialist(tag: string): LLMProvider & { calls: () => number } {
  let calls = 0;
  return {
    name: tag,
    calls: () => calls,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      calls += 1;
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      return {
        content: `${tag} handled "${last?.content ?? ''}"`,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
}

function agentFor(provider: LLMProvider) {
  return LLMCall.create({ provider, model: 'm' }).system('').build();
}

const HANDOFF = JSON.stringify({
  agentId: 'billing',
  message: 'please refund invoice 42',
  reason: 'money-shaped',
});
const FINISH = JSON.stringify({
  message: 'all set — your refund is on the way',
  reason: 'specialist answered',
});

describe('llmSwarm — hand-off and halt', () => {
  it('routes to the specialist, then halts on the router’s final answer', async () => {
    const router = scriptedRouter([HANDOFF, FINISH]);
    const billing = specialist('billing');
    const tech = specialist('tech');

    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices and refunds.', runner: agentFor(billing) },
        { id: 'tech', description: 'Errors and outages.', runner: agentFor(tech) },
      ],
      maxHandoffs: 4,
    });

    const answer = await desk.run({ message: 'my invoice is wrong' });

    expect(answer).toBe('all set — your refund is on the way');
    expect(billing.calls()).toBe(1);
    expect(tech.calls()).toBe(0);
  });

  it('hands the router’s message to the specialist, and the specialist’s answer back to the router', async () => {
    const router = scriptedRouter([HANDOFF, FINISH]);
    const billing = specialist('billing');

    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices and refunds.', runner: agentFor(billing) },
        { id: 'tech', description: 'Errors and outages.', runner: agentFor(specialist('tech')) },
      ],
    });

    await desk.run({ message: 'my invoice is wrong' });

    const asked = router.seen.map((r) => r.messages.map((m) => m.content).join(' '));
    expect(asked[0]).toContain('my invoice is wrong');
    // The second routing call reads what the specialist actually said.
    expect(asked[1]).toContain('billing handled "please refund invoice 42"');
  });

  it('calls the router once per turn, plus once to start', async () => {
    const router = scriptedRouter([HANDOFF, FINISH]);
    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices.', runner: agentFor(specialist('billing')) },
        { id: 'tech', description: 'Errors.', runner: agentFor(specialist('tech')) },
      ],
    });

    await desk.run({ message: 'my invoice is wrong' });

    // 1 opening decision + 1 after the single specialist turn.
    expect(router.seen).toHaveLength(2);
  });

  it('surfaces every decision as a route_decided event, reason included', async () => {
    const router = scriptedRouter([HANDOFF, FINISH]);
    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices.', runner: agentFor(specialist('billing')) },
        { id: 'tech', description: 'Errors.', runner: agentFor(specialist('tech')) },
      ],
    });

    const decisions: { chosen: string; evidence?: unknown }[] = [];
    desk.on('agentfootprint.composition.route_decided', (e) => {
      // The swarm's own Conditional also announces which branch it took;
      // keep only the router's decisions (they carry evidence).
      if (e.payload.evidence !== undefined) {
        decisions.push({ chosen: e.payload.chosen, evidence: e.payload.evidence });
      }
    });

    await desk.run({ message: 'my invoice is wrong' });

    expect(decisions).toEqual([
      { chosen: 'billing', evidence: { reason: 'money-shaped', inRoster: true } },
      // No agent was named, so there is no roster question to answer.
      { chosen: 'done', evidence: { reason: 'specialist answered' } },
    ]);
  });
});

describe('llmSwarm — halting laws', () => {
  it('answers immediately when the opening decision names no agent', async () => {
    const router = scriptedRouter([
      JSON.stringify({ message: 'you are already refunded', reason: 'nothing to do' }),
    ]);
    const billing = specialist('billing');

    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices.', runner: agentFor(billing) },
        { id: 'tech', description: 'Errors.', runner: agentFor(specialist('tech')) },
      ],
    });

    const answer = await desk.run({ message: 'am I refunded?' });

    expect(answer).toBe('you are already refunded');
    expect(billing.calls()).toBe(0);
    expect(router.seen).toHaveLength(1);
  });

  it('an id outside the roster follows swarm()’s done/fallback law — nobody is picked instead', async () => {
    const router = scriptedRouter([
      JSON.stringify({ agentId: 'legal', message: 'escalate to legal', reason: 'lawsuit' }),
    ]);
    const billing = specialist('billing');
    const tech = specialist('tech');

    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices.', runner: agentFor(billing) },
        { id: 'tech', description: 'Errors.', runner: agentFor(tech) },
      ],
    });

    const answer = await desk.run({ message: 'I will sue' });

    // swarm()'s Conditional falls through to its `done` branch (which
    // echoes the message) and the loop guard halts on the unknown id.
    expect(answer).toBe('escalate to legal');
    expect(billing.calls()).toBe(0);
    expect(tech.calls()).toBe(0);
  });

  it('maxHandoffs still bounds a router that never stops handing off', async () => {
    const router = scriptedRouter([JSON.stringify({ agentId: 'billing', message: 'go again' })]);
    const billing = specialist('billing');

    const desk = llmSwarm({
      provider: router,
      model: 'm',
      agents: [
        { id: 'billing', description: 'Invoices.', runner: agentFor(billing) },
        { id: 'tech', description: 'Errors.', runner: agentFor(specialist('tech')) },
      ],
      maxHandoffs: 3,
    });

    let turns = 0;
    desk.on('agentfootprint.composition.iteration_start', () => turns++);
    await desk.run({ message: 'start' });

    expect(turns).toBe(3);
    expect(billing.calls()).toBe(3);
  });

  it('rejects a roster smaller than 2, naming the call the consumer made', () => {
    expect(() =>
      llmSwarm({
        provider: scriptedRouter(['{}']),
        model: 'm',
        agents: [{ id: 'only', description: 'Everything.', runner: agentFor(specialist('only')) }],
      }),
    ).toThrow(/llmSwarm: must have >= 2 agents/);
  });

  it('keeps swarm()’s reserved-id law: an agent called "done" is rejected at build time', () => {
    expect(() =>
      llmSwarm({
        provider: scriptedRouter(['{}']),
        model: 'm',
        agents: [
          { id: 'done', description: 'Finishes things.', runner: agentFor(specialist('a')) },
          { id: 'tech', description: 'Errors.', runner: agentFor(specialist('b')) },
        ],
      }),
    ).toThrow(/"done" is reserved/);
  });
});

describe('llmSwarm — adapter-swap law', () => {
  it('runs the whole hand-off chain deterministically on a mock provider', async () => {
    const build = () =>
      llmSwarm({
        provider: scriptedRouter([HANDOFF, FINISH]),
        model: 'm',
        agents: [
          { id: 'billing', description: 'Invoices.', runner: agentFor(specialist('billing')) },
          { id: 'tech', description: 'Errors.', runner: agentFor(specialist('tech')) },
        ],
      });

    const first = await build().run({ message: 'my invoice is wrong' });
    const second = await build().run({ message: 'my invoice is wrong' });

    expect(first).toBe(second);
    expect(first).toBe('all set — your refund is on the way');
  });
});
