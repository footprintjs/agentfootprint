/**
 * RFC-002 §7 acceptance — the Neo catalog under the mock embedder
 * (integration tier).
 *
 * THE CALIBRATION DISCIPLINE: the char-frequency mockEmbedder
 * compresses unrelated prose into ~0.85–0.97 cosine, so these fixtures
 * assert RELATIVE ordering (which pairs rank above which), never
 * absolute scores. Absolute thresholds are per-real-embedder
 * configuration (see MOCK_EMBEDDER_CALIBRATION docs).
 *
 * The acceptance bar (RFC-002 §7): if the lint doesn't flag
 * `get_fcns_database` vs `influx_get_fcns_database`, the threshold is
 * wrong.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  analyzeToolCatalog,
  MOCK_EMBEDDER_CALIBRATION,
  type ToolCatalogReport,
} from '../../../src/lib/tool-lint';
import { neoToolCatalog } from '../../../examples/helpers/neoToolCatalog';

const FCNS_TWINS = ['get_fcns_database', 'influx_get_fcns_database'] as const;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

async function lintNeo(): Promise<ToolCatalogReport> {
  return analyzeToolCatalog(neoToolCatalog, {
    embedder: mockEmbedder(),
    ...MOCK_EMBEDDER_CALIBRATION,
  });
}

describe('Neo catalog acceptance — relative ordering under mock (C1)', () => {
  it('the fcns twins are EACH OTHER’s top-1 most-similar partner', async () => {
    const report = await lintNeo();
    const { ranked } = report.similarity;
    for (const tool of FCNS_TWINS) {
      const partners = ranked.filter((pair) => pair.a === tool || pair.b === tool);
      // ranked is sorted descending, so partners[0] is the tool's top pair.
      const top = partners[0];
      expect(
        pairKey(top.a, top.b),
        `${tool}'s most-similar partner must be its twin (got ${top.a} <> ${top.b})`,
      ).toBe(pairKey(...FCNS_TWINS));
    }
  });

  it('flags the fcns twin pair as confusable (the §7 bar)', async () => {
    const report = await lintNeo();
    const flagged = report.similarity.confusable.some(
      (pair) => pairKey(pair.a, pair.b) === pairKey(...FCNS_TWINS),
    );
    expect(
      flagged,
      'get_fcns_database <> influx_get_fcns_database must be flagged — threshold is wrong otherwise',
    ).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('every NX-API/Influx twin pair outranks the catalog median pair', async () => {
    const report = await lintNeo();
    const { ranked } = report.similarity;
    const median = ranked[Math.floor(ranked.length / 2)].similarity;
    const twins = [
      pairKey('get_fcns_database', 'influx_get_fcns_database'),
      pairKey('get_flogi_database', 'influx_get_flogi_database'),
      pairKey('get_interface_counters', 'influx_get_interface_counters'),
    ];
    for (const twin of twins) {
      const pair = ranked.find((p) => pairKey(p.a, p.b) === twin);
      expect(pair, `twin pair ${twin} missing from ranking`).toBeDefined();
      expect(
        pair!.similarity,
        `${twin} must outrank the median pair (relative ordering)`,
      ).toBeGreaterThan(median);
    }
  });

  it('the fcns twin hint names the differentiating axis (the influx qualifier)', async () => {
    const report = await lintNeo();
    const finding = report.similarity.confusable.find(
      (pair) => pairKey(pair.a, pair.b) === pairKey(...FCNS_TWINS),
    );
    expect(finding).toBeDefined();
    expect(finding!.hint).toContain("'influx'");
    expect(finding!.hint).toContain('WHEN');
  });

  it('structural findings include the Neo field cases (metric enum + silent optionals)', async () => {
    const report = await lintNeo();
    // The metric case: avg_iops | peak_iops | mbps in prose.
    expect(
      report.structural.some(
        (f) =>
          f.rule === 'enum-in-prose' &&
          f.tool === 'influx_get_port_ranking' &&
          f.param === 'metric',
      ),
    ).toBe(true);
    // The sweep case: optional switch_name with no description.
    expect(
      report.structural.some(
        (f) =>
          f.rule === 'optional-param-undocumented' &&
          f.tool === 'influx_get_interface_counters' &&
          f.param === 'switch_name',
      ),
    ).toBe(true);
  });

  it('mock verdicts include known false positives — the documented limitation', async () => {
    // Honesty pin: under the mock at the calibrated threshold, at least
    // one non-twin pair ALSO flags (prose compression). If this ever
    // starts failing, the calibration note in analyze.ts is stale.
    const report = await lintNeo();
    const twins = new Set([
      pairKey('get_fcns_database', 'influx_get_fcns_database'),
      pairKey('get_flogi_database', 'influx_get_flogi_database'),
      pairKey('get_interface_counters', 'influx_get_interface_counters'),
    ]);
    const nonTwinFlagged = report.similarity.confusable.filter(
      (pair) => !twins.has(pairKey(pair.a, pair.b)),
    );
    expect(nonTwinFlagged.length).toBeGreaterThan(0);
  });
});
