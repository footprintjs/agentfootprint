import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { METHODS } from './methods.mjs';
import { unwrap, expression } from './syntax.mjs';
const methods = new Set(Object.keys(METHODS));
export function createBindings(checker) {
  const packageNames = new Map();
  function packageName(file) {
    if (packageNames.has(file)) return packageNames.get(file);
    let directory = path.dirname(file);
    let name;
    for (;;) {
      const filename = path.join(directory, 'package.json');
      if (existsSync(filename)) {
        const metadata = JSON.parse(readFileSync(filename, 'utf8'));
        if (typeof metadata.name === 'string') {
          name = metadata.name;
          break;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    packageNames.set(file, name);
    return name;
  }

  function declarationOf(node) {
    const point = ts.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = checker.getSymbolAtLocation(point);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }

  function engineMethod(declaration) {
    const name = declaration?.name?.getText();
    return methods.has(name) &&
      declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/lib/builder/') &&
      packageName(declaration.getSourceFile().fileName) === 'footprintjs'
      ? name
      : undefined;
  }

  // .bind and conditional local aliases keep their alternatives; no resolver is called.
  function choices(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return undefined;
    const next = new Set(seen).add(node);
    if (ts.isConditionalExpression(node)) {
      const yes = choices(node.whenTrue, next),
        no = choices(node.whenFalse, next);
      if (!yes && !no) return undefined;
      return {
        methods: [...new Set([...(yes?.methods ?? []), ...(no?.methods ?? [])])].sort(),
        engine: Boolean(yes?.engine && no?.engine),
        partiallyBound: Boolean(yes?.partiallyBound || no?.partiallyBound),
        context: [
          `method selected by (${expression(node.condition)})`,
          ...(yes?.context ?? []),
          ...(no?.context ?? []),
        ],
      };
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind'
    ) {
      const target = choices(node.expression.expression, next);
      if (!target) return undefined;
      const partial = node.arguments.length > 1 || node.arguments.some(ts.isSpreadElement);
      return {
        ...target,
        partiallyBound: Boolean(target.partiallyBound || partial),
        context: [
          ...target.context,
          ...(partial ? ['partially bound or spread arguments; values not inferred'] : []),
        ],
      };
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return choices(declaration.initializer, next);
      }
    }
    const signatures = checker.getTypeAtLocation(node).getCallSignatures();
    const names = signatures
      .map((signature) => engineMethod(signature.declaration))
      .filter(Boolean);
    return names.length
      ? {
          methods: [...new Set(names)].sort(),
          engine: names.length === signatures.length,
          context: [],
        }
      : undefined;
  }

  return { packageName, declarationOf, engineMethod, choices };
}
