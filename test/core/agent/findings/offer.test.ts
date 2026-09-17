/**
 * findings/offer — the ids a model may name: `offeredResultIds` (the offer
 * the schema binds into `previous[].toolCallId`), `nameableIds` (the same
 * set in wire order), `undeclaredIds` (the set the piece's `undeclared:`
 * line reads — the honest absence, NOT the offer), `servedToolCallIds` (the
 * wire's `role: 'tool'` ids) and `knownResults` (the identity source a
 * standing resolves against), as pure functions.
 *
 * The laws under test: the offer is the served ids the model can still
 * READ — no standing, or a current `fact` / `open` standing — NEWEST FIRST,
 * each once; a `noise` or `ruled-out` standing from either door (a later
 * tool call, the answer turn) removes an id; a basis row removes nothing;
 * the fold decides (a retired id declared `fact` again is back); an absent
 * ledger offers every served result; messages with no id, an empty id or
 * another role contribute nothing; nothing is mutated (deep-frozen inputs);
 * the piece's `undeclared:` set is a SUBSET of the offer (the offer minus
 * undeclared = the current fact and open ids); and THE LAW AT THE ROW: for
 * every id the offer lists, a standing naming it resolves against
 * `knownResults` of the same wire — `unknownId` absent, whichever batch the
 * result came from.
 *
 * Sections follow Convention 3: Unit (each function) · Functional (the two
 * doors, revision, the unknown-id row) · Edge (absent ledger, empty wire,
 * frozen inputs) · Property (a seeded generator, no fast-check in the tree).
 */

import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '../../../../src/adapters/types.js';
import { placedToolResult } from '../../../../src/artifacts/placement.js';
import type { ArtifactMeta } from '../../../../src/artifacts/types.js';
import {
  basisRowFrom,
  foldLedger,
  standingRowsFrom,
  type PreviousResult,
} from '../../../../src/core/agent/findings/ledger.js';
import {
  RETIRING_STANDINGS,
  knownResults,
  nameableIds,
  offeredResultIds,
  servedToolCallIds,
  undeclaredIds,
} from '../../../../src/core/agent/findings/offer.js';
import { servedToolCallIds as servedToolCallIdsFromServe } from '../../../../src/core/agent/findings/serve.js';
import type {
  FindingsLedger,
  FindingsRow,
  Standing,
} from '../../../../src/core/agent/findings/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

const tool = (toolCallId: string): LLMMessage => ({
  role: 'tool',
  content: `result of ${toolCallId}`,
  toolCallId,
  toolName: 'lookup_port',
});

const asks = (...ids: string[]): LLMMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: ids.map((id) => ({ id, name: 'lookup_port', args: { port: id } })),
});

/** Three results on the wire, in the order they were served: c1, c2, c3. */
const WIRE: readonly LLMMessage[] = deepFreeze([
  { role: 'user', content: 'which port is down?' },
  asks('c1', 'c2'),
  tool('c1'),
  tool('c2'),
  asks('c3'),
  tool('c3'),
]);

/** The batch a standing is filed against — every wire id is in it. */
const BATCH: readonly PreviousResult[] = deepFreeze([
  { toolName: 'lookup_port', result: 'r1', toolCallId: 'c1' },
  { toolName: 'lookup_port', result: 'r2', toolCallId: 'c2' },
  { toolName: 'lookup_port', result: 'r3', toolCallId: 'c3' },
]);

const LIVE: readonly Standing[] = ['fact', 'open'];
const RETIRED: readonly Standing[] = ['noise', 'ruled-out'];

/** A standing row on `id`, declared on a later tool call or on the answer. */
const standingOn = (id: string, standing: Standing, on: 'call' | 'answer' = 'call'): FindingsRow =>
  standingRowsFrom(
    BATCH,
    { previous: [{ toolCallId: id, standing }] },
    on === 'answer' ? 'answer' : { toolCallId: 'c9' },
    2,
  )[0]!;

const basisOn = (id: string): FindingsRow =>
  basisRowFrom({ id, name: 'lookup_port' }, { basis: 'direct' }, 1);

