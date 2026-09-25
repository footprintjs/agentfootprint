/**
 * "Show me" — the allow-list, the deny list, the bounds, and the account's own
 * size bound (R2-S2), including the synthetic worst case.
 *
 * Test types:
 *   - SECURITY — injection bodies, tool arguments, tool results, a decision's
 *                `why`, `resumeInput`, the live heap and history content are
 *                never shown, whichever pointer names them; another run's event
 *                is `foreign`;
 *   - FUNCTIONAL — R3-S2's three leaves are shown (`state /userMessage`,
 *                `skill.turn_routed /witness/text`, `/decider/model`); an
 *                emptiness leaf is a derived `{ rows, at }`, never the rows;
 *   - EDGE / BOUNDS — a leaf over 2,048 characters is `too-large`; the map stops
 *                at 64 KB; the account stays ≤ 128 KB and the response ≤ 192 KB
 *                for 200 calls × 60 items × 5 KB strings.
 */

import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { pointerKey } from '../../../src/lib/answer-account/render.js';
import {
  isShowable,
  MAX_SHOWN_BYTES,
  SHOW_ME_ALLOW_LIST,
  SHOWN_MORE_KEY,
  showLeaves,
} from '../../../src/lib/answer-account/shown.js';
import type { AnswerAccount, RecordPointer } from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP7, fixtureA, FLAGSHIP_RUN_ID, NEO_DECLARATIONS } from './helpers.js';

const ev = (type: string, path: string, index = 0): RecordPointer => ({
  kind: 'event',
  index,
  type: `agentfootprint.${type}`,
  path,
});

describe('the allow-list', () => {
  it('R3-S2 — the person’s own words and the decider’s model are shown', () => {
    expect(isShowable({ kind: 'state', key: 'userMessage', path: '' })).toBe(true);
    expect(isShowable(ev('skill.turn_routed', '/witness/text'))).toBe(true);
    expect(isShowable(ev('skill.turn_routed', '/decider/model'))).toBe(true);
  });

  it.each([
    ['an injection body', ev('context.injected', '/rawContent')],
    ['an injection summary', ev('context.injected', '/contentSummary')],
    ['an injection reason (a skill description)', ev('context.injected', '/reason')],
    ['a tool argument', ev('stream.tool_start', '/args/q')],
    ['a tool result', ev('stream.tool_end', '/result')],
    ['a tool result leaf', ev('stream.tool_end', '/result/volumes/0/name')],
    ['what the model read', ev('stream.tool_end', '/modelResult')],
    ['a decision `why` (a person’s note)', ev('middleware.decision', '/why')],
    ['a resume input', ev('pause.resume', '/resumeInput/answer')],
    ['a check-in note', ev('checkin.decision', '/note')],
    [
      'any other state key',
      { kind: 'state', key: 'resolvedInstructions', path: '' } as RecordPointer,
    ],
    ['a nested state leaf', { kind: 'state', key: 'userMessage', path: '/0' } as RecordPointer],
    ['history content', { kind: 'history', index: 2, path: '/content' } as RecordPointer],
    ['a path the list never named', ev('agent.run_configured', '/llm/provider')],
    ['an event type the list never named', ev('agent.iteration_end', '/history')],
  ])('SECURITY — %s is never shown', (_label, pointer) => {
    expect(isShowable(pointer)).toBe(false);
  });
});

function fakeAccount(pointers: RecordPointer[], runId = FLAGSHIP_RUN_ID): AnswerAccount {
  const base = accountForAnswer(fixtureA(), undefined, { runId });
  return {
    ...base,
    rows: [
      { ...base.rows[0]!, lines: [{ ...base.rows[0]!.lines[0]!, pointers }] },
      ...base.rows.slice(1),
    ],
  };
}

