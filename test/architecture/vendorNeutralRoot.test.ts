/** The public root must stay outside every vendor implementation, transitively. */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import layering from '../../scripts/layering.config.cjs';

const ROOT = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

function packageOf(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

/** Include existing ESM loaders that bind `const spec = 'sdk'; import(spec)`. */
function literalSpecifier(argument: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (!ts.isIdentifier(argument)) return undefined;
  let scope: ts.Node | undefined = argument.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === argument.text) {
            return declaration.initializer && ts.isStringLiteralLike(declaration.initializer)
              ? declaration.initializer.text
              : undefined;
          }
        }
      }
    }
    scope = scope.parent;
  }
  return undefined;
}

describe('vendor-neutral root entry', () => {
  it('reaches no adapter implementation, even through another barrel or an alias', async () => {
    const { metafile } = await build({
      absWorkingDir: ROOT,
      entryPoints: ['src/index.ts'],
      bundle: true,
      treeShaking: false,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
    });
    const files = Object.keys(metafile.inputs);
    expect(files).toContain('src/core/Agent.ts');
    expect(files).toContain('src/artifacts/inMemoryArtifacts.ts');
    expect(files).toContain('src/artifacts/fileArtifacts.ts');
    expect(files).toContain('src/artifacts/sqliteArtifacts.ts');
    expect(
      files.filter((file) =>
        /(?:^src\/adapters\/|^src\/embedders\/|^src\/artifacts\/(?:s3|gcs)Artifacts\.ts$)/.test(
          file,
        ),
      ),
      'Vendor implementations belong behind a package subpath, including when re-exported indirectly.',
    ).toEqual([]);
    const optionalImports = Object.entries(metafile.inputs).flatMap(([from, input]) =>
      input.imports
        .filter((edge) => edge.external && pkg.peerDependenciesMeta[packageOf(edge.path)]?.optional)
        .map((edge) => `${from}: ${edge.path}`),
    );
    expect(optionalImports, 'The root must not statically load an optional SDK.').toEqual([]);
  });

  it('declares every vendor SDK peer optional', () => {
    const sdkPeers = Object.keys(pkg.peerDependencies).filter((name) => name !== 'footprintjs');
    expect(sdkPeers).toContain('@aws-sdk/client-s3');
    expect(sdkPeers).toContain('@google-cloud/storage');
    expect(sdkPeers.filter((name) => pkg.peerDependenciesMeta[name]?.optional !== true)).toEqual(
      [],
    );
  });

  it('has no static SDK imports, and SDK loads use function-scoped lazyRequire or import', () => {
    const violations: string[] = [];
    const peers = new Set(
      Object.keys(pkg.peerDependenciesMeta).filter(
        (name) => pkg.peerDependenciesMeta[name]?.optional,
      ),
    );
    for (const file of layering.listSourceFiles(ROOT) as string[]) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      const compiled = ts.createSourceFile(
        file,
        ts.transpileModule(text, {
          fileName: file,
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        ts.ScriptTarget.ES2022,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteralLike(node.moduleSpecifier) &&
          peers.has(packageOf(node.moduleSpecifier.text))
        ) {
          violations.push(`${file}: static SDK import ${node.moduleSpecifier.text}`);
        }
        const specifier =
          ts.isCallExpression(node) && node.arguments[0]
            ? literalSpecifier(node.arguments[0])
            : undefined;
        if (
          ts.isCallExpression(node) &&
          specifier !== undefined &&
          peers.has(packageOf(specifier)) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              ['require', 'lazyRequire'].includes(node.expression.text)))
        ) {
          let parent: ts.Node | undefined = node.parent;
          while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
          const lazy =
            node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'lazyRequire');
          if (!lazy || !parent) {
            violations.push(
              `${file}: SDK loads must use function-scoped lazyRequire(...) or import(...): ${specifier}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(compiled);
    }
    expect(violations).toEqual([]);
  }, 30_000);
});
