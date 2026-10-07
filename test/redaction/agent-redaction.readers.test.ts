/**
 * The readers of a redacted record never read a placeholder as a value.
 *
 * A served record holds `[REDACTED]` / `REDACTED` where a policy selected a
 * value. A reader that took the placeholder for what the run produced would
 * state things the run did not do: "the question is not recorded", "this
 * record does not show the run finishing", "it did not run any tools", a
 * pause that never happened. Pinned here, reader by reader:
 *
 *   - the answer account (`lib/answer-account/view.ts`): a kept-out value is
 *     said to be KEPT OUT where it is read, and a reader that would touch one
 *     it does not handle makes the account refuse to tell (`notToldAccount`);
 *   - `assessAnswer`: no standing over a state key the record keeps out
 *     (`AnswerAssessment.keptOut`) — while `agent.assessment()` reads live;
 *   - the served views (`servedViews`, `servedAt`) read a redacted snapshot
 *     without throwing, and name the fold base it lacks.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../src/doors/observe.js';
import { servedViews } from '../../src/index.js';
import type { AnswerAccount, Sentence } from '../../src/lib/answer-account/types.js';
import { conversationPolicy, fixtureAgent, MESSAGE } from './fixture.js';

/** Every sentence of an account, as template ids. */
function idsOf(account: AnswerAccount): string[] {
  const sentences: Sentence[] = [
    ...account.rows.flatMap((r) => [r.heading, ...r.lines, ...(r.more ? [r.more] : [])]),
    ...account.signals.map((s) => s.sentence),
    ...account.unreachable.map((u) => u.sentence),
    account.summary.sentence,
  ];
  return sentences.map((s) => s.template.id);
}

async function accountOf(redact: RedactionPolicy | undefined) {
  const agent = fixtureAgent({ ...(redact && { redact }) });
  const recorder = recordRun(agent);
  await agent.run({ message: MESSAGE });
  const recording = recorder.toRecording();
  return { agent, recording, account: accountForAnswer(recording as never) };
}

describe('the answer account over a redacted recording', () => {
  it('CONTROL — without a policy it quotes the question and judges the result', async () => {
    const { account } = await accountOf(undefined);
    expect(account.question.status).toBe('recorded');
    expect(idsOf(account)).toContain('asked');
    expect(idsOf(account)).toContain('unreachable.empty');
  });

  it('the question, the answer and the result are said to be KEPT OUT', async () => {
    const { account } = await accountOf(conversationPolicy());
    const ids = idsOf(account);
    expect(account.question).toMatchObject({ status: 'not-recorded', missing: 'redacted' });
    expect(ids).toContain('asked.keptOut');
    expect(ids).not.toContain('asked.none');
    // The run answered; its answer is kept out — it did not stop short.
    expect(account.answer).toMatchObject({ status: 'not-recorded', missing: 'redacted' });
    expect(ids).not.toContain('summary.unfinished');
    // The emptiness check cannot read a result the record keeps out — and says why.
    expect(ids).toContain('unreachable.empty.redacted');
    expect(ids).not.toContain('unreachable.empty');
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'ran', emptiness: 'unknown' });
    expect(account.facts.calls[0]).not.toHaveProperty('view');
  });

  it('no standing is given over state the record keeps out', async () => {
    const { account } = await accountOf(conversationPolicy());
    expect(idsOf(account)).toContain('howSure.standing.keptOut');
    expect(account.facts.standing).toMatchObject({ status: 'not-recorded', missing: 'redacted' });
  });

  for (const [label, redact] of [
    ['every field name', { patterns: [/./] }],
    ['every event, whole', { emitPatterns: [/./] }],
  ] as const) {
    it(`${label}: the account refuses to tell — never "no tool ran"`, async () => {
      const { account } = await accountOf(redact as RedactionPolicy);
      const ids = idsOf(account);
      expect(account.summary.sentence.template.id).toBe('scope.keptOut');
      expect(ids).not.toContain('checked.noCalls');
      expect(ids).not.toContain('found.noCalls');
      expect(ids).not.toContain('summary.unfinished');
      expect(ids).not.toContain('scope.noOwnEvents');
    });
  }

  it('earlier results in front of the model, in a history kept out, are named as unread', async () => {
    const run = async (redact: RedactionPolicy | undefined) => {
      const agent = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'lookup', args: { id: 'x' } }] },
            { content: 'first answer' },
            { content: 'second answer' },
          ],
        }),
        model: 'mock',
        maxIterations: 4,
        ...(redact && { redact }),
      })
        .tool(
          defineTool<{ id: string }, unknown>({
            name: 'lookup',
            description: 'Look it up.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: () => ({ rows: [] }),
          }),
        )
        .build();
      await agent.run({ message: 'look it up' });
      const recorder = recordRun(agent);
      await agent.followUp('and then?');
      return accountForAnswer(recorder.toRecording() as never);
    };
    const control = await run(undefined);
    expect(control.facts.inView.length).toBeGreaterThan(0);
    const redacted = await run(conversationPolicy());
    expect(redacted.facts.inView).toEqual([]);
    expect(idsOf(redacted)).toContain('unreachable.inView.redacted');
  });
});

describe('assessAnswer over a redacted record', () => {
  it('gives no standing over a kept-out key, and names it', async () => {
    const { agent, recording } = await accountOf(conversationPolicy());
    const served = assessAnswer(recording as never);
    expect(served.standing).toBe('not-assessed');
    expect(served.keptOut).toContain('history');
    // The live accessor reads the live state — the policy never reaches it.
    expect(agent.assessment()?.keptOut).toBeUndefined();
  });

  it('a kept-out pause id is not a pause', async () => {
    const { recording } = await accountOf({ patterns: [/./] });
    const a = assessAnswer(recording as never);
    expect(a.standing).not.toBe('ask');
    expect(a.standing).toBe('not-assessed');
  });

  it('CONTROL — without a policy nothing is kept out', async () => {
    const { recording } = await accountOf(undefined);
    expect(assessAnswer(recording as never).keptOut).toBeUndefined();
  });
});

describe('the served views over a redacted snapshot', () => {
  for (const [label, redact] of [
    ['the conversation', conversationPolicy()],
    ['every name', { patterns: [/./] }],
  ] as const) {
    it(`${label}: read without throwing, and the missing fold base is named`, async () => {
      const agent = fixtureAgent({ redact: redact as RedactionPolicy });
      await agent.run({ message: MESSAGE });
      const views = servedViews(agent.getLastSnapshot() as never);
      expect(views.length).toBeGreaterThan(0);
      expect(views.some((v) => v.gaps.some((g) => g.gap === 'no-fold-base'))).toBe(true);
    });
  }
});
