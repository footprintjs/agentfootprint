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
 * The command line reads the same `search` from its catalog file, so the
 * gate a build runs and `checkSemantics` called in code judge one row alike.
 *
 * Sections: Contract · Command line · Regression.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { absent } from '../../src/index.js';
import { checkSemantics, type SemanticsCatalogEntry } from '../../src/semantics/check.js';
import { coerceSemanticsCatalog, runCheckSemanticsCli } from '../../src/semantics/cli.js';
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

describe('check:semantics × search — command line', () => {
  // The catalog file is JSON, so the row goes through a JSON round trip, as a dump would.
  const ROW = JSON.parse(
    JSON.stringify({
      name: 'list_incidents',
      resultClass: 'triage',
      search: SEARCH,
      results: [DECLARED],
    }),
  ) as Record<string, unknown>;

  it("the catalog reader keeps each row's search", () => {
    const [entry] = coerceSemanticsCatalog([ROW]);
    expect(entry?.search).toEqual(SEARCH);
  });

  it('the command line gives the same verdict and findings as checkSemantics', async () => {
    const direct = checkSemantics([
      { name: 'list_incidents', resultClass: 'triage', search: SEARCH, results: [DECLARED] },
    ]);
    expect(direct.ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'afp-check-semantics-search-'));
    try {
      const file = join(dir, 'catalog.json');
      writeFileSync(file, JSON.stringify([ROW]));
      const out: string[] = [];
      const code = await runCheckSemanticsCli([file, '--json'], {
        stdout: (line) => out.push(line),
        stderr: () => {},
      });
      const report = JSON.parse(out.join('\n')) as { ok: boolean; findings: unknown[] };
      expect(code).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.findings).toEqual(JSON.parse(JSON.stringify(direct.findings)));
      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'source-said' }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check:semantics × search — a malformed search refuses the catalog', () => {
  // A catalog is a file anyone can write, so the gate asks defineTool's own rule
  // of each row's search. Each shape here is one defineTool refuses.
  const MALFORMED: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ['an empty object', {}, /search\.source/],
    ['true', true, /`search` must be/],
    ['a string', 'yes', /`search` must be/],
    ['null', null, /`search` must be/],
    ['a list', [], /`search` must be/],
    ['a number', 1, /`search` must be/],
    ["complete: 'bogus'", { ...SEARCH, complete: 'bogus' }, /search\.complete/],
  ];

  it.each(MALFORMED)(
    'checkSemantics throws for %s, naming the tool and the field',
    (_, search, field) => {
      const row = { name: 'list_incidents', search, results: [DECLARED] };
      expect(() => checkSemantics([row as unknown as SemanticsCatalogEntry])).toThrow(
        /checkSemantics: tool 'list_incidents' has a `search` defineTool would refuse/,
      );
      expect(() => checkSemantics([row as unknown as SemanticsCatalogEntry])).toThrow(field);
    },
  );

  it.each(MALFORMED)(
    'the command line exits 2 for %s, naming the field',
    async (_, search, field) => {
      const dir = mkdtempSync(join(tmpdir(), 'afp-check-semantics-bad-search-'));
      try {
        const file = join(dir, 'catalog.json');
        writeFileSync(
          file,
          JSON.stringify([{ name: 'list_incidents', search, results: [DECLARED] }]),
        );
        const err: string[] = [];
        const code = await runCheckSemanticsCli([file], {
          stdout: () => {},
          stderr: (line) => err.push(line),
        });
        expect(code).toBe(2);
        expect(err.join('\n')).toMatch(field);
        expect(err.join('\n')).not.toMatch(/TypeError/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('a search whose arguments the row cannot check against a schema still passes', () => {
    // No inputSchema in a catalog: the classified arguments stand in for it.
    const report = checkSemantics([
      {
        name: 'list_incidents',
        search: { ...SEARCH, arguments: [{ name: 'window', role: 'period' }] },
        results: [DECLARED],
      },
    ]);
    expect(report.ok).toBe(true);
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
