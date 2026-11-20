import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const execution = 'src/core/agent/stages/toolCalls/execution';
const owners = [
  ['initialInvocation.ts', 'frame.tool.execute', 'frame.env.signal'],
  ['resumedInvocation.ts', 'tool.execute', 'env.signal'],
] as const;

function awaitedCall(node: ts.Node | undefined): ts.CallExpression | undefined {
  return node && ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)
    ? node.expression
    : undefined;
}

function violationOf(
  fileName: string,
  text: string,
  execute: string,
  runSignal: string,
): string | undefined {
  const parsed = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const invocationTries: ts.TryStatement[] = [];
  const isExecute = (statement: ts.Statement): boolean => {
    if (!ts.isExpressionStatement(statement)) return false;
    const assignment = statement.expression;
    return (
      ts.isBinaryExpression(assignment) &&
      assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      awaitedCall(assignment.right)?.expression.getText(parsed) === execute
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node) && node.tryBlock.statements.some(isExecute)) {
      invocationTries.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (invocationTries.length !== 1) return 'expected one tool execution try block';

  // The finally runs before a result leaves the try or a throw reaches the
  // surrounding pause handler. Drain first so neither path can miss a verdict.
  const first = invocationTries[0]?.finallyBlock?.statements[0];
  const close = first && ts.isExpressionStatement(first) && awaitedCall(first.expression);
  if (
    !close ||
    close.expression.getText(parsed) !== 'binding.close' ||
    close.arguments.length !== 1 ||
    close.arguments[0]?.getText(parsed) !== runSignal
  ) {
    return 'the execution finally must start by awaiting admission close with the run signal';
  }
  return undefined;
}

describe.each(owners)('%s admission close', (name, execute, signal) => {
  const file = resolve(root, execution, name);
  const source = readFileSync(file, 'utf8');

  it('waits for the admission close before handling the tool outcome', () => {
    expect(violationOf(file, source, execute, signal)).toBeUndefined();
  });

  it('flags a missing await in source text', () => {
    const call = `binding.close(${signal})`;
    const changed = source.replace(`await ${call}`, call);
    expect(changed).not.toBe(source);
    expect(violationOf(file, changed, execute, signal)).toBe(
      'the execution finally must start by awaiting admission close with the run signal',
    );
  });
});
