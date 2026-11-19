import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');
const readers = ['src/answer-account/', 'src/core/agent/assessment/'];
const owner = 'src/core/agent/recordedCalls';
const scopedExclusions = new Map([
  ['src/security/extractSequence.ts', 'known, carded: TASK-Root-16'],
  ['src/core/agent/findings/ledger.ts', 'known, carded: TASK-Root-17'],
  ['src/core/agent/findings/context.ts', 'known, carded: TASK-Root-17'],
  ['src/time-travel/servedView/findings.ts', 'known, carded: TASK-Root-17'],
  ['src/trace-toolpack/traceToolpack/toolCallOccurrence.ts', 'known, carded: TASK-Root-18'],
  ['src/trace-toolpack/traceToolpack/toolCallJournal.ts', 'known, carded: TASK-Root-18'],
]);

function shouldScan(file: string): boolean {
  if (file === owner + '.ts' || file.startsWith(owner + '/')) return false;
  if (scopedExclusions.has(file)) return false;
  return readers.some((path) => file.startsWith(path)) && !file.endsWith('.test.ts');
}

const idFields = /^(?:toolCallId|callId|providerId|providerCallId|tool_call_id|tool_use_id)$/;
const keyMethods = new Set(['get', 'set', 'has', 'add', 'delete', 'includes', 'indexOf']);
const searches = new Set([
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'filter',
  'some',
  'every',
  'forEach',
]);
const scalarReaders = new Set(['str', 'String']);
const comparisons = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function member(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))
    return node.argumentExpression.text;
  return undefined;
}

function unwrap(node: ts.Node): ts.Node {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;
}

