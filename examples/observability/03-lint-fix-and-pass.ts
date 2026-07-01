/**
 * 03 — Fix the catalog, pass the gate (RFC-002 C1–C3).
 *
 * The remediation loop the lint exists for, on a focused 3-tool slice of
 * the Neo catalog:
 *
 *   BEFORE  ✗ the fcns twins are confusable (same database, two
 *             backends, nothing says when to pick which)
 *           ✗ reset_port has NO description (structural error)
 *           ~ reset_port.mode lists its values in prose ("shut | noshut
 *             | flap"), optional params are silent about omission
 *
 *   FIX     descriptions rewritten to LEAD WITH THE CHOICE CONDITION
 *           ("Live … call FIRST during an active incident" vs
 *           "Historical … use only for audits"), the prose values
 *           become a real JSON-Schema enum, every optional says what
 *           omission means
 *
 *   AFTER   report.ok === true under the SAME thresholds — in strict
 *           mode (failOn: 'warn'), so even advisories are clean.
 *
 * Same calibration honesty as example 02: the mock embedder compresses
 * prose, so we run with MOCK_EMBEDDER_CALIBRATION. Note how the fixed
 * twins land in the WATCH band rather than far apart — that's the
 * mock's floor, not the descriptions'; a real embedder separates them
 * decisively (see docs/guides/tool-catalog-lint.md).
 *
 * Run:  npx tsx examples/observability/03-lint-fix-and-pass.ts
 * CI:   npx agentfootprint-lint-tools tools.json --threshold 0.94 --strict
 */

import {
  analyzeToolCatalog,
  formatToolCatalogReport,
  MOCK_EMBEDDER_CALIBRATION,
  type CatalogTool,
  type ToolCatalogReport,
} from '../../src/observe.js';
import { mockEmbedder } from '../../src/memory/index.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/03-lint-fix-and-pass',
  title: 'Lint → fix descriptions → gate passes (RFC-002 C3)',
  group: 'observability',
  description:
    'The remediation loop: a 3-tool catalog fails the lint (confusable fcns twins, missing ' +
    'description, enum-in-prose, silent optionals); rewriting each description to lead with ' +
    'the WHEN condition and moving literals into a JSON-Schema enum flips report.ok to true ' +
    'under the SAME thresholds and strictness — the CI-gate workflow of ' +
    'agentfootprint-lint-tools.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'tools', 'lint', 'ci-gate', 'remediation', 'rfc-002'],
};

// ── BEFORE: the catalog as the field had it ──────────────────────────

const before: readonly CatalogTool[] = [
  {
    name: 'get_fcns_database',
    description:
      'FC Name Server (FCNS) DB — registered N_Ports in the fabric. Confirms a device is gone fabric-wide.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'influx_get_fcns_database',
    description:
      'FC Name Server registrations (time-series) — every registered N_Port with its FC-4 type (initiator vs target) and alias.',
    inputSchema: {
      type: 'object',
      properties: { switch_name: { type: 'string' }, vsan: { type: 'number' } },
      required: [],
    },
  },
  // The classic intern special: no description, values in prose.
  {
    name: 'reset_port',
    inputSchema: {
      type: 'object',
      properties: {
        interface: { type: 'string', description: 'FC interface, e.g. fc1/3' },
        mode: { type: 'string', description: 'shut | noshut | flap' },
      },
      required: ['interface'],
    },
  },
];

// ── AFTER: every finding addressed ───────────────────────────────────

const after: readonly CatalogTool[] = [
  {
    name: 'get_fcns_database',
    // Leads with WHEN; vocabulary anchored on live/incident/now.
    description:
      'Live FCNS query over switch CLI. Call FIRST during an active incident: shows which devices are logged in RIGHT NOW.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'influx_get_fcns_database',
    // Leads with WHEN; vocabulary anchored on historical/trend/audit.
    description:
      'Historical FCNS membership trend, sampled to InfluxDB. Use only for audits and week-over-week churn; lags minutes behind.',
    inputSchema: {
      type: 'object',
      properties: {
        switch_name: {
          type: 'string',
          description: 'optional — omit to query every switch in the fabric',
        },
        vsan: { type: 'number', description: 'optional — omit for all VSANs' },
      },
      required: [],
    },
  },
  {
    name: 'reset_port',
    description:
      'Bounce one interface (shut, then no shut). DESTRUCTIVE — only after diagnostics prove it is stuck, never as a first move.',
    inputSchema: {
      type: 'object',
      properties: {
        interface: { type: 'string', description: 'FC interface, e.g. fc1/3' },
        mode: {
          type: 'string',
          description: 'reset style — defaults to flap',
          enum: ['shut', 'noshut', 'flap'], // ← was prose
        },
      },
      required: ['interface'],
    },
  },
];

export interface LintFixAndPassResult {
  readonly beforeReport: ToolCatalogReport;
  readonly afterReport: ToolCatalogReport;
  readonly transcript: string;
}

export async function run(_input?: string | null): Promise<LintFixAndPassResult> {
  const out: string[] = [];
  const lintOptions = {
    embedder: mockEmbedder(),
    ...MOCK_EMBEDDER_CALIBRATION,
    failOn: 'warn' as const, // strict: advisories must be clean too
  };

  out.push('═══ BEFORE — the catalog as the field had it ═══', '');
  const beforeReport = await analyzeToolCatalog(before, lintOptions);
  out.push(formatToolCatalogReport(beforeReport, { topPairs: 3 }));

  out.push(
    '',
    '═══ AFTER — descriptions lead with WHEN; enum is schema; optionals documented ═══',
    '',
  );
  const afterReport = await analyzeToolCatalog(after, lintOptions);
  out.push(formatToolCatalogReport(afterReport, { topPairs: 3 }));

  out.push(
    '',
    '═══ THE GATE ═══',
    `before: ok=${beforeReport.ok} (exit 1 in CI)`,
    `after:  ok=${afterReport.ok} (exit 0 in CI — same thresholds, same strictness)`,
    '',
    'The fcns twins dropped below the threshold because each description now',
    'LEADS with its choice condition — live/incident vs historical/audit.',
    'They remain in the advisory WATCH band: that is the mock embedder’s',
    'compression floor, not a property of the descriptions — a calibrated',
    'real embedder separates them decisively.',
  );

  const transcript = out.join('\n');
  console.log(transcript);
  return { beforeReport, afterReport, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
