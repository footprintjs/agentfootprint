/**
 * `check:semantics` × `Tool.search` — the gate's review items and the one
 * error the new literal brings.
 *
 * Review items are WARNINGS (errors only under `--strict`), so no consumer's
 * CI breaks on upgrade, and an entry that declares no search sees none:
 *   • `source-said` — the words a claim may use to scope itself to the
 *     source, listed for a person (no word ever removes a gap);
 *   • `said-overlap` — a subject word that repeats a qualifier.
 * The error: a sample `checked: 'declared'` from a tool that declares no
 * search — at run time that call is refused.
 *
 * Sections: Contract · Regression.
 */

import { describe, expect, it } from 'vitest';

import { absent } from '../../src/index.js';
import { checkSemantics } from '../../src/semantics/check.js';
import type { ToolSearch } from '../../src/semantics/coverage/search/types.js';

const SEARCH: ToolSearch = {
  source: { what: 'the incident store', said: ['the incident store', 'the store'] },
  subject: { what: 'incidents', said: ['incidents', 'open incidents'] },
  fixed: [{ name: 'status', value: 'open', said: ['open'] }],
  arguments: [{ name: 'service', role: 'population' }],
  complete: 'within-arguments',
};

const DECLARED = absent({ what: 'incidents on payments', checked: 'declared' });

describe('check:semantics × search — contract', () => {
  it('lists the source words and flags a subject word repeating a qualifier — as warnings', () => {
    const report = checkSemantics([
      { name: 'list_incidents', search: SEARCH, results: [DECLARED] },
    ]);
    const codes = report.findings.map((f) => [f.code, f.severity]);
    expect(codes).toContainEqual(['source-said', 'warning']);
    expect(codes).toContainEqual(['said-overlap', 'warning']);
    expect(report.ok).toBe(true);
    const listed = report.findings.find((f) => f.code === 'source-said');
    expect(listed?.message).toMatch(/'the store'/);
  });

  it("a declared absence from a 'triage' search tool declares coverage", () => {
    const report = checkSemantics([
      { name: 'list_incidents', resultClass: 'triage', search: SEARCH, results: [DECLARED] },
    ]);
    expect(report.findings.some((f) => f.code === 'triage-without-coverage')).toBe(false);
  });

  it("checked: 'declared' from a tool with no search is an error naming the fix", () => {
    const report = checkSemantics([{ name: 'lookup', results: [DECLARED] }]);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.code === 'declared-without-search');
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toMatch(/search/);
  });
});

describe('check:semantics × search — regression', () => {
  it('an entry with no search and no literal gets no new finding', () => {
    const report = checkSemantics([
      { name: 'lookup', results: [absent({ what: 'x', checked: ['the store'] })] },
    ]);
    expect(report.findings).toEqual([]);
  });
});
