import { deepStrictEqual, equal, notEqual, ok } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const demoPath = '/demo/quick-start/';
const guidePath = '/docs/getting-started/quick-start/';
const guideAnchor = '#the-run-as-a-flowchart';
const demoRoot = fileURLToPath(new URL('../dist', import.meta.url));
const assetTypes = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  svg: 'image/svg+xml',
};

async function serve(t, root, mount, demoOverlay = false) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
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
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openBrowser(t, options) {
  const browser = await chromium.launch({
    executablePath: process.env.DOCS_DEMO_CHROMIUM_EXECUTABLE,
  });
  t.after(() => browser.close());
  return browser.newPage({
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 960 },
    ...options,
  });
}

test(
  'the built weather viewer groups, zooms, drills, returns and changes theme',
  { timeout: 30_000 },
  async (t) => {
    // A non-root deployment verifies the app and guide links are relative.
    const prefix = '/project';
    const origin = await serve(t, demoRoot, prefix + demoPath);
    const page = await openBrowser(t);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    const response = await page.goto(origin + prefix + demoPath);
    equal(response?.status(), 200);
    await page.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
    await page.getByText('Got it — San Francisco: sunny, 72°F.').waitFor();
    await page.getByText('agentfootprint-lens@0.84.0', { exact: false }).waitFor();
    const guideHref = await page
      .getByRole('link', { name: 'Back to Quick Start' })
      .getAttribute('href');
    equal(new URL(guideHref, page.url()).pathname, prefix + guidePath);
    equal(new URL(guideHref, page.url()).hash, guideAnchor);

    const chart = page.getByRole('region', { name: 'Mock weather agent flowchart' });
    await chart.locator('.react-flow__node-groupContainer[data-id="sf-llm-call"]').waitFor();
    await chart.getByText('System Prompt', { exact: true }).first().waitFor();
    const viewport = chart.locator('.react-flow__viewport');
    const beforeZoom = await viewport.getAttribute('style');
    await chart.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForFunction(
      (previous) =>
        document.querySelector('.react-flow__viewport').getAttribute('style') !== previous,
      beforeZoom,
    );
    notEqual(await viewport.getAttribute('style'), beforeZoom);

    const groups = page.getByRole('button', { name: 'Show grouped subflows' });
    await groups.press('Enter');
    equal(await groups.getAttribute('aria-pressed'), 'false');
    await chart.locator('.react-flow__node[data-id="sf-llm-call"]').click();
    await chart.locator('.react-flow__node[data-id="sf-llm-call/sf-system-prompt"]').waitFor();
    await chart.getByRole('button', { name: 'Chart', exact: true }).click();
    await chart.locator('.react-flow__node[data-id="sf-llm-call"]').waitFor();
    equal(
      await chart.locator('.react-flow__node[data-id="sf-llm-call/sf-system-prompt"]').count(),
      0,
    );

    const theme = page.getByRole('button', { name: 'Dark theme' });
    await theme.press('Enter');
    equal(await theme.getAttribute('aria-pressed'), 'true');
    equal(await page.locator('main').getAttribute('data-theme'), 'dark');
    deepStrictEqual(errors, []);
    ok(
      requests.every((url) => new URL(url).origin === origin),
      'the saved demo makes no external requests',
    );
  },
);

if (process.env.DOCS_DEMO_EXPORT) {
  test(
    'the exported guide opens the mounted viewer by full navigation',
    { timeout: 30_000 },
    async (t) => {
      const origin = await serve(t, resolve(process.env.DOCS_DEMO_EXPORT), '/', true);
      const page = await openBrowser(t);
      const guide = await page.goto(origin + guidePath + guideAnchor);
      equal(guide?.status(), 200);
      await page.locator(guideAnchor).waitFor();
      const [navigation] = await Promise.all([
        page.waitForEvent(
          'response',
          (response) =>
            response.url() === origin + demoPath &&
            response.request().resourceType() === 'document',
        ),
        page
          .getByRole('link', { name: 'Zoom and drill into the interactive weather trace' })
          .click(),
      ]);
      equal(navigation.status(), 200);
      equal(new URL(page.url()).pathname, demoPath);
      await page.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
      await page.locator('.react-flow__node-groupContainer[data-id="sf-llm-call"]').waitFor();
      await page.getByRole('link', { name: 'Back to Quick Start' }).click();
      equal(new URL(page.url()).pathname + new URL(page.url()).hash, guidePath + guideAnchor);
    },
  );

  test(
    'the exported guide opens a static fallback even with JavaScript disabled',
    { timeout: 30_000 },
    async (t) => {
      const origin = await serve(t, resolve(process.env.DOCS_DEMO_EXPORT), '/');
      const page = await openBrowser(t, { javaScriptEnabled: false });
      const guide = await page.goto(origin + guidePath + guideAnchor);
      equal(guide?.status(), 200);
      await page.locator(guideAnchor).waitFor();
      await page
        .getByRole('link', { name: 'Zoom and drill into the interactive weather trace' })
        .click();
      equal(new URL(page.url()).pathname, demoPath);
      await page.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
      await page.getByText('The interactive viewer is unavailable', { exact: false }).waitFor();
      const staticChart = page.getByRole('img', {
        name: 'Mock weather agent flowchart.',
        exact: false,
      });
      await staticChart.scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        [...document.images].some(
          (image) =>
            image.src.includes('quick-start-flowchart-light.svg') && image.naturalWidth > 0,
        ),
      );
      await page.getByRole('link', { name: 'Back to Quick Start' }).click();
      equal(new URL(page.url()).pathname + new URL(page.url()).hash, guidePath + guideAnchor);
    },
  );
}
