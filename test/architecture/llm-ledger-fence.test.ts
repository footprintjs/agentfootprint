/**
 * THE FENCE — `src/llm-ledger/` imports `footprintjs` and `foottrace` only, names no Node API outside
 * its file store, and runs no code when it is loaded.
 *
 * WHY THIS EXISTS. The owner's decision: the LLM ledger is an internal library first, and moving it
 * to its own package must stay a FILE MOVE. `scripts/layering.config.cjs` closes the folder
 * (`CLOSED_FOLDERS`), but that list sees only RELATIVE edges: `readEdges` skips a bare specifier, so
 * `import { readFileSync } from 'node:fs'` in `entries.ts` would pass it. This test reads every file
 * with the TypeScript parser — so `import type`, `export … from`, `import('…').T`, `await import()`,
 * `require()` and `import x = require()` are all seen — and holds, per file, the bare specifiers it
 * may name. A new file that uses Node is a visible edit to `ALLOWANCES` below.
 *
 * THE RULES (case table, rows 2.3, 3.2 and 3.3):
 *   - every production file may import `footprintjs` and `foottrace/canonical-json`, and relative
 *     files inside the folder; `fileStore.ts` also `node:fs`, `node:fs/promises`, `node:path`,
 *     `node:crypto`. Nothing else, anywhere.
 *   - `import()` of anything, `require`, `process` and the other Node globals appear nowhere; nor
 *     do `eval`, the `Function` constructor, `import.meta`, or the network (`fetch`, `WebSocket`,
 *     `XMLHttpRequest`: a receipt's `ref.uri` is never fetched).
 *   - Web Crypto appears only in `digest.ts`, and only as `globalThis.crypto`: no other
 *     `globalThis.` access anywhere, and no bare `crypto`.
 *   - no decorator anywhere, and no computed class member name: both run code when a class is
 *     defined; no `.constructor` / `['constructor']` read (the Function constructor without its
 *     name); no triple-slash `/// <reference …>` directive (a type-level edge out).
 *
 * WHAT A FENCE OVER SOURCE TEXT CANNOT DO: stop every call built at run time (a property name put
 * together from pieces, a function handed in by a host). What it does stop: every import form, the
 * Node and network globals by name, `eval` and the Function constructor by name and by its two
 * common reaches, `import.meta`, decorators, code at module evaluation, and Web Crypto outside its
 * one file.
 *   - no file runs code at module evaluation: the top level holds imports, exports and declarations
 *     whose initializers are inert (literals, functions, `Object.freeze` of a literal).
 *   - a test beside the code imports only the folder, `vitest`, `footprintjs`, `foottrace` and
 *     `node:` builtins; one that needs repository helpers lives in `test/llm-ledger/`.
 *
 * The scanner is proved before it is trusted: every refused shape is a fixture below that must be
 * flagged, and every shape the folder uses must not be.
 *
 * WHAT A GREEN RUN PROVES: the import graph and the top level of every file under the folder obey
 * the rules above. WHAT IT DOES NOT PROVE: that a value passed IN (a host's callback) does nothing —
 * a function the host hands in runs whatever it runs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../..');
const FOLDER = 'src/llm-ledger';

/** What EVERY production file may import, beyond relative files inside the folder. */
const EVERY_FILE = ['footprintjs', 'foottrace/canonical-json'] as const;

/** What a named file may import on top of `EVERY_FILE`, and why. */
const ALLOWANCES: Readonly<
  Record<string, { readonly specifiers: readonly string[]; readonly why: string }>
> = {
  [`${FOLDER}/fileStore.ts`]: {
    specifiers: ['node:fs', 'node:fs/promises', 'node:path', 'node:crypto'],
    why:
      'the file adapter: files, permissions, the lock and the HMAC. It is the ledger’s one door to a ' +
      'disk; the command line (a later pull request) adds its own row here.',
  },
};

/** The one file Web Crypto may appear in. */
const WEB_CRYPTO_FILE = `${FOLDER}/digest.ts`;

/** Node-only globals: no file reaches them (the host passes what it needs, e.g. its `uid`). */
const NODE_GLOBALS = new Set([
  'process',
  'require',
  'Buffer',
  '__dirname',
  '__filename',
  'global',
  'setImmediate',
  'clearImmediate',
  'module',
  'exports',
]);