// ── Unit: servedToolCallIds ──────────────────────────────────────────────

describe('servedToolCallIds', () => {
  it('the tool ids in wire order, each once; other roles, nameless and blank ids contribute nothing', () => {
    const wire: LLMMessage[] = [
      { role: 'user', content: 'q' },
      asks('a', 'b'),
      tool('a'),
      { role: 'tool', content: 'orphan' },
      { role: 'tool', content: 'blank', toolCallId: '' },
      { role: 'assistant', content: 'a', toolCallId: 'not-a-tool' } as LLMMessage,
      tool('b'),
      tool('a'),
    ];
    expect(servedToolCallIds(wire)).toEqual(['a', 'b']);
    expect(servedToolCallIds([])).toEqual([]);
  });

  it('is the ONE function `serve.ts` re-exports — same reference, one owner', () => {
    expect(servedToolCallIdsFromServe).toBe(servedToolCallIds);
  });
});

// ── Unit: undeclaredIds ──────────────────────────────────────────────────

describe('undeclaredIds — the piece’s absence line', () => {
  it('keeps the order given and lists each id once, whatever the caller repeated', () => {
    const { standingOf } = foldLedger([standingOn('c1', 'fact')]);
    expect(undeclaredIds(['c2', 'c2', 'c1', 'c3', 'c2'], standingOf)).toEqual(['c2', 'c3']);
    expect(undeclaredIds([], standingOf)).toEqual([]);
  });

  it('an empty fold leaves every id undeclared', () => {
    expect(undeclaredIds(['c1', 'c2'], foldLedger([]).standingOf)).toEqual(['c1', 'c2']);
  });

  it('ANY standing removes an id here — undeclared is the honest absence, not the offer', () => {
    for (const standing of [...LIVE, ...RETIRED]) {
      const { standingOf } = foldLedger([standingOn('c2', standing)]);
      expect(undeclaredIds(['c1', 'c2', 'c3'], standingOf), standing).toEqual(['c1', 'c3']);
    }
  });
});

// ── Unit: nameableIds ────────────────────────────────────────────────────

describe('nameableIds — the offer in wire order', () => {
  it('the retiring standings are exactly noise and ruled-out', () => {
    expect(RETIRING_STANDINGS).toEqual(['noise', 'ruled-out']);
    expect(Object.isFrozen(RETIRING_STANDINGS)).toBe(true);
  });

  it('keeps the order given, each id once; a fact or open id stays, a noise or ruled-out id leaves', () => {
    for (const standing of LIVE) {
      const { standingOf } = foldLedger([standingOn('c2', standing)]);
      expect(nameableIds(['c1', 'c2', 'c2', 'c3'], standingOf), standing).toEqual([
        'c1',
        'c2',
        'c3',
      ]);
    }
    for (const standing of RETIRED) {
      const { standingOf } = foldLedger([standingOn('c2', standing)]);
      expect(nameableIds(['c1', 'c2', 'c2', 'c3'], standingOf), standing).toEqual(['c1', 'c3']);
    }
    expect(nameableIds([], foldLedger([]).standingOf)).toEqual([]);
  });
});

// ── Functional: the offer ────────────────────────────────────────────────

