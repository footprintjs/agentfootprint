/**
 * Every typed event the library's stages emit leaves through ONE served path:
 * `typedEmit` → `emitServed` (`src/redaction/runRedaction.ts`), which serves
 * the payload under the run's rule before footprintjs's `$emit`. A stage that
 * called `scope.$emit` itself would put its payload on every channel raw.
 *
 * Pinned by reading the source: the only `.$emit(` call in `src/` is the one
 * inside `runRedaction.ts`, and `typedEmit` delegates to `emitServed`.
 */
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { productionSources } from '../helpers/productionSources.js';

const sourceFiles = productionSources;
const SRC = resolve(__dirname, '../../src');

/** A file's code with its comments taken out. */
const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the one served path for a stage’s typed events', () => {
  it('no file but runRedaction.ts calls `$emit` itself', () => {
    const callers = sourceFiles(SRC)
      .filter((path) => /\.\$emit\s*\(/.test(codeOf(path)))
      .map((path) => relative(SRC, path));
    expect(callers).toEqual(['redaction/runRedaction.ts']);
  });

  it('typedEmit hands every payload to emitServed', () => {
    const code = codeOf(join(SRC, 'recorders/core/typedEmit.ts'));
    const source = ts.createSourceFile('typedEmit.ts', code, ts.ScriptTarget.Latest, true);
    const writer = source.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === 'typedEmit',
    );
    if (writer?.body === undefined) throw new Error('Expected the actual typedEmit function');
    const delegates: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'emitServed'
      )
        delegates.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(delegates).toHaveLength(1);
    const delegate = delegates[0];
    if (delegate === undefined) throw new Error('Expected the native served delegate');
    expect(
      writer.body.statements.some(
        (statement) => ts.isExpressionStatement(statement) && statement.expression === delegate,
      ),
    ).toBe(true); // The native funnel is unconditional, never hidden under a branch.
    expect(writer.parameters).toHaveLength(4);
    expect(writer.parameters.every((parameter) => ts.isIdentifier(parameter.name))).toBe(true);
    expect(delegate.arguments.map((argument) => argument.getText(source))).toEqual(
      writer.parameters.map((parameter) => parameter.name.getText(source)),
    );
    const shown = writer.parameters[3];
    expect(shown?.questionToken?.kind).toBe(ts.SyntaxKind.QuestionToken);
    expect(writer.parameters[2]?.type?.getText(source)).toBe(
      "AgentfootprintEventMap[K]['payload']",
    );
    expect(shown?.type?.getText(source)).toBe(writer.parameters[2]?.type?.getText(source));
    expect(code).not.toMatch(/\.\$emit\s*\(/);
  });

  it('every stage that emits imports the served path, never footprintjs’s emit directly', () => {
    const stages = sourceFiles(join(SRC, 'core/agent/stages'));
    const emitting = stages.filter((path) => /typedEmit\(|emitServed\(/.test(codeOf(path)));
    expect(emitting.length).toBeGreaterThan(5);
    for (const path of emitting) {
      expect(codeOf(path), relative(SRC, path)).toMatch(/typedEmit|emitServed/);
      expect(codeOf(path), relative(SRC, path)).not.toMatch(/\.\$emit\s*\(/);
    }
  });
});
