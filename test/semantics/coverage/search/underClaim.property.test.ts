/**
 * PROPERTY — composition can only under-claim (design § 3.4, revision 5).
 *
 * Over generated declarations, calls and results: every composed item comes
 * from a place the call or the declaration names — a value the call sent, a
 * declared default, a declared fixed qualifier, the declared (or sent)
 * source, a host-filled identity key, or a fact the result declared — and
 * carries exactly that value; every classified argument none of them covers
 * is a gap; a `resolved` entity rides only the value it names; and `complete`
 * holds only where the declaration and the gaps allow it.
 *
 * A seeded generator, not fast-check: the tree carries no fast-check, and the
 * coverage properties pin themselves this way (`coverage-in-progress.test.ts`).
 * 3,000 cases per run, one fixed seed, so a failure reproduces.
 */

import { describe, expect, it } from 'vitest';

import { absent, coverage, describedResult } from '../../../../src/index.js';
import type { ComposedItem } from '../../../../src/semantics/coverage/composedCoverage.js';
import { composeSearchCoverage } from '../../../../src/semantics/coverage/search/compose.js';
import { sameName } from '../../../../src/semantics/coverage/search/binding.js';
import { isAnyValue } from '../../../../src/semantics/coverage/search/declaration.js';
import type {
  SearchArgument,
  SearchRole,
  ToolSearch,
} from '../../../../src/semantics/coverage/search/types.js';
import type { ToolResultStatus } from '../../../../src/semantics/toolOutcome.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ROLES: readonly SearchRole[] = [
  'population',
  'filter',
  'period',
  'source',
  'cap',
  'page',
  'inert',
];
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const VALUES = ['x', 'y', 'z', '2h', '7d'] as const;
const STATUSES: readonly (ToolResultStatus | undefined)[] = [
  undefined,
  'success',
  'partial',
  'pending',
];

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

