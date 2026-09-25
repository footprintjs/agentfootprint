/**
 * The two record rules the account stands on, pinned on the REAL recording:
 *
 *  1. THE WITNESS RULE (R2-B2) — "in front of the model" is proven by the
 *     answering iteration's messages compose, not by end-of-run state; and
 *     (R3-M1) only EARLIER answers' results are in view: `events[68]`, this
 *     run's own `get_array_inventory` result in the same compose, never
 *     produces an in-view line.
 *  2. THE OWN-RUN KEY (S7 + round-2 fallback/tiebreak) — the agentfootprint run
 *     id (never `snapshot.runId`), `options.runId` first, `run_configured`
 *     next, the `turn_end` owner as the tiebreak, and "unfiltered" said aloud.
 *
 * Test types: FUNCTIONAL (the rules), EDGE (ties, no key), SECURITY (another
 * run's events are counted, never read).
 */

import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { answeringIteration, witnessesOf } from '../../../src/lib/answer-account/facts/inView.js';
import { recordingView } from '../../../src/lib/answer-account/view.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { fixtureA, FLAGSHIP_RUN_ID, NEO_DECLARATIONS } from './helpers.js';

type E = { type: string; payload: Record<string, any>; meta: Record<string, any> };

describe('the witness rule on the real recording', () => {
  const view = recordingView(fixtureA(), { runId: FLAGSHIP_RUN_ID });

  it('N = 2, from the last llm_start before turn_end (events[98])', () => {
    expect(view.last('stream.llm_start')!.index).toBe(98);
    expect(answeringIteration(view)).toBe(2);
  });

  it('the compose is sf-messages/compose#34 (events[69]); it selects events[62..68]; events[64] is the witness; events[10] (iteration 1) is not selected', () => {
    const compose = view
      .ofType('context.slot_composed')
      .find((e) => e.payload.slot === 'messages' && e.payload.iteration === 2)!;
    expect(compose.index).toBe(69);
    expect(compose.meta.runtimeStageId).toBe('sf-messages/compose#34');
    const sameStage = view
      .ofType('context.injected')
      .filter((e) => e.meta.runtimeStageId === 'sf-messages/compose#34')
      .map((e) => e.index);
    expect(sameStage).toEqual([62, 63, 64, 65, 66, 67, 68]);
    const witnesses = witnessesOf(view, 2).map((e) => e.index);
    expect(witnesses).toEqual([64, 68]);
    expect(witnesses).not.toContain(10);
  });

  it('R3-M1 — events[68] (this run’s own call) never becomes an in-view line; [64] does, at distance 1', () => {
    const account = accountForAnswer(fixtureA(), NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
    expect(account.facts.inView).toHaveLength(1);
    expect(account.facts.inView[0]).toMatchObject({
      toolName: 'powerstore_get_volumes',
      toolCallId: 'toolu_01YQPyS4gmUrsi8mv52oj1DE',
      distance: 1,
      windowed: true,
      emptiness: 'undeclared-empty',
      emptinessSource: 'app',
    });
    const inViewPointers = account.rows
      .flatMap((r) => r.lines)
      .filter(
        (l) =>
          l.template.id.startsWith('found.inView') ||
          l.template.id.startsWith('signal.undeclaredEmptyInView'),
      )
      .flatMap((l) => l.pointers);
    expect(inViewPointers.some((p) => p.kind === 'event' && p.index === 64)).toBe(true);
    expect(inViewPointers.some((p) => p.kind === 'event' && p.index === 68)).toBe(false);
  });

  it('R3-M1 — even if this run’s call were not recognised as its own, distance 0 keeps [68] out', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    // Drop this run's own tool brackets: the call is no longer "of this run" by id.
    rec.events = rec.events.map((e) =>
      e.type === 'agentfootprint.stream.tool_start' || e.type === 'agentfootprint.stream.tool_end'
        ? { ...e, type: 'agentfootprint.unknown.dropped' }
        : e,
    );
    const account = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(account.facts.inView.map((f) => f.toolCallId)).toEqual([
      'toolu_01YQPyS4gmUrsi8mv52oj1DE',
    ]);
  });

  it('no answering compose → nothing is "in view" (history alone never proves it)', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events = rec.events.filter((_, i) => i !== 69);
    const account = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(account.facts.inView).toEqual([]);
  });
});