describe('offeredResultIds — the offer', () => {
  it('newest first: the wire order reversed', () => {
    expect(offeredResultIds(WIRE, [])).toEqual(['c3', 'c2', 'c1']);
    expect(offeredResultIds(WIRE, undefined)).toEqual(['c3', 'c2', 'c1']);
  });

  it('a noise or ruled-out id leaves the offer — a ticket on the wire, nothing left to re-judge', () => {
    for (const standing of RETIRED) {
      expect(offeredResultIds(WIRE, [standingOn('c2', standing)]), standing).toEqual(['c3', 'c1']);
    }
  });

  it('a fact or open id STAYS in the offer — the standing can be revised through the enum', () => {
    for (const standing of LIVE) {
      expect(offeredResultIds(WIRE, [standingOn('c2', standing)]), standing).toEqual([
        'c3',
        'c2',
        'c1',
      ]);
    }
  });

  it('a standing declared on the ANSWER turn counts the same way', () => {
    expect(offeredResultIds(WIRE, [standingOn('c3', 'noise', 'answer')])).toEqual(['c2', 'c1']);
    expect(offeredResultIds(WIRE, [standingOn('c3', 'open', 'answer')])).toEqual([
      'c3',
      'c2',
      'c1',
    ]);
  });

  it('a basis row removes nothing — only a retiring standing does', () => {
    expect(offeredResultIds(WIRE, [basisOn('c1'), basisOn('c2'), basisOn('c3')])).toEqual([
      'c3',
      'c2',
      'c1',
    ]);
  });

  it('a wire the model fully retired offers nothing; one it fully stood on offers everything', () => {
    const retired = [
      standingOn('c1', 'noise'),
      standingOn('c2', 'ruled-out'),
      standingOn('c3', 'noise'),
    ];
    expect(offeredResultIds(WIRE, retired)).toEqual([]);
    const stood = [standingOn('c1', 'fact'), standingOn('c2', 'open'), standingOn('c3', 'fact')];
    expect(offeredResultIds(WIRE, stood)).toEqual(['c3', 'c2', 'c1']);
  });

  it('revision is reachable: open → fact keeps the id listed; fact → ruled-out retires it; ruled-out → fact again brings it back (the fold decides, last wins)', () => {
    const opened = [standingOn('c1', 'open')];
    expect(offeredResultIds(WIRE, opened)).toContain('c1');
    const settled = [...opened, standingOn('c1', 'fact', 'answer')];
    expect(offeredResultIds(WIRE, settled)).toContain('c1');
    const retired = [...settled, standingOn('c1', 'ruled-out')];
    expect(offeredResultIds(WIRE, retired)).toEqual(['c3', 'c2']);
    const back = [...retired, standingOn('c1', 'fact')];
    expect(offeredResultIds(WIRE, back)).toEqual(['c3', 'c2', 'c1']);
  });

  it('a standing filed with unknownId (the id was not known when filed) still counts for the wire id — recorded as written, never resolved', () => {
    const [row] = standingRowsFrom(
      [{ toolName: 'lookup_port', result: 'r9', toolCallId: 'c9' }],
      { previous: [{ toolCallId: 'c1', standing: 'noise' }] },
      'answer',
      3,
    );
    expect(row!.unknownId).toBe(true);
    expect(offeredResultIds(WIRE, [row!])).toEqual(['c3', 'c2']);
  });

  it('an ordinal the model wrote ("0") is not a wire id: it is recorded, and the offer is unchanged', () => {
    const [row] = standingRowsFrom(
      BATCH,
      { previous: [{ toolCallId: '0', standing: 'noise' }] },
      { toolCallId: 'c9' },
      2,
    );
    expect(row!.unknownId).toBe(true);
    expect(offeredResultIds(WIRE, [row!])).toEqual(['c3', 'c2', 'c1']);
  });
});

// ── Functional: knownResults — the identity source ───────────────────────

