/**
 * postbuild-esm — make the ESM build TRUE ESM.
 *
 * Two steps tsc can't do on its own:
 *
 * 1. Write `dist/esm/package.json {"type":"module", "sideEffects": […]}` so
 *    Node/Deno/Bun load dist/esm as real ESM (every relative import already
 *    carries a `.js` extension — see the add-js-ext migration), instead of the
 *    slower syntax-detection fallback that also breaks stricter loaders.
 *
 *    The `sideEffects` half is load-bearing for BUNDLE SIZE (9.94.0). Every
 *    bundler reads that flag from the CLOSEST package.json to the module it is
 *    deciding about — and for `dist/esm/**` that is this file, not the root
 *    one. So from the day this file was first written, the root's honest
 *    `sideEffects` list never reached a single ESM module: webpack, Vite and
 *    esbuild all had to assume every file under dist/esm might run something
 *    at load, keep each one an importer names even when nothing from it is
 *    used, and could only strip the pure declarations inside. That is why a
 *    dynamic `import()` of a module a barrel also re-exports never split into
 *    its own chunk, and why the docs site's demo chunk carried every family a
 *    barrel could reach (docs-next/scripts/check-site-budget.mjs, the block
 *    above DEMO_ASYNC_GZIP_LIMIT). The list is COPIED from the root package.json
 *    rather than retyped, so the two cannot drift; test/esm-packaging.test.ts
 *    pins that they are equal. footprintjs's own dist/esm/package.json has
 *    carried its flag all along, which is the pattern this follows.
 *
 * 2. Replace bare `require()` in the ESM `lazyRequire` with
 *    `createRequire(import.meta.url)`. `lazyRequire` is the SINGLE indirection
 *    every optional peer-dep adapter (Anthropic, OpenAI, Bedrock, ioredis,
 *    AgentCore, MCP, OTEL/CloudWatch/X-Ray) loads through. In CJS `require` is
 *    global so the source is correct as-is; in true ESM `require` is undefined,
 *    so without this an ESM consumer instantiating any lazy adapter would hit a
 *    `ReferenceError: require is not defined`. We can't put `import.meta` in the
 *    shared source (it's illegal in the CJS compile), so we materialise the ESM
 *    variant here. The function signature is unchanged.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { esmSideEffects } from './lib/esmSideEffects.mjs';

const esmDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/esm');

// 1. mark as ESM — and carry the root's `sideEffects` list, because the
//    nearest package.json is the one a bundler consults (see the header).
//    The derivation lives in scripts/lib/esmSideEffects.mjs so
//    test/esm-packaging.test.ts pins the shipped file against the same rule.
const rootPkg = JSON.parse(readFileSync(resolve(esmDir, '../../package.json'), 'utf8'));
writeFileSync(
  resolve(esmDir, 'package.json'),
  JSON.stringify({ type: 'module', sideEffects: esmSideEffects(rootPkg.sideEffects) }, null, 0) +
    '\n',
);

// 2. ESM-correct lazyRequire (createRequire instead of bare require)
const lazyReqPath = resolve(esmDir, 'lib/lazyRequire.js');
if (!existsSync(lazyReqPath)) {
  throw new Error(
    `postbuild-esm: expected ${lazyReqPath} — did lib/lazyRequire.ts move? Update this script.`,
  );
}
// Browser-safety is subtle here. lazyRequire is only ever CALLED in Node (to
// load an optional peer-dep adapter); in a browser bundle it is
// imported-but-never-called. Bundlers (Vite) externalize `node:module` and throw
// on any property access. Two traps to avoid:
//   1. A top-level `createRequire(import.meta.url)` call — runs at import → crash.
//   2. A NAMED import `import { createRequire }` — Vite's CJS interop compiles it
//      to a TOP-LEVEL `const createRequire = mod["createRequire"]`, which is an
//      eager property read on the externalized stub → also crashes at import.
// A NAMESPACE import binds the whole module object with no property read; the
// `.createRequire` access then happens lazily inside the function (call-time),
// which the browser never reaches. So this loads in the browser and works in
// Node ESM.
writeFileSync(
  lazyReqPath,
  `import * as nodeModule from 'node:module';\n` +
    `let cachedRequire;\n` +
    `export function lazyRequire(specifier) {\n` +
    `    return (cachedRequire ??= nodeModule.createRequire(import.meta.url))(specifier);\n` +
    `}\n`,
);

console.log('postbuild-esm: dist/esm type:module + sideEffects + ESM-correct lazyRequire ✓');
