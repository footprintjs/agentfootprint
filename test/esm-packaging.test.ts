/**
 * ESM packaging guards — protect consumer ergonomics & bundle size:
 *   1. the ESM build is marked `type:module`,
 *   2. the main barrel + EVERY subpath export load as true ESM (no
 *      ERR_MODULE_NOT_FOUND — every relative import carries a `.js` extension),
 *   3. the ESM `lazyRequire` uses `createRequire` (not bare `require`), so
 *      optional peer-dep adapters work in ESM consumers instead of throwing
 *      `ReferenceError: require is not defined`, and
 *   4. tree-shaking works: a small `import { defineTool }` must NOT drag in the
 *      Agent runtime / injection engine / memory stores / LLM providers.
 *
 * Runs against the BUILT dist (dist/esm). Skips when dist isn't built so a bare
 * `vitest` (no prior build) doesn't false-fail; the release pipeline builds first.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esmDir = resolve(repoRoot, 'dist/esm');
const built = existsSync(resolve(esmDir, 'index.js'));

/** ESM subpath targets, read from package.json `exports`. */
function esmTargets(): Array<[string, string]> {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  const out: Array<[string, string]> = [];
  for (const [name, entry] of Object.entries(pkg.exports)) {
    const e = entry as { import?: { default?: string } | string; default?: string } | string;
    const imp =
      typeof e === 'string'
        ? e
        : typeof e.import === 'string'
        ? e.import
        : e.import?.default ?? e.default;
    if (typeof imp === 'string' && imp.includes('/esm/') && imp.endsWith('.js'))
      out.push([name, imp]);
  }
  return out;
}

describe.skipIf(!built)('ESM packaging', () => {
  it('dist/esm is marked type:module', () => {
    const pkg = JSON.parse(readFileSync(resolve(esmDir, 'package.json'), 'utf8'));
    expect(pkg.type).toBe('module');
  });

  it('main barrel + every subpath export load as TRUE ESM', () => {
    const targets = esmTargets();
    expect(targets.length).toBeGreaterThan(5);
    for (const [name, rel] of targets) {
      const abs = resolve(repoRoot, rel);
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(abs).href)})`],
        { encoding: 'utf8' },
      );
      expect(r.status, `subpath "${name}" (${rel}) failed to load as ESM:\n${r.stderr}`).toBe(0);
    }
  });

  it('lazyRequire works in Node ESM AND is safe to load in the browser', () => {
    const lazy = resolve(esmDir, 'lib/lazyRequire.js');
    const src = readFileSync(lazy, 'utf8');

    // Node ESM: createRequire-based (not a bare `require`, which is undefined in ESM).
    expect(src).toContain('createRequire(import.meta.url)');

    // Browser-safe: must use a NAMESPACE import of node:module. A NAMED import
    // (`import { createRequire }`) is compiled, under Vite's CJS interop, to a
    // top-level `mod["createRequire"]` property read — which throws at import on
    // the externalized node:module stub (Vite "externalized for browser
    // compatibility" error), even though lazyRequire is never called in a browser.
    expect(src).toMatch(/import \* as \w+ from ['"]node:module['"]/);
    // ...and createRequire must NOT be touched at module top level — only inside
    // the function (call-time), which a browser bundle never reaches.
    const beforeFn = src.slice(0, src.indexOf('function lazyRequire'));
    expect(beforeFn, 'createRequire must not be accessed at module top level').not.toContain(
      'createRequire',
    );

    // and it actually works for a builtin in true ESM
    const r = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { lazyRequire } from ${JSON.stringify(pathToFileURL(lazy).href)};
         if (typeof lazyRequire('node:path').join !== 'function') process.exit(3);`,
      ],
      { encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it('tree-shaking: import { defineTool } excludes Agent runtime / injection / memory / providers', async () => {
    const { build } = await import('esbuild');
    const result = await build({
      stdin: {
        contents: `import { defineTool } from ${JSON.stringify(
          resolve(esmDir, 'index.js'),
        )};\nglobalThis.__keep = defineTool;`,
        resolveDir: esmDir,
        loader: 'js',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      treeShaking: true,
    });
    const out = result.outputFiles[0]!.text;
    for (const decl of [
      'class Agent',
      'class InjectionEngine',
      'class VectorMemoryStore',
      'class AnthropicProvider',
    ]) {
      expect(out, `${decl} should be tree-shaken out of a defineTool-only import`).not.toContain(
        decl,
      );
    }
  });
});