describe('knownResults — what a standing resolves against', () => {
  const PLACED_META: ArtifactMeta = {
    ref: 'art_9f3c',
    kind: 'tool-result/fetch_log',
    mediaType: 'text/plain',
    bytes: 40_000,
    createdAt: 1_758_000_000_000,
  };

  it('the batch first, then every served tool message as a result, each id once, first wins', () => {
    const batch: PreviousResult[] = [
      { toolName: 'lookup_port', result: 'fresh r3', toolCallId: 'c3' },
    ];
    expect(knownResults(WIRE, batch)).toEqual([
      { toolName: 'lookup_port', result: 'fresh r3', toolCallId: 'c3' },
      { toolCallId: 'c1', toolName: 'lookup_port', result: 'result of c1' },
      { toolCallId: 'c2', toolName: 'lookup_port', result: 'result of c2' },
    ]);
    expect(knownResults(WIRE)).toEqual([
      { toolCallId: 'c1', toolName: 'lookup_port', result: 'result of c1' },
      { toolCallId: 'c2', toolName: 'lookup_port', result: 'result of c2' },
      { toolCallId: 'c3', toolName: 'lookup_port', result: 'result of c3' },
    ]);
  });

  it('a served message with no toolName yields a result with none — nothing is invented; nameless and blank ids are skipped', () => {
    const wire: LLMMessage[] = [
      { role: 'tool', content: 'anon', toolCallId: 'c7' },
      { role: 'tool', content: 'orphan' },
      { role: 'tool', content: 'blank', toolCallId: '' },
    ];
    const known = knownResults(wire, [{ toolName: 'x', result: 'y', toolCallId: '' }]);
    expect(known).toEqual([{ toolCallId: 'c7', result: 'anon' }]);
    expect(Object.prototype.hasOwnProperty.call(known[0], 'toolName')).toBe(false);
  });

  it('THE LAW AT THE ROW: an id copied from the offer resolves against the same wire — this batch’s or an earlier one’s — with its toolName and no unknownId', () => {
    const offer = offeredResultIds(WIRE, [standingOn('c2', 'open')]);
    expect(offer).toEqual(['c3', 'c2', 'c1']);
    // The last batch holds c3 only: c1 and c2 are earlier batches' results.
    const known = knownResults(WIRE, [BATCH[2]!]);
    const rows = standingRowsFrom(
      known,
      { previous: offer.map((toolCallId) => ({ toolCallId, standing: 'fact' as const })) },
      { toolCallId: 'c4' },
      3,
    );
    expect(rows.map((r) => [r.toolCallId, r.toolName, r.unknownId])).toEqual([
      ['c3', 'lookup_port', undefined],
      ['c2', 'lookup_port', undefined],
      ['c1', 'lookup_port', undefined],
    ]);
    // Against the batch alone — the pre-fix source — the older ids did not.
    const before = standingRowsFrom(
      [BATCH[2]!],
      { previous: offer.map((toolCallId) => ({ toolCallId, standing: 'fact' as const })) },
      { toolCallId: 'c4' },
      3,
    );
    expect(before.map((r) => r.unknownId)).toEqual([undefined, true, true]);
  });

  it('a placed result on the served history resolves to artifact:<ref> through the message’s ticket', () => {
    const ticket = JSON.stringify(placedToolResult('fetch_log', PLACED_META, 40_000, 8_000));
    const wire: LLMMessage[] = [
      { role: 'tool', content: ticket, toolCallId: 'c5', toolName: 'fetch_log' },
    ];
    const [row] = standingRowsFrom(
      knownResults(wire),
      { previous: [{ toolCallId: 'c5', standing: 'fact' }] },
      'answer',
      2,
    );
    expect(row!.ref).toBe('art_9f3c');
    expect(row!.toolName).toBe('fetch_log');
    expect(row!.unknownId).toBeUndefined();
  });

  it('never mutates deep-frozen inputs and returns a fresh array each call', () => {
    const a = knownResults(WIRE, BATCH);
    const b = knownResults(WIRE, BATCH);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(BATCH).toHaveLength(3);
    expect(WIRE).toHaveLength(6);
  });
});

// ── Edge ─────────────────────────────────────────────────────────────────

