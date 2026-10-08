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
 *     without throwing, and name the fold base it lacks;
 *   - the context ledger, whose gates decide what LATER runs are offered:
 *     a runner is counted from its live run, and a kind nothing can answer
 *     for is left unmetered — a placeholder never reads as "never used";
 *   - and the guard is a POSITIVE sign (`redaction/marker.ts`): without a
 *     policy, a value that merely looks like a placeholder is a value.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import { Agent, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  accountForAnswer,
  assessAnswer,
  contextLedger,
  ledgerToolGate,
  recordRun,
} from '../../src/doors/observe.js';
import { defineInstruction } from '../../src/injection-engine.js';
import { servedViews } from '../../src/index.js';
import type { AnswerAccount, Sentence } from '../../src/lib/answer-account/types.js';
import { REDACTION_MARKER_ID, servedUnderPolicy } from '../../src/redaction/marker.js';
import { assessLive } from '../../src/core/agent/assessment/assess.js';
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

  it('a declaration whose words are kept out: its items are counted and said kept out, never printed', async () => {
    // `{ keys: ['args'] }` keeps the arguments out and leaves the result readable,
    // so the account still judges the calls — and every coverage word on the
    // declarations' events (composed from the call: its event's words rows, `events/content.ts`) is kept out.
    const run = async (redact: RedactionPolicy | undefined) => {
      const agent = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'find', args: { id: 'ID-COV-1' } }] },
            { content: 'Nothing for that id.' },
          ],
        }),
        model: 'mock',
        maxIterations: 4,
        ...(redact && { redact }),
      })
        .tool(
          defineTool<{ id: string }, unknown>({
            name: 'find',
            description: 'Find records.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: ({ id }) =>
              absent({
                what: `records for ${id}`,
                checked: [`${id}: the live database`, 'the replica'],
                notChecked: [{ what: `the archive of ${id}`, why: 'too old', kind: 'existence' }],
              }),
          }),
        )
        .build();
      const recorder = recordRun(agent);
      await agent.run({ message: 'find it' });
      return accountForAnswer(recorder.toRecording() as never);
    };
    const lines = (account: AnswerAccount) =>
      account.rows.flatMap((r) => r.lines.map((l) => l.text)).join('\n');

    const control = await run(undefined);
    expect(lines(control)).toContain('ID-COV-1: the live database');
    expect(idsOf(control)).toContain('signal.existenceNotChecked.full');

    const redacted = await run({ keys: ['args'] });
    expect(idsOf(redacted)).not.toContain('scope.keptOut');
    // The calls are still told: the declaration, its items counted, the limit signalled.
    expect(idsOf(redacted)).toContain('checked.declared');
    expect(idsOf(redacted)).toContain('items.keptOut');
    expect(idsOf(redacted)).toContain('signal.existenceNotChecked.keptOut');
    expect(redacted.facts.calls[0]?.coverage).toMatchObject({ checked: 2, notChecked: 1 });
    expect(lines(redacted)).toContain('Kept out of this record: 2 items.');
    // Neither the words nor the placeholder are printed as words.
    const told = JSON.stringify(redacted.rows) + JSON.stringify(redacted.signals);
    expect(told).not.toContain('ID-COV-1');
    expect(told).not.toContain('REDACTED');
    expect(redacted.facts.calls[0]?.coverage?.lookedFor).toBeUndefined();
  });
});

