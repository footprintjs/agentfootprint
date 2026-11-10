/** Derive this consumer's Foottrace surface from TypeScript source, including type-only imports. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function importedFoottrace(root = new URL('../src/', import.meta.url)) {
  const imports = [];
  const sideEffects = [];
  function walk(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      // Match the source build's src/**/*.test.ts exclusion: adjacent tests do not ship.
      else if (/\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        const source = ts.createSourceFile(
          filename,
          fs.readFileSync(filename, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node) {
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            /^foottrace(?:\/|$)/.test(node.moduleSpecifier.text)
          ) {
            const module = node.moduleSpecifier.text;
            if (ts.isImportDeclaration(node) && !node.importClause) {
              sideEffects.push({ module, filename });
              return;
            }
            const clause = ts.isImportDeclaration(node) ? node.importClause : node;
            const bindings = ts.isImportDeclaration(node)
              ? clause?.namedBindings
              : node.exportClause;
            if (
              !clause ||
              (ts.isImportDeclaration(node) && clause.name) ||
              !bindings ||
              (!ts.isNamedImports(bindings) && !ts.isNamedExports(bindings))
            )
              throw new Error(`Add contract coverage for non-named Foottrace import: ${filename}`);
            for (const binding of bindings.elements)
              imports.push({
                module,
                name: (binding.propertyName ?? binding.name).text,
                typeOnly: clause.isTypeOnly || binding.isTypeOnly || false,
                file: path.relative(fileURLToPath(new URL('..', import.meta.url)), filename),
              });
          }
          if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal) &&
            /^foottrace(?:\/|$)/.test(node.argument.literal.text)
          )
            throw new Error(
              `Add contract coverage for import-type Foottrace reference: ${filename}`,
            );
          if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            node.moduleReference.expression &&
            ts.isStringLiteral(node.moduleReference.expression) &&
            /^foottrace(?:\/|$)/.test(node.moduleReference.expression.text)
          )
            throw new Error(
              `Add contract coverage for import-equals Foottrace reference: ${filename}`,
            );
          if (
            ts.isCallExpression(node) &&
            node.arguments.some(
              (argument) =>
                ts.isStringLiteral(argument) && /^foottrace(?:\/|$)/.test(argument.text),
            )
          )
            throw new Error(`Add contract coverage for dynamic Foottrace import: ${filename}`);
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk(root instanceof URL ? fileURLToPath(root) : root);
  if (imports.length === 0)
    throw new Error(
      'No source Foottrace imports found; remove or revise this contract explicitly.',
    );
  // A bare load imports no symbols. Its module must still have named runtime
  // bindings, so the existing type and import/require behavior contracts cover it.
  for (const { module, filename } of sideEffects)
    if (!imports.some((item) => item.module === module && !item.typeOnly))
      throw new Error(
        `Add contract coverage for side-effect-only Foottrace module ${module}: ${filename}`,
      );
  return imports;
}
