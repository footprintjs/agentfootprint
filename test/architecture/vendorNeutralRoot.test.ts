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

/** Parse call scopes once; only potential static SDK edges need TypeScript's type elision. */
function sdkLoadViolations(file: string, text: string, peers: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const isStaticSdkEdge = (
    node: ts.Node,
  ): node is (ts.ImportDeclaration | ts.ExportDeclaration) & {
    moduleSpecifier: ts.StringLiteralLike;
  } =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier) &&
    peers.has(packageOf(node.moduleSpecifier.text));
  let hasStaticSdkCandidate = false;
  const visit = (node: ts.Node): void => {
    if (isStaticSdkEdge(node)) hasStaticSdkCandidate = true;
    // ImportTypeNode (typeof import('sdk'), for example) is not a runtime call.
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
  visit(source);
  if (hasStaticSdkCandidate) {
    // Explicit and inferred type-only imports can disappear from emitted JS.
    // Compile the whole candidate file so usage, rather than syntax alone, decides.
    const compiled = ts.createSourceFile(
      file,
      ts.transpileModule(text, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      ts.ScriptTarget.ES2022,
      true,
    );
    const visitStaticEdges = (node: ts.Node): void => {
      if (isStaticSdkEdge(node)) {
        violations.push(`${file}: static SDK import ${node.moduleSpecifier.text}`);
      }
      ts.forEachChild(node, visitStaticEdges);
    };
    visitStaticEdges(compiled);
  }
  return violations;
}

const optionalPeers = new Set(
  Object.keys(pkg.peerDependenciesMeta).filter((name) => pkg.peerDependenciesMeta[name]?.optional),
);

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
    const violations = (layering.listSourceFiles(ROOT) as string[]).flatMap((file) =>
      sdkLoadViolations(file, readFileSync(resolve(ROOT, file), 'utf8'), optionalPeers),
    );
    expect(violations).toEqual([]);
  }, 30_000);
});

describe('SDK load scanner behavior', () => {
  const staticError = 'fixture.ts: static SDK import @aws-sdk/client-s3';
  const timingError =
    'fixture.ts: SDK loads must use function-scoped lazyRequire(...) or import(...): @aws-sdk/client-s3';
  it.each([
    {
      name: 'side-effect import refuses',
      text: "import '@aws-sdk/client-s3';",
      errors: [staticError],
    },
    {
      name: 'used value import refuses',
      text: "import { S3Client } from '@aws-sdk/client-s3'; console.log(S3Client);",
      errors: [staticError],
    },
    {
      name: 'value re-export refuses',
      text: "export { S3Client } from '@aws-sdk/client-s3';",
      errors: [staticError],
    },
    {
      name: 'star re-export refuses',
      text: "export * from '@aws-sdk/client-s3';",
      errors: [staticError],
    },
    {
      name: 'explicit type-only import is erased',
      text: "import type { S3Client } from '@aws-sdk/client-s3'; export type Client = S3Client;",
      errors: [],
    },
    {
      name: 'unannotated import used only as a type is erased',
      text: "import { S3Client } from '@aws-sdk/client-s3'; export type Client = S3Client;",
      errors: [],
    },
    {
      name: 'type-only re-export is erased',
      text: "export type { S3Client } from '@aws-sdk/client-s3';",
      errors: [],
    },
    {
      name: 'inline type-only re-export is erased',
      text: "export { type S3Client } from '@aws-sdk/client-s3';",
      errors: [],
    },
    {
      name: 'import type query is not a runtime load',
      text: "export type SDK = typeof import('@aws-sdk/client-s3');",
      errors: [],
    },
    {
      name: 'top-level lazyRequire refuses',
      text: "const sdk = lazyRequire('@aws-sdk/client-s3');",
      errors: [timingError],
    },
    {
      name: 'top-level dynamic import refuses',
      text: "const sdk = import('@aws-sdk/client-s3');",
      errors: [timingError],
    },
    {
      name: 'top-level const-specifier lazyRequire refuses',
      text: "const spec = '@aws-sdk/client-s3'; const sdk = lazyRequire(spec);",
      errors: [timingError],
    },
    {
      name: 'top-level const-specifier dynamic import refuses',
      text: "const spec = '@aws-sdk/client-s3'; const sdk = import(spec);",
      errors: [timingError],
    },
    {
      name: 'function-scoped require refuses',
      text: "function load() { return require('@aws-sdk/client-s3'); }",
      errors: [timingError],
    },
    {
      name: 'function-scoped lazyRequire accepts',
      text: "function load() { return lazyRequire('@aws-sdk/client-s3'); }",
      errors: [],
    },
    {
      name: 'function-scoped dynamic import accepts',
      text: "function load() { return import('@aws-sdk/client-s3'); }",
      errors: [],
    },
    {
      name: 'function-scoped const-specifier lazyRequire accepts',
      text: "function load() { const spec = '@aws-sdk/client-s3'; return lazyRequire(spec); }",
      errors: [],
    },
    {
      name: 'function-scoped const-specifier dynamic import accepts',
      text: "function load() { const spec = '@aws-sdk/client-s3'; return import(spec); }",
      errors: [],
    },
  ])('$name', ({ text, errors }) => {
    expect(sdkLoadViolations('fixture.ts', text, optionalPeers)).toEqual(errors);
  });
});
