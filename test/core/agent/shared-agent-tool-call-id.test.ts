/**
 * One shared agent, two concurrent invocations, one reused tool-call id — no
 * value from one invocation's tool result ever reaches the other's model
 * request.
 *
 * The regression this pins (found in review of the `absent({ among })` PR):
 * a dispatch-closure map keyed by tool-call id ALONE carried a per-call value
 * from a tool result to the model-bound message. The chart is built once and
 * its closures are shared by every mount of the agent, and a model reuses
 * call ids (`c1`) freely, so two invocations of one agent inside a
 * composition overwrote each other: Alice's next request received Bob's
 * private value. That map is gone; nothing in the dispatch may key a
 * per-call value by call id alone.
 *
 * Built like the reproduction: one `Agent` mounted twice in a `Parallel`, a
 * provider that proposes the SAME call id on every first turn, and a tool
 * whose result is private to the invocation that made it — the first call
 * to land waits longer, so the two interleave. Run in each of the agent's
 * three run modes.
 *
 * Sections (Convention 3): Security · Regression.
 */

import { describe, expect, it } from 'vitest';

import { absent, Agent, defineTool, Parallel } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;

const SECRETS = ['ALICE-PRIVATE-7731', 'BOB-PRIVATE-4419'] as const;

/** Names in each invocation's own inventory — read to check a count, never served. */
const INVENTORIES = [['ALICE-ARRAY-01', 'ALICE-ARRAY-02'], ['BOB-ARRAY-01']] as const;

type Shape = 'record' | 'absence';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function build(reactMode: (typeof MODES)[number], shape: Shape) {
  const requests: LLMRequest[] = [];
  let calls = 0;
  const provider = {
    name: 'scripted',
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      const answered = req.messages.some((m) => m.role === 'tool');
      return answered
        ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' }
        : {
            content: '',
            // The SAME id on every first turn, as a model is free to send.
            toolCalls: [{ id: 'c1', name: 'whose_record', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
    },
  };
  const tool = defineTool({
    name: 'whose_record',
    description: 'The caller’s own private record.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const who = calls % 2;
      const mine = SECRETS[who]!;
      // The first call waits longer, so the second lands first: interleaved.
      const wait = calls === 0 ? 30 : 5;
      calls += 1;
      await sleep(wait);
      if (shape === 'record') return { owner: mine };
      const names = INVENTORIES[who]!;
      return absent({
        what: mine,
        among: {
          argument: 'record_id',
          source: 'the caller’s own records',
          measuredAt: '2026-10-23T08:00:00Z',
          count: names.length,
          names,
        },
      });
    },
  });
  const shared = Agent.create({ provider, model: 'mock', reactMode })
    .system('Answer from the record.')
    .tool(tool)
    .build();
  const both = Parallel.create()
    .branch('alice', shared)
    .branch('bob', shared)
    .mergeWithFn((results) => Object.values(results).join(' | '))
    .build();
  return { both, requests };
}

const CASES = MODES.flatMap((mode) =>
  (['record', 'absence'] as const).map((shape) => [mode, shape]),
);

describe.each(CASES)(
  'a shared agent under reactMode %s, a tool returning a %s',
  (reactMode, shape) => {
    it('no value from one invocation’s tool result reaches the other’s model request', async () => {
      const { both, requests } = build(reactMode as (typeof MODES)[number], shape as Shape);
      await both.run({ message: 'show me my record' });
      const afterTool = requests.filter((r) => r.messages.some((m) => m.role === 'tool'));
      // Both invocations ran their tool and asked the model again.
      expect(afterTool).toHaveLength(2);
      const seen = new Set<string>();
      for (const request of afterTool) {
        const text = JSON.stringify(request);
        const carried = SECRETS.filter((secret) => text.includes(secret));
        // Exactly one invocation's value per request — never the other's.
        expect(carried).toHaveLength(1);
        seen.add(carried[0]!);
      }
      // And each invocation got its OWN value back.
      expect([...seen].sort()).toEqual([...SECRETS].sort());
      // An inventory's names are read to check the count and served to nobody.
      for (const name of INVENTORIES.flat()) expect(JSON.stringify(requests)).not.toContain(name);
    });
  },
);
