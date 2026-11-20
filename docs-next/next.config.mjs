import { createMDX } from 'fumadocs-mdx/next';
import { relative, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { resolveBrowserLibraries } from './lib/browser-library-aliases.mjs';

// Static export for GitHub Pages is opt-in via EXPORT=true so local `dev`/`build`
// stay as a normal Next app. basePath comes from NEXT_PUBLIC_BASE_PATH (also read by
// lib/site.ts `asset()` so public-asset URLs and the router base stay in sync).
const isExport = process.env.EXPORT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// ONE engine and ONE record implementation. Follow the AgentFootprint package
// the docs resolve. npm packs the built file:.. source into the docs install.
// Its natural browser dependencies own every public engine/reader door; refuse
// divergent docs, AF or engine reader roots rather than mask them with aliases.
// Resolve entries and their package manifests, never guess a dist or parent path.
// The doors come from each package's own exports, including future public doors.
// Webpack applies these aliases only to its client compiler: the demos mount
// with `ssr: false`, and the server compiler externalizes node_modules, where
// an absolute ESM path would be `require`d. Turbopack's existing global alias
// policy also covers Foottrace, using relative paths to the same root files.
const { aliases: browserLibraryAliases } = resolveBrowserLibraries(import.meta.dirname);

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: {
    // Use the parent repository as the root for the docs site and its source.
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
      // One copy of each library (see browserLibraryAliases above). Exact keys: turbopack
      // matches a key without `*` against the whole request. RELATIVE values:
      // turbopack reads an absolute value as a "server relative import" and
      // refuses it (`next dev` was 500 on every route that reached a
      // footprintjs door), so each file is spelled relative to docs-next.
      ...Object.fromEntries(
        Object.entries(browserLibraryAliases).map(([request, file]) => {
          const rel = relative(import.meta.dirname, file);
          return [request, rel.startsWith('.') ? rel : `./${rel}`];
        }),
      ),
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
      // One copy of each library (see browserLibraryAliases above). The `$` makes each
      // alias exact, so `footprintjs` does not also rewrite `footprintjs/trace`.
      ...(isServer
        ? {}
        : Object.fromEntries(
            Object.entries(browserLibraryAliases).map(([request, file]) => [`${request}$`, file]),
          )),
    };
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:(?:module|http|path|fs\/promises)$/,
        browserNodeStub,
      ),
    );
    // DOCS_WEBPACK_STATS=1 writes per-module stats for inspecting bundle contents.
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
              // cached, which can otherwise collapse a warm build into one
              // nameless "cached modules" group. Keep those modules visible.
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
