import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { productionSources } from './productionSources.js';

/**
 * Read declared port ancestry, not function bodies or member-type dependencies.
 * A full TypeScript Program pulls the agent/provider graph into this small census.
 */
function sessionPortDeclarations(portFile: string) {
  const sources = new Map<string, ts.SourceFile>();
  const known = new Set<string>();
  const visiting = new Set<string>();
  const options = { moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const canonical = resolve(portFile);

  function source(file: string): ts.SourceFile {
    let parsed = sources.get(file);
    if (!parsed) {
      parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
      sources.set(file, parsed);
    }
    return parsed;
  }

  function imported(file: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    return target && resolve(target.resolvedFileName);
  }

  function visit(key: string, read: () => boolean): boolean {
    if (known.has(key)) return true;
    if (visiting.has(key)) return false;
    visiting.add(key);
    try {
      const found = read();
      if (found) known.add(key);
      return found;
    } finally {
      visiting.delete(key);
    }
  }

  function exported(file: string, name: string): boolean {
    return visit(`export\0${file}\0${name}`, () => {
      const stars: string[] = [];
      // Explicit exports shadow export-star bindings, regardless of source order.
      for (const node of source(file).statements) {
        if (
          (ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isClassDeclaration(node)) &&
          node.name &&
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
          (node.name.text === name ||
            (name === 'default' &&
              node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)))
        )
          return local(file, node.name.text);
        if (!ts.isExportDeclaration(node)) continue;
        const specifier =
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          const binding = node.exportClause.elements.find((item) => item.name.text === name);
          if (!binding) continue;
          const original = (binding.propertyName ?? binding.name).text;
          const target = specifier && imported(file, specifier);
          return specifier ? (target ? exported(target, original) : false) : local(file, original);
        }
        if (!node.exportClause && specifier) stars.push(specifier);
      }
      if (name === 'default') return false;
      return stars.some((specifier) => {
        const target = imported(file, specifier);
        return target ? exported(target, name) : false;
      });
    });
  }

  function local(file: string, name: string): boolean {
    return visit(`local\0${file}\0${name}`, () => {
      const declarations = source(file).statements.filter(
        (node): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration =>
          (ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isClassDeclaration(node)) &&
          node.name?.text === name,
      );
      if (declarations.length > 0) {
        return declarations.some((node) => {
          if (file === canonical && ts.isInterfaceDeclaration(node) && name === 'SessionLifecycle')
            return true;
          const shadowed = new Set(node.typeParameters?.map((parameter) => parameter.name.text));
          if (ts.isTypeAliasDeclaration(node)) return hasPort(file, node.type, shadowed);
          return (
            node.heritageClauses?.some((clause) =>
              clause.types.some((base) => entity(file, base.expression, shadowed)),
            ) ?? false
          );
        });
      }
      for (const node of source(file).statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const bindings = node.importClause?.namedBindings;
        const binding =
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.find((item) => item.name.text === name)
            : undefined;
        const original = binding
          ? (binding.propertyName ?? binding.name).text
          : node.importClause?.name?.text === name
          ? 'default'
          : undefined;
        if (original === undefined) continue;
        const target = imported(file, node.moduleSpecifier.text);
        return target ? exported(target, original) : false;
      }
      return false;
    });
  }

  function entity(
    file: string,
    name: ts.EntityName | ts.Expression,
    shadowed: ReadonlySet<string> = new Set(),
  ): boolean {
    if (ts.isIdentifier(name)) return !shadowed.has(name.text) && local(file, name.text);
    const left = ts.isQualifiedName(name)
      ? name.left
      : ts.isPropertyAccessExpression(name)
      ? name.expression
      : undefined;
    const right = ts.isQualifiedName(name)
      ? name.right
      : ts.isPropertyAccessExpression(name)
      ? name.name
      : undefined;
    if (!left || !ts.isIdentifier(left) || !right || shadowed.has(left.text)) return false;
    for (const node of source(file).statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const binding = node.importClause?.namedBindings;
      if (!binding || !ts.isNamespaceImport(binding) || binding.name.text !== left.text) continue;
      const target = imported(file, node.moduleSpecifier.text);
      return target ? exported(target, right.text) : false;
    }
    return false;
  }

  function hasPort(
    file: string,
    type: ts.TypeNode,
    shadowed: ReadonlySet<string> = new Set(),
  ): boolean {
    if (ts.isTypeReferenceNode(type)) return entity(file, type.typeName, shadowed);
    if (ts.isParenthesizedTypeNode(type)) return hasPort(file, type.type, shadowed);
    if (ts.isUnionTypeNode(type)) return type.types.every((part) => hasPort(file, part, shadowed));
    if (
      ts.isImportTypeNode(type) &&
      ts.isLiteralTypeNode(type.argument) &&
      ts.isStringLiteral(type.argument.literal) &&
      type.qualifier &&
      ts.isIdentifier(type.qualifier)
    ) {
      const target = imported(file, type.argument.literal.text);
      return target ? exported(target, type.qualifier.text) : false;
    }
    return false;
  }

  if (
    !source(canonical).statements.some(
      (node) => ts.isInterfaceDeclaration(node) && node.name.text === 'SessionLifecycle',
    )
  ) {
    throw new Error(`SessionLifecycle declaration not found in ${portFile}`);
  }
  return { source, hasPort };
}

/** Named exported functions returning the declared port or a derived/aliased port. */
export function sessionStoreFactories(roots: readonly string[], portFile: string): Set<string> {
  const declarations = sessionPortDeclarations(portFile);
  const factories = new Map<string, string>();
  for (const path of roots.flatMap(productionSources)) {
    const file = resolve(path);
    for (const node of declarations.source(file).statements) {
      if (
        !ts.isFunctionDeclaration(node) ||
        !node.name ||
        !node.type ||
        !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      const shadowed = new Set(node.typeParameters?.map((parameter) => parameter.name.text));
      if (!declarations.hasPort(file, node.type, shadowed)) continue;
      const owner = factories.get(node.name.text);
      if (owner !== undefined && owner !== file) {
        throw new Error(
          `Multiple session-store factories named ${node.name.text}: ${owner}, ${file}`,
        );
      }
      factories.set(node.name.text, file);
    }
  }
  return new Set(factories.keys());
}

/** Names come from the actual harness factory references, never source comments. */
export function assertEnrolledSessionStores(
  factories: ReadonlySet<string>,
  enrolled: readonly string[],
): void {
  if (factories.size === 0) throw new Error('The session-store factory scan found nothing.');
  const missing = [...factories].filter((name) => !enrolled.includes(name));
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} ships and is not enrolled in the battery`);
  }
}
