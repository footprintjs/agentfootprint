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
const replacements = new Map<string, ts.SourceFile>();
host.getSourceFile = (file, languageVersion, onError) => {
  const replacement = replacements.get(file);
  if (replacement) return replacement;
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
    .map((d) => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }));
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
    const mutated = original.replace(
      'export function outcomesShapes() {\n  return {',
      `export function outcomesShapes() {\n  return {\n${property},`,
    );
    expect(mutated).not.toBe(original);
    replacements.set(
      outcomes,
      ts.createSourceFile(outcomes, mutated, ts.ScriptTarget.ES2022, true),
    );
    try {
      expect(errors(ts.createProgram([facade], options, host, cleanProgram))).toEqual([
        expect.objectContaining({ code: 1360 }),
      ]);
    } finally {
      replacements.delete(outcomes);
    }
  });
});

const facadeText = readFileSync(facade, 'utf8');
function compositionOf(text: string) {
  const source = ts.createSourceFile(facade, text, ts.ScriptTarget.ES2022, true);
  const fn = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'eventShapes',
  );
  const statement = fn?.body?.statements[0];
  if (
    !fn?.body ||
    fn.body.statements.length !== 1 ||
    !statement ||
    !ts.isReturnStatement(statement)
  )
    throw new Error('eventShapes must contain one return statement');
  const expression = statement.expression;
  if (!expression || !ts.isSatisfiesExpression(expression))
    throw new Error('eventShapes must satisfy CheckedEventGroups');
  if (!ts.isObjectLiteralExpression(expression.expression))
    throw new Error('eventShapes must return an object literal');
  return { object: expression.expression, checked: expression.type };
}
function compositionErrors(text: string): string[] {
  const { object, checked } = compositionOf(text);
  const spreads: string[] = [];
  for (const property of object.properties) {
    if (
      !ts.isSpreadAssignment(property) ||
      !ts.isCallExpression(property.expression) ||
      !ts.isIdentifier(property.expression.expression)
    )
      return ['Only spread calls may enter eventShapes'];
    spreads.push(property.expression.expression.text);
  }
  if (
    !ts.isTypeReferenceNode(checked) ||
    !ts.isIdentifier(checked.typeName) ||
    checked.typeName.text !== 'CheckedEventGroups' ||
    checked.typeArguments?.length !== 1 ||
    !ts.isTupleTypeNode(checked.typeArguments[0])
  )
    return ['eventShapes must check a tuple of group ReturnTypes'];
  const groups: string[] = [];
  for (const element of checked.typeArguments[0].elements) {
    if (
      !ts.isTypeReferenceNode(element) ||
      !ts.isIdentifier(element.typeName) ||
      element.typeName.text !== 'ReturnType' ||
      element.typeArguments?.length !== 1 ||
      !ts.isTypeQueryNode(element.typeArguments[0]) ||
      !ts.isIdentifier(element.typeArguments[0].exprName)
    )
      return ['eventShapes must check a tuple of group ReturnTypes'];
    groups.push(element.typeArguments[0].exprName.text);
  }
  return spreads.length === groups.length && spreads.every((name, index) => name === groups[index])
    ? []
    : ['Spread calls must match CheckedEventGroups in order'];
}
function withFacade(text: string) {
  replacements.set(facade, ts.createSourceFile(facade, text, ts.ScriptTarget.ES2022, true));
  try {
    return errors(ts.createProgram([facade], options, host, cleanProgram));
  } finally {
    replacements.delete(facade);
  }
}
function addSpread(body: string) {
  const { object } = compositionOf(facadeText);
  return (
    facadeText.slice(0, object.end - 1) +
    '...extraShapes(),\n' +
    facadeText.slice(object.end - 1) +
    `\nfunction extraShapes() { return ${body}; }\n`
  );
}

describe('the real facade checks every spread group, in order, with no inline overrides', () => {
  it('pins the production composition to its checked tuple', () => {
    expect(compositionErrors(facadeText)).toEqual([]);
  });
  it.each([
    ['an unlisted eighth group with identical duplicates', 'streamingShapes()'],
    [
      'an unlisted eighth group with an unknown key',
      "{ 'agentfootprint.not.registered': boundMeta }",
    ],
    [
      'an unlisted eighth group overriding a content rule',
      "{ 'agentfootprint.integrity.external_ground_used': boundMeta }",
    ],
  ])('rejects %s even though TypeScript accepts it', (_name, body) => {
    const mutated = addSpread(body);
    expect(withFacade(mutated)).toEqual([]);
    expect(compositionErrors(mutated)).toEqual([
      'Spread calls must match CheckedEventGroups in order',
    ]);
  });
  it('rejects an inline property after the spreads even though TypeScript accepts it', () => {
    const { object } = compositionOf(facadeText);
    const mutated =
      facadeText.slice(0, object.end - 1) +
      "'agentfootprint.stream.token': boundMeta,\n" +
      facadeText.slice(object.end - 1);
    expect(withFacade(mutated)).toEqual([]);
    expect(compositionErrors(mutated)).toEqual(['Only spread calls may enter eventShapes']);
  });
  it('rejects a tuple whose group order differs from the spreads', () => {
    const mutated = facadeText
      .replace('ReturnType<typeof contentShapes>', 'ReturnType<typeof lifecycleShapes>')
      .replace('ReturnType<typeof decisionsShapes>', 'ReturnType<typeof contentShapes>');
    expect(compositionErrors(mutated)).toEqual([
      'Spread calls must match CheckedEventGroups in order',
    ]);
  });
  it('accepts a new group when its spread and checked tuple both include it', () => {
    const mutated = addSpread('{}').replace(
      'ReturnType<typeof outcomesShapes>,',
      'ReturnType<typeof outcomesShapes>, ReturnType<typeof extraShapes>,',
    );
    expect(withFacade(mutated)).toEqual([]);
    expect(compositionErrors(mutated)).toEqual([]);
  });
});
