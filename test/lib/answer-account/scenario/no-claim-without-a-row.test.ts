/**
 * No line claims a fact the record lacks — the property test (P1–P7).
 *
 * The generator is the REAL recording (fixture A) with random damage: drop any
 * subset of events; drop optional payload fields; drop `sharedState` keys;
 * truncate `history`; replace a payload with `{}`; add unknown events and events
 * of ANOTHER run. It is a small SEEDED generator (mulberry32), not fast-check:
 * fast-check is not installed in the shared node_modules this worktree uses,
 * and adding it would write through that link — the fallback the packet allows.
 * Every case is reproducible from its seed, printed on failure.
 *
 *   P1  every recorded line points at the record, and every pointer resolves to
 *       a leaf; every `vars[k].from` resolves to `vars[k].value`.
 *   P2  a template whose source event type is gone never appears as recorded.
 *   P3  (monotone) removing entries never ADDS a signal.
 *   P4  determinism, across two calls and `structuredClone`.
 *   P5  a value filled from the app's declarations is vouched `app` with a
 *       declaration pointer; without declarations there is no such value.
 *   P6  (scope) events of another run change nothing but `foreign`.
 *   P7  the whole response `{ account, shown }` is allow-listed and bounded.
 */

import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../../../src/lib/answer-account/account.js';
import type { AnswerAccount } from '../../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import {
  assertP1,
  assertP7,
  dump,
  fixtureA,
  fixtureB,
  FLAGSHIP_RUN_ID,
  linesOf,
  NEO_DECLARATIONS,
} from '../helpers.js';

type E = { type: string; payload: Record<string, unknown>; meta: Record<string, unknown> };
type Rec = {
  meta?: unknown;
  snapshot: { runId?: string; sharedState: Record<string, unknown> };
  events: E[];
  structure: unknown;
};

/** mulberry32 — a tiny seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOf = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

type Damage = 'drop-events' | 'drop-fields' | 'drop-state' | 'truncate-history' | 'blank-payload';
const REMOVALS: readonly Damage[] = [
  'drop-events',
  'drop-fields',
  'drop-state',
  'truncate-history',
  'blank-payload',
];

/** One damaged copy of `base` — removals only (P3 needs removals). */
function damage(base: Rec, seed: number): { rec: Rec; how: string } {
  const r = rng(seed);
  const rec = structuredClone(base);
  const kinds = REMOVALS.filter(() => r() < 0.5);
  if (kinds.length === 0) kinds.push(pickOf(r, REMOVALS));
  const rate = pickOf(r, [0.02, 0.1, 0.3, 0.7]);
  for (const kind of kinds) {
    if (kind === 'drop-events') rec.events = rec.events.filter(() => r() >= rate);
    if (kind === 'drop-fields') {
      for (const e of rec.events) {
        if (r() >= rate) continue;
        const keys = Object.keys(e.payload);
        if (keys.length > 0) delete e.payload[pickOf(r, keys)];
      }
    }
    if (kind === 'drop-state') {
      for (const k of Object.keys(rec.snapshot.sharedState))
        if (r() < 0.5) delete rec.snapshot.sharedState[k];
    }
    if (kind === 'truncate-history' && Array.isArray(rec.snapshot.sharedState.history)) {
      const h = rec.snapshot.sharedState.history as unknown[];
      rec.snapshot.sharedState.history = h.slice(0, Math.floor(r() * h.length));
    }
    if (kind === 'blank-payload') for (const e of rec.events) if (r() < rate) e.payload = {};
  }
  return { rec, how: `seed ${seed}: ${kinds.join('+')} @${rate}` };
}

/** Additions: unknown events and events of another run, at random places. */
function addForeign(base: Rec, seed: number): { rec: Rec; added: number } {
  const r = rng(seed);
  const rec = structuredClone(base);
  const templates = rec.events.filter((_, i) => r() < 0.1);
  let added = 0;
  for (const t of templates) {
    const at = Math.floor(r() * rec.events.length);
    rec.events.splice(at, 0, {
      ...structuredClone(t),
      meta: { ...t.meta, runId: 'run-another-person-9' },
    });
    added += 1;
  }
  return { rec, added };
}

/** 120 in the suite; set AF_ACCOUNT_CASES to stress (3,000 seeds ran clean when this was written). */
const CASES = Number(process.env.AF_ACCOUNT_CASES ?? 120);
const LONG = { timeout: 120_000 };
const baseA = (): Rec => fixtureA() as unknown as Rec;
const explain = (rec: Rec, withDecl = true): AnswerAccount =>
  accountForAnswer(rec as unknown as Recording, withDecl ? NEO_DECLARATIONS : undefined, {
    runId: FLAGSHIP_RUN_ID,
  });
const signalKeys = (a: AnswerAccount) =>
  new Set(
    a.signals.map(
      (s) => `${s.id}:${String(s.sentence.vars.tool?.value ?? s.sentence.vars.skill?.value ?? '')}`,
    ),
  );

