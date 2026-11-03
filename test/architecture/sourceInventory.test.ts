import { describe, expect, it } from 'vitest';
import { constructionInventory } from '../adapters/construction/sourceCoverage.js';
import { loaderSpecifier, runtimeSdkEdges, sourceInventory } from './sourceInventory.js';

const peers = new Set(['optional-sdk']);

describe('shared architecture source inventory', () => {
  it('reuses an unchanged version without confusing changed text at the same path', () => {
    const firstText = "function load() { const spec = 'optional-sdk'; return import(spec); }";
    const changedText = "const spec = 'different-sdk'; const value = import(spec);";
    const first = sourceInventory('versions.ts', firstText);
    const changed = sourceInventory('versions.ts', changedText);
    runtimeSdkEdges(first, peers);
    expect(
      constructionInventory([{ file: 'versions.ts', text: firstText }], peers).candidates,
    ).toHaveLength(1);
    expect(loaderSpecifier(first.loaders[0]!)).toBe('optional-sdk');
    expect(first.loaders[0]?.owner).toBeDefined();
    expect(loaderSpecifier(changed.loaders[0]!)).toBe('different-sdk');
    expect(changed.loaders[0]?.owner).toBeUndefined();
    expect(sourceInventory('versions.ts', firstText)).toBe(first);
    expect(sourceInventory('another-path.ts', firstText).file).toBe('another-path.ts');
  });

  it('keeps SDK var/let resolution distinct from construction const-only metadata', () => {
    const inventory = sourceInventory(
      'scopes.ts',
      `
      const spec = 'outer-sdk';
      function load() { let spec = 'optional-sdk'; return import(spec); }
      function other() { var local = 'optional-sdk'; return lazyRequire(local); }
    `,
    );
    expect(inventory.loaders.map((site) => loaderSpecifier(site))).toEqual([
      'optional-sdk',
      'optional-sdk',
    ]);
    expect(inventory.loaders.map((site) => loaderSpecifier(site, true))).toEqual([
      'outer-sdk',
      undefined,
    ]);
  });

  it('ignores JSDoc examples while keeping actual declarations and runtime loads', () => {
    const text = `
      /** @example import 'optional-sdk'; interface PhantomOptions { server?: Server }
       * @type {import('optional-sdk').Client} */
      export interface ActualOptions { client?: Client }
      function load() { return import('optional-sdk'); }
    `;
    const inventory = sourceInventory('documented.ts', text);
    expect(inventory.loaders).toHaveLength(1);
    expect(loaderSpecifier(inventory.loaders[0]!)).toBe('optional-sdk');
    expect(runtimeSdkEdges(inventory, peers)).toEqual([]);
    expect(
      constructionInventory([{ file: 'documented.ts', text }], peers).candidates.map(
        ({ key }) => key,
      ),
    ).toEqual(['documented.ts#ActualOptions.client', 'documented.ts#SDK(load).optional-sdk']);
  });

  it('keeps original type-elision decisions separate for each cached source version', () => {
    const value = sourceInventory(
      'emission.ts',
      "import { Client } from 'optional-sdk'; console.log(Client);",
    );
    const typeOnly = sourceInventory(
      'emission.ts',
      "import { Client } from 'optional-sdk'; export type Port = Client;",
    );
    expect(runtimeSdkEdges(value, peers).map((edge) => edge.moduleSpecifier.text)).toEqual([
      'optional-sdk',
    ]);
    expect(runtimeSdkEdges(typeOnly, peers)).toEqual([]);
    expect(runtimeSdkEdges(value, peers).map((edge) => edge.moduleSpecifier.text)).toEqual([
      'optional-sdk',
    ]);
  });
});
