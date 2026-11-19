import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const viewerPackages = [
  '@xyflow/react',
  '@xyflow/system',
  'agentfootprint-lens',
  'footprint-explainable-ui',
  'footprint-storydeck',
  'storydeck',
];
const isViewer = (specifier) => viewerPackages.some(
  (name) => specifier === name || specifier.startsWith(`${name}/`),
);

test('the required docs install carries no viewer package or stored StoryDeck archive', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(manifest[group] ?? {}).filter(isViewer), [], group);
  }
  assert.deepEqual(Object.keys(lock.packages).filter((key) =>
    key.includes('node_modules/') && isViewer(key.split('node_modules/').at(-1)),
  ), [], 'docs lock includes moved viewer packages');
  assert.ok(!existsSync(join(root, 'vendor/storydeck')), 'the stored StoryDeck directory was retired');
});

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
    return node.arguments[0];
  }
}

test('docs source does not load packages from the separately locked demo', () => {
  const files = ['next.config.mjs', 'source.config.ts'].map((name) => join(root, name));
  for (const directory of ['app', 'components', 'lib', 'scripts', 'site-samples']) {
    for (const entry of readdirSync(join(root, directory), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
        files.push(join(entry.parentPath, entry.name));
      }
    }
  }
  const found = [];
  for (const name of files) {
    const file = ts.createSourceFile(name, readFileSync(name, 'utf8'), ts.ScriptTarget.Latest);
    function visit(node) {
      const specifier = moduleSpecifier(node);
      if (specifier && ts.isStringLiteralLike(specifier) && isViewer(specifier.text)) {
        found.push(`${relative(root, name)}: ${specifier.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.deepEqual(found, []);
});
