/**
 * lazyRequire — module-path-indirect `require()` wrapper for lazy
 * peer-dep loading.
 *
 * Why a wrapper: bundlers (Vite, esbuild, webpack, Rollup) statically
 * analyze `require('literal-string')` calls and try to resolve the
 * dependency at BUILD time — even when the function is never called
 * at runtime. For optional peer-deps (`@modelcontextprotocol/sdk`,
 * `@anthropic-ai/sdk`, `ioredis`, `@aws-sdk/client-bedrock-*`), this
 * means consumers who never instantiate the matching adapter still
 * get a build error if the peer-dep isn't installed.
 *
 * Wrapping the call in a function with a string PARAMETER hides the
 * specifier from static analysis. At runtime this is exactly the
 * same as inline `require()`, including the throwing behavior when
 * the peer-dep isn't installed.
 *
 * Pattern: indirect require — used by Node's `createRequire`-style
 *          fallbacks for the same reason.
 *
 * @example
 *   try {
 *     const mod = lazyRequire<typeof import('ioredis')>('ioredis');
 *     this._client = new mod.default(...);
 *   } catch {
 *     throw new Error('install ioredis to use RedisStore');
 *   }
 */
export function lazyRequire<T = unknown>(specifier: string): T {
  // CJS: `require` is global, so this is correct as-is.
  // ESM: `require` is undefined — `scripts/postbuild-esm.mjs` rewrites the
  //      emitted dist/esm/lib/lazyRequire.js to use
  //      `createRequire(import.meta.url)`. (We can't `import.meta` here: this
  //      file also compiles to CJS, where import.meta is illegal.) Keep the
  //      signature in sync with that script.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier) as T;
}
