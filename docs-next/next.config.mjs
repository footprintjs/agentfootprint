import { createMDX } from 'fumadocs-mdx/next';
import { resolve } from 'node:path';

// Static export for GitHub Pages is opt-in via EXPORT=true so local `dev`/`build`
// stay as a normal Next app. basePath comes from NEXT_PUBLIC_BASE_PATH (also read by
// lib/site.ts `asset()` so public-asset URLs and the router base stay in sync).
const isExport = process.env.EXPORT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

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
    },
  },
  // Keep webpack as a supported verification/fallback path. `node:` requests
  // need replacement before webpack's scheme reader runs; aliases alone are
  // too late for them.
  webpack: (config, { webpack }) => {
    const browserNodeStub = resolve(import.meta.dirname, 'lib/stubs/browser-node-builtins.js');
    config.resolve.alias = {
      ...config.resolve.alias,
      'node:module': browserNodeStub,
      'node:http': browserNodeStub,
      'node:path': browserNodeStub,
      'node:fs/promises': browserNodeStub,
      '@huggingface/transformers': resolve(import.meta.dirname, 'lib/stubs/embedder-deps.js'),
      'fs/promises': resolve(import.meta.dirname, 'lib/stubs/embedder-deps.js'),
    };
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:(?:module|http|path|fs\/promises)$/,
        browserNodeStub,
      ),
    );
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
