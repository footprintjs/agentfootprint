/**
 * Compile-level regression test — `describedResult()`'s declaration.
 *
 * What the real compiler (`npm run test:types`) pins:
 *
 *   1. **Series or facts without `provenance` is a COMPILE error.** The run
 *      refuses it anyway, inside the tool, where the model reads the refusal;
 *      the type lets the author meet the bug first (`@ts-expect-error`).
 *   2. **Edges-only and clarify-only declarations need no provenance** — the
 *      same line the run draws (`hasData` = series or facts).
 *   3. **One spelling.** camelCase compiles; a snake_case key
 *      (`measured_at`, `is_counter`, `filter_note`) does not.
 *   4. **The input type is not the wire type.** `describedResult()` returns the
 *      unchanged `ToolSemantics`, whose provenance has `measured_at` and no
 *      `measuredAt` — the camelCase declaration never widened the wire.
 *   5. `semantic()`'s declaration is untouched: it still takes snake_case and
 *      still compiles without provenance (its refusal stays at run time).
 *
 * The `.test.ts` name lets `npm test` run the runtime assertions too.
 */
import { describe, expect, it } from 'vitest';

import {
  describedResult,
  semantic,
  type DescribedResultDeclaration,
  type SemanticProvenance,
  type ToolSemantics,
} from '../../src/index';

const rows = [{ entity: 'vm-01', size_tb: 12 }];
const exportTime = '2026-09-19T02:00:00Z';

describe('describedResult() — the declaration type', () => {
  it('series or facts without provenance does not compile', () => {
    // @ts-expect-error — facts with no provenance: a number with no source and no age
    const noSource = (): ToolSemantics => describedResult({ facts: rows });
    const noSourceSeries = (): ToolSemantics =>
      // @ts-expect-error — a series with no provenance
      describedResult({
        series: [{ t: exportTime, entity: 'fc1/3', metric: 'iops', value: 1 }],
        grain: { interval: '30m' },
      });
    // The run still refuses both if the compiler is bypassed.
    expect(noSource).toThrow(/^refused: /);
    expect(noSourceSeries).toThrow(/^refused: /);

    const declared: DescribedResultDeclaration = {
      facts: rows,
      provenance: { measuredAt: exportTime, source: 'RVTools export' },
    };
    expect(describedResult(declared).provenance?.measured_at).toBe(exportTime);
  });

  it('a value typed as possibly-present facts still needs provenance', () => {
    const maybeRows: typeof rows | undefined = rows.length > 0 ? rows : undefined;
    // @ts-expect-error — facts MAY be present, so provenance must be
    const risky = (): ToolSemantics => describedResult({ facts: maybeRows });
    expect(risky).toThrow(/provenance/);
    const fine = describedResult({
      facts: maybeRows,
      provenance: { measuredAt: exportTime, source: 'RVTools export' },
    });
    expect(fine.facts).toHaveLength(1);
  });

  it('edges-only and clarify-only declarations need no provenance', () => {
    const edges = describedResult({ edges: [{ from: 'vm-01', to: 'ds-7', kind: 'rides' }] });
    expect(edges.edges).toHaveLength(1);
    const ask = describedResult({
      clarify: {
        question: 'Two customers match — which one?',
        candidates: ['Acme Ltd', 'Acme Inc'],
      },
    });
    expect(ask.clarify).not.toBeNull();
  });

  it('camelCase compiles; the snake_case spelling does not', () => {
    const ok = describedResult({
      series: [{ t: exportTime, entity: 'fc1/3', metric: 'avg_iops', value: 17200 }],
      grain: { interval: '30m', aggregation: 'avg', isCounter: false },
      provenance: {
        measuredAt: exportTime,
        ageSeconds: 600,
        source: 'InfluxDB',
        sourceExportDate: '2026-09-18',
      },
      render: { default: 'table', filterNote: 'replicas excluded', chartHint: 'line per entity' },
    });
    expect(ok.grain?.is_counter).toBe(false);

    const snakeProvenance = (): ToolSemantics =>
      describedResult({
        facts: rows,
        provenance: {
          // @ts-expect-error — `measured_at` is the wire's spelling; this door takes `measuredAt`
          measured_at: exportTime,
          source: 'RVTools export',
        },
      });
    expect(snakeProvenance).toThrow(/did you mean `measuredAt`\?/);
    const snakeGrain = (): ToolSemantics =>
      describedResult({
        edges: [{ from: 'a', to: 'b', kind: 'k' }],
        grain: {
          // @ts-expect-error — `is_counter` is the wire's spelling; this door takes `isCounter`
          is_counter: true,
        },
      });
    expect(snakeGrain).toThrow(/did you mean `isCounter`\?/);
    const snakeRender = (): ToolSemantics =>
      describedResult({
        edges: [{ from: 'a', to: 'b', kind: 'k' }],
        render: {
          default: 'table',
          // @ts-expect-error — `filter_note` is the wire's spelling; this door takes `filterNote`
          filter_note: 'x',
        },
      });
    expect(snakeRender).toThrow(/did you mean `filterNote`\?/);
  });

  it('the return is the unchanged wire type — the declaration never widened it', () => {
    const minted = describedResult({
      facts: rows,
      provenance: { measuredAt: exportTime, source: 'RVTools export' },
    });
    const wire: SemanticProvenance | undefined = minted.provenance;
    expect(wire?.measured_at).toBe(exportTime);
    // @ts-expect-error — the wire carries measured_at, never measuredAt
    expect(wire?.measuredAt).toBeUndefined();
  });

  it("semantic()'s declaration is untouched — snake_case, provenance still optional in its type", () => {
    // Compiles, exactly as before; the refusal stays at run time for the deprecated name.
    const legacy = (): ToolSemantics => semantic({ facts: rows });
    expect(legacy).toThrow(/^refused: this result carries series\/facts with no `provenance`/);
    const minted = semantic({
      facts: rows,
      provenance: { measured_at: exportTime, source: 'RVTools export' },
    });
    expect(minted.provenance?.measured_at).toBe(exportTime);
  });
});