/** Globals that run code from text or reach the network: refused everywhere. */
const RUNNERS = new Set(['eval', 'Function', 'fetch', 'WebSocket', 'XMLHttpRequest']);

/** What a test beside the code may import (bare), beyond relative files inside the folder. */
const TEST_BARE = (spec: string): boolean =>
  spec === 'vitest' ||
  spec === 'footprintjs' ||
  spec.startsWith('footprintjs/') ||
  spec === 'foottrace' ||
  spec.startsWith('foottrace/') ||
  spec.startsWith('node:');

// ── the scanner ──────────────────────────────────────────────────────────────

interface Specifier {
  readonly spec: string;
  readonly form: 'static' | 'dynamic' | 'require' | 'type';
  readonly line: number;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Every module a file names, in every form the parser can see. */
function specifiersOf(source: ts.SourceFile): Specifier[] {
  const out: Specifier[] = [];
  const take = (node: ts.Node | undefined, form: Specifier['form'], at: ts.Node): void => {
    if (node === undefined) return;
    if (ts.isStringLiteralLike(node)) out.push({ spec: node.text, form, line: lineOf(source, at) });
    else out.push({ spec: '<computed>', form, line: lineOf(source, at) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) take(node.moduleSpecifier, 'static', node);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference))
        take(node.moduleReference.expression, 'require', node);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) take(node.argument.literal, 'type', node);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        take(node.arguments[0] ?? node, 'dynamic', node);
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        take(node.arguments[0] ?? node, 'require', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Whether a relative specifier from `file` names a file inside the folder. */
function staysInside(file: string, spec: string): boolean {
  const target = relative(REPO, resolve(REPO, dirname(file), spec))
    .split('\\')
    .join('/');
  return target === FOLDER || target.startsWith(`${FOLDER}/`);
}

/** Is `node` an identifier read as a free variable (not a property name or a declared name)? */
function readsGlobal(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  )
    return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  return true;
}

const ARITHMETIC = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.SlashToken,
]);

function numericLiteralArithmetic(node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return numericLiteralArithmetic(node.expression);
  return (
    ts.isBinaryExpression(node) &&
    ARITHMETIC.has(node.operatorToken.kind) &&
    numericLiteralArithmetic(node.left) &&
    numericLiteralArithmetic(node.right)
  );
}

/** An initializer that runs no code when the module is evaluated. */
function inert(node: ts.Expression): boolean {
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  )
    return true;
  if (ts.isPrefixUnaryExpression(node)) return ts.isNumericLiteral(node.operand);
  // Arithmetic over number literals only (`32 * 1024 * 1024`): no operand can run a `valueOf`.
  if (ts.isBinaryExpression(node)) return numericLiteralArithmetic(node);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return inert(node.expression);
  // Reading a property of a binding (`LEDGER_LIMITS.maxLineBytes`), never a call.
  if (ts.isPropertyAccessExpression(node))
    return ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)
      ? inert(node.expression)
      : false;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every((e) => !ts.isSpreadElement(e) && inert(e));
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every((p) => {
      if (p.name !== undefined && ts.isComputedPropertyName(p.name)) return false;
      if (ts.isPropertyAssignment(p)) return inert(p.initializer);
      return ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p);
    });
  // The one call allowed: `Object.freeze(<inert>)`.
  if (ts.isCallExpression(node))
    return (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Object' &&
      node.expression.name.text === 'freeze' &&
      node.arguments.length === 1 &&
      inert(node.arguments[0] as ts.Expression)
    );
  return false;
}

/** Top-level statements that would run code when the module is loaded. */
function topLevelCode(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const say = (node: ts.Node, what: string): void => {
    out.push(`${source.fileName}:${lineOf(source, node)} — ${what}`);
  };
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    )
      continue;
    if (ts.isExportDeclaration(statement)) continue;
    if (ts.isClassDeclaration(statement)) {
      const heritage = statement.heritageClauses?.flatMap((h) => h.types) ?? [];
      if (heritage.some((h) => !ts.isIdentifier(h.expression)))
        say(statement, 'a computed base class');
      for (const member of statement.members) {
        const isStatic = ts
          .getModifiers(member as ts.HasModifiers)
          ?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
        if (ts.isClassStaticBlockDeclaration(member)) say(member, 'a static block');
        else if (isStatic && ts.isPropertyDeclaration(member) && member.initializer !== undefined)
          if (!inert(member.initializer)) say(member, 'a static initializer that runs code');
        if (member.name !== undefined && ts.isComputedPropertyName(member.name))
          say(member, 'a computed class member');
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) say(declaration, 'a destructuring declaration');
        else if (declaration.initializer !== undefined && !inert(declaration.initializer))
          say(declaration, `an initializer that runs code (${declaration.name.text})`);
      }
      continue;
    }
    say(statement, `a top-level ${ts.SyntaxKind[statement.kind]}`);
  }
  return out;
}

