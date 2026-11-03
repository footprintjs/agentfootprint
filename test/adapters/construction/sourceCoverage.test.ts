import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  constructionBehaviorKeys,
  constructionRegistry,
  constructionSourceExclusions,
  constructionOptionShapes,
} from './registry.js';
import {
  constructionCandidates,
  constructionInventory,
  uncoveredConstructionCandidates,
} from './sourceCoverage.js';

const ROOT = resolve(__dirname, '../../..');
function files(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
  });
}
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const optionalPeers = new Set(
  Object.entries(pkg.peerDependenciesMeta)
    .filter(([, metadata]) => metadata.optional)
    .map(([name]) => name),
);

describe('construction inventory coverage', () => {
  // Whole-tree parsing measured 13.8s under hosted V8 coverage and 4.6s locally.
  // Match the other architecture scan’s bounded 30s; small fixtures keep defaults.
  it('joins SDK and injected-handle candidates to behavioral cases or exact reason exclusions', () => {
    const inventory = constructionInventory(
      files('src').map((file) => ({
        file,
        text: readFileSync(resolve(ROOT, file), 'utf8'),
      })),
      optionalPeers,
    );
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
    for (const key of constructionBehaviorKeys) {
      const [file, declaration] = key.split('#');
      const field = declaration!.split('.').at(-1);
      expect(
        constructionRegistry.some(
          (entry) =>
            entry.source === file && (declaration!.startsWith('SDK(') || entry.handleKey === field),
        ),
        key,
      ).toBe(true);
    }
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
  }, 30_000);

  const discover = (text: string) =>
    constructionCandidates([{ file: 'src/newAdapter.ts', text }], new Set(['vendor-sdk']));
  it('names a newly introduced adapter with no battery case', () => {
    const candidates = discover(
      'export interface NewAdapterOptions { client?: VendorClient; region?: string }',
    );
    expect(uncoveredConstructionCandidates(candidates, [], [])).toEqual([
      'src/newAdapter.ts#NewAdapterOptions.client',
    ]);
  });
  it('requires a separate registration for a sibling or a second handle in the same file', () => {
    const candidates = discover(`
      export interface KnownOptions { client?: VendorClient; server?: VendorServer }
      export interface SiblingOptions { client?: VendorClient }
    `);
    expect(
      uncoveredConstructionCandidates(candidates, ['src/newAdapter.ts#KnownOptions.client'], []),
    ).toEqual(['src/newAdapter.ts#KnownOptions.server', 'src/newAdapter.ts#SiblingOptions.client']);
  });
  it('records a newly added option on an already registered public-handle type', () => {
    const base = constructionInventory(
      [
        {
          file: 'src/redis.ts',
          text: 'export interface RedisStoreOptions { client?: Client; url?: string }',
        },
      ],
      new Set(),
    );
    const changed = constructionInventory(
      [
        {
          file: 'src/redis.ts',
          text: 'export interface RedisStoreOptions { client?: Client; url?: string; tls?: boolean }',
        },
      ],
      new Set(),
    );
    expect(base.optionShapes[0]?.fields).toEqual(['client', 'url']);
    expect(changed.optionShapes[0]?.fields).toEqual(['client', 'tls', 'url']);
    expect(changed.optionShapes).not.toEqual(base.optionShapes);
  });
  it('admits an exact covered handle or a documented exclusion, never a reasonless waiver', () => {
    const candidates = discover(
      'export interface NewAdapterOptions { client?: VendorClient; _sdk?: VendorSdk }',
    );
    expect(
      uncoveredConstructionCandidates(
        candidates,
        ['src/newAdapter.ts#NewAdapterOptions.client'],
        [
          {
            key: 'src/newAdapter.ts#NewAdapterOptions._sdk',
            reason: 'Module injection still constructs the configured client.',
          },
        ],
      ),
    ).toEqual([]);
    expect(
      uncoveredConstructionCandidates(
        candidates,
        [],
        [{ key: 'src/newAdapter.ts#NewAdapterOptions.client', reason: '' }],
      ),
    ).toContain('src/newAdapter.ts#NewAdapterOptions.client');
  });
  it('follows inherited and aliased configuration fields, including imported parents', () => {
    const candidates = constructionCandidates(
      [
        {
          file: 'src/base.ts',
          text: 'export interface BaseOptions { client?: VendorClient; _sdk?: VendorSdk }',
        },
        {
          file: 'src/newAdapter.ts',
          text: `import type { BaseOptions as Imported } from './base.js';
        export interface NewAdapterOptions extends Imported { region?: string }
        export type AliasOptions = Readonly<Omit<NewAdapterOptions, '_sdk'>>;`,
        },
      ],
      new Set(),
    );
    const keys = candidates.map(({ key }) => key);
    expect(keys).toContain('src/newAdapter.ts#NewAdapterOptions.client');
    expect(keys).toContain('src/newAdapter.ts#NewAdapterOptions._sdk');
    expect(keys).toContain('src/newAdapter.ts#AliasOptions.client');
    expect(keys).not.toContain('src/newAdapter.ts#AliasOptions._sdk');
  });
  it('discovers inline factory/constructor handles and runtime SDK loads while ignoring type imports', () => {
    const candidates = discover(`
      type Sdk = typeof import('vendor-sdk');
      export function createNew(options: { client?: VendorClient }) { return options.client; }
      export class AnotherAdapter { constructor(options: { server?: VendorServer }) {} }
      function load() { const spec = 'vendor-sdk'; return import(spec); }
    `);
    expect(candidates.map(({ key }) => key)).toEqual([
      'src/newAdapter.ts#AnotherAdapter.server',
      'src/newAdapter.ts#createNew.client',
      'src/newAdapter.ts#SDK(load).vendor-sdk',
    ]);
  });
});
