import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../src/index.js';
import { productionSources } from '../helpers/productionSources.js';
import { rulerBounds, rulerRows, rulerTool } from './fixtures/rulerTool.js';

describe('the bounded UTC minute ruler', () => {
  const from = '2026-11-13T18:00:00Z';
  const to = '2026-11-13T18:02:00Z';

  it('includes the start, excludes the end by default, and can include an explicit endpoint', () => {
    const range = { from, to };
    expect(rulerRows(range)).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T18:01Z']);
    expect(rulerRows(range, 'inclusive')).toEqual([
      'R-2026-11-13T18:00Z',
      'R-2026-11-13T18:01Z',
      'R-2026-11-13T18:02Z',
    ]);
    expect(rulerRows({ from, to: from }, 'inclusive')).toEqual(['R-2026-11-13T18:00Z']);
  });

  it('places even sub-millisecond bounds on the correct side of a grid point', () => {
    const startsAfter = '2026-11-13T18:00:00.000000001Z';
    const endsAfter = '2026-11-13T18:02:00.000000001Z';
    expect(rulerRows({ from: startsAfter, to: endsAfter })).toEqual([
      'R-2026-11-13T18:01Z',
      'R-2026-11-13T18:02Z',
    ]);
    expect(rulerRows({ from: startsAfter, to: '2026-11-13T18:00:59.999Z' })).toEqual([]);
  });

  it('generates at the declared cap and refuses any larger window before generating', () => {
    expect(rulerBounds.maxRange).toBe('48h');
    const exact = { from, to: '2026-11-15T18:00:00Z' };
    const rows = rulerRows(exact);
    expect(rows).toHaveLength(2_880);
    expect(rows[0]).toBe('R-2026-11-13T18:00Z');
    expect(rows.at(-1)).toBe('R-2026-11-15T17:59Z');
    expect(rulerRows(exact, 'inclusive').at(-1)).toBe('R-2026-11-15T18:00Z');
    const format = vi.spyOn(Date.prototype, 'toISOString');
    try {
      expect(() => rulerRows({ from, to: '2026-11-15T18:01:00Z' })).toThrow(/exceeds 48h/);
      expect(format).not.toHaveBeenCalled();
    } finally {
      format.mockRestore();
    }
  });

  it('refuses malformed, local, or reversed bounds', () => {
    expect(() => rulerRows({ from, to: '2026-11-31T18:00:00Z' })).toThrow(/UTC ISO bounds/);
    expect(() => rulerRows({ from: '2026-11-13T10:00:00-08:00', to })).toThrow(/UTC ISO bounds/);
    expect(() => rulerRows({ from: to, to: from })).toThrow(/ordered window/);
  });

  it('advertises absolute bounds and returns only their UTC row names', async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    const tool = rulerTool({ onCall: (args) => calls.push(args) });
    expect(tool.period?.forms).toEqual([rulerBounds]);
    const range = { from, to };
    const context = {} as ToolExecutionContext;
    const result = await tool.execute(range, context);
    expect(calls).toEqual([range]);
    expect(JSON.parse(result)).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T18:01Z']);
  });
});

function accessPath(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const receiver = accessPath(node.expression);
    if (receiver !== undefined) return `${receiver}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const receiver = accessPath(node.expression);
    if (receiver !== undefined) return `${receiver}.${node.argumentExpression.text}`;
  }
  return undefined;
}

function globalPath(node: ts.Node): string | undefined {
  return accessPath(node)?.replace(/^(globalThis|global)\./, '');
}

function readsDefaultIntlInstant(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || node.arguments.length !== 0) return false;
  const call = node.expression;
  if (!ts.isPropertyAccessExpression(call)) return false;
  if (call.name.text !== 'format' && call.name.text !== 'formatToParts') return false;
  const formatter = call.expression;
  return (
    (ts.isCallExpression(formatter) || ts.isNewExpression(formatter)) &&
    globalPath(formatter.expression) === 'Intl.DateTimeFormat'
  );
}

function ambientClockReads(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const reads: string[] = [];
  function visit(node: ts.Node): void {
    const key = globalPath(node);
    const ambientSource =
      key === 'Date.now' || key === 'Temporal.Now' || key === 'performance.timeOrigin';
    const dateFunction = ts.isCallExpression(node) && globalPath(node.expression) === 'Date';
    const dateWithoutInstant =
      ts.isNewExpression(node) &&
      globalPath(node.expression) === 'Date' &&
      (node.arguments?.length ?? 0) === 0;
    if (ambientSource || dateFunction || dateWithoutInstant || readsDefaultIntlInstant(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      reads.push(`${name}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return reads;
}

describe('the time layer uses its admitted run clock', () => {
  it('distinguishes ambient reads from formatting supplied instants', () => {
    const shapes = [
      'Date.now()',
      'const getNow = globalThis.Date["now"]',
      'new Date()',
      'Date()',
      'Temporal.Now.instant()',
      'performance.timeOrigin',
      'new Intl.DateTimeFormat(locale).format()',
      'new Date(stamp).toISOString()',
      'Date.parse(stamp)',
      'new Intl.DateTimeFormat(zone).format(stamp)',
    ].join('\n');
    expect(ambientClockReads('fixture.ts', shapes)).toEqual([
      'fixture.ts:1',
      'fixture.ts:2',
      'fixture.ts:3',
      'fixture.ts:4',
      'fixture.ts:5',
      'fixture.ts:6',
      'fixture.ts:7',
    ]);
  });

  it('does not read the ambient wall clock anywhere under src/time', () => {
    const root = join(__dirname, '..', '..');
    const files = productionSources(join(root, 'src', 'time'));
    const reads = files.flatMap((path) =>
      ambientClockReads(relative(root, path), readFileSync(path, 'utf8')),
    );
    expect(reads).toEqual([]);
  });
});