describe('P1 + P7 — every damaged recording', () => {
  it(`${CASES} seeded cases, with and without declarations`, LONG, () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const { rec, how } = damage(baseA(), seed);
      for (const withDecl of [true, false]) {
        const decl = withDecl ? NEO_DECLARATIONS : {};
        const account = explain(rec, withDecl);
        try {
          assertP1(account, rec as unknown as Recording, decl);
          assertP7(account, rec as unknown as Recording, decl);
        } catch (error) {
          throw new Error(`${how} (declarations: ${withDecl}) — ${(error as Error).message}`);
        }
      }
    }
  });

  it('P7 over the undamaged fixtures A, A0 and B', () => {
    assertP7(explain(baseA()), fixtureA(), NEO_DECLARATIONS);
    assertP7(explain(baseA(), false), fixtureA(), {});
    const b = fixtureB();
    assertP7(
      accountForAnswer(b, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID }),
      b,
      NEO_DECLARATIONS,
    );
  });
});

describe('P2 — a gone source is never "recorded"', () => {
  it('drop every event of one type: no recorded line points at that type', () => {
    const types = [...new Set(baseA().events.map((e) => e.type))];
    for (const type of types) {
      const rec = baseA();
      rec.events = rec.events.filter((e) => e.type !== type);
      const account = explain(rec);
      const offenders = linesOf(account).filter(
        (s) =>
          s.status === 'recorded' && s.pointers.some((p) => p.kind === 'event' && p.type === type),
      );
      expect(
        offenders.map((s) => s.template.id),
        type,
      ).toEqual([]);
    }
  });
});

describe('P3 — monotone: removing entries never adds a signal', () => {
  it(`${CASES} seeded removals`, LONG, () => {
    for (const withDecl of [true, false]) {
      const base = signalKeys(explain(baseA(), withDecl));
      for (let seed = 1; seed <= CASES; seed++) {
        const { rec, how } = damage(baseA(), seed);
        const damaged = signalKeys(explain(rec, withDecl));
        for (const key of damaged) expect(base.has(key), `${how}: added ${key}`).toBe(true);
      }
    }
  });
});

describe('P4 — determinism', () => {
  it('two calls and a structuredClone give the same bytes', () => {
    const rec = baseA();
    const one = JSON.stringify(explain(rec));
    expect(JSON.stringify(explain(rec))).toBe(one);
    expect(JSON.stringify(explain(structuredClone(rec)))).toBe(one);
    for (let seed = 1; seed <= 20; seed++) {
      const { rec: d } = damage(baseA(), seed);
      expect(JSON.stringify(explain(d))).toBe(JSON.stringify(explain(structuredClone(d))));
    }
  });
});

describe('P5 — the app’s declarations are vouched `app`, and only they', () => {
  it('a var read from a declaration is app; a truth-deciding one pulls its sentence to app; a label does not', () => {
    const account = explain(baseA());
    for (const s of linesOf(account)) {
      for (const [name, variable] of Object.entries(s.vars)) {
        if (variable.from?.kind !== 'declaration') continue;
        expect(variable.source, `${s.template.id}.${name}`).toBe('app');
        if (!name.endsWith('Label')) expect(s.source).toBe('app');
      }
      const rowsAtPointer = s.pointers.some(
        (p) => p.kind === 'declaration' && p.field.endsWith('.rowsAt'),
      );
      if (rowsAtPointer) expect(s.source, s.template.id).toBe('app');
    }
  });

  it('without declarations: no declaration pointer, no app label, no app line — nothing re-attributed', () => {
    const account = explain(baseA(), false);
    const all = linesOf(account);
    expect(all.flatMap((s) => s.pointers).filter((p) => p.kind === 'declaration')).toEqual([]);
    expect(all.flatMap((s) => s.parts).filter((p) => 'label' in p && p.source === 'app')).toEqual(
      [],
    );
    expect(all.filter((s) => s.template.id === 'understood.app.notRecorded')).toEqual([]);
  });
});

describe('P6 — another run’s events change nothing but `foreign`', () => {
  it('interleaved foreign events: same text, same signals, counted', () => {
    const base = explain(baseA());
    for (let seed = 1; seed <= 30; seed++) {
      const { rec, added } = addForeign(baseA(), seed);
      const account = explain(rec);
      expect(account.foreign, `seed ${seed}`).toBe(added);
      expect(dump(account), `seed ${seed}`).toBe(dump(base));
      expect(account.signals.map((s) => s.sentence.text)).toEqual(
        base.signals.map((s) => s.sentence.text),
      );
    }
  });

  it('unknown event types are passed over', () => {
    const rec = baseA();
    rec.events.push({
      type: 'agentfootprint.future.thing',
      payload: { x: 1 },
      meta: { runId: FLAGSHIP_RUN_ID },
    });
    rec.events.push({ nope: true } as unknown as E);
    const account = explain(rec);
    expect(account.unread).toBe(1);
    expect(dump(account)).toBe(dump(explain(baseA())));
  });
});
