/**
 * The AG-UI id grammar — `<run>/<kind>/<n>/<address>` — is injective.
 *
 * A collision would hand one entity's events to another: an AG-UI client finds
 * a tool call by its id across the whole conversation. So the law ships with
 * its check (CLAUDE.md, "One law before you add a mapping"): a seeded property
 * over the strings most likely to fold — separators, escapes, the absence
 * marker, empty segments — plus the minter's per-(kind, address) counting.
 */

import { describe, expect, it } from 'vitest';

import { agUiId, agUiIdMinter, type AgUiIdKind } from '../../src/ag-ui/ids.js';

const KINDS: readonly AgUiIdKind[] = ['text', 'reasoning', 'tool', 'result', 'agent', 'interrupt'];
const PIECES = [
  '',
  '/',
  '%',
  '%2F',
  '%25',
  '_',
  '%5F',
  '#',
  '#1',
  'a',
  'b/c',
  'call-llm#18',
  '0',
  '1/2',
];

/** A small deterministic generator (mulberry32) — the same tuples every run. */
function* tuples(seed: number, count: number): Generator<[string, AgUiIdKind, number, string]> {
  let x = seed >>> 0;
  const next = () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return (z ^ (z >>> 14)) >>> 0;
  };
  const word = () => {
    let s = '';
    for (let i = next() % 4; i >= 0; i--) s += PIECES[next() % PIECES.length];
    return s;
  };
  for (let i = 0; i < count; i++) {
    const run = word() || 'r';
    yield [run, KINDS[next() % KINDS.length] as AgUiIdKind, next() % 3, word()];
  }
}

describe('AG-UI ids — injective', () => {
  it('different (run, kind, n, address) tuples never spell the same id', () => {
    const seen = new Map<string, string>();
    for (const [run, kind, n, address] of tuples(7, 20_000)) {
      const id = agUiId(run, kind, n, address);
      const tuple = JSON.stringify([run, kind, n, address]);
      const earlier = seen.get(id);
      if (earlier !== undefined) expect(earlier).toBe(tuple);
      seen.set(id, tuple);
    }
    expect(seen.size).toBeGreaterThan(1_000);
  });

  it('the run segment holds no separator, so it always ends at the first `/`', () => {
    expect(agUiId('a/b', 'tool', 0, 'x#1')).toBe('a%2Fb/tool/0/x#1');
    expect(agUiId('a%2Fb', 'tool', 0, 'x#1')).toBe('a%252Fb/tool/0/x#1');
  });
});

describe('AG-UI ids — the minter', () => {
  it('counts per (kind, address), from 0', () => {
    const ids = agUiIdMinter('r');
    expect(ids.next('tool', 'tool-calls#8')).toEqual({ id: 'r/tool/0/tool-calls#8', n: 0 });
    expect(ids.next('tool', 'tool-calls#8')).toEqual({ id: 'r/tool/1/tool-calls#8', n: 1 });
    expect(ids.next('text', 'tool-calls#8')).toEqual({ id: 'r/text/0/tool-calls#8', n: 0 });
    expect(ids.at('result', 1, 'tool-calls#8')).toBe('r/result/1/tool-calls#8');
  });

  it('refuses an empty run id', () => {
    expect(() => agUiIdMinter('')).toThrow(/non-empty/);
  });
});
