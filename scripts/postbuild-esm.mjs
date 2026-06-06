/**
 * postbuild-esm — make the ESM build TRUE ESM.
 *
 * Two steps tsc can't do on its own:
 *
 * 1. Write `dist/esm/package.json {"type":"module"}` so Node/Deno/Bun load
 *    dist/esm as real ESM (every relative import already carries a `.js`
 *    extension — see the add-js-ext migration), instead of the slower
 *    syntax-detection fallback that also breaks stricter loaders.
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
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const esmDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/esm');

// 1. mark as ESM
writeFileSync(resolve(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 0) + '\n');

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

console.log('postbuild-esm: dist/esm type:module + ESM-correct lazyRequire ✓');
