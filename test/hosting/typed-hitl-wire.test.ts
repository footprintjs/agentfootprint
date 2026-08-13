/**
 * Typed HITL over the wire (9.24.0) — `PendingAsk.component` end to end.
 *
 * The laws being pinned:
 *   • The served pause carries the component on `PendingAsk.component` — ONE
 *     place a screen looks, whichever pause kind carried it — and the stored
 *     `'flowchart-v1'` envelope keeps it through a real JSON cycle, so a
 *     hydrate-then-resume session shows the same question the pause raised.
 *   • Both shipped dialects carry it verbatim in their `awaiting` bodies
 *     (`jsonWire`, `agentCoreRuntimeWire`) — the payload upgrade needed zero
 *     dialect edits, and this test is what notices if a dialect starts
 *     projecting fields.
 *   • The decision posts back through the SAME field it always did
 *     (`decision`), and the resumed run completes.
 *   • Zero-cost: a component-less pause serves a `PendingAsk` with no
 *     `component` key — byte-identical to 9.23.
 */

import { describe, expect, it } from 'vitest';

import { Agent, askHuman, defineTool, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { jsonWire, memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { PendingAsk } from '../../src/hosting/index.js';
import { agentCoreRuntimeWire } from '../../src/hosting-providers.js';
import { inProcessHost } from './testHost.js';

const OPTION_MARKER = 'WIRE_OPT_7c1d';
const options = Array.from({ length: 200 }, (_, i) => ({
  id: `option-${i}`,
  label: `${OPTION_MARKER} reason #${i}`,
}));

function pickerAgent(store = inMemoryArtifacts()): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'pick_reason', args: {} }] },
        { content: 'refund filed' },
      ],
    }),
    model: 'test-model',
    maxIterations: 3,
    artifacts: store,
  })
    .system('terse')
    .tool(
      defineTool({
        name: 'pick_reason',
        description: 'ask the person to pick a refund reason',
        execute: async (_args, ctx) => {
          const meta = await ctx.artifacts.put({
            kind: 'options/list',
            mediaType: 'application/json',
            data: options,
            label: 'refund reasons',
          });
          return askHuman({
            question: 'Which reason?',
            component: { componentId: 'option-picker', propsRef: meta.ref },
          });
        },
      }),
    )
    .build();
}

function plainAskAgent(): Agent {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 't1', name: 'approve', args: {} }] }, { content: 'done' }],
    }),
    model: 'test-model',
    maxIterations: 3,
  })
    .system('terse')
    .tool(
      defineTool({
        name: 'approve',
        description: 'ask',
        execute: () => askHuman({ question: 'Approve?' }),
      }),
    )
    .build();
}

describe('typed HITL — the served round trip', () => {
  it('awaiting carries component; the store keeps the options; the decision resumes it', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: pickerAgent(), sessions, host });
    try {
      const first = await host.deliver({ input: 'refund order 9', sessionId: 's-1' });
      expect(first.awaiting).toBeDefined();
      const pending = first.awaiting as PendingAsk;
      // ONE place a screen looks, whatever kind of pause carried it.
      expect(pending.component?.componentId).toBe('option-picker');
      expect(pending.component?.propsRef).toMatch(/^art_/);
      expect(pending.question).toBe('Which reason?');
      // The 200 options are STORE freight, not reply freight and not session
      // freight: neither the awaiting body nor the stored envelope carries a
      // single option byte, while the ref stays redeemable.
      expect(JSON.stringify(pending)).not.toContain(OPTION_MARKER);
      const stored = await sessions.hydrate('s-1');
      expect(stored?.format).toBe('flowchart-v1');
      const throughJson = JSON.parse(JSON.stringify(stored)) as {
        data: { pending: PendingAsk };
      };
      expect(JSON.stringify(throughJson)).not.toContain(OPTION_MARKER);
      // …and the component survives the storage cycle intact, so a support
      // view hydrating the session sees the same typed question.
      expect(throughJson.data.pending.component).toEqual(pending.component);

      // The decision returns through the SAME field it always did.
      const second = await host.deliver({ input: '', sessionId: 's-1', decision: 'option-42' });
      expect(second.output).toBe('refund filed');
    } finally {
      await handle.close();
    }
  });

  it('a component-less pause serves a PendingAsk with no component key (zero-delta)', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: plainAskAgent(), sessions, host });
    try {
      const first = await host.deliver({ input: 'go', sessionId: 's-2' });
      expect(first.awaiting).toBeDefined();
      expect('component' in (first.awaiting as PendingAsk)).toBe(false);
      const second = await host.deliver({ input: '', sessionId: 's-2', decision: 'yes' });
      expect(second.output).toBe('done');
    } finally {
      await handle.close();
    }
  });
});

describe('typed HITL — both shipped dialects carry the component verbatim', () => {
  const pending: PendingAsk = {
    sessionId: 's-9',
    tool: 'pick_reason',
    question: 'Which reason?',
    component: {
      componentId: 'option-picker',
      props: { title: 'Pick one' },
      propsRef: 'art_abcdefghijklmnopqrstuv',
    },
    pauseData: {
      toolCallId: 't1',
      toolName: 'pick_reason',
      question: 'Which reason?',
      component: {
        componentId: 'option-picker',
        props: { title: 'Pick one' },
        propsRef: 'art_abcdefghijklmnopqrstuv',
      },
    },
  };

  it('jsonWire', () => {
    const body = JSON.parse(JSON.stringify(jsonWire.awaiting?.(pending))) as {
      awaiting: PendingAsk;
    };
    expect(body.awaiting.component).toEqual(pending.component);
  });

  it('agentCoreRuntimeWire', () => {
    const body = JSON.parse(JSON.stringify(agentCoreRuntimeWire().awaiting?.(pending))) as {
      awaiting: PendingAsk;
      status: string;
    };
    expect(body.status).toBe('awaiting');
    expect(body.awaiting.component).toEqual(pending.component);
  });
});
