/**
 * check:semantics — the gate core, the formatter, and the CLI shell (9.53.0).
 *
 * The property under test is NAMING: a failing build log must point at the
 * tool and the field, never at the suite. Severity follows provability (the
 * skillGraph check-up law): only what the declaration proves wrong errors.
 *
 * Sections: Unit (rule table, code by code) · Functional (report + formatter)
 * · Integration (the CLI shell end-to-end, exit codes 0/1/2) · Edge.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { semantic, absent, coverage } from '../../../src/index.js';
import {
  checkSemantics,
  coerceSemanticsCatalog,
  formatSemanticsReport,
  runCheckSemanticsCli,
  type SemanticsFinding,
} from '../../../src/lib/semantics/index.js';

const PROVENANCE = { measured_at: '2026-08-19T10:20:00Z', source: 'Cohesity API' };

const goodTriage = () =>
  semantic({
    facts: [{ entity: 'shiecgprnap103', backed_up: true, copies: 1 }],
    provenance: PROVENANCE,
    coverage: {
      checked: ['4 Cohesity clusters'],
      cannotCover: [{ what: 'PPDM', why: 'not collected on this install' }],
    },
  });

const codesOf = (findings: readonly SemanticsFinding[]): string[] => findings.map((f) => f.code);

// ─────────────────────────────────────────────────────────────────────────
// Unit — the rule table, code by code
// ─────────────────────────────────────────────────────────────────────────

describe('unit: the rule table', () => {
  it('triage-without-coverage ERRORS, naming the tool and the field', () => {
    const report = checkSemantics([
      {
        name: 'vm_backup_status',
        resultClass: 'triage',
        results: [
          semantic({ facts: [{ entity: 'vm-1', backed_up: true }], provenance: PROVENANCE }),
        ],
      },
    ]);
    expect(report.ok).toBe(false);
    const finding = report.findings[0]!;
    expect(finding.code).toBe('triage-without-coverage');
    expect(finding.severity).toBe('error');
    expect(finding.tool).toBe('vm_backup_status');
    expect(finding.field).toBe('coverage');
    expect(finding.message).toContain("'vm_backup_status'");
    expect(finding.message).toContain('coverage');
  });

  it('a triage that declares its boundary through ANY door passes: semantic coverage, coverage(), absent()', () => {
    const viaSemantic = goodTriage();
    const viaLedger = coverage(
      { verdict: 'no fault found' },
      { checked: ['the array-side path'], notChecked: ['the client side'] },
    );
    const viaAbsence = absent({ what: 'backup jobs for vm-9', checked: ['4 Cohesity clusters'] });
    const report = checkSemantics([
      { name: 't1', resultClass: 'triage', results: [viaSemantic] },
      { name: 't2', resultClass: 'triage', results: [viaLedger] },
      { name: 't3', resultClass: 'triage', results: [viaAbsence] },
    ]);
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('inventory-without-coverage ERRORS; inventory-without-render WARNS', () => {
    const noCoverage = semantic({
      facts: [{ entity: 'SHPSTRPRNFS012', shares: 2 }],
      provenance: PROVENANCE,
      render: { default: 'table' },
    });
    const noRender = semantic({
      facts: [{ entity: 'SHPSTRPRNFS012', shares: 2 }],
      provenance: PROVENANCE,
      coverage: { checked: ['6 arrays with file services'] },
    });
    const report = checkSemantics([
      { name: 'pstore_file_inventory', resultClass: 'inventory', results: [noCoverage, noRender] },
    ]);
    expect(report.ok).toBe(false);
    const byCode = Object.fromEntries(report.findings.map((f) => [f.code, f]));
    expect(byCode['inventory-without-coverage']?.severity).toBe('error');
    expect(byCode['inventory-without-coverage']?.resultIndex).toBe(0);
    expect(byCode['inventory-without-render']?.severity).toBe('warning');
    expect(byCode['inventory-without-render']?.resultIndex).toBe(1);
  });

  it('a marker-bearing envelope with faults ERRORS under the recognizer codes, per fault, naming fields', () => {
    const broken = {
      af_semantics: true,
      series: [{ t: 1, entity: 'fc1/3', metric: 'frames_tx', value: 10 }],
      grain: { interval: '30m', aggregation: 'sum' },
    };
    const report = checkSemantics([{ name: 'port_counters', results: [broken] }]);
    expect(report.ok).toBe(false);
    const codes = codesOf(report.findings);
    expect(codes).toContain('counter-aggregation-unstated');
    expect(codes).toContain('data-without-provenance');
    for (const f of report.findings) {
      expect(f.severity).toBe('error');
      expect(f.tool).toBe('port_counters');
      expect(f.field.length).toBeGreaterThan(0);
    }
  });

  it('unsampled-tool-class WARNS — the gate cannot check what it cannot see, but silence must not read as a pass', () => {
    const report = checkSemantics([
      { name: 'nas_share_triage', resultClass: 'triage', results: [] },
    ]);
    expect(report.ok).toBe(true); // a warning never fails ok
    expect(report.findings[0]?.code).toBe('unsampled-tool-class');
    expect(report.findings[0]?.severity).toBe('warning');
  });

  it('an unclassed tool returning plain data gets NO findings — the gate is opt-in per tool', () => {
    const report = checkSemantics([{ name: 'get_time', results: ['12:00'] }]);
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('an unknown resultClass THROWS (a catalog mistake, not a finding), naming the closed set', () => {
    expect(() =>
      checkSemantics([{ name: 'x', resultClass: 'metric' as never, results: [] }]),
    ).toThrow(/'metric'[\s\S]*triage, inventory/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — report + formatter
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the report and its rendering', () => {
  it('counts tools and results; the formatter names tool + field on every line', () => {
    const report = checkSemantics([
      { name: 'good', resultClass: 'triage', results: [goodTriage()] },
      { name: 'bad', resultClass: 'triage', results: [{ rows: [] }] },
    ]);
    expect(report.checkedTools).toBe(2);
    expect(report.checkedResults).toBe(2);
    const text = formatSemanticsReport(report);
    expect(text).toContain('check:semantics — 2 tools, 2 sample results');
    expect(text).toContain('bad');
    expect(text).toContain('[triage-without-coverage]');
    expect(text).toContain('field: coverage');
    expect(text).toContain('FAILED — 1 error, 0 warnings');
  });

  it('a clean catalog renders a clean line', () => {
    const text = formatSemanticsReport(
      checkSemantics([{ name: 'good', resultClass: 'triage', results: [goodTriage()] }]),
    );
    expect(text).toContain('✓ every sampled result honors');
    expect(text).toContain('ok — 0 errors, 0 warnings');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the CLI shell (exit codes are the whole contract)
// ─────────────────────────────────────────────────────────────────────────

const runCli = async (
  json: unknown,
  flags: readonly string[] = [],
): Promise<{ code: number; out: string[]; err: string[] }> => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-check-semantics-'));
  try {
    const file = join(dir, 'catalog.json');
    writeFileSync(file, JSON.stringify(json));
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCheckSemanticsCli([file, ...flags], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    return { code, out, err };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('integration: runCheckSemanticsCli', () => {
  it('exit 0 on a clean catalog; the report prints', async () => {
    const { code, out } = await runCli([
      { name: 'vm_backup_status', resultClass: 'triage', result: goodTriage() },
    ]);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('check:semantics');
  });

  it('exit 1 when a triage forgot its coverage — the failure names the tool and the field', async () => {
    const { code, out } = await runCli([
      { name: 'vm_backup_status', resultClass: 'triage', result: { rows: [] } },
    ]);
    expect(code).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('vm_backup_status');
    expect(text).toContain('field: coverage');
  });

  it('--strict turns a warnings-only catalog into exit 1', async () => {
    const warnOnly = [{ name: 'nas_share_triage', resultClass: 'triage', results: [] }];
    expect((await runCli(warnOnly)).code).toBe(0);
    expect((await runCli(warnOnly, ['--strict'])).code).toBe(1);
  });

  it('--json prints the machine report', async () => {
    const { code, out } = await runCli(
      [{ name: 'good', resultClass: 'triage', result: goodTriage() }],
      ['--json'],
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as { ok: boolean; checkedTools: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.checkedTools).toBe(1);
  });

  it('exit 2 on unknown flags, a missing file, and an unrecognized shape', async () => {
    expect(await runCheckSemanticsCli(['--nope'], { stdout: () => {}, stderr: () => {} })).toBe(2);
    expect(await runCheckSemanticsCli([], { stdout: () => {}, stderr: () => {} })).toBe(2);
    expect(
      await runCheckSemanticsCli(['/nonexistent/afp-catalog.json'], {
        stdout: () => {},
        stderr: () => {},
      }),
    ).toBe(2);
    expect((await runCli({ not: 'a catalog' })).code).toBe(2);
    expect((await runCli([{ name: 'x' }])).code).toBe(2); // neither results nor result
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge — catalog coercion
// ─────────────────────────────────────────────────────────────────────────

describe('edge: coerceSemanticsCatalog', () => {
  it('accepts the array form, the single-result form, and the { tools } wrapper', () => {
    const viaArray = coerceSemanticsCatalog([{ name: 'a', results: [1, 2] }]);
    expect(viaArray[0]?.results).toEqual([1, 2]);
    const viaSingle = coerceSemanticsCatalog([{ name: 'b', result: 'one' }]);
    expect(viaSingle[0]?.results).toEqual(['one']);
    const viaWrapper = coerceSemanticsCatalog({ tools: [{ name: 'c', results: [] }] });
    expect(viaWrapper[0]?.name).toBe('c');
  });

  it('refuses rows without a name or without samples, naming the row', () => {
    expect(() => coerceSemanticsCatalog([{ results: [] }])).toThrow(
      /tools\[0\] has no string 'name'/,
    );
    expect(() => coerceSemanticsCatalog([{ name: 'x' }])).toThrow(
      /neither 'results'[\s\S]*nor[\s\S]*'result'/,
    );
  });
});
