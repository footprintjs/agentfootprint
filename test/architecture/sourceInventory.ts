import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface SourceText {
  readonly file: string;
  readonly text: string;
}
type Scope = ts.SourceFile | ts.Block;
interface Bindings {
  readonly bindings: Map<string, ts.Expression | undefined>;
  readonly constants: Map<string, ts.Expression | undefined>;
}
export interface LoaderSite {
  readonly node: ts.CallExpression;
  readonly kind: 'import' | 'require' | 'lazyRequire';
  readonly owner: ts.Node | undefined;
  readonly scopes: readonly Scope[];
}
export type ModuleEdge = (ts.ImportDeclaration | ts.ExportDeclaration) & {
  readonly moduleSpecifier: ts.StringLiteralLike;
};
export interface SourceInventory extends SourceText {
  readonly source: ts.SourceFile;
  readonly declarations: readonly (ts.InterfaceDeclaration | ts.TypeAliasDeclaration)[];
  readonly imports: readonly ts.ImportDeclaration[];
  readonly moduleEdges: readonly ModuleEdge[];
  readonly functions: readonly ts.FunctionDeclaration[];
  readonly classes: readonly ts.ClassDeclaration[];
  readonly loaders: readonly LoaderSite[];
}

// One cache per test process/module instance. No sharing across Vitest forks is assumed.
// Exact text keys keep synthetic fixtures and changed source versions independent.
const parsed = new Map<string, Map<string, SourceInventory>>();
const emitted = new WeakMap<SourceInventory, SourceInventory>();
const scopeBindings = new WeakMap<Scope, Bindings>();
const repositories = new Map<string, readonly SourceText[]>();
const indexedKinds = new Set([
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.ConstructorType,
  ts.SyntaxKind.JSDocFunctionType,
  ts.SyntaxKind.CallExpression,
]);

/** A repository snapshot is read once in this test process; fixtures pass their own exact text. */
export function repositorySources(root: string): readonly SourceText[] {
  const key = resolve(root);
  const cached = repositories.get(key);
  if (cached) return cached;
  const walk = (directory: string): SourceText[] =>
    readdirSync(resolve(key, directory), { withFileTypes: true }).flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return statSync(resolve(key, file)).isDirectory()
        ? walk(file)
        : file.endsWith('.ts')
        ? [{ file, text: readFileSync(resolve(key, file), 'utf8') }]
        : [];
    });
  const texts = walk('src');
  repositories.set(key, texts);
  return texts;
}

