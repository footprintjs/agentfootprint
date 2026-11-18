import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { productionSources } from '../helpers/productionSources.js';

const root = join(__dirname, '../..');
const owners = new Set([
  'src/artifacts/placement.ts',
  'src/core/agent/placedTickets.ts',
  'src/time-travel/servedView/requestOnly.ts',
]);

it('production placement readers use the issued receipt instead of the ticket shape', () => {
  const violations = productionSources(join(root, 'src')).flatMap((path) => {
    const file = relative(root, path).replaceAll('\\', '/');
    if (owners.has(file)) return [];
    const text = readFileSync(path, 'utf8');
    if (!text.includes('isPlacedToolResult')) return [];
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
        node.text === 'isPlacedToolResult' &&
        !ts.isExportSpecifier(node.parent)
      ) {
        found.push(file + ':' + (source.getLineAndCharacterOfPosition(node.getStart()).line + 1));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  });
  expect(violations).toEqual([]);
});
