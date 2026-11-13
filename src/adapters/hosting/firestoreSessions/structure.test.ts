import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { productionSources } from '../../../../test/helpers/productionSources.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
describe('chart-folder structure', () => {
  it('the chart holds wiring only, with named functions and data rules elsewhere', () => {
    const path = resolve(ROOT, 'chart.ts');
    const file = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const logic: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isIfStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isConditionalExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)
      )
        logic.push(ts.SyntaxKind[node.kind]);
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(logic).toEqual([]);
  });

  it('no production stage imports a sibling stage', () => {
    const stages = resolve(ROOT, 'stages');
    const violations: string[] = [];
    for (const path of productionSources(stages)) {
      const owner = relative(stages, path).split('/')[0];
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        const spec = statement.moduleSpecifier.text;
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(path), spec).replace(/\.js$/, '.ts');
        const destination = relative(stages, target);
        if (!destination.startsWith('..') && destination.split('/')[0] !== owner)
          violations.push(`${relative(ROOT, path)} -> ${relative(ROOT, target)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
