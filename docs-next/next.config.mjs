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
      'node:module': './lib/stubs/node-module.js',
    },
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
