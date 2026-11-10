import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { productionSources } from '../../../../test/helpers/productionSources.js';

const OWNER = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(OWNER, '../../..');
const FACADE = resolve(OWNER, '../otel.ts');
const inside = (path: string): boolean => path.startsWith(OWNER + '/');

function edges(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return sf.statements.flatMap(statement => {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
      !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const specifier = statement.moduleSpecifier.text;
    return specifier.startsWith('.')
      ? [resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))] : [];
  });
}

describe('OTel implementation ownership', () => {
  it('all production callers enter through the public facade', () => {
    const leaks = productionSources(SRC).filter(file => file !== FACADE && !inside(file))
      .flatMap(file => edges(file).filter(inside).map(target => `${relative(SRC, file)} -> ${relative(SRC, target)}`));
    expect(leaks).toEqual([]);
  });

  it('owners never import the facade or each other in a cycle, including type edges', () => {
    const files = productionSources(OWNER);
    const graph = new Map(files.map(file => [file, edges(file)]));
    expect(files.filter(file => graph.get(file)?.includes(FACADE))).toEqual([]);
    const visited = new Set<string>();
    function visit(file: string, active: string[]): void {
      expect(active, `cycle through ${relative(OWNER, file)}`).not.toContain(file);
      if (visited.has(file)) return;
      for (const target of graph.get(file) ?? []) if (inside(target)) visit(target, [...active, file]);
      visited.add(file);
    }
    files.forEach(file => visit(file, []));
  });
});
