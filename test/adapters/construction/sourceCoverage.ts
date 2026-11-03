import ts from 'typescript';

export interface SourceText {
  readonly file: string;
  readonly text: string;
}
export interface SourceCandidate {
  readonly key: string;
  readonly file: string;
  readonly declaration: string;
  readonly field: string;
}
export interface CoverageEntry {
  readonly key: string;
  readonly reason?: string;
}
export interface SourceOptionShape {
  readonly key: string;
  readonly fields: readonly string[];
}

const handleNames = new Set([
  'client',
  'storage',
  'server',
  'tracer',
  'backend',
  'credential',
  'connection',
  'transport',
  'provider',
  'firestore',
  'auth',
  'fetch',
  'sdk',
]);
const optionName = /(?:Options|Config|Configuration|Connection|Settings)$/;
type Members = ReadonlyMap<string, ts.TypeNode>;

/** Structural inventory, not a type checker or proof of arbitrary runtime option semantics. */
export function constructionInventory(
  texts: readonly SourceText[],
  optionalPeers: ReadonlySet<string>,
): {
  readonly candidates: readonly SourceCandidate[];
  readonly optionShapes: readonly SourceOptionShape[];
} {
  const sources = new Map(
    texts.map(({ file, text }) => [
      file,
      ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true),
    ]),
  );
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  const imports = new Map<string, string>();
  for (const [file, source] of sources) {
    const index = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        declarations.set(`${file}#${node.name.text}`, node);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const binding = node.importClause?.namedBindings;
        if (specifier.startsWith('.') && binding && ts.isNamedImports(binding)) {
          const parts = file.split('/');
          parts.pop();
          for (const part of specifier.split('/')) {
            if (part === '..') parts.pop();
            else if (part !== '.') parts.push(part);
          }
          const target = parts.join('/').replace(/\.js$/, '.ts');
          for (const element of binding.elements) {
            imports.set(
              `${file}#${element.name.text}`,
              `${target}#${element.propertyName?.text ?? element.name.text}`,
            );
          }
        }
      }
      ts.forEachChild(node, index);
    };
    index(source);
  }

  const resolve = (
    file: string,
    node: ts.TypeNode,
    seen: ReadonlySet<string> = new Set(),
  ): Members => {
    const members = new Map<string, ts.TypeNode>();
    const merge = (other: Members): void => {
      for (const [key, type] of other) members.set(key, type);
    };
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (
          ts.isPropertySignature(member) &&
          member.type &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        ) {
          members.set(member.name.text, member.type);
        }
      }
    } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const type of node.types) merge(resolve(file, type, seen));
    } else if (ts.isParenthesizedTypeNode(node)) {
      merge(resolve(file, node.type, seen));
    } else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      const first = node.typeArguments?.[0];
      if (first && ['Readonly', 'Partial', 'Required', 'Omit', 'Pick'].includes(name)) {
        merge(resolve(file, first, seen));
        if (name === 'Omit' || name === 'Pick') {
          const keys = node.typeArguments?.[1];
          const types = keys && ts.isUnionTypeNode(keys) ? keys.types : keys ? [keys] : [];
          const selected = new Set(
            types.flatMap((type) =>
              ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
                ? [type.literal.text]
                : [],
            ),
          );
          for (const key of members.keys()) {
            if ((name === 'Omit') === selected.has(key)) members.delete(key);
          }
        }
      } else {
        const key = imports.get(`${file}#${name}`) ?? `${file}#${name}`;
        if (!seen.has(key)) {
          const nextSeen = new Set([...seen, key]);
          const declaration = declarations.get(key);
          if (declaration) {
            const targetFile = key.slice(0, key.indexOf('#'));
            if (ts.isTypeAliasDeclaration(declaration))
              merge(resolve(targetFile, declaration.type, nextSeen));
            else {
              for (const clause of declaration.heritageClauses ?? []) {
                for (const parent of clause.types) {
                  if (ts.isIdentifier(parent.expression)) {
                    merge(
                      resolve(
                        targetFile,
                        ts.factory.createTypeReferenceNode(
                          parent.expression.text,
                          parent.typeArguments,
                        ),
                        nextSeen,
                      ),
                    );
                  }
                }
              }
              for (const member of declaration.members) {
                if (
                  ts.isPropertySignature(member) &&
                  member.type &&
                  (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
                ) {
                  members.set(member.name.text, member.type);
                }
              }
            }
          }
        }
      }
    }
    return members;
  };

  const result = new Map<string, SourceCandidate>();
  const optionShapes: SourceOptionShape[] = [];
  const add = (file: string, declaration: string, field: string): void => {
    const key = `${file}#${declaration}.${field}`;
    result.set(key, { key, file, declaration, field });
  };
  const addMembers = (file: string, name: string, members: Members): void => {
    for (const [field, type] of members) {
      if (
        !handleNames.has(field) &&
        !/^_(?:client|server|storage|credential|sdk|pg|fetch|fs|sqlite|open|otelApi|childProcess|commands|auth)$/.test(
          field,
        )
      )
        continue;
      if (
        [
          ts.SyntaxKind.UndefinedKeyword,
          ts.SyntaxKind.BooleanKeyword,
          ts.SyntaxKind.StringKeyword,
          ts.SyntaxKind.NumberKeyword,
          ts.SyntaxKind.NeverKeyword,
        ].includes(type.kind) ||
        ts.isLiteralTypeNode(type)
      )
        continue;
      add(file, name, field);
    }
  };
  for (const [file, source] of sources) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        optionName.test(node.name.text)
      ) {
        const members = resolve(file, ts.factory.createTypeReferenceNode(node.name.text));
        addMembers(file, node.name.text, members);
        optionShapes.push({ key: `${file}#${node.name.text}`, fields: [...members.keys()].sort() });
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const type = node.parameters[0]?.type;
        // Named Options declarations are inventoried once above, including inheritance/aliases.
        if (
          type &&
          !(
            ts.isTypeReferenceNode(type) &&
            ts.isIdentifier(type.typeName) &&
            optionName.test(type.typeName.text)
          )
        ) {
          addMembers(file, node.name.text, resolve(file, type));
        }
      }
      if (
        ts.isClassDeclaration(node) &&
        node.name &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const constructor = node.members.find(ts.isConstructorDeclaration);
        const type = constructor?.parameters[0]?.type;
        if (
          type &&
          !(
            ts.isTypeReferenceNode(type) &&
            ts.isIdentifier(type.typeName) &&
            optionName.test(type.typeName.text)
          )
        ) {
          addMembers(file, node.name.text, resolve(file, type));
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            ['require', 'lazyRequire'].includes(node.expression.text)))
      ) {
        let argument = node.arguments[0];
        if (ts.isIdentifier(argument)) {
          const name = argument.text;
          let parent: ts.Node | undefined = node.parent;
          while (parent) {
            if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
              const declaration = parent.statements
                .flatMap((statement) =>
                  ts.isVariableStatement(statement) &&
                  (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
                    ? [...statement.declarationList.declarations]
                    : [],
                )
                .find(
                  (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
                );
              if (declaration?.initializer) {
                argument = declaration.initializer;
                break;
              }
            }
            parent = parent.parent;
          }
        }
        if (ts.isStringLiteralLike(argument)) {
          const peer = argument.text
            .split('/')
            .slice(0, argument.text.startsWith('@') ? 2 : 1)
            .join('/');
          if (optionalPeers.has(peer)) {
            let owner: ts.Node | undefined = node.parent;
            while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
            const name =
              owner && 'name' in owner && owner.name && ts.isIdentifier(owner.name as ts.Node)
                ? (owner.name as ts.Identifier).text
                : 'anonymous';
            add(file, `SDK(${name})`, peer);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {
    candidates: [...result.values()].sort((left, right) => left.key.localeCompare(right.key)),
    optionShapes: optionShapes.sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export function constructionCandidates(
  texts: readonly SourceText[],
  optionalPeers: ReadonlySet<string>,
): readonly SourceCandidate[] {
  return constructionInventory(texts, optionalPeers).candidates;
}

export function uncoveredConstructionCandidates(
  candidates: readonly SourceCandidate[],
  behaviorKeys: readonly string[],
  exclusions: readonly CoverageEntry[],
): readonly string[] {
  const covered = new Set(behaviorKeys);
  for (const exclusion of exclusions) {
    if (exclusion.reason?.trim()) covered.add(exclusion.key);
  }
  return candidates.filter(({ key }) => !covered.has(key)).map(({ key }) => key);
}
