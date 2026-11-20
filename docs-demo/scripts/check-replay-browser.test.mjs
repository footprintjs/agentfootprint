import { deepStrictEqual, equal, notEqual, ok } from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  appVersion,
  demoPath,
  demoRoot,
  measureAssetBytes,
  openBrowser,
  openPage,
  recordDemoAssets,
  serve,
  versionedDemoPath,
} from './browser-test-helpers.mjs';

const { meta } = JSON.parse(
  await readFile(new URL('../../docs-next/lib/offline-replay-figure.json', import.meta.url), 'utf8'),
);
// Replay uses the shared renderer and saved chart. It measured 188,492 B gzip after drill, leaving 11,508 B.
const replayAssetLimit = 200_000;
// The Hello sample loads the published AgentFootprint and Lens runtime on demand.
// A complete run measured 868,184 B gzip, leaving 31,816 B of headroom.
const lensAssetLimit = 900_000;
const replay = {
  slug: 'offline-replay',
  guide: '/docs/debug/offline-replay/#replay-trace--the-chart-only-subset',
  heading: 'Offline replay',
  region: 'Offline replay flowchart',
  chunk: 'OfflineReplay',
  back: 'Back to Replay a saved run',
  launch: 'Explore the saved replay',
  fallback: 'See the recorded replay in the guide',
};
const lens = {
  slug: 'how-to-build-lens',
  guide: '/how-to-build/#debug',
  heading: 'See it in Lens',
  region: 'Lens run capture',
  chunk: 'HowToBuildLens',
  back: 'Back to How to Build',
  launch: 'Run the Lens example',
  fallback: 'See the Lens code in How to Build',
};

function trackPage(page, origin, demoUrl) {
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const assets = recordDemoAssets(page, demoUrl);
  return {
    assets,
    check() {
      deepStrictEqual(errors, []);
      deepStrictEqual([...new Set(assets.values())], [200], 'the demo assets resolve');
      ok(requests.every((url) => new URL(url).origin === origin), 'the demo makes no outbound requests');
    },
  };
}