function scan(file: string, text: string): string[] {
  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.ES2022 };
  const source = ts.createSourceFile(file, text, options.target, true);
  // Bind aliases to their own lexical declarations. No imports, packages or library code run.
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === file ? source : undefined);
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  const declaration = (node: ts.Node) =>
    ts.isIdentifier(node) ? checker.getSymbolAtLocation(node)?.valueDeclaration : undefined;

  function callback(raw: ts.Node | undefined): ts.ConciseBody | undefined {
    if (raw === undefined) return undefined;
    const node = unwrap(raw);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node.body;
    const d = declaration(node);
    if (d !== undefined && ts.isFunctionDeclaration(d)) return d.body;
    if (d !== undefined && ts.isVariableDeclaration(d)) {
      const init = d.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init.body;
    }
    return undefined;
  }

  /** The collection supplying a for-of variable or a collection callback's first parameter. */
  function iterableOf(d: ts.Declaration | undefined): ts.Expression | undefined {
    if (d === undefined) return undefined;
    if (ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent)) {
      if (ts.isForOfStatement(d.parent.parent)) return d.parent.parent.expression;
    }
    if (ts.isParameter(d) && (ts.isArrowFunction(d.parent) || ts.isFunctionExpression(d.parent))) {
      const call = d.parent.parent;
      if (
        d.parent.parameters[0] === d &&
        ts.isCallExpression(call) &&
        call.arguments[0] === d.parent &&
        ts.isPropertyAccessExpression(call.expression)
      )
        return call.expression.expression;
    }
    return undefined;
  }

  /** `toolCalls[i].id`, a callback over `toolCalls`, or `for (const call of …toolCalls…)`. */
  function proposal(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isElementAccessExpression(node)) return mentionsToolCalls(node.expression);
    const d = declaration(node);
    const iterable = iterableOf(d);
    if (iterable !== undefined) return mentionsToolCalls(iterable);
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      return proposal(unwrap(d.initializer), seen);
    }
    return false;
  }

  function mentionsToolCalls(node: ts.Node): boolean {
    return member(node) === 'toolCalls' || ts.forEachChild(node, mentionsToolCalls) === true;
  }

  function isCallId(raw: ts.Node | undefined, seen = new Set<ts.Node>()): boolean {
    if (raw === undefined) return false;
    const node = unwrap(raw);
    if (seen.has(node)) return false;
    seen.add(node);
    const field = member(node);
    if (field !== undefined && idFields.test(field)) return true;
    if (
      field === 'id' &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    )
      return proposal(unwrap(node.expression));
    if (ts.isConditionalExpression(node))
      return isCallId(node.whenTrue, seen) || isCallId(node.whenFalse, seen);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    )
      return isCallId(node.left, seen) || isCallId(node.right, seen);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      scalarReaders.has(node.expression.text)
    )
      return isCallId(node.arguments[0], seen);
    if (!ts.isIdentifier(node)) return false;
    if (idFields.test(node.text)) return true;
    const d = declaration(node);
    const iterable = iterableOf(d);
    if (iterable !== undefined) return projects(iterable, (item) => isCallId(item, seen));
    if (d !== undefined && ts.isVariableDeclaration(d)) return isCallId(d.initializer, seen);
    if (d !== undefined && ts.isBindingElement(d)) {
      const property = d.propertyName ?? d.name;
      return (
        (ts.isIdentifier(property) || ts.isStringLiteral(property)) && idFields.test(property.text)
      );
    }
    return false;
  }

  function projects(
    raw: ts.Node | undefined,
    test: (value: ts.Node) => boolean,
    seen = new Set<ts.Node>(),
  ): boolean {
    if (raw === undefined) return false;
    const node = unwrap(raw);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isArrayLiteralExpression(node))
      return node.elements.some((entry) =>
        ts.isSpreadElement(entry) ? projects(entry.expression, test, seen) : test(unwrap(entry)),
      );
    if (ts.isConditionalExpression(node))
      return projects(node.whenTrue, test, seen) || projects(node.whenFalse, test, seen);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression } = node.expression;
      if (name.text === 'filter' || name.text === 'slice') return projects(expression, test, seen);
      if (name.text === 'map' || name.text === 'flatMap') {
        const body = callback(node.arguments[0]);
        if (body === undefined) return false;
        const mapped = (value: ts.Node) =>
          name.text === 'map' ? test(unwrap(value)) : projects(value, test, seen);
        if (!ts.isBlock(body)) return mapped(body);
        return body.statements.some(
          (statement) =>
            ts.isReturnStatement(statement) &&
            statement.expression !== undefined &&
            mapped(statement.expression),
        );
      }
    }
    const d = declaration(node);
    return d !== undefined && ts.isVariableDeclaration(d) && projects(d.initializer, test, seen);
  }

  const entryHasIdKey = (entry: ts.Node) =>
    ts.isArrayLiteralExpression(entry) && isCallId(entry.elements[0]);
  const isNullish = (raw: ts.Node) => {
    const node = unwrap(raw);
    return (
      node.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(node) && node.text === 'undefined')
    );
  };
  function comparesId(node: ts.Node): boolean {
    if (
      ts.isBinaryExpression(node) &&
      comparisons.has(node.operatorToken.kind) &&
      !isNullish(node.left) &&
      !isNullish(node.right) &&
      (isCallId(node.left) || isCallId(node.right))
    )
      return true;
    return ts.forEachChild(node, comparesId) === true;
  }

  const found: string[] = [];
  const report = (node: ts.Node, operation: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}:${character + 1} ${operation}`);
  };
  function visit(node: ts.Node): void {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const kind = node.expression.text;
      if (kind === 'Map' && projects(node.arguments?.[0], entryHasIdKey)) report(node, kind);
      if (kind === 'Set' && projects(node.arguments?.[0], (item) => isCallId(item)))
        report(node, kind);
    }
    if (ts.isCallExpression(node)) {
      const name = member(node.expression);
      if (name !== undefined && keyMethods.has(name) && isCallId(node.arguments[0]))
        report(node, name);
      if (name !== undefined && searches.has(name)) {
        const predicate = callback(node.arguments[0]);
        if (predicate !== undefined && comparesId(predicate)) report(node, name);
      }
      if (name === 'fromEntries' && projects(node.arguments[0], entryHasIdKey)) report(node, name);
    }
    if (ts.isElementAccessExpression(node) && isCallId(node.argumentExpression))
      report(node, 'index');
    if (ts.isComputedPropertyName(node) && isCallId(node.expression)) report(node, 'key');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function productionReaders(): string[] {
  return readers
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/')),
    )
    .filter(shouldScan)
    .sort();
}

describe('recorded call occurrence ownership', () => {
  it('keeps provider IDs out of call lookups in the account and assessment readers', () => {
    const files = productionReaders();
    for (const dir of readers) expect(files.some((file) => file.startsWith(dir))).toBe(true);
    const violations = files.flatMap((file) => scan(file, readFileSync(join(root, file), 'utf8')));
    expect(violations, `read occurrences from ${owner}.ts`).toEqual([]);
  });

  const reader = 'src/answer-account/facts/example.ts';
  it.each([
    ['set', 'const key = str(event.payload.toolCallId); lookup.set(key, event)'],
    ['has', 'const {toolCallId: key} = event.payload; seen.has(key)'],
    ['get', 'results.get(occurrence.providerId)'],
    ['get', "const key = row['toolCallId']; lookup['get'](key)"],
    ['Map', 'new Map(rows.map(row => [row.toolCallId, row]))'],
    [
      'Set',
      'const keys = rows.flatMap(row => row.toolCallId ? [row.toolCallId] : []); new Set(keys)',
    ],
    [
      'find',
      'const match = row => { const key = row.toolCallId; return key === requested; }; rows.find(match)',
    ],
    ['findIndex', 'messages.findIndex(m => m.role === "tool" && m.toolCallId === requested)'],
    ['filter', 'rows.filter(r => r.toolCallId !== requested)'],
    ['set', 'for (const call of rowList(message.toolCalls)?.entries ?? []) map.set(call.id, call)'],
    ['add', 'for (const key of rows.map(row => row.toolCallId)) seen.add(key)'],
    ['has', 'const keys = rows.map(row => row.toolCallId); keys.some(key => seen.has(key))'],
    ['key', 'const lookup = { [row.toolCallId]: row }'],
    ['index', 'lookup[row.toolCallId]'],
    ['fromEntries', 'Object.fromEntries(rows.map(row => [row.toolCallId, row]))'],
  ])('finds a provider-ID %s lookup', (operation, code) => {
    expect(scan(reader, code)).toEqual([expect.stringMatching(new RegExp(` ${operation}$`))]);
  });

  it.each([
    'new Map(rows.map(row => [row.historyIndex, row.toolCallId]))',
    'new Set(rows.map(row => row.historyIndex))',
    'rows.find(row => row.toolCallId !== undefined && row.historyIndex === index)',
    'rows.filter(row => row.toolCallId === null)',
    'nodes.find(node => node.id === id)',
    'for (const key of rows.map(row => row.historyIndex)) seen.add(key)',
    'rows.find(row => row.outcome === "pending")',
    'const key = row.toolCallId; function show(key) { labels.get(key) }',
    'row => ({ toolCallId: row.toolCallId, pointer: at(row, "toolCallId") })',
  ])('allows occurrence coordinates and display labels: %s', (code) => {
    expect(scan(reader, code)).toEqual([]);
  });

  it('scopes the owner and reserved lanes to their named paths', () => {
    expect(shouldScan(owner + '.ts')).toBe(false);
    expect(shouldScan(owner + '/pair.ts')).toBe(false);
    for (const [path, reason] of scopedExclusions) {
      expect(shouldScan(path), reason).toBe(false);
      const siblingName = path.slice(path.lastIndexOf('/') + 1);
      for (const dir of readers) expect(shouldScan(dir + siblingName), reason).toBe(true);
    }
  });
});
