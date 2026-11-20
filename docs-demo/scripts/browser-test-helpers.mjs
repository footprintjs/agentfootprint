import { ok } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

export const demoPath = '/demo/quick-start/';
export const demoRoot = fileURLToPath(new URL('../dist', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const appVersion = manifest.dependencies.agentfootprint;

const assetTypes = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  svg: 'image/svg+xml',
  json: 'application/json',
};

export async function serve(t, root, mount, demoOverlay = false) {
  const server = createServer(async (req, res) => {
    let pathname;
    // Next's dynamic route chunks keep brackets in their exported filenames.
    try {
      pathname = decodeURI(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const name = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const overlay = demoOverlay && pathname.startsWith(demoPath);
    const servedRoot = overlay ? demoRoot : root;
    const relativeName = name.slice(overlay ? demoPath.length : mount.length);
    const file = resolve(servedRoot, relativeName);
    if (!pathname.startsWith(mount) || !file.startsWith(`${servedRoot}${sep}`)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      res.setHeader(
        'Content-Type',
        assetTypes[file.split('.').at(-1)] ?? 'application/octet-stream',
      );
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

export async function openBrowser(t) {
  const browser = await chromium.launch({
    executablePath: process.env.DOCS_DEMO_CHROMIUM_EXECUTABLE,
  });
  t.after(() => browser.close());
  return browser;
}

export async function openPage(browser, options) {
  const page = await browser.newPage({
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 960 },
    ...options,
  });
  page.setDefaultTimeout(8_000);
  return page;
}

export function versionedDemoPath({ slug }) {
  return `${demoPath}?view=${slug}&agentfootprint=${appVersion}#${slug}`;
}

export function recordDemoAssets(page, demoUrl) {
  const assets = new Map();
  page.on('response', (response) => {
    const url = response.url();
    if (url.startsWith(`${demoUrl}assets/`)) {
      assets.set(url.slice(demoUrl.length), response.status());
    }
  });
  return assets;
}

export async function measureAssetBytes(label, files, limit) {
  ok(files.length > 0, `${label} emits assets`);
  const contents = await Promise.all(files.map((file) => readFile(resolve(demoRoot, file))));
  const bytes = contents.reduce((sum, bytes) => sum + gzipSync(bytes, { level: 9 }).byteLength, 0);
  console.log(`${label}: ${bytes} B gzip across ${files.length} assets`);
  if (limit !== undefined) {
    ok(bytes <= limit, `${label}: ${bytes} B gzip exceeds its ${limit} B budget`);
  }
}
