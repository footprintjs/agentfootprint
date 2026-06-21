import { createMDX } from 'fumadocs-mdx/next';

// Static export for GitHub Pages is opt-in via EXPORT=true so local `dev`/`build`
// stay as a normal Next app. basePath comes from NEXT_PUBLIC_BASE_PATH (also read by
// lib/site.ts `asset()` so public-asset URLs and the router base stay in sync).
const isExport = process.env.EXPORT === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Pin the workspace root — the monorepo has multiple lockfiles and Next would
  // otherwise infer the parent dir.
  turbopack: {
    root: import.meta.dirname,
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
