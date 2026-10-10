/**
 * Record names have one home: Foottrace. Derive the names from its published
 * declarations, not a second hand-maintained list. Engine names remain on
 * FootPrint. This also checks examples and benchmarks that CI users copy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const manifest = require.resolve('foottrace/package.json');
const doors = Object.values(JSON.parse(readFileSync(manifest, 'utf8')).exports) as Array<
  string | { require?: { types?: string } }
>;
const entries = doors.flatMap((door) =>
  typeof door !== 'string' && door.require?.types
    ? [resolve(dirname(manifest), door.require.types)]
    : [],
);
const program = ts.createProgram(entries, { skipLibCheck: true });
const checker = program.getTypeChecker();
const recordNames = new Set(
  entries.flatMap((entry) =>
    checker
      .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)!)!)
      .map((s) => s.name),
  ),
);

function misplaced(text: string): string[] {
  const source = ts.createSourceFile('input.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const inspect = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^footprintjs(?:\/|$)/.test(node.moduleSpecifier.text)
    ) {
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const item of bindings.elements) {
          const name = (item.propertyName ?? item.name).text;
          if (recordNames.has(name)) found.push(name);
        }
      }
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      /^footprintjs(?:\/|$)/.test(node.argument.literal.text) &&
      node.qualifier &&
      ts.isIdentifier(node.qualifier) &&
      recordNames.has(node.qualifier.text)
    ) {
      found.push(node.qualifier.text);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? sources(path) : /\.(?:ts|mjs)$/.test(path) ? [path] : [];
  });
}

describe('canonical record ownership', () => {
  it('derives both values and types from every published Foottrace door', () => {
    expect(entries).toHaveLength(3);
    for (const name of [
      'CommitValuesMode',
      'ControlDepLookup',
      'CommitBundle',
      'commitValueAt',
      'SharedMemory',
      'setNestedValue',
      'pathSegments',
    ]) {
      expect(recordNames.has(name), name).toBe(true);
    }
    expect(recordNames.has('controlDepRecorder')).toBe(false);
  });

  it('catches aliases, re-exports and inline type imports, while allowing engine names', () => {
    expect(
      misplaced(`
        import { commitValueAt as read, controlDepRecorder } from 'footprintjs/trace';
        export type { CommitBundle as Row } from 'footprintjs/trace';
        type Mode = import('footprintjs').CommitValuesMode;
        import { SharedMemory } from 'footprintjs/write';
        import { pathSegments } from 'footprintjs/trace';
        export { setNestedValue } from 'footprintjs/advanced';
        import type { ControlDepLookup } from 'foottrace';
      `),
    ).toEqual([
      'commitValueAt',
      'CommitBundle',
      'CommitValuesMode',
      'SharedMemory',
      'pathSegments',
      'setNestedValue',
    ]);
  });

  it('source, tests, examples and benchmarks take every record name from its owner', () => {
    const files = ['src', 'test', 'examples', 'bench'].flatMap((dir) => sources(join(root, dir)));
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.flatMap((file) =>
        misplaced(readFileSync(file, 'utf8')).map((name) => `${file}: ${name}`),
      ),
    ).toEqual([]);
  }, 30_000); // Whole-tree TypeScript parsing is slower under coverage instrumentation.
});