/** Every refusal the rules give one production file. */
function productionFaults(file: string, text: string): string[] {
  const source = parse(file, text);
  const faults: string[] = [];
  const allowed = new Set<string>([...EVERY_FILE, ...(ALLOWANCES[file]?.specifiers ?? [])]);
  for (const { spec, form, line } of specifiersOf(source)) {
    if (form === 'dynamic') faults.push(`${file}:${line} — import() of '${spec}'`);
    else if (form === 'require') faults.push(`${file}:${line} — require of '${spec}'`);
    else if (spec.startsWith('.')) {
      if (!staysInside(file, spec)) faults.push(`${file}:${line} — '${spec}' leaves the folder`);
    } else if (!allowed.has(spec))
      faults.push(`${file}:${line} — '${spec}' is not on its allowance`);
  }
  const say = (node: ts.Node, what: string): void => {
    faults.push(`${file}:${lineOf(source, node)} — ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && readsGlobal(node)) {
      if (NODE_GLOBALS.has(node.text)) say(node, `the Node global '${node.text}'`);
      if (RUNNERS.has(node.text))
        say(node, `'${node.text}' runs text as code or reaches the network`);
      if (node.text === 'crypto') say(node, "a bare 'crypto': Web Crypto is `globalThis.crypto`");
      if (node.text === 'globalThis') {
        const access = node.parent;
        const webCrypto =
          ts.isPropertyAccessExpression(access) &&
          access.expression === node &&
          access.name.text === 'crypto';
        if (!webCrypto || file !== WEB_CRYPTO_FILE)
          say(node, `'globalThis' other than \`globalThis.crypto\` in ${WEB_CRYPTO_FILE}`);
      }
    }
    if (ts.isMetaProperty(node)) say(node, '`import.meta`');
    if (ts.isDecorator(node)) say(node, 'a decorator: it runs code when its class is defined');
    // `[].constructor.constructor('…')` reaches the Function constructor without naming it.
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'constructor')
      say(node, 'a `.constructor` read: the way to the Function constructor without its name');
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'constructor'
    )
      say(node, "a `['constructor']` read: the way to the Function constructor without its name");
    ts.forEachChild(node, visit);
  };
  visit(source);
  // A triple-slash directive is an edge the import walk never sees: a type-level reach out.
  for (const ref of [
    ...source.referencedFiles,
    ...source.typeReferenceDirectives,
    ...source.libReferenceDirectives,
  ])
    faults.push(`${file} — a triple-slash reference to '${ref.fileName}'`);
  return [...faults, ...topLevelCode(source)];
}

/** Every refusal the rules give one test file beside the code. */
function testFaults(file: string, text: string): string[] {
  const faults: string[] = [];
  for (const { spec, line } of specifiersOf(parse(file, text))) {
    if (spec.startsWith('.')) {
      if (!staysInside(file, spec)) faults.push(`${file}:${line} — '${spec}' leaves the folder`);
    } else if (!TEST_BARE(spec))
      faults.push(
        `${file}:${line} — '${spec}': a test beside the code imports only the folder, vitest, ` +
          'footprintjs, foottrace and node: builtins (move it to test/llm-ledger/)',
      );
  }
  return faults;
}

function walk(dir: string): string[] {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
}

const FILES = walk(FOLDER).sort();
const SOURCES = FILES.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const TESTS = FILES.filter((f) => f.endsWith('.test.ts'));
const read = (file: string): string => readFileSync(join(REPO, file), 'utf8');

// ── the scanner, proved first ────────────────────────────────────────────────

