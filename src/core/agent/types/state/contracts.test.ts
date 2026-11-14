import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const entry = resolve(root, 'src/core/agent/types.ts');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type ReadSource = (file: string) => string;
type Field = readonly [type: string, optional: boolean, readonly: boolean];
interface Contract {
  fields: Record<string, Field>;
  comments: Record<string, number>;
}
interface Binding {
  owner: string;
  name: string;
}
interface Location {
  file: string;
  node: ts.PropertySignature;
  source: ts.SourceFile;
}

function owner(file: string, specifier: string): string {
  return specifier.startsWith('.')
    ? relative(root, resolve(dirname(file), specifier)).replace(/\.js$/, '.ts')
    : specifier;
}

function bindings(file: string, source: ts.SourceFile): Map<string, Binding> {
  const result = new Map<string, Binding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const names = statement.importClause?.namedBindings;
    if (!names || !ts.isNamedImports(names)) continue;
    for (const name of names.elements) {
      result.set(name.name.text, {
        owner: owner(file, statement.moduleSpecifier.text),
        name: name.propertyName?.text ?? name.name.text,
      });
    }
  }
  return result;
}

/** Resolve named and inline type imports to the same declaration coordinate. */
function canonical(node: ts.Node, source: ts.SourceFile, imports: Map<string, Binding>): unknown {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const imported = imports.get(node.typeName.text);
    if (imported) {
      return [
        'reference',
        imported.owner,
        imported.name,
        node.typeArguments?.map((arg) => canonical(arg, source, imports)) ?? [],
      ];
    }
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    return [
      node.isTypeOf ? 'typeof-reference' : 'reference',
      owner(source.fileName, node.argument.literal.text),
      node.qualifier?.getText(source) ?? '',
      node.typeArguments?.map((arg) => canonical(arg, source, imports)) ?? [],
    ];
  }
  const children = node.getChildren(source).filter((child) => !ts.isJSDoc(child));
  if (children.length)
    return [
      ts.SyntaxKind[node.kind],
      ...children.map((child) => canonical(child, source, imports)),
    ];
  return [
    ts.SyntaxKind[node.kind],
    ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
      ? node.text
      : node.getText(source),
  ];
}

function commentHashes(text: string): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const result: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      result.push(digest(scanner.getTokenText()));
    }
  }
  return result;
}

/** Discover inheritance rather than prescribing any grouping or owner file names. */
function readState(read: ReadSource = (file) => readFileSync(file, 'utf8')) {
  const fields: Record<string, Field> = {};
  const comments: Record<string, number> = {};
  const locations = new Map<string, Location>();
  const sources = new Map<string, string>();
  const visiting = new Set<string>();
  const addComments = (text: string) => {
    for (const hash of commentHashes(text)) comments[hash] = (comments[hash] ?? 0) + 1;
  };
  function visit(file: string, name: string, outer = false): void {
    const key = `${file}:${name}`;
    if (visiting.has(key)) throw new Error(`Cyclic state inheritance: ${key}`);
    visiting.add(key);
    const text = read(file);
    sources.set(file, text);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const declarations = source.statements.filter(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === name,
    );
    if (declarations.length !== 1) throw new Error(`Expected one interface ${key}`);
    const declaration = declarations[0];
    const imports = bindings(file, source);
    if (outer) addComments(text.slice(declaration.getFullStart(), declaration.getStart(source)));
    const open = declaration
      .getChildren(source)
      .find((child) => child.kind === ts.SyntaxKind.OpenBraceToken);
    if (!open) throw new Error(`No state body: ${key}`);
    addComments(text.slice(open.end, declaration.end));
    for (const heritage of declaration.heritageClauses ?? []) {
      if (heritage.token !== ts.SyntaxKind.ExtendsKeyword)
        throw new Error('State must use interface inheritance');
      for (const parent of heritage.types) {
        if (!ts.isIdentifier(parent.expression) || parent.typeArguments?.length) {
          throw new Error('Expected a named, non-generic state interface');
        }
        const imported = imports.get(parent.expression.text);
        visit(
          imported ? resolve(root, imported.owner) : file,
          imported?.name ?? parent.expression.text,
        );
      }
    }
    for (const member of declaration.members) {
      if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) {
        throw new Error('Expected a named state property');
      }
      const name = member.name.text;
      if (Object.hasOwn(fields, name)) throw new Error(`Duplicate state property: ${name}`);
      fields[name] = [
        digest(JSON.stringify(canonical(member.type, source, imports))),
        member.questionToken !== undefined,
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ??
          false,
      ];
      locations.set(name, { file, node: member, source });
    }
    visiting.delete(key);
  }
  visit(entry, 'AgentState', true);
  return { contract: { fields, comments } satisfies Contract, locations, sources };
}

