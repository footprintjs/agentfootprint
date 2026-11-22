import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { answerFoldReads } from '../../src/core/agent/honesty/answerFoldReads.js';
import { auditedBoundaries, inventoriedCalls, type Boundary } from './hidingInventoryCases.js';
import { importedCalls, sourceAnchors } from './hidingInventorySource.js';

const root = join(__dirname, '../..');
const sources = new Map<string, ts.SourceFile>();

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function readSource(file: string): ts.SourceFile {
  const previous = sources.get(file);
  if (previous !== undefined) return previous;
  const source = parse(file, readFileSync(join(root, file), 'utf8'));
  sources.set(file, source);
  return source;
}

function inside(node: ts.Node, anchor: ts.Node): boolean {
  return node.pos >= anchor.pos && node.end <= anchor.end;
}

function boundaryOf(source: ts.SourceFile, [file, name]: Boundary): ts.Node {
  const matches = sourceAnchors(source, name);
  expect(matches, `${file} · ${name} must resolve to one production boundary`).toHaveLength(1);
  return matches[0]!;
}

function doorCalls(source: ts.SourceFile, writer: string, exportName: string): ts.CallExpression[] {
  const specifiers = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (posix.join(posix.dirname(source.fileName), specifier) === `${writer}.js`)
      specifiers.add(specifier);
  }
  return [...specifiers].flatMap((specifier) => importedCalls(source, specifier, exportName));
}

it.each(Object.entries(auditedBoundaries))('keeps the %s audit tied to production', (_, sites) => {
  for (const site of sites) boundaryOf(readSource(site[0]), site);
});

it('each inventoried boundary calls its operation as recorded', () => {
  for (const { writer, exportName, sites } of inventoriedCalls) {
    for (const site of sites) {
      const source = readSource(site[0]);
      const anchor = boundaryOf(source, site);
      const writes = doorCalls(source, writer, exportName).filter((call) => inside(call, anchor));
      expect(writes, `${site[0]} · ${site[1]} calls ${exportName}`).toHaveLength(site[2] ?? 1);
    }
  }
});

it('every discovered call of an inventoried operation belongs to its boundary', () => {
  const names = inventoriedCalls.map(({ exportName }) => exportName);
  const files = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const unexpected: string[] = [];
  for (const path of files) {
    const file = relative(root, path).replaceAll('\\', '/');
    const text = readFileSync(path, 'utf8');
    if (!names.some((name) => text.includes(name))) continue;
    const source = sources.get(file) ?? parse(file, text);
    for (const { writer, exportName, sites } of inventoriedCalls) {
      const anchors = sites
        .filter((site) => site[0] === file)
        .map((site) => boundaryOf(source, site));
      for (const call of doorCalls(source, writer, exportName)) {
        if (anchors.some((anchor) => inside(call, anchor))) continue;
        const line = source.getLineAndCharacterOfPosition(call.getStart()).line + 1;
        unexpected.push(`${file}:${line} · ${exportName}`);
      }
    }
  }
  expect(unexpected).toEqual([]);
});

it('the armed answer fold reads the committed result and response facts', () => {
  const keys = answerFoldReads({
    tools: true,
    resultLimits: true,
    evidenceGate: false,
    answerValidation: false,
    inputs: false,
    toolMiddleware: false,
  });
  expect(keys).toEqual(expect.arrayContaining(['libraryResultLimits', 'llmLatestStopReason']));
});

it.each([
  ['one owned write', "import { save } from './facts.js'; function cut() { save(); }", 1],
  [
    'one owned write with split imports',
    "import { describeFact } from './facts.js'; import { save } from './facts.js'; function cut() { describeFact(); save(); }",
    1,
  ],
  ['missing write', "import { save } from './facts.js'; function cut() { }", 0],
  ['duplicate write', "import { save } from './facts.js'; function cut() { save(); save(); }", 2],
  ['unrelated import', "import { save } from './other.js'; function cut() { save(); }", 0],
  [
    'shadowed binding',
    "import { save } from './facts.js'; function cut(save: () => void) { save(); }",
    0,
  ],
  [
    'aliased import',
    "import { save as record } from './facts.js'; function cut() { record(); }",
    1,
  ],
  [
    'sibling write',
    "import { save } from './facts.js'; function cut() {} function other() { save(); }",
    0,
  ],
] as const)('identifies %s at a boundary', (_, snippet, expected) => {
  const source = parse('src/audit.ts', snippet);
  const anchor = boundaryOf(source, ['src/audit.ts', 'cut']);
  const calls = doorCalls(source, 'src/facts', 'save').filter((call) => inside(call, anchor));
  expect(calls).toHaveLength(expected);
});
