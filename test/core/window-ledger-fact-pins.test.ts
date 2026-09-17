/**
 * The window keeps what the model says it STANDS ON — the `'ledger-fact'`
 * pin (9.102.0), and the two helpers that give a turn a standing.
 *
 * ## The measured gap
 *
 * From `bench/findings-context.mjs`, step 3: under `slidingWindow` (keep 6,
 * twenty calls, six planted facts) the ledger PIECE carried all six facts to
 * the answer turn while the wire carried two of them verbatim. The refusal
 * engine saw a fact and a noise result as the same bytes, so recency decided
 * — the facts left oldest-first with the noise around them while younger
 * noise stayed.
 *
 * ## The rule, as shipped
 *
 * One candidate per TURN whose standing is `fact`, by the model's LAST row per
 * result and its most valuable member deciding the turn's, newest first,
 * nothing at or before the current request, content-aware by the MODEL'S
 * claim only. The ceiling (`keepLedgerFacts`), the refusal order and the
 * stand-down live in the refusal engine and the stage and are pinned where
 * they live; this file pins the PIN and its helpers — the twin of the
 * `toolResultPinsOf` block in `window-last-tool-result.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { LLMMessage } from '../../src/adapters/types.js';
import type { Standing } from '../../src/core/agent/findings/types.js';
import { currentRequestIndexOf } from '../../src/core/agent/window/currentRequest.js';
import {
  ledgerFactPinsOf,
  rankStanding,
  turnStandingOf,
  type LedgerFactPin,
} from '../../src/core/agent/window/ledgerFactPins.js';
import { segmentTurns, type Turn } from '../../src/core/agent/window/turns.js';

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const TASK = 'Walk the whole floor and tell me which rack is hottest.';
const HOLDS = 'HOLDS: aix-lab-01-rack-a, aix-lab-01-rack-b, aix-lab-02-rack-a';

const user = (content: string): LLMMessage => ({ role: 'user', content });
const asks = (calls: { id: string; name: string }[]): LLMMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })),
});
const answers = (id: string, name: string, content = 'ok'): LLMMessage => ({
  role: 'tool',
  content,
  toolCallId: id,
  toolName: name,
});
/** One ReAct round: the call and its answer, which segment as ONE turn. */
const round = (id: string, name: string, content = 'ok'): LLMMessage[] => [
  asks([{ id, name }]),
  answers(id, name, content),
];

/**
 * A per-turn `standingOf`, as the stage binds it: the ledger's LAST standing
 * per result (`foldLedger(rows).standingOf.get(id)?.standing`) lifted to the
 * turn by `turnStandingOf`. An id absent from `rows` is UNDECLARED.
 */
