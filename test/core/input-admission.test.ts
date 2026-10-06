/**
 * A refused input is a recorded attempt, not an admitted conversation.
 * Test the NEXT call too: stopping the first model call alone did not stop
 * the refused text riding a checkpoint into a later one.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  deny,
  MessageDeniedError,
  NoConversationError,
  type AgentRunCheckpoint,
  type MessageOutcome,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest } from '../../src/adapters/types.js';

const secret = 'refused-input-918273';
const refusals: readonly (readonly [string, () => MessageOutcome])[] = [
  ['deny', () => deny('not admitted')],
  [
    'throw',
    () => {
      throw new Error('gate unavailable');
    },
  ],
  ['ask', () => ask({ question: 'approve?' }) as never],
  ['non-text', () => allow({ invalid: true } as never, 'invalid transform')],
];

function build(reactMode: 'dynamic' | 'dynamic-grouped', refusal: () => MessageOutcome) {
  const requests: LLMRequest[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req) => {
        requests.push({ ...req, messages: req.messages.map((message) => ({ ...message })) });
        return `answer-${requests.length}`;
      },
    }),
    model: 'm',
    reactMode,
  })
    .system('sys')
    .act({
      input: [
        {
          name: 'admission',
          onMessage: (msg) => (msg.content.includes(secret) ? refusal() : allow()),
        },
      ],
    })
    .build();
  return { agent, requests };
}

for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
  describe(`input admission (${mode})`, () => {
    for (const [label, refusal] of refusals) {
      for (const continued of [false, true]) {
        it(`${label}, ${
          continued ? 'continued' : 'fresh'
        }: no conversation checkpoint survives refusal`, async () => {
          const { agent, requests } = build(mode, refusal);
          let prior: AgentRunCheckpoint | undefined;
          if (continued) {
            await agent.run('accepted first turn');
            prior = agent.checkpoint();
          }
          const priorBytes = JSON.stringify(prior);
          const beforeCalls = requests.length;
          const work: boolean[] = [];
          agent.on('agentfootprint.integrity.disposition', (event) => {
            work.push(event.payload.workExisted);
          });

          await expect(
            agent.run({ message: secret, ...(prior && { continueFrom: prior }) }),
          ).rejects.toBeInstanceOf(MessageDeniedError);
          expect(requests).toHaveLength(beforeCalls);
          expect(work).toEqual([false]);
          expect(agent.checkpoint()).toBeUndefined();
          const state = agent.getLastSnapshot()!.sharedState;
          expect(state).not.toHaveProperty('history');
          expect(state).not.toHaveProperty('userMessage');
          expect(state).toMatchObject({
            messageDeniedPhase: 'input',
            messageDeniedBy: 'admission',
            middlewareDecisions: [expect.objectContaining({ outcome: 'deny', phase: 'input' })],
          });
          // The reason is the refusal, not an unfinished run: a refusal raises
          // MessageDeniedError, which carries no checkpoint to catch. A refused
          // FIRST turn has no earlier accepted checkpoint to point at, so it is
          // still 'never-run'.
          const refusedFollowUp = agent.followUp('safe next turn');
          await expect(refusedFollowUp).rejects.toBeInstanceOf(NoConversationError);
          await expect(refusedFollowUp).rejects.toMatchObject({
            reason: continued ? 'last-input-refused' : 'never-run',
          });
          if (continued) {
            await expect(refusedFollowUp).rejects.toThrow(/earlier accepted checkpoint/);
          } else {
            await expect(refusedFollowUp).rejects.not.toThrow(/earlier accepted/);
          }
          await expect(refusedFollowUp).rejects.not.toThrow(/RunCheckpointError/);
          expect(requests).toHaveLength(beforeCalls);
          expect(JSON.stringify(prior)).toBe(priorBytes);

          // The caller's last admitted checkpoint is still usable. No implicit
          // fallback to another run, no denied text, no stale restoration flag.
          await agent.run({ message: 'safe next turn', ...(prior && { continueFrom: prior }) });
          expect(JSON.stringify(requests.at(-1))).not.toContain(secret);
          expect(requests.at(-1)!.messages.filter((m) => m.role !== 'system')).toEqual([
            ...(prior?.history ?? []),
            { role: 'user', content: 'safe next turn' },
          ]);
          await agent.run('fresh again');
          expect(requests.at(-1)!.messages.filter((m) => m.role !== 'system')).toEqual([
            { role: 'user', content: 'fresh again' },
          ]);
        });
      }
    }

    it('a refused retry cannot restore already-recorded failed-turn messages', async () => {
      const { agent, requests } = build(mode, refusals[0]![1]);
      await agent.run('accepted first turn');
      const prior = agent.checkpoint()!;
      const failed: AgentRunCheckpoint = {
        ...prior,
        originalInput: { message: secret },
        history: [
          ...prior.history,
          { role: 'user', content: secret },
          { role: 'assistant', content: 'partial answer derived from refused input' },
          { role: 'user', content: 'synthetic repair instruction' },
        ],
      };
      const bytes = JSON.stringify(failed);
      await expect(agent.resumeOnError(failed)).rejects.toBeInstanceOf(MessageDeniedError);
      expect(requests).toHaveLength(1);
      expect(agent.checkpoint()).toBeUndefined();
      expect(agent.getLastSnapshot()!.sharedState).not.toHaveProperty('history');
      expect(JSON.stringify(failed)).toBe(bytes);
      await expect(agent.followUp('safe follow-up')).rejects.toBeInstanceOf(NoConversationError);
      await agent.run({ message: 'safe next turn', continueFrom: prior });
      expect(JSON.stringify(requests.at(-1))).not.toContain(secret);
    });

    it('rewrite then deny records the decision, but never admits the rewritten text', async () => {
      const agent = Agent.create({
        provider: mock({ reply: 'unused' }),
        model: 'm',
        reactMode: mode,
      })
        .act({
          input: [
            { name: 'rewrite', onMessage: () => allow('rewritten refusal', 'rewrote the input') },
            { name: 'deny', onMessage: () => deny('not admitted') },
          ],
        })
        .build();
      await expect(agent.run(secret)).rejects.toBeInstanceOf(MessageDeniedError);
      expect(agent.checkpoint()).toBeUndefined();
      expect(agent.getLastSnapshot()!.sharedState).toMatchObject({
        middlewareDecisions: [
          expect.objectContaining({ outcome: 'allow', before: secret, after: 'rewritten refusal' }),
          expect.objectContaining({ outcome: 'deny' }),
        ],
      });
      // The audit pair still exists: this is admission, not record redaction.
      expect(agent.getLastSnapshot()!.sharedState).not.toHaveProperty('history');
    });

    it('a denied retry restores no conversation metadata and clears it before a fresh run', async () => {
      const agent = Agent.create({ provider: mock({ reply: 'safe' }), model: 'm', reactMode: mode })
        .time({ zone: 'UTC' })
        .act({
          input: [
            { name: 'gate', onMessage: (msg) => (msg.content === secret ? deny('no') : allow()) },
          ],
        })
        .build();
      await agent.run('accepted');
      const failed: AgentRunCheckpoint = {
        ...agent.checkpoint()!,
        originalInput: { message: secret },
        folded: [
          {
            summaryFingerprint: 'old-summary',
            runId: 'old-run',
            iteration: 1,
            foldedAtMs: 1,
            model: 'm',
            messageCount: 1,
            removedStageIds: ['old-stage'],
            retained: 'conversation',
            messages: [{ role: 'user', content: secret }],
          },
        ],
      };
      expect(failed.findingsLedger!.length).toBeGreaterThan(0);
      await expect(agent.resumeOnError(failed)).rejects.toBeInstanceOf(MessageDeniedError);
      const state = agent.getLastSnapshot()!.sharedState;
      for (const key of ['history', 'userMessage', 'foldedSpans', 'findingsLedger', 'turnNumber']) {
        expect(state).not.toHaveProperty(key);
      }
      expect(agent.checkpoint()).toBeUndefined();
      await agent.run('fresh');
      const fresh = agent.checkpoint()!;
      expect(fresh.folded).toBeUndefined();
      expect(fresh.findingsLedger).toHaveLength(1);
      expect(agent.getLastSnapshot()!.sharedState).toMatchObject({ turnNumber: 1 });
    });
  });
}