test('offline replay opens the saved chart with live runtime assets blocked', { timeout: 30_000 }, async (t) => {
  const prefix = '/project';
  const origin = await serve(t, demoRoot, prefix + demoPath);
  const demoUrl = origin + prefix + demoPath;
  const browser = await openBrowser(t);
  const weather = await openPage(browser);
  const weatherAssets = recordDemoAssets(weather, demoUrl);
  equal((await weather.goto(demoUrl))?.status(), 200);
  await weather.getByRole('heading', { name: 'Quick Start weather trace' }).waitFor();
  await weather.locator('.react-flow__node-groupContainer[data-id="sf-llm-call"]').waitFor();
  await weather.close();

  // Permit only the existing pure renderer and this route's graph and controls.
  const replayAsset = (file) => weatherAssets.has(file) ||
    /^assets\/(?:OfflineReplay|subflowKeyboard)-[^/]+\.(?:js|css)$/.test(file);
  const emitted = (await readdir(resolve(demoRoot, 'assets'))).map((file) => `assets/${file}`);
  const forbidden = emitted.filter((file) => !replayAsset(file));
  for (const chunk of ['DynamicReactRun', lens.chunk]) {
    ok(forbidden.some((file) => file.startsWith(`assets/${chunk}-`)), `${chunk} is blocked in replay`);
  }
  const page = await openPage(browser);
  const { assets, check } = trackPage(page, origin, demoUrl);
  const blocked = [];
  await page.route(`${demoUrl}assets/**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice((prefix + demoPath).length);
    if (replayAsset(file)) return route.continue();
    blocked.push(file);
    return route.abort();
  });

  equal((await page.goto(origin + prefix + versionedDemoPath(replay)))?.status(), 200);
  await page.getByRole('heading', { name: replay.heading, exact: true }).waitFor();
  await page.getByText(`${meta.title}. No agent rerun.`, { exact: true }).waitFor();
  await page.getByText(`${meta.events} events · redaction: ${meta.redaction}`, { exact: true }).waitFor();
  await page.getByText(meta.input, { exact: false }).waitFor();
  await page.getByText(meta.result, { exact: true }).waitFor();
  await page.getByText(`agentfootprint@${appVersion}`, { exact: false }).waitFor();
  equal(await page.getByRole('button', { name: 'Run', exact: true }).count(), 0);

  const chart = page.getByRole('region', { name: replay.region });
  const groupedMount = chart.locator('.react-flow__node-groupContainer[data-id="sf-llm-call"]');
  await groupedMount.waitFor();
  await chart.getByText('System Prompt', { exact: true }).first().waitFor();
  const viewport = chart.locator('.react-flow__viewport');
  const beforeZoom = await viewport.getAttribute('style');
  await chart.getByRole('button', { name: 'Zoom In' }).click();
  await page.waitForFunction(
    (before) => document.querySelector('.react-flow__viewport')?.getAttribute('style') !== before,
    beforeZoom,
  );

  const grouped = page.getByRole('button', { name: 'Show grouped subflows' });
  await grouped.press('Enter');
  equal(await grouped.getAttribute('aria-pressed'), 'false');
  await groupedMount.waitFor({ state: 'detached' });
  const mount = chart.locator('.react-flow__node[data-id="sf-llm-call"][tabindex="0"]');
  const slot = chart.locator('.react-flow__node[data-id="sf-llm-call/sf-system-prompt"]');
  const breadcrumb = chart.getByRole('button', { name: 'Chart', exact: true });
  await mount.waitFor();
  await mount.focus();
  ok(await mount.evaluate((element) => document.activeElement === element),
    'the ungrouped LLM mount receives keyboard focus');
  await page.keyboard.press('Enter');
  await breadcrumb.waitFor();
  await slot.waitFor();
  await page.keyboard.press('Tab');
  ok(await breadcrumb.evaluate((element) => document.activeElement === element),
    'after drilling, Tab focuses the Chart breadcrumb');
  await page.keyboard.press('Space');
  await mount.waitFor();
  equal(await slot.count(), 0);

  const theme = page.getByRole('button', { name: 'Dark theme' });
  const light = await chart.evaluate((element) => getComputedStyle(element).backgroundColor);
  await theme.press('Enter');
  equal(await theme.getAttribute('aria-pressed'), 'true');
  notEqual(await chart.evaluate((element) => getComputedStyle(element).backgroundColor), light);
  const back = page.getByRole('link', { name: replay.back, exact: false });
  equal(new URL(await back.getAttribute('href'), page.url()).href, origin + prefix + replay.guide);

  deepStrictEqual(blocked, [], 'the saved replay needs none of the blocked assets');
  ok([...assets.keys()].some((file) => file.startsWith(`assets/${replay.chunk}-`)));
  check();
  await measureAssetBytes('Offline replay requested assets', [...assets.keys()], replayAssetLimit);
});

test('the documented Hello sample runs in Lens', { timeout: 30_000 }, async (t) => {
  const prefix = '/project';
  const origin = await serve(t, demoRoot, prefix + demoPath);
  const browser = await openBrowser(t);
  const page = await openPage(browser);
  const { assets, check } = trackPage(page, origin, origin + prefix + demoPath);

  equal((await page.goto(origin + prefix + versionedDemoPath(lens)))?.status(), 200);
  await page.getByRole('heading', { name: lens.heading, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run', exact: true }).press('Enter');
  await page.getByRole('status', { name: 'Mock answer' }).filter({ hasText: /^Hi!$/ }).waitFor();
  const capture = page.getByRole('region', { name: lens.region });
  await capture.locator('.react-flow__node').first().waitFor();
  await capture.getByRole('listbox', { name: 'Run timeline' })
    .getByRole('option', { name: /Final/ }).waitFor();
  const back = page.getByRole('link', { name: lens.back, exact: false });
  equal(new URL(await back.getAttribute('href'), page.url()).href, origin + prefix + lens.guide);
  ok([...assets.keys()].some((file) => file.startsWith(`assets/${lens.chunk}-`)));
  ok(![...assets.keys()].some((file) => file.startsWith(`assets/${replay.chunk}-`)));
  check();
  await measureAssetBytes('How to Build Lens requested assets', [...assets.keys()], lensAssetLimit);
});

test('the built replay and Lens sample have script-free and unavailable-view fallbacks', { timeout: 30_000 }, async (t) => {
  const prefix = '/project';
  const origin = await serve(t, demoRoot, prefix + demoPath);
  const browser = await openBrowser(t);
  const noscript = await openPage(browser, { javaScriptEnabled: false });
  for (const view of [replay, lens]) {
    const expected = origin + prefix + view.guide;
    const url = origin + prefix + versionedDemoPath(view);
    equal((await noscript.goto(url))?.status(), 200);
    const link = noscript.locator(`#${view.slug}`).getByRole('link');
    await link.waitFor();
    equal(new URL(await link.getAttribute('href'), noscript.url()).href, expected);

    const unavailable = await openPage(browser);
    const viewRequests = [];
    unavailable.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(`${prefix}${demoPath}assets/${view.chunk}-`)) {
        viewRequests.push(request.url());
      }
    });
    await unavailable.goto(url.replace(`agentfootprint=${appVersion}`, 'agentfootprint=0.0.0'));
    await unavailable.getByText('The interactive viewer is unavailable for this version.', { exact: false }).waitFor();
    deepStrictEqual(viewRequests, [], 'a rejected version does not request its view chunk');
    const back = unavailable.getByRole('link', { name: view.back, exact: false });
    equal(new URL(await back.getAttribute('href'), unavailable.url()).href, expected);

    await unavailable.route(`**/assets/${view.chunk}-*.js`, (route) => route.abort());
    await unavailable.goto(url);
    await unavailable.getByText('The interactive viewer is unavailable.', { exact: false }).waitFor();
    equal(new URL(await back.getAttribute('href'), unavailable.url()).href, expected);
    await unavailable.close();
  }
});

