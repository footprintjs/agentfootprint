import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');
const facade = resolve(__dirname, '../auditShapes.ts');
const outcomes = resolve(__dirname, 'events/outcomes.ts');
const streaming = resolve(__dirname, 'events/streaming.ts');
const config = ts.getParsedCommandLineOfConfigFile(
  resolve(root, 'tsconfig.json'),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  },
);
if (!config) throw new Error('tsconfig.json did not parse');
const options = { ...config.options, noEmit: true };
const host = ts.createCompilerHost(options);
const originalGet = host.getSourceFile;
const sourceCache = new Map<string, ts.SourceFile>();
let replacement: ts.SourceFile | undefined;
host.getSourceFile = (file, languageVersion, onError) => {
  if (file === outcomes && replacement) return replacement;
  const cached = sourceCache.get(file);
  if (cached) return cached;
  const source = originalGet(file, languageVersion, onError);
  if (source) sourceCache.set(file, source);
  return source;
};
const original = readFileSync(outcomes, 'utf8');
const streamSource = ts.createSourceFile(
  streaming,
  readFileSync(streaming, 'utf8'),
  ts.ScriptTarget.ES2022,
  true,
);
let duplicate: string | undefined;
function findToken(node: ts.Node): void {
  if (
    ts.isPropertyAssignment(node) &&
    ts.isStringLiteral(node.name) &&
    node.name.text === 'agentfootprint.stream.token'
  )
    duplicate = node.getText(streamSource);
  ts.forEachChild(node, findToken);
}
findToken(streamSource);
if (!duplicate) throw new Error('The existing stream.token rule was not found');
const cleanProgram = ts.createProgram([facade], options, host);
function errors(program: ts.Program) {
  const source = program.getSourceFile(facade);
  if (!source) throw new Error('Audit facade was not compiled');
  return program
    .getSemanticDiagnostics(source)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
const cleanErrors = errors(cleanProgram);

describe('the real audit facade refuses conflicting event groups at compile time', () => {
  it('accepts the current groups', () => {
    expect(cleanErrors).toEqual([]);
  });
  it.each([
    ['an identical event duplicated in a later group', duplicate],
    ['an event key outside the registry', "'agentfootprint.not.registered': charsMarker"],
  ])('rejects %s', (_name, property) => {
    // Only the later group's source changes. The real facade and guard stay intact.
    const mutated = original.replace('return {', `return {\n${property},`);
    expect(mutated).not.toBe(original);
    replacement = ts.createSourceFile(outcomes, mutated, ts.ScriptTarget.ES2022, true);
    try {
      expect(errors(ts.createProgram([facade], options, host, cleanProgram))).not.toEqual([]);
    } finally {
      replacement = undefined;
    }
  });
});