describe('the leaves', () => {
  it('another run’s event is `foreign`; a missing one `not-found`; a non-leaf `not-shown-here`', () => {
    const rec = fixtureA() as unknown as {
      events: { type: string; payload: Record<string, unknown>; meta: Record<string, unknown> }[];
    };
    rec.events.push({
      type: 'agentfootprint.agent.turn_start',
      payload: { userPrompt: 'someone else' },
      meta: { runId: 'run-other' },
    });
    const foreignAt = rec.events.length - 1;
    const pointers = [
      ev('agent.turn_start', '/userPrompt', foreignAt),
      ev('agent.turn_start', '/userPrompt', 99_999),
      ev('skill.turn_routed', '/scores/0/id', 6),
      ev('agent.run_configured', '/skillGraph/routing', 0),
    ];
    const shown = showLeaves(fakeAccount(pointers), rec as unknown as Recording);
    expect(shown[pointerKey(pointers[0]!)]).toEqual({ withheld: 'foreign' });
    expect(shown[pointerKey(pointers[1]!)]).toEqual({ withheld: 'not-found' });
    expect(shown[pointerKey(pointers[2]!)]).toEqual({ value: 'array-inventory' });
    expect(shown[pointerKey(pointers[3]!)]).toEqual({ value: 'assist' });
  });

  it('an emptiness leaf is a derived count, never the rows', () => {
    const account = accountForAnswer(fixtureA(), NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
    const shown = showLeaves(account, fixtureA(), NEO_DECLARATIONS);
    expect(shown['history:2:#emptiness']).toEqual({ rows: 0, at: '/content/volumes' });
    expect(JSON.stringify(shown)).not.toContain('af_provenance');
  });

  it('a leaf over 2,048 characters is `too-large`', () => {
    const rec = fixtureA() as unknown as { events: { payload: Record<string, unknown> }[] };
    rec.events[5]!.payload.userPrompt = 'q'.repeat(3000);
    const p = ev('agent.turn_start', '/userPrompt', 5);
    expect(showLeaves(fakeAccount([p]), rec as unknown as Recording)[pointerKey(p)]).toEqual({
      withheld: 'too-large',
    });
  });

  it('the map stops at 64 KB: no later pointer adds a key; one #more entry says the rest is withheld', () => {
    const rec = fixtureA() as unknown as {
      events: { type: string; payload: Record<string, unknown>; meta: Record<string, unknown> }[];
    };
    const pointers: RecordPointer[] = [];
    for (let i = 0; i < 80; i++) {
      rec.events.push({
        type: 'agentfootprint.agent.turn_start',
        payload: { userPrompt: `${i}-${'x'.repeat(2000)}` },
        meta: { runId: FLAGSHIP_RUN_ID },
      });
      pointers.push(ev('agent.turn_start', '/userPrompt', rec.events.length - 1));
    }
    const shown = showLeaves(fakeAccount(pointers), rec as unknown as Recording);
    expect(JSON.stringify(shown).length).toBeLessThanOrEqual(MAX_SHOWN_BYTES);
    expect(shown[SHOWN_MORE_KEY]).toEqual({ withheld: 'too-large' });
    const kept = Object.keys(shown).filter((k) => k !== SHOWN_MORE_KEY);
    expect(kept.length).toBeLessThan(40); // the rest added NO key
    // A prefix of the pointers is shown; from the first one that did not fit, none is.
    const present = pointers.map((p) => pointerKey(p) in shown);
    const cut = present.indexOf(false);
    expect(cut).toBeGreaterThan(0);
    expect(present.slice(cut).every((x) => !x)).toBe(true);
  });
});

describe('BOUNDS — the synthetic worst case (200 calls × 60 items × 5 KB strings)', () => {
  it('account ≤ 128 KB, response ≤ 192 KB, and the folds are said', () => {
    const RUN = 'run-worst';
    const big = (tag: string) => `${tag} ${'w'.repeat(5000)}`;
    const events: {
      type: string;
      payload: Record<string, unknown>;
      meta: Record<string, unknown>;
    }[] = [];
    const push = (type: string, payload: Record<string, unknown>) =>
      events.push({
        type: `agentfootprint.${type}`,
        payload,
        meta: { runId: RUN, runtimeStageId: 's#1' },
      });
    push('agent.run_configured', {
      agentId: 'a',
      llm: { provider: 'p', model: 'm' },
      reactMode: 'dynamic',
      memories: [],
      evidenceGate: 'guard',
    });
    push('agent.turn_start', { turnIndex: 0, userPrompt: big('question') });
    for (let c = 0; c < 200; c++) {
      const id = `c${c}`;
      push('stream.tool_start', { toolName: `tool_${c}`, toolCallId: id, args: {} });
      const items = (k: string) =>
        Array.from({ length: 60 }, (_, i) => ({
          what: big(`${k}${c}.${i}`),
          short: `s${i}`.padEnd(70, 's'),
          kind: 'existence',
        }));
      push('tools.absent', {
        toolName: `tool_${c}`,
        toolCallId: id,
        iteration: 1,
        lookedFor: big('looked'),
        checked: items('c').map(({ kind: _k, ...rest }) => rest),
        notChecked: items('n'),
        cannotCover: items('x'),
      });
      push('stream.tool_end', { toolCallId: id, result: [], status: 'absent', durationMs: 1 });
    }
    push('agent.evidence_checked', {
      iteration: 1,
      posture: 'guard',
      candidates: 30,
      unsupported: Array.from({ length: 12 }, (_, i) => ({ value: big(`v${i}`), shape: 'id' })),
      action: 'flagged',
      afterRevision: false,
    });
    push('agent.turn_end', {
      turnIndex: 0,
      finalContent: big('answer').repeat(4),
      totalInputTokens: 1,
      totalOutputTokens: 1,
      iterationCount: 1,
      durationMs: 1,
    });
    const recording = {
      snapshot: { sharedState: { turnNumber: 1 } },
      events,
      structure: null,
    } as unknown as Recording;
    const account = accountForAnswer(recording, undefined, { runId: RUN });
    assertP7(account, recording);
    expect(account.facts.calls).toHaveLength(50);
    expect(account.facts.callsOmitted).toBe(150);
    expect(account.rows.find((r) => r.id === 'checked')!.more?.text).toBe(
      '…and 195 more tool calls.',
    );
    expect(account.answer.clipped).toBe(true);
    const size = JSON.stringify(account).length;
    const response = JSON.stringify({ account, shown: showLeaves(account, recording) }).length;
    expect(size).toBeLessThanOrEqual(128 * 1024);
    expect(response).toBeLessThanOrEqual(192 * 1024);
  });
});
