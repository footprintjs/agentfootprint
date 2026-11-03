import ts from 'typescript';
import {
  sourceInventory,
  loaderSpecifier,
  packageOf,
  type SourceText,
} from '../../architecture/sourceInventory.js';
export type { SourceText } from '../../architecture/sourceInventory.js';

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
  const sources = new Map(texts.map(({ file, text }) => [file, sourceInventory(file, text)]));
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  const imports = new Map<string, string>();
  for (const [file, source] of sources) {
    for (const node of source.declarations) declarations.set(`${file}#${node.name.text}`, node);
    for (const node of source.imports) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) continue;
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
        for (const element of binding.elements)
          imports.set(
            `${file}#${element.name.text}`,
            `${target}#${element.propertyName?.text ?? element.name.text}`,
          );
      }
    }
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
    for (const node of source.declarations) {
      if (!optionName.test(node.name.text)) continue;
      const members = resolve(file, ts.factory.createTypeReferenceNode(node.name.text));
      addMembers(file, node.name.text, members);
      optionShapes.push({ key: `${file}#${node.name.text}`, fields: [...members.keys()].sort() });
    }
    for (const node of source.functions) {
      if (
        !node.name ||
        !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      const type = node.parameters[0]?.type;
      if (
        type &&
        !(
          ts.isTypeReferenceNode(type) &&
          ts.isIdentifier(type.typeName) &&
          optionName.test(type.typeName.text)
        )
      )
        addMembers(file, node.name.text, resolve(file, type));
    }
    for (const node of source.classes) {
      if (
        !node.name ||
        !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      const constructor = node.members.find(ts.isConstructorDeclaration);
      const type = constructor?.parameters[0]?.type;
      if (
        type &&
        !(
          ts.isTypeReferenceNode(type) &&
          ts.isIdentifier(type.typeName) &&
          optionName.test(type.typeName.text)
        )
      )
        addMembers(file, node.name.text, resolve(file, type));
    }
    for (const site of source.loaders) {
      const specifier = loaderSpecifier(site, true);
      if (specifier === undefined) continue;
      const peer = packageOf(specifier);
      if (!optionalPeers.has(peer)) continue;
      const owner = site.owner;
      const name =
        owner && 'name' in owner && owner.name && ts.isIdentifier(owner.name as ts.Node)
          ? (owner.name as ts.Identifier).text
          : 'anonymous';
      add(file, `SDK(${name})`, peer);
    }
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
