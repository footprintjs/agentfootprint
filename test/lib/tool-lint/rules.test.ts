/**
 * Structural lint rules (RFC-002 C2) — one fixture catalog per rule.
 *
 * Test types: unit (each rule in isolation, happy + boundary) +
 * pluggability (add/remove/replace via the options seam).
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeToolCatalog,
  defaultStructuralRules,
  descriptionRule,
  enumInProseRule,
  optionalParamRule,
  saysWhatNotWhenRule,
  type CatalogTool,
  type LintRule,
} from '../../../src/lib/tool-lint';

const CATALOG: readonly CatalogTool[] = []; // rules that ignore catalog context

describe('descriptionRule — missing/short description', () => {
  const rule = descriptionRule();

  it('FIXTURE missing: no description → error', () => {
    const findings = rule.check({ name: 'get_thing' }, CATALOG);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'description-missing-or-short',
      tool: 'get_thing',
      severity: 'error',
    });
  });

  it('FIXTURE empty/whitespace: counts as missing → error', () => {
    expect(rule.check({ name: 't', description: '   ' }, CATALOG)[0]?.severity).toBe('error');
  });

  it('FIXTURE short: under 40 chars → warn with the measured length', () => {
    const findings = rule.check({ name: 't', description: 'Lists ports.' }, CATALOG);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('12 chars');
  });

  it('passes at exactly the threshold', () => {
    const description = 'x'.repeat(40);
    expect(rule.check({ name: 't', description }, CATALOG)).toHaveLength(0);
  });

  it('minChars is tunable via the factory', () => {
    const strict = descriptionRule({ minChars: 100 });
    expect(strict.check({ name: 't', description: 'x'.repeat(60) }, CATALOG)).toHaveLength(1);
  });
});

describe('saysWhatNotWhenRule — no temporal/conditional cue', () => {
  const rule = saysWhatNotWhenRule();

  it('FIXTURE says-what-only: pure WHAT description → warn', () => {
    const findings = rule.check(
      { name: 'get_fcns_database', description: 'FC Name Server registrations — every N_Port.' },
      CATALOG,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'says-what-not-when', severity: 'warn' });
  });

  it('passes with a WHEN cue ("Call FIRST.")', () => {
    const findings = rule.check(
      { name: 'get_interface_status', description: 'Blast radius — all statuses. Call FIRST.' },
      CATALOG,
    );
    expect(findings).toHaveLength(0);
  });

  it('cue match is whole-word: "fortify" does not count as "for"', () => {
    const findings = rule.check(
      { name: 't', description: 'Fortify the perimeter database snapshots.' },
      CATALOG,
    );
    expect(findings).toHaveLength(1);
  });

  it('skips tools with no description (descriptionRule owns that finding)', () => {
    expect(rule.check({ name: 't' }, CATALOG)).toHaveLength(0);
  });

  it('cue list is tunable via the factory', () => {
    const custom = saysWhatNotWhenRule({ cueTokens: ['whenever'] });
    expect(
      custom.check({ name: 't', description: 'Use whenever the cache is stale.' }, CATALOG),
    ).toHaveLength(0);
  });
});

describe('enumInProseRule — literal values listed in prose', () => {
  const rule = enumInProseRule();

  it('FIXTURE the Neo metric case: pipe-separated literals → warn + enum suggestion', () => {
    const findings = rule.check(
      {
        name: 'influx_get_port_ranking',
        description: 'Rank ports by IOPS/throughput (time-series).',
        inputSchema: {
          type: 'object',
          properties: {
            metric: { type: 'string', description: 'avg_iops | peak_iops | mbps' },
          },
          required: [],
        },
      },
      CATALOG,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'enum-in-prose',
      tool: 'influx_get_port_ranking',
      param: 'metric',
      severity: 'warn',
    });
    expect(findings[0].suggestion).toBe('"enum": ["avg_iops","peak_iops","mbps"]');
  });

  it('comma lists flag only behind an explicit values marker', () => {
    const flagged = rule.check(
      {
        name: 't',
        inputSchema: {
          type: 'object',
          properties: { color: { type: 'string', description: 'one of: red, green, blue' } },
        },
      },
      CATALOG,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].suggestion).toContain('"red"');
  });

  it('does NOT flag free-form examples ("e.g. 1h, 24h" — the Neo window param)', () => {
    const findings = rule.check(
      {
        name: 'influx_get_interface_counters',
        inputSchema: {
          type: 'object',
          properties: { window: { type: 'string', description: 'lookback window, e.g. 1h, 24h' } },
        },
      },
      CATALOG,
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag params that already declare an enum', () => {
    const findings = rule.check(
      {
        name: 't',
        inputSchema: {
          type: 'object',
          properties: {
            metric: {
              type: 'string',
              description: 'avg_iops | peak_iops',
              enum: ['avg_iops', 'peak_iops'],
            },
          },
        },
      },
      CATALOG,
    );
    expect(findings).toHaveLength(0);
  });

  it('tolerates absent/malformed inputSchema without throwing', () => {
    expect(rule.check({ name: 't' }, CATALOG)).toHaveLength(0);
    expect(
      rule.check({ name: 't', inputSchema: { properties: 'not-an-object' } }, CATALOG),
    ).toHaveLength(0);
  });
});

describe('optionalParamRule — omission has meaning but nothing says so', () => {
  const rule = optionalParamRule();

  it('FIXTURE the Neo sweep case: optional param with NO description → warn', () => {
    const findings = rule.check(
      {
        name: 'influx_get_interface_counters',
        description: 'Fabric-wide interface error counters (time-series).',
        inputSchema: {
          type: 'object',
          properties: {
            switch_name: { type: 'string' },
            window: { type: 'string', description: 'lookback window, e.g. 1h, 24h' },
          },
          required: [],
        },
      },
      CATALOG,
    );
    // switch_name: no description at all. window: described, but never
    // says what omission means (what IS the default lookback?).
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.param)).toEqual(['switch_name', 'window']);
    expect(findings[0].message).toContain('no description');
    expect(findings[1].message).toContain('omission');
  });

  it('passes when the description carries an omission cue', () => {
    const findings = rule.check(
      {
        name: 'influx_get_sfp_diagnostics',
        inputSchema: {
          type: 'object',
          properties: {
            interface: { type: 'string', description: 'optional — limit to one port' },
          },
          required: [],
        },
      },
      CATALOG,
    );
    expect(findings).toHaveLength(0);
  });

  it('required params are exempt', () => {
    const findings = rule.check(
      {
        name: 't',
        inputSchema: {
          type: 'object',
          properties: { hostname: { type: 'string' } },
          required: ['hostname'],
        },
      },
      CATALOG,
    );
    expect(findings).toHaveLength(0);
  });
});

describe('rule pack pluggability (the C2 seam)', () => {
  const quiet: readonly CatalogTool[] = [
    { name: 'alpha', description: 'Looks up the alpha record for an id. Use when an id is known.' },
  ];

  it('defaultStructuralRules is the documented 4-rule pack', () => {
    expect(defaultStructuralRules.map((rule) => rule.id)).toEqual([
      'description-missing-or-short',
      'says-what-not-when',
      'enum-in-prose',
      'optional-param-undocumented',
    ]);
  });

  it('consumers can ADD a custom rule', async () => {
    const noVerbs: LintRule = {
      id: 'must-mention-id',
      check: (tool) =>
        tool.description?.includes('id')
          ? []
          : [{ rule: 'must-mention-id', tool: tool.name, severity: 'warn', message: 'no id' }],
    };
    const report = await analyzeToolCatalog(
      [...quiet, { name: 'beta', description: 'Fetches beta things for the current scope only.' }],
      { rules: [...defaultStructuralRules, noVerbs] },
    );
    expect(report.structural.some((f) => f.rule === 'must-mention-id' && f.tool === 'beta')).toBe(
      true,
    );
  });

  it('consumers can REMOVE a default rule', async () => {
    const report = await analyzeToolCatalog([{ name: 'bare' }], {
      rules: defaultStructuralRules.filter((rule) => rule.id !== 'description-missing-or-short'),
    });
    expect(report.structural).toHaveLength(0);
    expect(report.ok).toBe(true);
  });
});
