/**
 * The cancellation conformance against the BUILT package — ESM (`dist/esm`)
 * and CJS (`dist`) — so what ships is held to the same law as the source.
 *
 * The same cases (`abortConformance.ts`) and the same rigs (`rigs.ts`), built
 * over the adapter modules loaded from the build: `import()` for ESM,
 * `require` for CJS. A consumer gets one or the other; a fix that reached only
 * one build would pass `abort.conformance.test.ts` and still ship the defect.
 *
 * Skips when `dist` is not built, so a bare `vitest` does not false-fail —
 * except under CI, which builds before it tests: there a missing build fails.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { abortConformance } from './abortConformance.js';
import { adapterRigs, SOURCE_MODULES, type AdapterModules } from './rigs.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORMATS = [
  { format: 'esm', dir: resolve(repoRoot, 'dist/esm/adapters/llm') },
  { format: 'cjs', dir: resolve(repoRoot, 'dist/adapters/llm') },
] as const;
const built = FORMATS.every(({ dir }) => existsSync(resolve(dir, 'AnthropicProvider.js')));
const requireCjs = createRequire(import.meta.url);

/** Every module the rigs read, loaded from one build. */
async function load(format: 'esm' | 'cjs', dir: string): Promise<AdapterModules> {
  const entries = await Promise.all(
    Object.keys(SOURCE_MODULES).map(async (name) => {
      const file = resolve(dir, `${name}.js`);
      const mod: unknown =
        format === 'esm' ? await import(pathToFileURL(file).href) : requireCjs(file);
      return [name, mod] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as AdapterModules;
}

it('the build is present under CI (the dist conformance never skips there)', () => {
  if (process.env.CI) expect(built, 'dist is not built: run `npm run build` first').toBe(true);
});

for (const { format, dir } of FORMATS) {
  describe.skipIf(!built)(`cancellation conformance — built ${format}`, async () => {
    const rigs = built ? adapterRigs(await load(format, dir)) : [];
    it(`every rig of the source list is built over the ${format} package`, () => {
      expect(rigs.map((r) => r.factory)).toEqual(adapterRigs(SOURCE_MODULES).map((r) => r.factory));
    });
    for (const rig of rigs) {
      const label = rig.variant === undefined ? rig.factory : `${rig.factory} (${rig.variant})`;
      describe(label, () => {
        abortConformance(rig);
      });
    }
  });
}
