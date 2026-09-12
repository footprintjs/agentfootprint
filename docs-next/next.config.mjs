import { createMDX } from 'fumadocs-mdx/next';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

// Static export for GitHub Pages is opt-in via EXPORT=true so local `dev`/`build`
// stay as a normal Next app. basePath comes from NEXT_PUBLIC_BASE_PATH (also read by
// lib/site.ts `asset()` so public-asset URLs and the router base stay in sync).
const isExport = process.env.EXPORT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// ONE footprintjs in the browser. docs-next links the library (`agentfootprint:
// file:..`), so the library's dist resolves `footprintjs` from ../node_modules,
// while everything installed HERE (the lens, explainable-ui) resolves it from
// ./node_modules — two directories, so two engines in every demo bundle whatever
// the two versions say (the site shipped 9.10.0 beside 9.21.1 for months; the
// numbers are in scripts/check-site-budget.mjs, the entry after 9.94.1). Two
// engines is not only bytes: a trace the library writes with one and the lens
// reads with the other shares no class, symbol or WeakMap. The root's copy is
// the one the library was built and tested against, so every browser request
// for `footprintjs` or one of its doors is pointed at it. The doors come from
// the package's own `exports` field — never a hand list that a new door would
// silently miss — and the `import` condition is the one a browser bundle takes.
// Client compiler only: the demos mount with `ssr: false`, and the server
// compiler externalizes node_modules, where an absolute ESM path would be
// `require`d.
const footprintjsRoot = resolve(import.meta.dirname, '../node_modules/footprintjs');
const footprintjsAliases = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(resolve(footprintjsRoot, 'package.json'), 'utf8')).exports)
    .filter(([subpath, target]) => subpath !== './package.json' && target?.import?.default)
    .map(([subpath, target]) => [
      subpath === '.' ? 'footprintjs' : `footprintjs/${subpath.slice(2)}`,
      resolve(footprintjsRoot, target.import.default),
    ]),
);

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The live "Try it" demos run the REAL agent in the browser with a mock provider.
  // The lens is a sibling package imported client-side, so Turbopack must bundle it.
  transpilePackages: ['agentfootprint-lens'],
  turbopack: {
    // Root = the agentfootprint repo (the parent), NOT docs-next. The live "Try it"
    // demos import `agentfootprint` client-side, and npm links it as a symlink to the
    // parent repo (docs-next is nested inside it). Turbopack only bundles modules
    // INSIDE the root, so the root must contain the parent — otherwise the symlinked
    // agent runtime can't be bundled for the browser.
    root: resolve(import.meta.dirname, '..'),
    // agentfootprint's lazyRequire does a CALL-TIME-only `node:module` access (Node-only;
    // never reached by a browser mock agent). Vite/webpack stub node: builtins
    // automatically; Turbopack doesn't, so alias it to a throwing browser stub. The
    // library is untouched — this is a consumer-side bundler config.
    resolveAlias: {
      'node:module': './lib/stubs/browser-node-builtins.js',
      // Broad context/provider barrels also expose call-time-only Node helpers.
      // The browser demos never call them, but the bundler must still resolve the
      // dynamic imports while proving the client graph.
      'node:http': './lib/stubs/browser-node-builtins.js',
      'node:path': './lib/stubs/browser-node-builtins.js',
      'node:fs/promises': './lib/stubs/browser-node-builtins.js',
      // localEmbedder's model packages — call-time-only, never reached by a
      // browser mock agent (see lib/stubs/embedder-deps.js).
      '@huggingface/transformers': './lib/stubs/embedder-deps.js',
      'fs/promises': './lib/stubs/embedder-deps.js',
      // One footprintjs (see footprintjsAliases above). Exact keys: turbopack
      // matches a key without `*` against the whole request.
      ...footprintjsAliases,
    },
  },
  // Keep webpack as a supported verification/fallback path. `node:` requests
  // need replacement before webpack's scheme reader runs; aliases alone are
  // too late for them.
  webpack: (config, { webpack, isServer }) => {
    const browserNodeStub = resolve(import.meta.dirname, 'lib/stubs/browser-node-builtins.js');
    config.resolve.alias = {
      ...config.resolve.alias,
      'node:module': browserNodeStub,
      'node:http': browserNodeStub,
      'node:path': browserNodeStub,
      'node:fs/promises': browserNodeStub,
      '@huggingface/transformers': resolve(import.meta.dirname, 'lib/stubs/embedder-deps.js'),
      'fs/promises': resolve(import.meta.dirname, 'lib/stubs/embedder-deps.js'),
      // One footprintjs (see footprintjsAliases above). The `$` makes each
      // alias exact, so `footprintjs` does not also rewrite `footprintjs/trace`.
      ...(isServer
        ? {}
        : Object.fromEntries(Object.entries(footprintjsAliases).map(([request, file]) => [`${request}$`, file]))),
    };
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:(?:module|http|path|fs\/promises)$/,
        browserNodeStub,
      ),
    );
    // DOCS_WEBPACK_STATS=1 writes a per-module stats file per compiler so
    // scripts/demo-chunk-modules.mjs can say WHICH library modules a chunk
    // carries — the number check-site-budget.mjs ratchets is only the sum.
    if (process.env.DOCS_WEBPACK_STATS === '1') {
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.done.tap('DocsWebpackStats', (stats) => {
            const json = stats.toJson({
              all: false,
              assets: true,
              chunks: true,
              modules: true,
              nestedModules: true,
              // Under `all: false` webpack also defaults `cachedModules` to
              // false, and a WARM .next/cache marks every unchanged module
              // cached — so a second build in a row collapsed the whole
              // library into one nameless "cached modules" group and
              // demo-chunk-modules.mjs printed 0 modules. Cached is a build
              // fact, not a bundle fact: list them.
              cachedModules: true,
              ids: true,
              source: false,
              // Every module, ungrouped: the defaults collapse anything past
              // 15 into a "+ N modules" placeholder with no children.
              modulesSpace: Infinity,
              nestedModulesSpace: Infinity,
              groupModulesByPath: false,
              groupModulesByExtension: false,
              groupModulesByType: false,
              groupModulesByCacheStatus: false,
              groupModulesByAttributes: false,
              groupModulesByLayer: false,
            });
            const name = compiler.name || 'default';
            writeFileSync(resolve(import.meta.dirname, `.next/webpack-stats-${name}.json`), JSON.stringify(json));
          });
        },
      });
    }
    return config;
  },
  ...(isExport
    ? {
        output: 'export',
        basePath,
        // every route becomes a directory + index.html → GitHub Pages serves it cleanly
        trailingSlash: true,
        // no Next image optimization server on static hosting
        images: { unoptimized: true },
      }
    : {}),
};

const withMDX = createMDX();

export default withMDX(config);
