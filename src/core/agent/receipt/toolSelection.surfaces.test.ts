import { expect, it } from 'vitest';
import { Agent, defineTool, receiptAt, servedAt, slidingWindow } from '../../../index.js';
import { accountForAnswer } from '../../../answer-account/index.js';
import { mock } from '../../../adapters/llm/MockProvider.js';
import { defineSkill } from '../../../injection-engine.js';
import { type Recording, recordRun } from '../../../recorders/observability/recordRun.js';
import type { LLMRequest } from '../../../provider-contract/types.js';

const tool = (name: string, result: string) =>
  defineTool({ name, description: result, execute: () => result });

const visibleLoss = { name: 'read_status', wonBy: 'registry', lostBy: 'provider' };

async function observeVisibility(includeHiddenClaim: boolean) {
  const status = tool('read_status', 'Visible status');
  const alternateStatus = tool('read_status', 'Alternate status');
  const lookup = tool('lookup', 'Public lookup');
  const hiddenLookup = tool('lookup', 'Restricted implementation detail');
  const requests: Pick<LLMRequest, 'systemPrompt' | 'messages' | 'tools'>[] = [];
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: ({ systemPrompt, messages, tools }) => {
        requests.push({ systemPrompt, messages, tools });
        return 'Finished.';
      },
    }),
    permissionChecker: {
      name: 'fixture',
      governs: ['skill_read'],
      check: ({ target }) =>
        target === 'skill:restricted'
          ? { result: 'deny', rationale: 'Restricted' }
          : { result: 'allow' },
    },
  })
    .tool(status)
    .skill(
      defineSkill({
        id: 'restricted',
        description: 'Restricted procedure',
        body: 'Restricted procedure',
        tools: includeHiddenClaim ? [hiddenLookup] : [],
        autoActivate: 'currentSkill',
      }),
    )
    .toolProvider({
      id: 'catalog',
      list: () =>
        includeHiddenClaim ? [lookup, hiddenLookup, alternateStatus] : [lookup, alternateStatus],
    })
    .build();
  const events: unknown[] = [];
  const streamOffers: unknown[] = [];
  agent.on('agentfootprint.tools.shadowed', (e) => events.push(e.payload));
  agent.on('agentfootprint.tools.claim_swallowed', (e) => events.push(e.payload));
  agent.on('agentfootprint.stream.llm_start', (e) => streamOffers.push(e.payload.tools));
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message: 'Show status.' });
    const saved = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const selection = receiptAt(saved.snapshot, 1)?.toolSelection;
    const view = servedAt(saved.snapshot, 1);
    const account = accountForAnswer(saved);
    expect(answer).toBe('Finished.');
    expect(requests).toHaveLength(1);
    expect(streamOffers).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect(selection?.shadowed).toEqual([visibleLoss]);
    expect(selection?.absent).toEqual([]);
    expect(selection).not.toHaveProperty('bounded');
    expect(view?.tools.names).toContain('lookup');
    expect(view?.tools.names).toContain('read_status');
    return {
      requests,
      streamOffers,
      events,
      answer,
      selection: {
        absent: selection?.absent,
        shadowed: selection?.shadowed,
        bounded: selection?.bounded,
      },
      tools: view?.tools,
      account: {
        summary: account.summary.sentence.text,
        signals: account.signals.map((s) => s.sentence.text),
        rows: account.rows.map((r) => ({
          id: r.id,
          lines: r.lines.map((l) => l.text),
          chips: r.chips.map((c) => c.text),
        })),
      },
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('adding a role-hidden competing tool preserves visible offers, collision events, replay and the answer account', async () => {
  const absent = await observeVisibility(false);
  const hidden = await observeVisibility(true);
  expect(hidden).toEqual(absent);
  expect(JSON.stringify(hidden)).not.toContain('Restricted implementation detail');
});

it.each(['delta', 'full'] as const)(
  'retains the first request’s collision after its tool result leaves the window (%s)',
  async (commitValues) => {
    for (const evict of [false, true]) {
      let calls = 0;
      const histories: string[][] = [];
      const base = tool('read_status', 'Read status');
      const competitor = tool('read_status', 'Alternate status');
      const builder = Agent.create({
        model: 'mock',
        maxIterations: 10,
        commitValues,
        provider: mock({
          respond: (req) => {
            histories.push(
              req.messages.flatMap((m) =>
                m.role === 'tool' && m.toolCallId ? [m.toolCallId] : [],
              ),
            );
            calls++;
            return calls <= 6
              ? { toolCalls: [{ id: 'read-' + calls, name: 'read_status', args: {} }] }
              : 'Finished.';
          },
        }),
      })
        .tool(base)
        .toolProvider({ id: 'first-request-only', list: () => (calls === 0 ? [competitor] : []) });
      if (evict) builder.window(slidingWindow({ keepRecentTurns: 1 }));
      const agent = builder.build();
      const recorder = recordRun(agent);
      try {
        const answer = await agent.run({ message: 'Check status.' });
        expect(answer).toBe(
          evict
            ? 'Finished.\n\n---\n\nNot sure — 5 results from this turn were dropped from the conversation before the answer.'
            : 'Finished.',
        );
        expect(calls).toBe(7);
        expect(histories[1]).toContain('read-1');
        expect(histories.at(-1)?.includes('read-1')).toBe(!evict);
        expect(histories.at(-1)).toContain('read-6');
        const { snapshot } = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
        const served = servedAt(snapshot, calls);
        expect(
          served?.messages.asSent.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
        ).toEqual(histories.at(-1));
        const first = receiptAt(snapshot, 1);
        expect(first?.toolSelection).toEqual({
          consumer: { series: servedAt(snapshot, 1)?.callRuntimeStageId, attempt: 1 },
          absent: [],
          shadowed: [visibleLoss],
        });
        for (let epoch = 2; epoch <= calls; epoch++) {
          const later = receiptAt(snapshot, epoch);
          expect(later?.basis.epoch).toBe(epoch);
          expect(later).not.toHaveProperty('toolSelection');
        }
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    }
  },
);
