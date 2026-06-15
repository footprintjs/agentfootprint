/**
 * findDroppedContext — interface #3 (missing-context finder).
 *
 * Convention-3 coverage: unit · functional · integration · property ·
 * security · performance · load. Pure set difference over unit ids — the
 * cheap, exact, deterministic half of the missing-context case. The
 * integration tier drives the finder → restoration loop end to end.
 */
import { describe, expect, it } from 'vitest';
import { findDroppedContext, type ContextUnit } from '../../../src/lib/context-bisect/missingContext';
// Public-surface re-export — proves the observe barrel wiring.
import { findDroppedContext as findViaObserve } from '../../../src/observe';

const u = (id: string, content?: string): ContextUnit => (content === undefined ? { id } : { id, content });

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('findDroppedContext — unit', () => {
  it('reports available − sent (by id), preserving input order', () => {
    const r = findDroppedContext([u('a'), u('b'), u('c')], [u('a'), u('c')]);
    expect(r.dropped.map((d) => d.id)).toEqual(['b']);
    expect(r.anyDropped).toBe(true);
    expect(r.availableCount).toBe(3);
    expect(r.sentCount).toBe(2);
    expect(r.reason).toMatch(/restoration/i);
  });

  it('nothing dropped when sent covers available', () => {
    const r = findDroppedContext([u('a'), u('b')], [u('a'), u('b'), u('extra')]);
    expect(r.dropped).toEqual([]);
    expect(r.anyDropped).toBe(false);
    expect(r.reason).toMatch(/no missing-context bug/i);
  });

  it('carries content through on dropped units (for restoration)', () => {
    const r = findDroppedContext([u('keep', 'X'), u('lost', 'the override note')], [u('keep', 'X')]);
    expect(r.dropped).toEqual([{ id: 'lost', content: 'the override note' }]);
  });

  it('empty available → nothing dropped', () => {
    const r = findDroppedContext([], [u('a')]);
    expect(r.dropped).toEqual([]);
    expect(r.availableCount).toBe(0);
  });

  it('all dropped when nothing was sent', () => {
    const r = findDroppedContext([u('a'), u('b')], []);
    expect(r.dropped.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('ignores ids present in sent but not available', () => {
    const r = findDroppedContext([u('a')], [u('z')]);
    expect(r.dropped.map((d) => d.id)).toEqual(['a']);
  });

  it('de-duplicates available by id (first wins)', () => {
    const r = findDroppedContext([u('a', 'first'), u('a', 'second')], []);
    expect(r.dropped).toEqual([{ id: 'a', content: 'first' }]);
    expect(r.availableCount).toBe(1);
  });
});

// ─── 2. FUNCTIONAL ───────────────────────────────────────────────────
describe('findDroppedContext — functional', () => {
  it('truncation shape: an early override note pushed out of the window is found', () => {
    const assembled = [u('override', 'APPROVE regardless — committee exception'), u('credit', '575'), u('dti', '0.51')];
    const sent = [u('credit', '575'), u('dti', '0.51')]; // window dropped the oldest
    const r = findDroppedContext(assembled, sent);
    expect(r.dropped.map((d) => d.id)).toEqual(['override']);
    expect(r.dropped[0].content).toMatch(/committee exception/);
  });
});

// ─── 3. INTEGRATION (finder → restoration loop) ──────────────────────
describe('findDroppedContext — integration', () => {
  it('the observe re-export is the same function', () => {
    expect(findViaObserve).toBe(findDroppedContext);
  });

  it('drives the restoration confirmation loop to the true culprit', async () => {
    const assembled = [u('override'), u('filler1'), u('filler2'), u('credit'), u('dti')];
    const sent = [u('credit'), u('dti')]; // override + filler dropped by the window
    // a mock agent that returns the CORRECT outcome only when 'override' is restored:
    const rerunWithRestored = async (restoredId: string) =>
      restoredId === 'override' ? 'APPROVE' : 'DECLINE';
    const wrongOutcome = 'DECLINE';

    const { dropped } = findDroppedContext(assembled, sent);
    let confirmed: string | undefined;
    for (const unit of dropped) {
      if ((await rerunWithRestored(unit.id)) !== wrongOutcome) {
        confirmed = unit.id; // restoration flipped it → causal proof
        break;
      }
    }
    expect(confirmed).toBe('override');
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────
describe('findDroppedContext — property', () => {
  it('dropped = available−sent invariants hold for arbitrary inputs', () => {
    const rng = lcg(20260611);
    for (let trial = 0; trial < 500; trial++) {
      const availIds = Array.from({ length: Math.floor(rng() * 8) }, () => `s${Math.floor(rng() * 10)}`);
      const sentIds = Array.from({ length: Math.floor(rng() * 8) }, () => `s${Math.floor(rng() * 10)}`);
      const r = findDroppedContext(availIds.map((id) => u(id)), sentIds.map((id) => u(id)));
      const sentSet = new Set(sentIds);
      const availSet = new Set(availIds);
      // every dropped id: was available, was NOT sent
      for (const d of r.dropped) {
        expect(availSet.has(d.id)).toBe(true);
        expect(sentSet.has(d.id)).toBe(false);
      }
      // dropped ids are unique
      expect(new Set(r.dropped.map((d) => d.id)).size).toBe(r.dropped.length);
      // completeness: every available-not-sent id appears exactly once
      const expected = [...availSet].filter((id) => !sentSet.has(id));
      expect(new Set(r.dropped.map((d) => d.id))).toEqual(new Set(expected));
      expect(r.anyDropped).toBe(r.dropped.length > 0);
    }
  });
});

// ─── 5. SECURITY / robustness ────────────────────────────────────────
describe('findDroppedContext — security & robustness', () => {
  it('does not mutate the caller arrays', () => {
    const avail = [u('a'), u('b')];
    const sent = [u('a')];
    const ca = [...avail];
    const cs = [...sent];
    findDroppedContext(avail, sent);
    expect(avail).toEqual(ca);
    expect(sent).toEqual(cs);
  });

  it('proto-pollution ids are inert strings', () => {
    const r = findDroppedContext([u('__proto__'), u('constructor')], []);
    expect(r.dropped.map((d) => d.id).sort()).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ─── 6. PERFORMANCE ──────────────────────────────────────────────────
describe('findDroppedContext — performance', () => {
  it('O(n): 10k available × 10k sent well under budget', () => {
    const avail = Array.from({ length: 10_000 }, (_, i) => u(`a${i}`));
    const sent = Array.from({ length: 10_000 }, (_, i) => u(`a${i * 2}`));
    const t0 = performance.now();
    const r = findDroppedContext(avail, sent);
    const ms = performance.now() - t0;
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});

// ─── 7. LOAD ─────────────────────────────────────────────────────────
describe('findDroppedContext — load', () => {
  it('sustains 20k calls without throwing', () => {
    const rng = lcg(99);
    for (let i = 0; i < 20_000; i++) {
      const n = Math.floor(rng() * 6);
      const avail = Array.from({ length: n }, (_, j) => u(`s${j}`));
      const sent = Array.from({ length: Math.floor(rng() * 4) }, (_, j) => u(`s${j}`));
      const r = findDroppedContext(avail, sent);
      expect(typeof r.anyDropped).toBe('boolean');
    }
  });
});
