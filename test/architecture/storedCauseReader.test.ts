import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const file = resolve(root, 'src/trace-toolpack/storedCauseReader.ts');
const source = readFileSync(file, 'utf8');
const eslint = new ESLint({ cwd: root });

/** This is an optional-reader exception, not permission to read arbitrary door namespaces. */
function violations(text: string): string[] {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = parsed.statements.filter(ts.isImportDeclaration);
  const named = imports.filter((entry) => entry.importClause?.isTypeOnly);
  const namespaces = imports.filter(
    (entry) =>
      entry.importClause?.namedBindings && ts.isNamespaceImport(entry.importClause.namedBindings),
  );
  const errors: string[] = [];
  if (imports.length !== 2) errors.push('only the named type and one namespace import are allowed');
  if (
    imports.some(
      (entry) =>
        !ts.isStringLiteral(entry.moduleSpecifier) ||
        entry.moduleSpecifier.text !== 'footprintjs/trace',
    )
  )
    errors.push('only the public producer trace door is allowed');
  const bindings = named[0]?.importClause?.namedBindings;
  const reader = bindings && ts.isNamedImports(bindings) ? bindings.elements[0] : undefined;
  if (
    named.length !== 1 ||
    !reader ||
    !bindings ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.length !== 1 ||
    reader.propertyName?.text !== 'readStoredCapture'
  )
    errors.push('one named reader type must preserve compile-time door ownership');
  if (namespaces.length !== 1) errors.push('exactly one producer namespace is allowed');
  const namespace = namespaces[0]?.importClause?.namedBindings;
  const namespaceName =
    namespace && ts.isNamespaceImport(namespace) ? namespace.name.text : undefined;
  const namespaceUses: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === namespaceName) namespaceUses.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (namespaceUses.length !== 2)
    errors.push('namespace reads are limited to the declared reader lookup');
  const declarations = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap((entry) => [...entry.declarationList.declarations]);
  const candidate = declarations.find(
    (entry) => ts.isIdentifier(entry.name) && entry.name.text === 'candidate',
  );
  const lookup = candidate?.initializer;
  if (
    !lookup ||
    !ts.isCallExpression(lookup) ||
    !ts.isPropertyAccessExpression(lookup.expression) ||
    lookup.expression.expression.getText(parsed) !== 'Reflect' ||
    lookup.expression.name.text !== 'get' ||
    lookup.arguments.length !== 2 ||
    lookup.arguments[0]?.getText(parsed) !== namespaceName ||
    !ts.isStringLiteral(lookup.arguments[1]!) ||
    lookup.arguments[1].text !== 'readStoredCapture'
  )
    errors.push('only the one declared reader can be looked up');
  const published = declarations.find(
    (entry) => ts.isIdentifier(entry.name) && entry.name.text === 'readStoredCapture',
  );
  const type = published?.type;
  if (
    !reader ||
    !type ||
    !ts.isUnionTypeNode(type) ||
    !type.types.some(
      (entry) => ts.isTypeQueryNode(entry) && entry.exprName.getText(parsed) === reader.name.text,
    ) ||
    !type.types.some((entry) => entry.kind === ts.SyntaxKind.UndefinedKeyword)
  )
    errors.push('the optional export must retain the named reader type');
  if ((text.match(/eslint-disable-next-line no-restricted-syntax/g) ?? []).length !== 1)
    errors.push('only one line has a justified namespace exception');
  return errors;
}

describe('one optional producer-reader namespace exception', () => {
  it('pins the actual bridge to one reader and one public door with a named type', () => {
    expect(violations(source)).toEqual([]);
  });

  it('keeps the bridge clean under the real lint policy', async () => {
    expect((await eslint.lintText(source, { filePath: file }))[0].messages).toEqual([]);
  });

  it.each([
    ["import * as producer from 'footprintjs/trace';", "import * as producer from 'foottrace';"],
    ["Reflect.get(producer, 'readStoredCapture')", "Reflect.get(producer, 'controlDepRecorder')"],
    [
      'import type { readStoredCapture as DeclaredReader }',
      'import type { controlDepRecorder as DeclaredReader }',
    ],
    ['typeof DeclaredReader | undefined', 'unknown'],
  ])('rejects changing the actual bridge boundary: %s', (before, after) => {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(violations(changed).length).toBeGreaterThan(0);
  });

  it.each(['footprintjs', 'footprintjs/trace', 'foottrace', 'foottrace/cause'])(
    'retains the namespace fence in every ordinary source file for %s',
    async (door) => {
      const text = `import * as producer from '${door}'; export { producer };`;
      const messages = (
        await eslint.lintText(text, {
          filePath: resolve(root, 'src/trace-toolpack/causeContext.ts'),
        })
      )[0].messages;
      expect(
        messages.some(
          (message) => message.ruleId === 'no-restricted-syntax' && message.severity === 2,
        ),
      ).toBe(true);
    },
  );

  it('does not excuse a second namespace import in the bridge itself', async () => {
    const changed = source + "\nimport * as escaped from 'foottrace'; export { escaped };\n";
    const messages = (await eslint.lintText(changed, { filePath: file }))[0].messages;
    expect(
      messages.some(
        (message) => message.ruleId === 'no-restricted-syntax' && message.severity === 2,
      ),
    ).toBe(true);
    expect(violations(changed).length).toBeGreaterThan(0);
  });

  it.each([
    '\nexport const escaped = producer.controlDepRecorder;\n',
    '\nexport const escaped = producer["controlDepRecorder"];\n',
    '\nexport const { controlDepRecorder: escaped } = producer;\n',
  ])('refuses an additional namespace member read: %s', (extra) => {
    expect(violations(source + extra).length).toBeGreaterThan(0);
  });
});