const fixture = JSON.parse(readFileSync(join(here, 'contracts.json'), 'utf8')) as {
  baseline: string;
  contract: Contract;
};

function changedField(name: string, change: (text: string) => string) {
  const current = readState();
  const location = current.locations.get(name)!;
  const text = current.sources.get(location.file)!;
  const start = location.node.getStart(location.source);
  const changed = change(text.slice(start, location.node.end));
  const replacement = text.slice(0, start) + changed + text.slice(location.node.end);
  return () =>
    readState((file) => (file === location.file ? replacement : readFileSync(file, 'utf8')));
}

function typeModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const file = join(directory, item.name);
    return item.isDirectory()
      ? typeModules(file)
      : item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')
      ? [file]
      : [];
  });
}

function assertErased(file: string, text: string): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    const erasedImport =
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      (statement.importClause.isTypeOnly ||
        (statement.importClause.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings) &&
          !statement.importClause.name &&
          statement.importClause.namedBindings.elements.every((item) => item.isTypeOnly)));
    const erasedExport =
      ts.isExportDeclaration(statement) &&
      (statement.isTypeOnly ||
        (statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every((item) => item.isTypeOnly)));
    if (
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !erasedImport &&
      !erasedExport
    )
      throw new Error(`Runtime statement in ${file}`);
  }
  const emitted = ts
    .transpileModule(text, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        removeComments: true,
      },
    })
    .outputText.replace(/export\s*\{\s*\};?/g, '')
    .trim();
  if (emitted) throw new Error(`Runtime output in ${file}`);
}

describe('AgentState declaration contract', () => {
  it('preserves every original property, modifier and exact comment byte', () => {
    expect(readState().contract).toEqual(fixture.contract);
  });

  it('recognizes equivalent named and inline type imports', () => {
    const named =
      "import type { Shared as Local } from './door.js'; export interface AgentState { value?: readonly Local[]; }";
    const inline = "export interface AgentState { value?: readonly import('./door.js').Shared[]; }";
    expect(readState(() => named).contract).toEqual(readState(() => inline).contract);
  });

  it.each([
    ['removed member', changedField('userMessage', () => '')],
    [
      'changed member type',
      changedField('userMessage', (text) => text.replace(': string', ': number')),
    ],
    [
      'changed optional modifier',
      changedField('toolResults', (text) => text.replace('toolResults?', 'toolResults')),
    ],
    ['changed readonly modifier', changedField('userMessage', (text) => `readonly ${text}`)],
    [
      'changed nested readonly modifier',
      changedField('stoppedEarly', (text) => text.replace('readonly reason:', 'reason:')),
    ],
  ])('rejects %s', (_name, read) => {
    expect(read().contract).not.toEqual(fixture.contract);
  });

  it('rejects a duplicate inherited property', () => {
    const read = changedField('userMessage', (text) => `${text}\n  userMessage: string;`);
    expect(read).toThrow('Duplicate state property: userMessage');
  });

  it('rejects the same imported name from the wrong owner', () => {
    const current = readState();
    const file = current.locations.get('history')!.file;
    const text = current.sources.get(file)!;
    const changed = text.replace('provider-contract/types.js', 'provider-contract/wrong-owner.js');
    expect(changed).not.toBe(text);
    expect(
      readState((path) => (path === file ? changed : readFileSync(path, 'utf8'))).contract,
    ).not.toEqual(fixture.contract);
  });

  it('rejects a changed standalone comment, including its whitespace', () => {
    const current = readState();
    const file = current.locations.get('pausedCredentialService')!.file;
    const text = current.sources.get(file)!;
    const changed = text.replace('NO scope key', 'NO  scope key');
    expect(changed).not.toBe(text);
    expect(
      readState((path) => (path === file ? changed : readFileSync(path, 'utf8'))).contract,
    ).not.toEqual(fixture.contract);
  });

  it('keeps every extracted type module erased', () => {
    const modules = typeModules(resolve(dirname(entry), 'types'));
    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) assertErased(file, readFileSync(file, 'utf8'));
  });

  it.each(['export const live = 1;', "import './side-effect.js';", 'export class Live {}'])(
    'rejects runtime additions: %s',
    (text) => {
      expect(() => assertErased('added.ts', text)).toThrow('Runtime statement');
    },
  );
});
