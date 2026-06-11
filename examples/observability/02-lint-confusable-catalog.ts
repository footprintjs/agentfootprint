/**
 * 02 — Lint a confusable tool catalog (RFC-002 C1–C2).
 *
 * THE FRONT DOOR: `analyzeToolCatalog` takes a plain
 * `{ name, description, inputSchema }[]` — zero stack buy-in — and
 * returns a CI-gateable report: pairwise confusability over what the
 * model reads (name + description) plus a pluggable structural rule
 * pack.
 *
 * The catalog is REAL: a 16-tool subset of the Neo SAN-operations
 * agent's sidecar (py-tools/server.py), which deliberately carries
 * NX-API/InfluxDB twins. The lint surfaces:
 *
 *   ✗ get_fcns_database <> influx_get_fcns_database — the §7 acceptance
 *     pair: same database, two backends, and neither description says
 *     WHEN to pick which. The hint names the differentiating axis.
 *   ~ enum-in-prose — influx_get_port_ranking.metric lists its legal
 *     values in prose ("avg_iops | peak_iops | mbps") instead of a
 *     JSON-Schema enum.
 *   ~ optional-param-undocumented — omitting switch_name means
 *     "fabric-wide sweep", but nothing tells the model that.
 *
 * CALIBRATION HONESTY: this demo embeds with the deterministic
 * mockEmbedder (offline, no API key). The mock compresses unrelated
 * prose into ~0.85–0.97 cosine, so we use MOCK_EMBEDDER_CALIBRATION and
 * the report's RANKED section (relative ordering) is the signal to
 * trust — with a real embedder, calibrate confusabilityThreshold once
 * and absolute verdicts become meaningful (see
 * docs/guides/tool-catalog-lint.md).
 *
 * Run:  npx tsx examples/observability/02-lint-confusable-catalog.ts
 * CI:   npx agentfootprint-lint-tools tools.json --threshold 0.94
 */

import {
  analyzeToolCatalog,
  formatToolCatalogReport,
  MOCK_EMBEDDER_CALIBRATION,
  type ToolCatalogReport,
} from '../../src/observe.js';
import { mockEmbedder } from '../../src/index.js';
import { neoToolCatalog } from '../helpers/neoToolCatalog.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/02-lint-confusable-catalog',
  title: 'Tool-catalog confusability lint — the Neo twins (RFC-002 C1/C2)',
  group: 'observability',
  description:
    'analyzeToolCatalog lints a real 16-tool SAN catalog (zero stack buy-in: plain ' +
    'name/description/inputSchema objects): pairwise confusability flags the deliberate ' +
    'get_fcns_database vs influx_get_fcns_database twins with a differentiating-axis hint, ' +
    'and the structural rule pack catches enum-in-prose (metric: "avg_iops | peak_iops | ' +
    'mbps") plus undocumented optional params — all offline via the mock embedder.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'tools', 'lint', 'confusability', 'ci-gate', 'rfc-002'],
};

export interface LintConfusableResult {
  readonly report: ToolCatalogReport;
  readonly fcnsPairFlagged: boolean;
  readonly transcript: string;
}

export async function run(_input?: string | null): Promise<LintConfusableResult> {
  const out: string[] = [];

  out.push('═══ TOOL-CATALOG LINT — the Neo SAN catalog (16 tools) ═══', '');
  out.push(
    '⚠ demo embedder is the deterministic mock (offline). Verdicts use',
    `  MOCK_EMBEDDER_CALIBRATION (threshold ${MOCK_EMBEDDER_CALIBRATION.confusabilityThreshold}); trust the RELATIVE ordering.`,
    '  With a real embedder, calibrate once and absolute verdicts hold.',
    '',
  );

  const report = await analyzeToolCatalog(neoToolCatalog, {
    embedder: mockEmbedder(),
    ...MOCK_EMBEDDER_CALIBRATION,
  });

  out.push(formatToolCatalogReport(report, { topPairs: 8 }));

  const fcnsPair = report.similarity.confusable.find(
    (pair) => [pair.a, pair.b].sort().join('|') === 'get_fcns_database|influx_get_fcns_database',
  );
  out.push(
    '',
    '═══ THE ACCEPTANCE PAIR (RFC-002 §7) ═══',
    fcnsPair
      ? `✗ flagged as expected: ${fcnsPair.a} <> ${fcnsPair.b} @ ${fcnsPair.similarity.toFixed(
          4,
        )}\n  hint: ${fcnsPair.hint}`
      : '✘ NOT FLAGGED — the threshold is wrong (this should never print)',
  );

  const transcript = out.join('\n');
  console.log(transcript);

  return { report, fcnsPairFlagged: fcnsPair !== undefined, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