describe('llm-ledger fence — the scanner flags every refused shape', () => {
  const PLAIN = `${FOLDER}/entries.ts`;
  const REFUSED: ReadonlyArray<readonly [string, string, string]> = [
    ['a Node import outside fileStore.ts', PLAIN, "import { readFileSync } from 'node:fs';"],
    ['a type-only Node import', PLAIN, "import type { Stats } from 'node:fs';"],
    ['another package', PLAIN, "import { z } from 'zod';"],
    [
      'a foottrace door that is not on the list',
      PLAIN,
      "import { commitValueAt } from 'foottrace';",
    ],
    ['a relative import out of the folder', PLAIN, "import { sleep } from '../lib/sleep.js';"],
    ['a type-only relative import out', PLAIN, "import type { Tool } from '../tools/tools.js';"],
    ['a re-export from outside', PLAIN, "export { sleep } from '../lib/sleep.js';"],
    ['an import type reference out', PLAIN, "export type T = import('../core/x.js').T;"],
    ['a dynamic import, even inside', PLAIN, "export const load = () => import('./tokens.js');"],
    ['require', PLAIN, "export const fs = require('node:fs');"],
    ['import = require', PLAIN, "import fs = require('node:fs');"],
    ['process', PLAIN, 'export const env = () => process.env;'],
    ['Buffer', PLAIN, 'export const b = (s: string) => Buffer.from(s);'],
    [
      'Web Crypto outside digest.ts',
      PLAIN,
      'export const r = () => globalThis.crypto.randomUUID();',
    ],
    [
      'the bare crypto global outside digest.ts',
      PLAIN,
      'export const r = () => crypto.randomUUID();',
    ],
    ['a top-level call', PLAIN, 'register();'],
    ['an initializer that calls', PLAIN, 'const table = build();'],
    ['an initializer that constructs', PLAIN, 'const seen = new Map();'],
    ['a frozen value built by a call', PLAIN, 'export const X = Object.freeze(make());'],
    ['a static block', PLAIN, 'class A { static { go(); } }'],
    ['a static initializer that calls', PLAIN, 'class A { static x = go(); }'],
    ['a top-level if', PLAIN, 'if (ready) start();'],
    ['an enum (runs code to build)', PLAIN, 'enum E { A }'],
    ['an expression in a computed key', PLAIN, 'const o = { [key()]: 1 };'],
    ['arithmetic over a binding (its valueOf can run)', PLAIN, 'const twice = size * 2;'],
    ['a template with a substitution', PLAIN, 'const s = `${name()}`;'],
    ['an allowance used outside its file', PLAIN, "import { createHmac } from 'node:crypto';"],
    ['eval', PLAIN, 'export const run = (code: string) => eval(code);'],
    ['the Function constructor', PLAIN, 'export const run = (code: string) => new Function(code);'],
    ['fetch', PLAIN, 'export const get = (uri: string) => fetch(uri);'],
    ['a WebSocket', PLAIN, 'export const open = (uri: string) => new WebSocket(uri);'],
    ['XMLHttpRequest', PLAIN, 'export const x = () => new XMLHttpRequest();'],
    ['import.meta', PLAIN, 'export const where = () => import.meta.url;'],
    ['a class decorator', PLAIN, '@register\nexport class A {}'],
    ['a member decorator', PLAIN, 'export class A { @track m() {} }'],
    ['a computed method name', PLAIN, 'export class A { [key()]() {} }'],
    [
      'globalThis.process even in digest.ts',
      WEB_CRYPTO_FILE,
      'export const p = () => globalThis.process;',
    ],
    [
      'globalThis passed on whole in digest.ts',
      WEB_CRYPTO_FILE,
      'export const g = () => globalThis;',
    ],
    ['a bare crypto in digest.ts', WEB_CRYPTO_FILE, 'export const r = () => crypto.randomUUID();'],
    [
      'a triple-slash path reference',
      PLAIN,
      '/// <reference path="../time/instant.ts" />\nexport const x = 1;',
    ],
    [
      'a triple-slash types reference',
      PLAIN,
      '/// <reference types="node" />\nexport const x = 1;',
    ],
    ['a triple-slash lib reference', PLAIN, '/// <reference lib="dom" />\nexport const x = 1;'],
    [
      'the Function constructor by .constructor',
      PLAIN,
      "export const f = () => [].constructor.constructor('return 1')();",
    ],
    [
      "the Function constructor by ['constructor']",
      PLAIN,
      "export const f = () => ({})['constructor']['constructor']('return 1');",
    ],
  ];
  for (const [name, file, source] of REFUSED) {
    it(`flags ${name}`, () => {
      expect(productionFaults(file, source).length).toBeGreaterThan(0);
    });
  }

  it('leaves every shape the folder uses', () => {
    const ok = [
      "import { canonicalizeJson } from 'foottrace/canonical-json';",
      "import type { JsonValue } from 'foottrace/canonical-json';",
      "import { LEDGER_LIMITS as L } from './limits.js';",
      "export type { LedgerEntry } from './types.js';",
      'export const LIMITS = Object.freeze({ a: 1, b: -2, c: [1, 2] } as const);',
      'export const PLUS = Object.freeze({ cap: L.maxEntries, n: 84 });',
      'const RE = /^a+$/;',
      'const MB = 32 * 1024 * 1024;',
      'const f = (v: unknown): boolean => typeof v === "string";',
      'export class E extends Error { readonly code: string; constructor(c: string) { super(c); this.code = c; } }',
      'export function g(x: number): number { return process2(x); }',
      'interface I { readonly process: number }',
      'const o = { process: 1, crypto: 2 };',
      'const read = (o: { process: number }) => o.process;',
    ].join('\n');
    expect(productionFaults(`${FOLDER}/entries.ts`, ok)).toEqual([]);
  });

  it('lets fileStore.ts import its four Node modules, and digest.ts reach Web Crypto', () => {
    const node = [
      "import { constants } from 'node:fs';",
      "import { open } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      "import { createHmac } from 'node:crypto';",
    ].join('\n');
    expect(productionFaults(`${FOLDER}/fileStore.ts`, node)).toEqual([]);
    expect(
      productionFaults(`${FOLDER}/fileStore.ts`, "import { spawn } from 'node:child_process';"),
    ).not.toEqual([]);
    const web =
      'export const r = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));';
    expect(productionFaults(WEB_CRYPTO_FILE, web)).toEqual([]);
  });

  it('holds a test beside the code to the folder, vitest, footprintjs, foottrace and node:', () => {
    const file = `${FOLDER}/tokens.test.ts`;
    expect(
      testFaults(
        file,
        "import { it } from 'vitest';\nimport { x } from './tokens.js';\nimport { join } from 'node:path';\n" +
          "import { canonicalizeJson } from 'foottrace/canonical-json';\nimport { flowChart } from 'footprintjs';",
      ),
    ).toEqual([]);
    expect(
      testFaults(file, "import { seeded } from '../../test/helpers/seededText.js';"),
    ).not.toEqual([]);
    expect(testFaults(file, "import { build } from 'esbuild';")).not.toEqual([]);
  });
});