if (process.env.DOCS_DEMO_EXPORT) {
  test('the exported replay and How to Build guides launch the app and work without it', { timeout: 30_000 }, async (t) => {
    const exportRoot = resolve(process.env.DOCS_DEMO_EXPORT);
    const overlay = await serve(t, exportRoot, '/', true);
    const staticSite = await serve(t, exportRoot, '/');
    const browser = await openBrowser(t);
    for (const view of [replay, lens]) {
      const page = await openPage(browser);
      const appRequests = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith(demoPath)) appRequests.push(request);
      });
      equal((await page.goto(overlay + view.guide))?.status(), 200);
      await page.locator(new URL(page.url()).hash).waitFor({ state: 'attached' });
      const launch = page.getByRole('link', { name: view.launch });
      await launch.scrollIntoViewIfNeeded();
      const url = new URL(await launch.getAttribute('href'), page.url());
      equal(url.href, overlay + versionedDemoPath(view));
      deepStrictEqual(appRequests, [], 'the exported guide makes no eager app requests');
      url.hash = '';
      const [navigation] = await Promise.all([
        page.waitForEvent('response', (response) =>
          response.url() === url.href && response.request().resourceType() === 'document'),
        launch.click(),
      ]);
      equal(navigation.status(), 200);
      equal(appRequests[0], navigation.request());
      await page.getByRole('heading', { name: view.heading, exact: true }).waitFor();
      if (view === replay) await page.getByRole('region', { name: replay.region }).waitFor();
      else await page.getByRole('button', { name: 'Run', exact: true }).waitFor();
      await page.getByRole('link', { name: view.back, exact: false }).click();
      equal(page.url(), overlay + view.guide);
      await page.close();

      const fallback = await openPage(browser, { javaScriptEnabled: false });
      equal((await fallback.goto(staticSite + view.guide))?.status(), 200);
      await fallback.getByRole('link', { name: view.launch }).click();
      equal(fallback.url(), staticSite + versionedDemoPath(view));
      const section = fallback.locator(`#${view.slug}`);
      await section.getByText('The interactive viewer is unavailable', { exact: false }).waitFor();
      await section.getByRole('link', { name: view.fallback }).click();
      equal(fallback.url(), staticSite + view.guide);
      if (view === replay) {
        const image = fallback.locator('img[src$="/offline-replay-light.svg"]');
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element) => element.decode());
        const link = fallback.getByRole('link', { name: 'Download the redacted Trace' });
        notEqual(await link.getAttribute('download'), null);
        const response = await fallback.request.get(new URL(await link.getAttribute('href'), fallback.url()).href);
        equal(response.status(), 200);
        const trace = await response.json();
        equal(trace.redaction, 'pii');
        equal(trace.events.length, meta.events);
        ok(trace.structure);
      } else {
        await fallback.locator('pre code').filter({ hasText: 'lensRecorder' })
          .filter({ hasText: 'Hello!' }).waitFor();
      }
      await fallback.close();
    }
  });
}
