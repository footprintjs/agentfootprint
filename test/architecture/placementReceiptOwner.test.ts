import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = join(__dirname, '../..');
const owners = new Set([
  'src/artifacts/placement.ts',
  'src/core/agent/placedTickets.ts',
  'src/time-travel/servedView/requestOnly.ts',
]);

it('placement readers under src use the issued receipt instead of the ticket shape', () => {
  const files = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const violations = files.flatMap((path) => {
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