function standingsOf(rows: Record<string, Standing>): (turn: Turn) => Standing | undefined {
  const byId = new Map(Object.entries(rows));
  return (turn) => turnStandingOf(turn, (id) => byId.get(id));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────
// Unit — the rank
// ─────────────────────────────────────────────────────────────────

describe('rankStanding', () => {
  it('fact > open > undeclared > ruled-out > noise, strictly', () => {
    const order: (Standing | undefined)[] = ['fact', 'open', undefined, 'ruled-out', 'noise'];
    for (let i = 0; i + 1 < order.length; i++) {
      expect(
        rankStanding(order[i]),
        `${String(order[i])} > ${String(order[i + 1])}`,
      ).toBeGreaterThan(rankStanding(order[i + 1]));
    }
  });

  it('undeclared sits between a declaration and a verdict — an absent standing is never a verdict', () => {
    expect(rankStanding(undefined)).toBeLessThan(rankStanding('open'));
    expect(rankStanding(undefined)).toBeGreaterThan(rankStanding('ruled-out'));
    expect(rankStanding(undefined)).toBeGreaterThan(rankStanding('noise'));
  });
});

// ─────────────────────────────────────────────────────────────────
// Unit — a turn's standing
// ─────────────────────────────────────────────────────────────────

describe('turnStandingOf', () => {
  /** A parallel batch: three results answered in ONE turn. */
  const batch = segmentTurns([
    asks([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
      { id: '3', name: 'c' },
    ]),
    answers('1', 'a'),
    answers('2', 'b'),
    answers('3', 'c'),
  ])[0]!;

  it("a turn's standing is its most valuable result's", () => {
    expect(turnStandingOf(batch, standingOfIds({ '1': 'noise', '2': 'fact', '3': 'open' }))).toBe(
      'fact',
    );
    expect(turnStandingOf(batch, standingOfIds({ '1': 'open', '2': 'ruled-out' }))).toBe('open');
    expect(
      turnStandingOf(batch, standingOfIds({ '1': 'ruled-out', '2': 'noise', '3': 'noise' })),
    ).toBe('ruled-out');
  });

  it('a batch with one unjudged result is UNDECLARED, not noise — nothing is defaulted', () => {
    expect(turnStandingOf(batch, standingOfIds({ '1': 'noise', '2': 'noise' }))).toBeUndefined();
    expect(turnStandingOf(batch, standingOfIds({ '1': 'ruled-out' }))).toBeUndefined();
  });

  it('a turn with no tool result has no standing, and the ledger is not even asked', () => {
    const asked: string[] = [];
    const lookup = (id: string): Standing | undefined => {
      asked.push(id);
      return 'fact';
    };
    expect(turnStandingOf(segmentTurns([user(TASK)])[0]!, lookup)).toBeUndefined();
    expect(turnStandingOf(segmentTurns([asks([])])[0]!, lookup)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('a result without an id cannot be on the ledger, so it is not asked about', () => {
    const asked: string[] = [];
    const turn = segmentTurns([asks([]), { role: 'tool', content: 'no id' }])[0]!;
    expect(
      turnStandingOf(turn, (id) => {
        asked.push(id);
        return 'fact';
      }),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('asks once per result, by id, in wire order', () => {
    const asked: string[] = [];
    turnStandingOf(batch, (id) => {
      asked.push(id);
      return undefined;
    });
    expect(asked).toEqual(['1', '2', '3']);
  });

  function standingOfIds(rows: Record<string, Standing>): (id: string) => Standing | undefined {
    const byId = new Map(Object.entries(rows));
    return (id) => byId.get(id);
  }
});

// ─────────────────────────────────────────────────────────────────
// Unit — which turns are candidates
// ─────────────────────────────────────────────────────────────────

describe('ledgerFactPinsOf', () => {
  it('fact turns ONLY, newest first — open, noise, ruled-out and undeclared are not held', () => {
    const history: LLMMessage[] = [
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
      ...round('c', 'move'),
      ...round('d', 'move'),
      ...round('e', 'move'),
      ...round('f', 'measure', 'rack-b 41C'),
    ];
    const turns = segmentTurns(history);
    const anchor = currentRequestIndexOf(history, TASK);
    const pins = ledgerFactPinsOf(
      turns,
      history,
      standingsOf({ a: 'fact', b: 'noise', c: 'open', d: 'ruled-out', f: 'fact' }),
      anchor,
    );
    expect(pins.map((p) => p.toolCallIds)).toEqual([['f'], ['a']]);
    // Newest first: the order the ceiling is spent in.
    expect(pins.map((p) => p.turnIndex)).toEqual([turns.length - 1, 1]);
    expect(pins[0]!.turnIndex).toBeGreaterThan(pins[1]!.turnIndex);
    // Positioned so a reader can find the turn.
    expect(pins.map((p) => p.messageIndex)).toEqual([
      turns[turns.length - 1]!.start,
      turns[1]!.start,
    ]);
    expect(pins.map((p) => p.toolName)).toEqual(['measure', 'whats_here']);
    // `chars` is the whole TURN — the call and its result leave together.
    expect(pins[1]!.chars).toBe(HOLDS.length);
    expect(pins[0]!.chars).toBe('rack-b 41C'.length);
  });

  it('nothing at or before the current request — a new user turn releases the previous loop', () => {
    const history: LLMMessage[] = [
      ...round('old', 'whats_here', 'STALE'),
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
    ];
    const turns = segmentTurns(history);
    const anchor = currentRequestIndexOf(history, TASK);
    const standingOf = standingsOf({ old: 'fact', a: 'fact' });

    const pins = ledgerFactPinsOf(turns, history, standingOf, anchor);
    expect(pins.map((p) => p.toolCallIds)).toEqual([['a']]);
    expect(pins.every((p) => p.messageIndex > anchor)).toBe(true);

    // With no anchor (`-1`, the default), the old fact is a candidate too: it
    // is the anchor alone that released it, not its standing.
    expect(ledgerFactPinsOf(turns, history, standingOf).map((p) => p.toolCallIds)).toEqual([
      ['a'],
      ['old'],
    ]);
  });

  it('a parallel batch answered in one turn is ONE pin holding every id, in wire order', () => {
    const history: LLMMessage[] = [
      user(TASK),
      asks([
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' },
      ]),
      answers('1', 'a'),
      answers('2', 'b'),
      answers('3', 'c'),
      ...round('later', 'd'),
    ];
    const pins = ledgerFactPinsOf(
      segmentTurns(history),
      history,
      standingsOf({ '1': 'fact', '2': 'noise' }),
      0,
    );
    // One turn, one slot — and the noise answered beside the fact stays with it.
    expect(pins).toHaveLength(1);
    expect(pins[0]!.turnIndex).toBe(1);
    expect(pins[0]!.toolCallIds).toEqual(['1', '2', '3']);
    // Named for its newest nameable result, as the sibling pin names a turn.
    expect(pins[0]!.toolName).toBe('c');
  });

  it('a name absent on the result is recovered from the assistant call', () => {
    const history: LLMMessage[] = [
      user(TASK),
      asks([{ id: 'x', name: 'whats_here' }]),
      { role: 'tool', content: HOLDS, toolCallId: 'x' },
    ];
    const pins = ledgerFactPinsOf(segmentTurns(history), history, standingsOf({ x: 'fact' }), 0);
    expect(pins.map((p) => p.toolName)).toEqual(['whats_here']);
  });

  it('a fact result nothing can name is NOT pinned — never an invented name', () => {
    const history: LLMMessage[] = [
      user(TASK),
      { role: 'tool', content: 'orphan', toolCallId: 'nobody-asked' },
    ];
    expect(
      ledgerFactPinsOf(segmentTurns(history), history, standingsOf({ 'nobody-asked': 'fact' }), 0),
    ).toEqual([]);
  });

  it('a turn called a fact that holds no result is not pinned — no id, no hold', () => {
    const history: LLMMessage[] = [user(TASK), { role: 'assistant', content: 'thinking' }];
    const everyTurnAFact = (): Standing | undefined => 'fact';
    expect(ledgerFactPinsOf(segmentTurns(history), history, everyTurnAFact, 0)).toEqual([]);
  });

  it('asks the standing once per turn, newest first, and reads nothing else', () => {
    const history: LLMMessage[] = [
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
      ...round('c', 'move'),
    ];
    const turns = segmentTurns(history);
    const asked: number[] = [];
    ledgerFactPinsOf(
      turns,
      history,
      (turn) => {
        asked.push(turn.index);
        return undefined;
      },
      0,
    );
    expect(asked).toEqual(turns.map((t) => t.index).reverse());
  });

  it('deep-frozen inputs are untouched, and the answer is plain data', () => {
    const history = deepFreeze<readonly LLMMessage[]>([
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
    ]);
    const turns = deepFreeze(segmentTurns(history));
    const pins: readonly LedgerFactPin[] = ledgerFactPinsOf(
      turns,
      history,
      standingsOf({ a: 'fact' }),
      0,
    );
    expect(pins.map((p) => p.toolCallIds)).toEqual([['a']]);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(turns)).toBe(true);
    expect(Object.isFrozen(turns[1]!.messages)).toBe(true);
    // Committed with the record, so it must survive the record's clone.
    expect(structuredClone(pins)).toEqual(pins);
  });
});