/** Parse once and build the indexes in one walk; loader ancestry needs no global parent pass. */
export function sourceInventory(file: string, text: string): SourceInventory {
  let versions = parsed.get(file);
  const cached = versions?.get(text);
  if (cached) return cached;
  if (!versions) {
    versions = new Map();
    parsed.set(file, versions);
  }
  // These syntax inventories consume explicit TS nodes, never JSDoc type/tag trees.
  // Keep the original text for candidate emission, whose type-elision rules stay unchanged.
  const source = ts.createSourceFile(
    file,
    text,
    {
      languageVersion: ts.ScriptTarget.ES2022,
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
    },
    false,
  );
  const declarations: (ts.InterfaceDeclaration | ts.TypeAliasDeclaration)[] = [];
  const imports: ts.ImportDeclaration[] = [];
  const moduleEdges: ModuleEdge[] = [];
  const functions: ts.FunctionDeclaration[] = [];
  const classes: ts.ClassDeclaration[] = [];
  const loaders: LoaderSite[] = [];
  const scopes: Scope[] = [];
  const owners: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    // Most nodes are identifiers/literals. They need traversal, not the declaration/scope dispatch.
    if (!indexedKinds.has(node.kind)) {
      ts.forEachChild(node, visit);
      return;
    }
    let isScope = false;
    let isOwner = false;
    switch (node.kind) {
      case ts.SyntaxKind.SourceFile:
      case ts.SyntaxKind.Block:
        scopes.push(node as Scope);
        isScope = true;
        break;
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        declarations.push(node as ts.InterfaceDeclaration | ts.TypeAliasDeclaration);
        break;
      case ts.SyntaxKind.ImportDeclaration: {
        const declaration = node as ts.ImportDeclaration;
        imports.push(declaration);
        if (ts.isStringLiteralLike(declaration.moduleSpecifier))
          moduleEdges.push(declaration as ModuleEdge);
        break;
      }
      case ts.SyntaxKind.ExportDeclaration: {
        const declaration = node as ts.ExportDeclaration;
        if (declaration.moduleSpecifier && ts.isStringLiteralLike(declaration.moduleSpecifier))
          moduleEdges.push(declaration as ModuleEdge);
        break;
      }
      case ts.SyntaxKind.ClassDeclaration:
        classes.push(node as ts.ClassDeclaration);
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        functions.push(node as ts.FunctionDeclaration);
        owners.push(node);
        isOwner = true;
        break;
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.MethodSignature:
      case ts.SyntaxKind.CallSignature:
      case ts.SyntaxKind.ConstructSignature:
      case ts.SyntaxKind.FunctionType:
      case ts.SyntaxKind.ConstructorType:
      case ts.SyntaxKind.JSDocFunctionType:
        owners.push(node);
        isOwner = true;
        break;
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        if (!call.arguments[0]) break;
        const kind =
          call.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'import'
            : ts.isIdentifier(call.expression) &&
              ['require', 'lazyRequire'].includes(call.expression.text)
            ? (call.expression.text as 'require' | 'lazyRequire')
            : undefined;
        if (kind) loaders.push({ node: call, kind, owner: owners.at(-1), scopes: [...scopes] });
        break;
      }
    }
    ts.forEachChild(node, visit);
    if (isOwner) owners.pop();
    if (isScope) scopes.pop();
  };
  visit(source);
  const inventory = {
    file,
    text,
    source,
    declarations,
    imports,
    moduleEdges,
    functions,
    classes,
    loaders,
  };
  versions.set(text, inventory);
  return inventory;
}

/** Preserve the two callers' existing literal/const-specifier rules without repeated scope walks. */
export function loaderSpecifier(site: LoaderSite, constOnly = false): string | undefined {
  const argument = site.node.arguments[0];
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (!ts.isIdentifier(argument)) return undefined;
  for (let index = site.scopes.length - 1; index >= 0; index--) {
    const scope = site.scopes[index]!;
    let indexed = scopeBindings.get(scope);
    if (!indexed) {
      indexed = { bindings: new Map(), constants: new Map() };
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const name = declaration.name.text;
          if (!indexed.bindings.has(name)) indexed.bindings.set(name, declaration.initializer);
          if (
            (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
            !indexed.constants.has(name)
          )
            indexed.constants.set(name, declaration.initializer);
        }
      }
      scopeBindings.set(scope, indexed);
    }
    const bindings = constOnly ? indexed.constants : indexed.bindings;
    if (!bindings.has(argument.text)) continue;
    const initializer = bindings.get(argument.text);
    if (constOnly && !initializer) continue;
    return initializer && ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
  }
  return undefined;
}

export function packageOf(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

/** Only static optional-SDK candidates need emission to decide type-only elision. */
export function runtimeSdkEdges(
  inventory: SourceInventory,
  peers: ReadonlySet<string>,
): readonly ModuleEdge[] {
  if (!inventory.moduleEdges.some((edge) => peers.has(packageOf(edge.moduleSpecifier.text))))
    return [];
  let compiled = emitted.get(inventory);
  if (!compiled) {
    compiled = sourceInventory(
      inventory.file,
      ts.transpileModule(inventory.text, {
        fileName: inventory.file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
    emitted.set(inventory, compiled);
  }
  return compiled.moduleEdges.filter((edge) => peers.has(packageOf(edge.moduleSpecifier.text)));
}