describe('the own-run key', () => {
  const withRun = (e: E, runId: string): E => ({ ...e, meta: { ...e.meta, runId } });

  it('snapshot.runId is a different id space — keying on it would drop every event; the account does not', () => {
    const rec = fixtureA();
    expect((rec.snapshot as { runId: string }).runId).toBe('1790361930312-0000000124');
    const account = accountForAnswer(rec, undefined);
    expect(account.scope).toBe('own-run');
    expect(account.run.value!.runId).toBe(FLAGSHIP_RUN_ID);
    expect(account.foreign).toBe(0);
  });

  it('options.runId beats run_configured', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    // Another run in the same recording (a pre-3631bf4b shared recording): its own manifest + question.
    rec.events.push(withRun(rec.events[0]!, 'run-other-2'), {
      ...withRun(rec.events[5]!, 'run-other-2'),
      payload: { turnIndex: 0, userPrompt: 'the other person asked this' },
    });
    const account = accountForAnswer(rec as unknown as Recording, undefined, {
      runId: 'run-other-2',
    });
    expect(account.run.value!.runId).toBe('run-other-2');
    expect(account.question.value).toBe('the other person asked this');
    expect(account.foreign).toBe(rec.events.length - 2);
  });

  it('S3 — a runId that owns NO event: "not in this record", never "no tools" or "did not finish"', () => {
    const rec = fixtureA();
    const account = accountForAnswer(rec, NEO_DECLARATIONS, { runId: 'run-nope' });
    expect(account.foreign).toBe(rec.events.length);
    const ids = account.rows.flatMap((r) => r.lines.map((l) => l.template.id));
    for (const claim of [
      'checked.noCalls',
      'found.noCalls',
      'summary.unfinished',
      'notChecked.noCalls',
    ])
      expect(ids).not.toContain(claim);
    expect(account.summary.sentence.text).toBe(
      "None of this record's events belong to the run asked for, so nothing about that run can be told from it.",
    );
    expect(account.summary.tone).toBe('unknown');
    expect(account.rows.every((r) => r.status === 'not-recorded')).toBe(true);
    expect([account.run.status, account.question.status, account.answer.status]).toEqual([
      'not-recorded',
      'not-recorded',
      'not-recorded',
    ]);
    expect(account.signals).toEqual([]);
  });

  it('two run_configured ids: the turn_end owner wins, never simply the first', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    const other = withRun(rec.events[0]!, 'run-other-1');
    rec.events = [other, ...rec.events];
    const view = recordingView(rec as unknown as Recording);
    expect(view.runId).toBe(FLAGSHIP_RUN_ID);
    expect(view.foreign).toBe(1);
  });

  it('two ids and no turn_end owner among them: nothing is filtered, and the account says so', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events = [
      withRun(rec.events[0]!, 'run-other-1'),
      ...rec.events.filter((e) => !e.type.endsWith('turn_end')),
    ];
    const account = accountForAnswer(rec as unknown as Recording, undefined);
    expect(account.scope).toBe('unfiltered');
    expect(account.run.status).toBe('not-recorded');
    const wrong = account.rows
      .find((r) => r.id === 'anything-wrong')!
      .lines.map((l) => l.template.id);
    expect(wrong).toContain('scope.unfiltered');
  });

  it('no run id anywhere: scope unfiltered, scope.unfiltered@1 printed', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events = rec.events.filter((e) => !e.type.endsWith('run_configured'));
    const account = accountForAnswer(rec as unknown as Recording, undefined);
    expect(account.scope).toBe('unfiltered');
    expect(account.rows.find((r) => r.id === 'anything-wrong')!.lines.map((l) => l.text)).toContain(
      'Which run these events belong to is not recorded, so this report reads every event in the record.',
    );
  });

  it('SECURITY — another run’s events are counted in `foreign` and never read', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    const intruder: E = {
      type: 'agentfootprint.stream.tool_start',
      payload: { toolName: 'steal_secrets', toolCallId: 'x1', args: { q: 'SECRET-ARG' } },
      meta: { runId: 'run-intruder', runtimeStageId: 'tool-calls#1' },
    };
    rec.events = [...rec.events, intruder];
    const account = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(account.foreign).toBe(1);
    expect(JSON.stringify(account)).not.toContain('steal_secrets');
  });
});