describe('offeredResultIds — edges', () => {
  it('an empty wire offers nothing, ledger or not', () => {
    expect(offeredResultIds([], undefined)).toEqual([]);
    expect(offeredResultIds([], [standingOn('c1', 'fact')])).toEqual([]);
  });

  it('messages without a toolCallId, with an empty one, or of another role are ignored', () => {
    const wire: LLMMessage[] = [
      { role: 'tool', content: 'orphan' },
      { role: 'tool', content: 'blank', toolCallId: '' },
      { role: 'assistant', content: 'x', toolCallId: 'a1' } as LLMMessage,
      tool('c1'),
    ];
    expect(offeredResultIds(wire, undefined)).toEqual(['c1']);
  });

  it('never mutates deep-frozen inputs, and returns a fresh array each call', () => {
    const rows: FindingsLedger = deepFreeze([standingOn('c2', 'noise')]);
    const a = offeredResultIds(WIRE, rows);
    const b = offeredResultIds(WIRE, rows);
    expect(a).toEqual(['c3', 'c1']);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(WIRE.map((m) => m.toolCallId)).toEqual([
      undefined,
      undefined,
      'c1',
      'c2',
      undefined,
      'c3',
    ]);
    expect(rows).toHaveLength(1);
  });

  it('one owner, two sets: the piece’s undeclared list is the offer minus the current fact and open ids, in wire order', () => {
    const rows = [
      standingOn('c1', 'fact'),
      standingOn('c2', 'ruled-out'),
      standingOn('c3', 'open'),
    ];
    const { standingOf } = foldLedger(rows);
    const served = servedToolCallIds(WIRE);
    expect(undeclaredIds(served, standingOf)).toEqual([]);
    expect(offeredResultIds(WIRE, rows)).toEqual(['c3', 'c1']);
    expect([...offeredResultIds(WIRE, rows)].reverse()).toEqual(nameableIds(served, standingOf));
    const undeclaredOnly = [standingOn('c2', 'ruled-out')];
    expect(undeclaredIds(served, foldLedger(undeclaredOnly).standingOf)).toEqual(['c1', 'c3']);
    expect(offeredResultIds(WIRE, undeclaredOnly)).toEqual(['c3', 'c1']);
  });
});

// ── Property: a seeded generator, no fast-check ──────────────────────────

/** mulberry32 — a small seeded PRNG so a failure replays by seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property — every served id is offered iff its current standing is absent, fact or open; every offered id resolves', () => {
  it('holds over 300 generated wires and ledgers', () => {
    const rnd = prng(0x0ffe);
    const POOL = Array.from({ length: 12 }, (_, i) => `t${i}`);
    for (let run = 0; run < 300; run++) {
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const served: string[] = [];
      const wire: LLMMessage[] = [{ role: 'user', content: 'q' }];
      const n = Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        const id = pick(POOL);
        if (rnd() < 0.15) wire.push({ role: 'tool', content: 'orphan' });
        else {
          wire.push(tool(id));
          served.push(id);
        }
      }
      const rows: FindingsRow[] = [];
      const m = Math.floor(rnd() * 8);
      for (let i = 0; i < m; i++) {
        const id = pick(POOL);
        if (rnd() < 0.3) rows.push(basisOn(id));
        else
          rows.push(
            standingOn(
              id,
              pick(['fact', 'open', 'noise', 'ruled-out']),
              rnd() < 0.5 ? 'answer' : 'call',
            ),
          );
      }
      const frozenWire = deepFreeze(structuredClone(wire));
      const frozenRows = deepFreeze(structuredClone(rows));
      const offer = offeredResultIds(frozenWire, frozenRows);
      const { standingOf } = foldLedger(rows);
      const message = `run ${run}`;
      const unique = [...new Set(served)];
      const live = (id: string): boolean => {
        const current = standingOf.get(id);
        return current === undefined || !RETIRING_STANDINGS.includes(current.standing);
      };
      // each once, newest first, and exactly the served ids the model can still read
      expect(new Set(offer).size, message).toBe(offer.length);
      expect(offer, message).toEqual(unique.filter(live).reverse());
      for (const id of unique) expect(offer.includes(id), message).toBe(live(id));
      // the piece's undeclared set is inside the offer
      for (const id of undeclaredIds(servedToolCallIds(frozenWire), standingOf)) {
        expect(offer, message).toContain(id);
      }
      // THE LAW AT THE ROW: every offered id resolves against the same wire,
      // with no batch at all — the history is the identity source.
      if (offer.length > 0) {
        const filed = standingRowsFrom(
          knownResults(frozenWire),
          { previous: offer.map((toolCallId) => ({ toolCallId, standing: 'open' as const })) },
          'answer',
          9,
        );
        for (const row of filed) {
          expect(row.unknownId, `${message} · ${row.toolCallId}`).toBeUndefined();
          expect(row.toolName, `${message} · ${row.toolCallId}`).toBe('lookup_port');
        }
      }
    }
  });
});