describe('property — composition never claims what the call did not send or declare', () => {
  it('3,000 generated calls', () => {
    const next = rng(20261023);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    const chance = (p: number) => next() < p;

    for (let n = 0; n < 3000; n++) {
      // ── a declaration ──
      const used = NAMES.filter(() => chance(0.7));
      let sourceTaken = false;
      const args: SearchArgument[] = used.map((name) => {
        let role = pick(ROLES);
        if (role === 'source' && sourceTaken) role = 'filter';
        if (role === 'source') sourceTaken = true;
        const w = next();
        const whenOmitted =
          role === 'inert'
            ? undefined
            : w < 0.35
            ? undefined
            : w < 0.55
            ? ({ any: true } as const)
            : w < 0.85
            ? pick(VALUES)
            : [pick(VALUES), pick(VALUES)];
        return { name, role, ...(whenOmitted !== undefined && { whenOmitted }) };
      });
      const fixed = chance(0.5) ? [{ name: 'fx', value: pick(VALUES), said: ['w'] }] : undefined;
      const search: ToolSearch = {
        source: { what: 'the store', said: ['the store'] },
        subject: { what: 'things', said: ['things'] },
        ...(fixed !== undefined && { fixed }),
        arguments: args,
        ...(chance(0.7) && { complete: 'within-arguments' as const }),
        ...(chance(0.2) && { limits: { cap: chance(0.5) ? ('unknown' as const) : 2 } }),
      };

      // ── a call ──
      const sent: Record<string, unknown> = {};
      for (const a of args) {
        if (!chance(0.5)) continue;
        sent[a.name] =
          a.role === 'population' && chance(0.3) ? [pick(VALUES), pick(VALUES)] : pick(VALUES);
      }
      const identityArg = chance(0.3) ? pick(used.length > 0 ? used : ['a']) : undefined;
      const hostFilled =
        identityArg !== undefined
          ? { identity: { [identityArg]: 'tenant' }, credential: [] }
          : undefined;

      // ── a result ──
      const resolved = chance(0.5)
        ? [
            {
              argument: pick(NAMES),
              id: pick(VALUES),
              ...(chance(0.5) && { aliases: [pick(VALUES)] }),
            },
          ]
        : undefined;
      const period = chance(0.4)
        ? {
            queried: { from: '2026-10-22T08:00:00Z', to: '2026-10-22T10:00:00Z' },
            held: { from: '2026-10-01T00:00:00Z', to: '2026-10-22T10:00:00Z' },
          }
        : undefined;
      const paging = chance(0.4) ? { next: chance(0.5) ? null : 'c2' } : undefined;
      const kind = next();
      const factCount = 1 + Math.floor(next() * 3);
      const rows = kind < 0.5 ? 0 : kind < 0.8 ? factCount : 1;
      const pagingRead = kind < 0.8 ? paging : undefined; // coverage() carries no paging
      const result =
        kind < 0.5
          ? absent({
              what: 'things',
              checked: 'declared',
              ...(resolved !== undefined && { resolved }),
              ...(period !== undefined && { period }),
              ...(paging !== undefined && { paging }),
            })
          : kind < 0.8
          ? describedResult({
              facts: Array.from({ length: factCount }, (_, i) => ({
                entity: `e${i}`,
              })),
              provenance: { measuredAt: '2026-10-22T10:00:00Z', source: 'the store' },
              ...(resolved !== undefined && { resolved }),
              ...(period !== undefined && { period }),
              ...(paging !== undefined && { paging }),
            })
          : coverage(['r'], { checked: 'declared', ...(period !== undefined && { period }) });
      const origin = chance(0.2) ? ('remote' as const) : ('local' as const);
      const status = pick(STATUSES);

      const out = composeSearchCoverage(
        {
          toolName: 't',
          toolCallId: `c${n}`,
          iteration: 1,
          resultId: `claim-result/ns/run/${n + 1}`,
          search,
          origin,
          args: sent,
          ...(hostFilled !== undefined && { hostFilled }),
          period: {
            argument: used.find((u) => args.find((a) => a.name === u)?.role === 'period') ?? 'a',
            spelling: 'lookback',
          },
          turnNow: '2026-10-22T10:00:00Z',
          ...(status !== undefined && { status }),
        },
        result,
      );
      expect(out?.outcome).toBe('composed');
      if (out?.outcome !== 'composed') continue;
      const facts = out.reading.declared[0];
      const items = (facts?.coverage.checked ?? []) as readonly ComposedItem[];
      const gaps = facts?.composed?.gaps ?? [];
      const argOf = (name: string | undefined) => args.find((a) => a.name === name);
      const isHost = (name: string | undefined) => name !== undefined && name === identityArg;

      // Every item comes from a place the call or the declaration names, with that value.
      for (const item of items) {
        const a = argOf(item.argument);
        switch (item.from) {
          case 'call': {
            expect(a).toBeDefined();
            expect(isHost(item.argument)).toBe(false);
            const v = sent[item.argument as string];
            const ok =
              deepEqual(item.value, v) ||
              (Array.isArray(v) &&
                a?.role === 'population' &&
                v.some((e) => deepEqual(e, item.value)));
            expect(ok).toBe(true);
            break;
          }
          case 'default': {
            expect(a).toBeDefined();
            expect(item.argument !== undefined && item.argument in sent).toBe(false);
            const w = a?.whenOmitted;
            if (item.any === true) expect(isAnyValue(w)).toBe(true);
            else
              expect(
                deepEqual(item.value, w) ||
                  (Array.isArray(w) && w.some((e) => deepEqual(e, item.value))),
              ).toBe(true);
            break;
          }
          case 'fixed':
            expect(fixed?.some((q) => q.name === item.argument && q.value === item.value)).toBe(
              true,
            );
            break;
          case 'tool': {
            expect(item.facet).toBe('source');
            expect(item.value).toBeUndefined();
            const src = args.find((x) => x.role === 'source');
            expect(
              src === undefined ||
                (!(src.name in sent) && isAnyValue(src.whenOmitted)) ||
                isHost(src.name),
            ).toBe(true);
            break;
          }
          case 'host':
            expect(isHost(item.argument)).toBe(true);
            expect(item.value).toEqual({ identity: 'tenant' });
            break;
          case 'result':
            // A result fact can only narrow: the period the result declared, and nothing else.
            expect(item.facet).toBe('period');
            expect(period).toBeDefined();
            expect(args.some((x) => x.role === 'period')).toBe(false);
            break;
          default:
            throw new Error(`an item from nowhere: ${JSON.stringify(item)}`);
        }
        // `resolved` rides only the value it names, for its own argument.
        if (item.resolved !== undefined) {
          const entry = resolved?.find(
            (r) => r.argument === item.argument && r.id === item.resolved?.id,
          );
          expect(entry).toBeDefined();
          const names = [entry?.id, ...(entry?.aliases ?? [])].filter(
            (x): x is string => x !== undefined,
          );
          expect(names.some((nm) => sameName(nm, String(item.value)))).toBe(true);
        }
      }

      // Every classified argument (not inert, not host-filled) is an item or a gap.
      for (const a of args) {
        if (a.role === 'inert' || isHost(a.name)) continue;
        const asItem =
          items.some((i) => i.argument === a.name) ||
          (a.role === 'source' && items.some((i) => i.facet === 'source'));
        const asGap = gaps.some((g) => g.argument === a.name);
        const groundless = a.role === 'cap' || a.role === 'page';
        if (!(a.name in sent) && a.whenOmitted === undefined) {
          expect(gaps.some((g) => g.kind === 'argument-unsent' && g.argument === a.name)).toBe(
            true,
          );
        } else if (!groundless) {
          expect(asItem || asGap).toBe(true);
        }
      }

      // An INDEPENDENT oracle for what must keep a row from being complete —
      // computed from the inputs, never from the composer's own gaps.
      const capOf = (v: unknown) =>
        typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : undefined;
      const inEffect = (a: SearchArgument): unknown =>
        a.name in sent ? sent[a.name] : isAnyValue(a.whenOmitted) ? 'ANY' : a.whenOmitted;
      const mustBlock =
        origin === 'remote' ||
        search.complete === undefined ||
        status === 'partial' ||
        status === 'pending' ||
        args.some(
          (a) =>
            a.role !== 'inert' &&
            !isHost(a.name) &&
            !(a.name in sent) &&
            a.whenOmitted === undefined,
        ) ||
        args.some((a) => a.role === 'page' && !isHost(a.name) && a.name in sent) ||
        (args.some((a) => a.role === 'page' && !isHost(a.name)) && pagingRead === undefined) ||
        (pagingRead !== undefined && pagingRead.next !== null) ||
        search.limits?.cap === 'unknown' ||
        (typeof search.limits?.cap === 'number' && rows >= search.limits.cap) ||
        args.some((a) => {
          if (a.role !== 'cap' || isHost(a.name)) return false;
          const v = inEffect(a);
          if (v === undefined || v === 'ANY') return false;
          const cap = capOf(v);
          return cap === undefined || rows >= cap;
        });
      if (mustBlock) expect(facts?.composed?.complete).toBe(false);

      // `complete` only where the declaration and the gaps allow it.
      if (facts?.composed?.complete === true) {
        expect(origin).toBe('local');
        expect(search.complete).toBe('within-arguments');
        expect(
          gaps.some(
            (g) => g.kind === 'argument-unsent' || g.kind === 'prose' || g.bears === 'completeness',
          ),
        ).toBe(false);
        expect(status === 'partial' || status === 'pending').toBe(false);
      }
    }
  });
});