describe('assessAnswer over a redacted record', () => {
  it('gives no standing over a kept-out key, and names it', async () => {
    const { agent, recording } = await accountOf(conversationPolicy());
    const served = assessAnswer(recording as never);
    expect(served.standing).toBe('not-assessed');
    expect(served.keptOut).toContain('history');
    // The live accessor reads the live state — the policy never reaches it:
    // the same assessment as the same run without a policy.
    const live = await agent.assessment();
    expect(live).toBeDefined();
    expect(live?.keptOut).toBeUndefined();
    const control = fixtureAgent();
    await control.run({ message: MESSAGE });
    expect(live).toEqual(await control.assessment());
  });

  it('the live fold reads a placeholder-looking value as a value; the served fold, as kept out', () => {
    // The live snapshot carries the marker too (it is a recorder on the
    // executor, and the commit log IS scrubbed), but its state is the run's
    // own heap: `Agent.assessment()` folds it as values (`assess.ts` · `assessLive`).
    const snapshot = {
      sharedState: { history: [{ role: 'user', content: 'q' }], pausedToolCallId: 'REDACTED' },
      recorders: [{ id: REDACTION_MARKER_ID, name: 'Redaction', data: {} }],
    };
    const served = assessAnswer({ snapshot } as never);
    expect(served.standing).toBe('not-assessed');
    expect(served.keptOut).toContain('pausedToolCallId');
    const live = assessLive(snapshot);
    expect(live.keptOut).toBeUndefined();
    expect(live.standing).toBe('ask');
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

describe('kept out is read from a positive sign, never from a value', () => {
  /** One `search` call returning `result`, recorded and accounted for. */
  const searchRun = async (result: unknown, redact: RedactionPolicy | undefined) => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { toolCalls: [{ id: 'c1', name: 'search', args: { q: 'x' } }] },
          { content: 'Done.' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
      ...(redact && { redact }),
    })
      .tool(
        defineTool<{ q: string }, unknown>({
          name: 'search',
          description: 'Search.',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute: () => result,
        }),
      )
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'find them' });
    const recording = recorder.toRecording();
    const account = accountForAnswer(
      recording as never,
      {
        tools: { search: { rowsAt: 'customers' } },
      } as never,
    );
    return { agent, recording, account };
  };

  it('the marker rides a served snapshot only: present under a policy, absent without one', async () => {
    const control = await searchRun({ customers: [] }, undefined);
    expect(servedUnderPolicy(control.agent.getLastSnapshot())).toBe(false);
    expect(servedUnderPolicy(control.recording.snapshot)).toBe(false);
    const served = await searchRun({ customers: [] }, conversationPolicy());
    expect(servedUnderPolicy(served.agent.getLastSnapshot())).toBe(true);
    expect(servedUnderPolicy(served.recording.snapshot)).toBe(true);
  });

  it('without a policy, a tool that returns the word REDACTED is read as what it returned', async () => {
    const word = await searchRun('REDACTED', undefined);
    const other = await searchRun('NOT-A-PLACEHOLDER', undefined);
    // Same account, sentence for sentence, as for any other string.
    expect(idsOf(word.account)).toEqual(idsOf(other.account));
    expect(idsOf(word.account).some((id) => /keptOut|\.redacted$/.test(id))).toBe(false);
    expect(word.account.facts.calls[0]).toEqual(other.account.facts.calls[0]);
  });

  it('a row set kept out INSIDE a result is said to be kept out, never "no list"', async () => {
    const rows = { total: 3, customers: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const control = await searchRun(rows, undefined);
    expect(idsOf(control.account)).not.toContain('unreachable.empty.redacted');
    expect(control.account.facts.calls[0]).toMatchObject({ emptiness: 'non-empty' });

    const served = await searchRun(rows, { keys: ['customers'] });
    const ids = idsOf(served.account);
    expect(ids).toContain('unreachable.empty.redacted');
    expect(served.account.facts.calls[0]).toMatchObject({ emptiness: 'unknown' });
    expect(ids.some((id) => /noList|no-list/i.test(id))).toBe(false);
  });
});

describe('the context ledger: a placeholder never reads as "never used"', () => {
  // The ledger's gates decide what LATER runs are offered — computation, so a
  // policy on the record must not demote a piece the run really used.
  const ledgerAgent = (redact: RedactionPolicy | undefined) =>
    Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { toolCalls: [{ id: 'c1', name: 'lookup', args: { id: 'x' } }] },
          { content: 'Found it.' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
      ...(redact && { redact }),
    })
      .tool(
        defineTool<{ id: string }, string>({
          name: 'lookup',
          description: 'Look it up.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          execute: () => 'row-1',
        }),
      )
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'shredder',
          description: 'Never called.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => 'unused',
        }),
      )
      .instruction(defineInstruction({ id: 'legalese', prompt: 'Remember clause 42b.' }))
      .build();

  const toolRows = (ledger: ReturnType<typeof contextLedger>): string[] =>
    ledger
      .rows()
      .filter((r) => r.kind === 'tool')
      .map((r) => `${r.id} offered=${r.offered} used=${r.used}`)
      .sort();

  const recordRuns = async (redact: RedactionPolicy | undefined, asSnapshot: boolean) => {
    const ledger = contextLedger();
    const recorded = [];
    for (let i = 0; i < 3; i++) {
      const agent = ledgerAgent(redact);
      await agent.run({ message: MESSAGE });
      recorded.push(ledger.recordRun(asSnapshot ? agent.getLastSnapshot() : agent));
    }
    return { ledger, recorded };
  };

  it('a runner is counted from its live run: the same tool rows with and without the policy', async () => {
    const control = await recordRuns(undefined, false);
    const served = await recordRuns(conversationPolicy(), false);
    expect(toolRows(served.ledger)).toEqual(toolRows(control.ledger));
    expect(served.ledger.row('tool', 'lookup')?.used).toBe(3);
    expect(control.recorded.every((r) => r !== undefined && r.unmetered === undefined)).toBe(true);
    // What each CALL was offered lives only in the log, and the vocabulary keeps
    // `activeInjections` out: injections are left unmetered, never counted unused.
    expect(control.ledger.row('injection', 'legalese')?.offered).toBeGreaterThan(0);
    expect(served.ledger.row('injection', 'legalese')).toBeUndefined();
    for (const run of served.recorded) {
      expect(run?.unmetered).toEqual(['skill', 'injection']);
      expect(run?.basis?.activeInjections).toContain('redacted');
    }
  });

  it('a served snapshot handed in leaves the tool unmetered — its gate keeps offering it', async () => {
    const served = await recordRuns(conversationPolicy(), true);
    for (const run of served.recorded) {
      expect(run?.unmetered).toContain('tool');
      expect(run?.basis?.history).toContain('redacted');
    }
    expect(served.ledger.row('tool', 'lookup')).toBeUndefined();
    expect(served.ledger.row('tool', 'shredder')).toBeUndefined();
    const strict = { minOffers: 1, refreshEvery: Infinity };
    expect(ledgerToolGate(served.ledger, strict)('lookup', {} as never)).toBe(true);
    expect(ledgerToolGate(served.ledger, strict)('shredder', {} as never)).toBe(true);

    // CONTROL: the same snapshots without a policy are metered, and the gate
    // judges — the called tool earns, the never-called one is demoted.
    const control = await recordRuns(undefined, true);
    expect(control.recorded.every((r) => r !== undefined && r.unmetered === undefined)).toBe(true);
    expect(control.ledger.row('tool', 'lookup')?.used).toBe(3);
    expect(ledgerToolGate(control.ledger, strict)('lookup', {} as never)).toBe(true);
    expect(ledgerToolGate(control.ledger, strict)('shredder', {} as never)).toBe(false);
  });
});