// ── the real folder ──────────────────────────────────────────────────────────

describe('llm-ledger fence — this repository', () => {
  it('finds the folder (a fence over nothing proves nothing)', () => {
    expect(SOURCES).toContain(`${FOLDER}/fileStore.ts`);
    expect(SOURCES).toContain(WEB_CRYPTO_FILE);
    expect(SOURCES.length).toBeGreaterThan(8);
    expect(TESTS.length).toBeGreaterThan(3);
  });

  it.each(SOURCES)('%s keeps to its allowance and runs no code when loaded', (file) => {
    expect(productionFaults(file, read(file))).toEqual([]);
  });

  it.each(TESTS)('%s, a test beside the code, imports only what the folder may', (file) => {
    expect(testFaults(file, read(file))).toEqual([]);
  });

  it('every allowance names a file that exists and is still used in full (it only shrinks)', () => {
    for (const [file, { specifiers, why }] of Object.entries(ALLOWANCES)) {
      expect(SOURCES, `${file} is on the allowance list but does not exist`).toContain(file);
      expect(why.length).toBeGreaterThan(20);
      const used = new Set(specifiersOf(parse(file, read(file))).map((s) => s.spec));
      expect(
        specifiers.filter((s) => !used.has(s)),
        `${file} no longer imports these`,
      ).toEqual([]);
    }
  });

  it('Web Crypto is really reached, and only from digest.ts', () => {
    expect(read(WEB_CRYPTO_FILE)).toContain('globalThis.crypto');
  });

  it('holds only TypeScript and its README: nothing else ships beside the code', () => {
    expect(FILES.filter((f) => !f.endsWith('.ts') && !f.endsWith('/README.md'))).toEqual([]);
  });
});
