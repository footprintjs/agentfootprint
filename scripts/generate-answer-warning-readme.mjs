import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const assessment = new URL('../src/core/agent/assessment/', import.meta.url);
const start = '<!-- answer-warning-stages:start -->';
const end = '<!-- answer-warning-stages:end -->';
const source = readFileSync(new URL('chart.ts', assessment), 'utf8');
const chart = ts.createSourceFile('chart.ts', source, ts.ScriptTarget.Latest, true);
const fold = chart.statements.find(
  (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'foldState',
);
if (!fold?.body) throw new Error('The answer warning flow has no foldState body');

const imports = new Map();
for (const statement of chart.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) continue;
  for (const { name } of bindings.elements) imports.set(name.text, statement.moduleSpecifier.text);
}

const rows = [];
function documentStep(expression) {
  if (!expression || !ts.isCallExpression(expression)) return;
  if (!ts.isIdentifier(expression.expression)) {
    throw new Error('Call warning stages by name from the chart');
  }
  const step = expression.expression.text;
  const folder = imports.get(step)?.match(/^\.\/([a-z-]+)\/stage\.js$/)?.[1];
  if (!folder) throw new Error('Place answer warning step ' + step + ' in its own stage folder');
  const definition = readFileSync(new URL(folder + '/stage.ts', assessment), 'utf8');
  const stage = ts.createSourceFile('stage.ts', definition, ts.ScriptTarget.Latest, true);
  const declared = stage.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === step &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  if (!declared) throw new Error('Define ' + step + ' in the ' + folder + ' stage');
  readFileSync(new URL(folder + '/README.md', assessment), 'utf8');
  rows.push('| ' + (rows.length + 1) + ' | [' + folder + '](' + folder + '/README.md) | ' + step + ' |');
}
for (const statement of fold.body.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      documentStep(declaration.initializer);
    }
  } else if (ts.isExpressionStatement(statement) || ts.isReturnStatement(statement)) {
    documentStep(statement.expression);
  } else {
    throw new Error('Keep the answer warning chart to ordered stage calls');
  }
}
if (rows.length === 0) throw new Error('No answer warning stages found');
const readme = new URL('README.md', assessment);
const existing = readFileSync(readme, 'utf8');
const from = existing.indexOf(start);
const to = existing.indexOf(end);
if (from < 0 || to < from || existing.lastIndexOf(start) !== from || existing.lastIndexOf(end) !== to) {
  throw new Error('Missing or repeated answer warning README markers');
}
const table = ['| Step | Folder | Function |', '| --- | --- | --- |', ...rows].join('\n');
const next = existing.slice(0, from + start.length) + '\n\n' + table + '\n\n' + existing.slice(to);
if (process.argv.includes('--check')) {
  if (existing !== next) throw new Error('Run node scripts/generate-answer-warning-readme.mjs');
} else if (existing !== next) {
  writeFileSync(readme, next);
}
