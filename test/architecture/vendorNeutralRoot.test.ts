/** The public root must stay outside every vendor implementation, transitively. */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sourceInventory,
  repositorySources,
  loaderSpecifier,
  packageOf,
  runtimeSdkEdges,
} from './sourceInventory.js';

import {
  constructionInventory,
  uncoveredConstructionCandidates,
} from '../adapters/construction/sourceCoverage.js';
import {
  constructionBehaviorKeys,
  constructionSourceExclusions,
  constructionOptionShapes,
} from '../adapters/construction/sourceCoverageRegistry.js';

const ROOT = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

/** Both architecture laws consume the same memoized parse and loader-scope inventory. */
function sdkLoadViolations(file: string, text: string, peers: ReadonlySet<string>): string[] {
  const inventory = sourceInventory(file, text);
  const violations: string[] = [];
  for (const site of inventory.loaders) {
    const specifier = loaderSpecifier(site);
    if (specifier === undefined || !peers.has(packageOf(specifier))) continue;
    if (site.kind === 'require' || !site.owner)
      violations.push(
        `${file}: SDK loads must use function-scoped lazyRequire(...) or import(...): ${specifier}`,
      );
  }
  for (const edge of runtimeSdkEdges(inventory, peers))
    violations.push(`${file}: static SDK import ${edge.moduleSpecifier.text}`);
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
    const violations = repositorySources(ROOT)
      .filter(({ file }) => !file.endsWith('.d.ts'))
      .flatMap(({ file, text }) => sdkLoadViolations(file, text, optionalPeers));
    expect(violations).toEqual([]);
  }, 30_000);

  it('joins SDK and injected-handle candidates to behavioral cases or exact reason exclusions', () => {
    const inventory = constructionInventory(repositorySources(ROOT), optionalPeers);
    const { candidates } = inventory;
    const uncovered = uncoveredConstructionCandidates(
      candidates,
      constructionBehaviorKeys,
      constructionSourceExclusions,
    );
    expect(uncovered, `Missing construction coverage:\n${uncovered.join('\n')}`).toEqual([]);
    const discovered = new Set(candidates.map(({ key }) => key));
    expect(constructionBehaviorKeys.filter((key) => !discovered.has(key))).toEqual([]);
    expect(constructionSourceExclusions.filter(({ key }) => !discovered.has(key))).toEqual([]);
    const optionDeclarations = [
      ...new Set(
        constructionBehaviorKeys
          .filter((key) => !key.includes('#SDK('))
          .map((key) => key.slice(0, key.lastIndexOf('.'))),
      ),
    ].sort();
    expect(constructionOptionShapes.map(({ key }) => key).sort()).toEqual(optionDeclarations);
    for (const shape of constructionOptionShapes) {
      const actual = inventory.optionShapes.find(({ key }) => key === shape.key);
      expect(actual, `Missing public option shape: ${shape.key}`).toBeDefined();
      expect(
        actual?.fields,
        `Unreviewed option change on ${shape.key}; classify construction vs operation before updating the registry`,
      ).toEqual(shape.fields);
    }
  });
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
