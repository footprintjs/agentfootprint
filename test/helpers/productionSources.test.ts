import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { productionSources } from './productionSources.js';

it('includes nested production source but excludes colocated tests and declarations', () => {
  const root = mkdtempSync(join(tmpdir(), 'production-source-census-'));
  try {
    mkdirSync(join(root, 'nested'));
    for (const name of [
      'b.ts',
      'a.ts',
      'a.test.ts',
      'types.d.ts',
      'nested/c.ts',
      'nested/c.test.ts',
    ])
      writeFileSync(join(root, name), "export const role = 'user';");
    expect(productionSources(root).map((file) => relative(root, file))).toEqual([
      'a.ts',
      'b.ts',
      'nested/c.ts',
    ]);
  } finally {
    rmSync(root, { recursive: true });
  }
});
