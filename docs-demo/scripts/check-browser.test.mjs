import { deepStrictEqual, equal, notEqual, ok } from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const demoPath = '/demo/quick-start/';
const guidePath = '/docs/getting-started/quick-start/';
const guideAnchor = '#the-run-as-a-flowchart';
const demoRoot = fileURLToPath(new URL('../dist', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const appVersion = manifest.dependencies.agentfootprint;
const weatherAssetLimit = 200_000;
// Historical measurements for the former Next deferred-demo budget:
// https://github.com/footprintjs/agentfootprint/blob/5a0e6720b062ea989f6a6b14ce76995957df77ed/docs-next/scripts/check-site-budget.mjs#L347-L595
const deferredSkillAssetLimit = 492_000;
const skillViews = [
  {
    slug: 'skill-graph-quickstart',
    heading: 'Skill graph quickstart',
    anchor: 'you-can-see-it',
    edges: ['__start__ to refunds', '__start__ to billing', '__start__ to triage'],
    skill: 'refunds',
    selectKey: 'Enter',
    body: 'Confirm the order id first, then call process_refund(orderId).',
    tool: 'process_refund',
    staticHeading: 'Quickstart skill graph',
    noscriptLink: 'View the static Skill graph quickstart diagram',
  },
  {
    slug: 'skills-explained',
    heading: 'Support skill graph',
    anchor: 'routing-between-skills--the-skill-graph',
    edges: ['__start__ to triage', 'triage to billing', 'triage to tech'],
    skill: 'tech',
    selectKey: 'Space',
    body: 'Reproduce the issue, run a diagnostic, then summarize the fix.',
    tool: 'run_diagnostic',
    staticHeading: 'Support skill graph',
    noscriptLink: 'View the static Skills explained diagram',
  },
];
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
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

async function openBrowser(t) {
  const browser = await chromium.launch({
    executablePath: process.env.DOCS_DEMO_CHROMIUM_EXECUTABLE,
  });
  t.after(() => browser.close());
  return browser;
}

async function openPage(browser, options) {
  const page = await browser.newPage({
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 960 },
    ...options,
  });
  page.setDefaultTimeout(8_000);
  return page;
}

function skillDemoPath({ slug }) {
  return `${demoPath}?view=${slug}&agentfootprint=${appVersion}#${slug}`;
}

function skillGuidePath({ slug, anchor }) {
  return `/docs/build/${slug}/#${anchor}`;
}

function recordDemoAssets(page, demoUrl) {
  const assets = new Map();
  page.on('response', (response) => {
    const url = response.url();
    if (url.startsWith(`${demoUrl}assets/`)) {
      assets.set(url.slice(demoUrl.length), response.status());
    }
  });
  return assets;
}

async function checkGzipBudget(label, files, limit) {
  const contents = await Promise.all(files.map((file) => readFile(resolve(demoRoot, file))));
  const bytes = contents.reduce((sum, bytes) => sum + gzipSync(bytes, { level: 9 }).byteLength, 0);
  console.log(`${label}: ${bytes} B gzip across ${files.length} assets`);
  ok(bytes <= limit, `${label}: ${bytes} B gzip exceeds its ${limit} B budget`);
}

test(
  'the built weather viewer groups, zooms, drills, returns and changes theme',
  { timeout: 30_000 },
  async (t) => {
    // A non-root deployment verifies the app and guide links are relative.
    const prefix = '/project';
    const origin = await serve(t, demoRoot, prefix + demoPath);
    const browser = await openBrowser(t);
    const page = await openPage(browser);
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

test(
  'the built skill graphs load on demand and preserve native graph inspection',
  { timeout: 30_000 },
  async (t) => {
    const prefix = '/project';
    const origin = await serve(t, demoRoot, prefix + demoPath);
    const browser = await openBrowser(t);
    const weather = await openPage(browser);
    const weatherAssets = recordDemoAssets(weather, origin + prefix + demoPath);
    equal((await weather.goto(origin + prefix + demoPath))?.status(), 200);
    await weather.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
    await weather.locator('.react-flow__node-groupContainer[data-id="sf-llm-call"]').waitFor();
    const weatherFiles = [...weatherAssets.keys()];
    ok(
      weatherFiles.some((file) => file.endsWith('.js')),
      'the weather viewer loads JavaScript',
    );
    ok(
      weatherFiles.some((file) => file.endsWith('.css')),
      'the weather viewer loads styles',
    );
    deepStrictEqual([...new Set(weatherAssets.values())], [200], 'the weather assets resolve');
    await checkGzipBudget('Quick Start viewer', weatherFiles, weatherAssetLimit);

    // The weather route exercises the shared entry and dependencies. Measure the
    // remainder of the artifact, including chunks the skill view can load later.
    const builtAssets = await readdir(resolve(demoRoot, 'assets'));
    const deferredFiles = builtAssets
      .map((asset) => `assets/${asset}`)
      .filter((asset) => !weatherAssets.has(asset));
    const skillChunk = deferredFiles.find((file) =>
      /^assets\/SkillGraphTryItInner-.*\.js$/.test(file),
    );
    ok(skillChunk, 'the built skill renderer is deferred from the weather route');
    await checkGzipBudget('Deferred skill graph viewer', deferredFiles, deferredSkillAssetLimit);

    for (const view of skillViews) {
      const page = await openPage(browser, { colorScheme: 'dark' });
      const errors = [];
      const requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      const assets = recordDemoAssets(page, origin + prefix + demoPath);
      equal((await page.goto(origin + prefix + skillDemoPath(view)))?.status(), 200);
      await page.getByRole('heading', { name: view.heading }).waitFor();
      await page.getByText(`agentfootprint@${appVersion}`, { exact: false }).waitFor();
      const chart = page.getByRole('region', { name: 'Skill graph' });
      await chart.locator('.react-flow__node-sgStart[data-id="__start__"]').waitFor();
      for (const edge of view.edges) {
        await chart
          .getByLabel(`Edge from ${edge}`, { exact: true })
          .locator('.react-flow__edge-path[d^="M"]')
          .waitFor({ state: 'attached' });
      }
      const node = chart.locator(`.react-flow__node-sgSkill[data-id="${view.skill}"]`);
      await node.waitFor();
      ok(assets.has(skillChunk), `${view.slug} loads the deferred renderer`);
      deepStrictEqual([...new Set(assets.values())], [200], 'the skill assets resolve');

      const theme = page.getByRole('button', { name: 'Dark theme' });
      const detail = chart.getByTestId('skill-graph-detail');
      equal(await theme.getAttribute('aria-pressed'), 'true');
      equal(await page.locator('main').getAttribute('data-theme'), 'dark');
      const darkPanel = await detail.evaluate((panel) => getComputedStyle(panel).backgroundColor);
      await theme.press('Enter');
      equal(await theme.getAttribute('aria-pressed'), 'false');
      equal(await page.locator('main').getAttribute('data-theme'), 'light');
      notEqual(
        await detail.evaluate((panel) => getComputedStyle(panel).backgroundColor),
        darkPanel,
      );

      await node.press(view.selectKey);
      await detail.getByText(view.body, { exact: true }).waitFor();
      await detail.getByText(view.tool, { exact: true }).waitFor();
      await node.press('Escape');
      await detail.getByText(view.body, { exact: true }).waitFor({ state: 'hidden' });
      await node.click();
      await detail.getByText(view.body, { exact: true }).waitFor();

      const viewport = chart.locator('.react-flow__viewport');
      const beforeZoom = await viewport.getAttribute('style');
      await chart.getByRole('button', { name: 'Zoom Out' }).click();
      await page.waitForFunction(
        (previous) =>
          document.querySelector('.react-flow__viewport').getAttribute('style') !== previous,
        beforeZoom,
      );

      const backHref = await page.getByRole('link', { name: /Back to/ }).getAttribute('href');
      equal(new URL(backHref, page.url()).href, origin + prefix + skillGuidePath(view));
      deepStrictEqual(errors, []);
      ok(
        requests.every((url) => new URL(url).origin === origin),
        'the skill graph makes no external requests',
      );
      await page.close();
    }
  },
);

test(
  'the built demo links back to the figures when the skill renderer is unavailable',
  { timeout: 30_000 },
  async (t) => {
    const origin = await serve(t, demoRoot, demoPath);
    const browser = await openBrowser(t);
    const noscript = await openPage(browser, { javaScriptEnabled: false });
    for (const view of skillViews) {
      equal((await noscript.goto(origin + skillDemoPath(view)))?.status(), 200);
      const link = noscript.getByRole('link', { name: view.noscriptLink });
      await link.waitFor();
      equal(
        new URL(await link.getAttribute('href'), noscript.url()).href,
        origin + skillGuidePath(view),
      );
    }

    const view = skillViews[0];
    const mismatch = await openPage(browser);
    await mismatch.goto(
      origin + skillDemoPath(view).replace(`agentfootprint=${appVersion}`, 'agentfootprint=0.0.0'),
    );
    await mismatch
      .getByText('The interactive viewer is unavailable for this version.', { exact: false })
      .waitFor();
    equal(await mismatch.getByRole('region', { name: 'Skill graph' }).count(), 0);
    const mismatchHref = await mismatch.getByRole('link', { name: /Back to/ }).getAttribute('href');
    equal(new URL(mismatchHref, mismatch.url()).href, origin + skillGuidePath(view));

    const blocked = await openPage(browser);
    await blocked.route('**/assets/SkillGraphTryItInner-*.js', (route) => route.abort());
    await blocked.goto(origin + skillDemoPath(view));
    await blocked
      .getByText('The interactive viewer is unavailable. The guide has the recorded diagram.')
      .waitFor();
    const blockedHref = await blocked.getByRole('link', { name: /Back to/ }).getAttribute('href');
    equal(new URL(blockedHref, blocked.url()).href, origin + skillGuidePath(view));
  },
);

if (process.env.DOCS_DEMO_EXPORT) {
  test(
    'the exported guide opens the mounted viewer by full navigation',
    { timeout: 30_000 },
    async (t) => {
      const origin = await serve(t, resolve(process.env.DOCS_DEMO_EXPORT), '/', true);
      const browser = await openBrowser(t);
      const page = await openPage(browser);
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
      const browser = await openBrowser(t);
      const page = await openPage(browser, { javaScriptEnabled: false });
      const guide = await page.goto(origin + guidePath + guideAnchor);
      equal(guide?.status(), 200);
      await page.locator(guideAnchor).waitFor();
      await page
        .getByRole('link', { name: 'Zoom and drill into the interactive weather trace' })
        .click();
      equal(new URL(page.url()).pathname, demoPath);
      await page.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
      await page
        .getByText('The interactive viewer is unavailable on this deployment. The diagram below', {
          exact: false,
        })
        .waitFor();
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

  test(
    'the two exported skill guides load no app bytes until full navigation and retain their static fallback',
    { timeout: 30_000 },
    async (t) => {
      const exportRoot = resolve(process.env.DOCS_DEMO_EXPORT);
      const overlay = await serve(t, exportRoot, '/', true);
      const staticSite = await serve(t, exportRoot, '/');
      const browser = await openBrowser(t);
      for (const view of skillViews) {
        const page = await openPage(browser);
        const appRequests = [];
        page.on('request', (request) => {
          if (new URL(request.url()).pathname.startsWith(demoPath)) appRequests.push(request.url());
        });
        equal((await page.goto(overlay + skillGuidePath(view)))?.status(), 200);
        await page.locator(`#${view.anchor}`).waitFor({ state: 'attached' });
        const openGraph = page.getByRole('link', {
          name: 'Open the interactive skill graph',
          exact: false,
        });
        await openGraph.scrollIntoViewIfNeeded();
        const launchUrl = new URL(await openGraph.getAttribute('href'), page.url());
        equal(launchUrl.href, overlay + skillDemoPath(view));
        deepStrictEqual(
          appRequests,
          [],
          'the exported skill guide fetches no demo bytes before navigation',
        );
        launchUrl.hash = '';
        const [navigation] = await Promise.all([
          page.waitForEvent(
            'response',
            (response) =>
              response.url() === launchUrl.href && response.request().resourceType() === 'document',
          ),
          openGraph.click(),
        ]);
        equal(navigation.status(), 200);
        await page.getByRole('heading', { name: view.heading }).waitFor();
        await page.getByRole('link', { name: /Back to/ }).click();
        equal(page.url(), overlay + skillGuidePath(view));
        await page.close();

        const fallback = await openPage(browser, { javaScriptEnabled: false });
        equal((await fallback.goto(staticSite + skillDemoPath(view)))?.status(), 200);
        const section = fallback.locator(`#${view.slug}`);
        await section
          .getByText('The interactive viewer is unavailable on this deployment.', { exact: false })
          .waitFor();
        await section.getByRole('heading', { name: view.staticHeading }).waitFor();
        await section
          .getByRole('link', { name: 'See the recorded skill graph in the guide' })
          .click();
        equal(fallback.url(), staticSite + skillGuidePath(view));
        const figure = fallback.locator(`img[src$="/${view.slug}-light.svg"]`);
        await figure.scrollIntoViewIfNeeded();
        await figure.evaluate((image) => image.decode());
        await fallback.close();
      }
    },
  );
}
