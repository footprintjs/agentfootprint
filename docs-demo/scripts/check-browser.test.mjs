import { deepStrictEqual, equal, notEqual, ok } from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
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

const guidePath = '/docs/getting-started/quick-start/';
const guideAnchor = '#the-run-as-a-flowchart';
const dynamicReactGuide = '/docs/build/dynamic-react/';
const weatherAssetLimit = 200_000;
// Historical measurements for the former Next deferred-demo budget:
// https://github.com/footprintjs/agentfootprint/blob/5a0e6720b062ea989f6a6b14ce76995957df77ed/docs-next/scripts/check-site-budget.mjs#L347-L595
const deferredSkillAssetLimit = 492_000;
// The live view loads the published AgentFootprint and Lens runtime on demand.
// A complete run measured 869,863 B gzip, leaving 30,137 B of headroom.
const dynamicReactLiveAssetLimit = 900_000;
// The raw view measured 188,836 B gzip after drilling, leaving 11,164 B of headroom.
const dynamicReactSubflowsAssetLimit = 200_000;
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
const dynamicReactViews = [
  {
    slug: 'dynamic-react',
    anchor: 'try-it-live',
    heading: 'Dynamic ReAct live demo',
    region: 'Run capture',
    chunk: 'DynamicReactRun',
    launchLink: 'Run the interactive Dynamic ReAct demo',
    staticLink: 'See the recorded Dynamic ReAct run in the guide',
    assetLimit: dynamicReactLiveAssetLimit,
    inspect: inspectDynamicReactRun,
  },
  {
    slug: 'dynamic-react-subflows',
    anchor: 'how-every-iteration-actually-works',
    heading: 'Dynamic ReAct subflows',
    region: 'Raw LLM-call subflows',
    chunk: 'DynamicReactSubflows',
    launchLink: 'Explore the raw LLM-call subflows',
    staticLink: 'See the context slot diagram in the guide',
    assetLimit: dynamicReactSubflowsAssetLimit,
    inspect: inspectDynamicReactSubflows,
  },
];
const dynamicReactAnswer = 'Done. Refund of $42 issued for [EMAIL]. You should see it in 3-5 business days.';
function dynamicReactGuidePath({ anchor }) {
  return `${dynamicReactGuide}#${anchor}`;
}

function skillGuidePath({ slug, anchor }) {
  return `/docs/build/${slug}/#${anchor}`;
}

async function inspectDynamicReactRun(page, view) {
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('Contact demo@example.test to refund $42, please.');
  await message.press('Enter');
  const pending = page.getByRole('button', { name: 'Running…', exact: true });
  await pending.waitFor();
  ok(await pending.isDisabled());
  ok(await message.isDisabled());
  const capture = page.getByRole('region', { name: view.region });
  await capture.locator('.react-flow__node').first().waitFor();
  await page.getByRole('status').filter({ hasText: dynamicReactAnswer }).waitFor();
  const timeline = capture.getByRole('listbox', { name: 'Run timeline' });
  await timeline.waitFor();
  const calls = timeline.getByRole('option', { name: /Called (read_skill|redact_pii|process_refund)/ });
  await timeline.getByRole('option', { name: /Called process_refund/ }).waitFor();
  deepStrictEqual(
    (await calls.allTextContents()).map((label) => label.match(/Called (\w+)/)?.[1]),
    ['read_skill', 'redact_pii', 'process_refund'],
  );
  await timeline.getByRole('option', { name: /LLM · sf-llm-call 3$/ }).click();
  await timeline.getByText('[system-prompt] instructions:post-pii', { exact: true }).waitFor();
  await timeline.getByText('Contact [EMAIL] to refund $42, please.', { exact: true }).first().waitFor();
}

async function inspectDynamicReactSubflows(page, view) {
  const chart = page.getByRole('region', { name: view.region });
  const node = (id) => chart.locator(`.react-flow__node[data-id="${id}"]`);
  for (const stage of ['sf-injection-engine', 'sf-cache', 'call-llm']) {
    await node(`sf-llm-call/${stage}`).waitFor();
  }
  for (const slot of ['sf-system-prompt', 'sf-messages', 'sf-tools']) {
    await node(`sf-llm-call/${slot}`).waitFor();
    await chart.getByLabel(`Edge from sf-llm-call/context to sf-llm-call/${slot}`, { exact: true })
      .locator('.react-flow__edge-path[d^="M"]')
      .waitFor({ state: 'attached' });
  }
  const systemPrompt = node('sf-llm-call/sf-system-prompt').and(chart.locator('[tabindex="0"]'));
  const compose = node('sf-llm-call/sf-system-prompt/compose');
  await systemPrompt.focus();
  await page.keyboard.press('Enter');
  await compose.waitFor();
  ok(await chart.evaluate((element) => document.activeElement === element));
  await chart.getByRole('button', { name: 'LLM', exact: true }).press('Enter');
  await systemPrompt.waitFor();
  await systemPrompt.focus();
  await page.keyboard.press('Space');
  await compose.waitFor();
  await chart.getByRole('button', { name: 'Chart', exact: true }).click();
  const call = node('sf-llm-call');
  await call.waitFor();
  await call.click();
  await systemPrompt.waitFor();
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
    await measureAssetBytes('Quick Start viewer', weatherFiles, weatherAssetLimit);

    // The weather route exercises the shared entry and dependencies. Count the
    // deferred assets the two skill views actually load, excluding that shared entry.
    const builtAssets = await readdir(resolve(demoRoot, 'assets'));
    const skillChunk = builtAssets
      .map((asset) => `assets/${asset}`)
      .find((file) => /^assets\/SkillGraphTryItInner-.*\.js$/.test(file));
    ok(skillChunk && !weatherAssets.has(skillChunk),
      'the built skill renderer is deferred from the weather route');
    const skillAssets = new Set();

    for (const view of skillViews) {
      const page = await openPage(browser, { colorScheme: 'dark' });
      const errors = [];
      const requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      const assets = recordDemoAssets(page, origin + prefix + demoPath);
      equal((await page.goto(origin + prefix + versionedDemoPath(view)))?.status(), 200);
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
      for (const file of assets.keys()) {
        if (!weatherAssets.has(file)) skillAssets.add(file);
      }

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
    await measureAssetBytes('Deferred skill graph viewer', [...skillAssets], deferredSkillAssetLimit);
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
      equal((await noscript.goto(origin + versionedDemoPath(view)))?.status(), 200);
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
      origin + versionedDemoPath(view).replace(`agentfootprint=${appVersion}`, 'agentfootprint=0.0.0'),
    );
    await mismatch
      .getByText('The interactive viewer is unavailable for this version.', { exact: false })
      .waitFor();
    equal(await mismatch.getByRole('region', { name: 'Skill graph' }).count(), 0);
    const mismatchHref = await mismatch.getByRole('link', { name: /Back to/ }).getAttribute('href');
    equal(new URL(mismatchHref, mismatch.url()).href, origin + skillGuidePath(view));

    const blocked = await openPage(browser);
    await blocked.route('**/assets/SkillGraphTryItInner-*.js', (route) => route.abort());
    await blocked.goto(origin + versionedDemoPath(view));
    await blocked
      .getByText('The interactive viewer is unavailable. The guide has the recorded diagram.')
      .waitFor();
    const blockedHref = await blocked.getByRole('link', { name: /Back to/ }).getAttribute('href');
    equal(new URL(blockedHref, blocked.url()).href, origin + skillGuidePath(view));
  },
);

test(
  'the built Dynamic ReAct views run and drill with deferred assets',
  { timeout: 30_000 },
  async (t) => {
    const prefix = '/project';
    const origin = await serve(t, demoRoot, prefix + demoPath);
    const demoUrl = origin + prefix + demoPath;
    const browser = await openBrowser(t);
    const existingAssets = new Set();
    for (const view of [null, ...skillViews]) {
      const page = await openPage(browser);
      const assets = recordDemoAssets(page, demoUrl);
      equal((await page.goto(view ? origin + prefix + versionedDemoPath(view) : demoUrl))?.status(), 200);
      await page.getByRole('heading', { name: view?.heading ?? 'Quick Start weather trace' }).waitFor();
      await page.locator('.react-flow__node').first().waitFor();
      for (const file of assets.keys()) existingAssets.add(file);
      await page.close();
    }

    const dynamicAssets = new Set();
    for (const view of dynamicReactViews) {
      const page = await openPage(browser, { colorScheme: 'dark' });
      const errors = [];
      const requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      const assets = recordDemoAssets(page, demoUrl);
      equal((await page.goto(origin + prefix + versionedDemoPath(view)))?.status(), 200);
      await page.getByRole('heading', { name: view.heading }).waitFor();
      await page.getByText(`agentfootprint@${appVersion}`, { exact: false }).waitFor();
      await view.inspect(page, view);

      const theme = page.getByRole('button', { name: 'Dark theme' });
      const frame = page.locator('main');
      const panel = page.getByRole('region', { name: view.region });
      const darkPanel = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
      equal(await theme.getAttribute('aria-pressed'), 'true');
      equal(await frame.getAttribute('data-theme'), 'dark');
      await theme.press('Enter');
      equal(await theme.getAttribute('aria-pressed'), 'false');
      equal(await frame.getAttribute('data-theme'), 'light');
      notEqual(await panel.evaluate((element) => getComputedStyle(element).backgroundColor), darkPanel);
      const back = page.getByRole('link', { name: /Back to Dynamic ReAct/ });
      equal(new URL(await back.getAttribute('href'), page.url()).href,
        origin + prefix + dynamicReactGuidePath(view));

      const chunk = [...assets.keys()].find((file) => file.startsWith(`assets/${view.chunk}-`) && file.endsWith('.js'));
      ok(chunk && !existingAssets.has(chunk), `${view.slug} loads its own deferred viewer`);
      const otherView = dynamicReactViews.find(({ slug }) => slug !== view.slug);
      ok(![...assets.keys()].some((file) => file.startsWith(`assets/${otherView.chunk}-`)),
        `${view.slug} loads only the selected viewer`);
      deepStrictEqual([...new Set(assets.values())], [200], 'the dynamic assets resolve');
      deepStrictEqual(errors, []);
      ok(requests.every((url) => new URL(url).origin === origin), 'the demo makes no external requests');
      await measureAssetBytes(`${view.heading} requested assets`, [...assets.keys()], view.assetLimit);
      for (const file of assets.keys()) dynamicAssets.add(file);
      await page.close();
    }

    const dynamicOnly = [...dynamicAssets].filter((file) => !existingAssets.has(file));
    await measureAssetBytes('Dynamic ReAct exclusive requested assets', dynamicOnly);
    const emitted = (await readdir(resolve(demoRoot, 'assets'))).map((file) => `assets/${file}`);
    const deferred = emitted.filter((file) => !existingAssets.has(file));
    await measureAssetBytes('Emitted assets outside the weather and skill views', deferred);
    await measureAssetBytes('Complete emitted demo app', ['index.html', ...emitted]);
  },
);

test(
  'the built Dynamic ReAct views link back when scripts, the cohort, or the view chunk are unavailable',
  { timeout: 30_000 },
  async (t) => {
    const prefix = '/project';
    const origin = await serve(t, demoRoot, prefix + demoPath);
    const browser = await openBrowser(t);
    const noscript = await openPage(browser, { javaScriptEnabled: false });
    const blocked = await openPage(browser);
    for (const view of dynamicReactViews) {
      const url = origin + prefix + versionedDemoPath(view);
      const expected = origin + prefix + dynamicReactGuidePath(view);
      equal((await noscript.goto(url))?.status(), 200);
      const link = noscript.locator(`#${view.slug}`).getByRole('link');
      await link.waitFor();
      equal(new URL(await link.getAttribute('href'), noscript.url()).href, expected);

      const mismatch = await openPage(browser);
      const viewRequests = [];
      mismatch.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith(`${prefix}${demoPath}assets/${view.chunk}-`)) {
          viewRequests.push(request.url());
        }
      });
      await mismatch.goto(url.replace(`agentfootprint=${appVersion}`, 'agentfootprint=0.0.0'));
      await mismatch.getByText('The interactive viewer is unavailable for this version.', { exact: false }).waitFor();
      const mismatchBack = mismatch.getByRole('link', { name: /Back to Dynamic ReAct/ });
      equal(new URL(await mismatchBack.getAttribute('href'), mismatch.url()).href, expected);
      deepStrictEqual(viewRequests, [], 'a rejected cohort makes no request for the view chunk');
      await mismatch.close();

      await blocked.route(`**/assets/${view.chunk}-*.js`, (route) => route.abort());
      await blocked.goto(url);
      await blocked.getByText(/The interactive viewer is unavailable\. The guide has the recorded/).waitFor();
      const blockedBack = blocked.getByRole('link', { name: /Back to Dynamic ReAct/ });
      equal(new URL(await blockedBack.getAttribute('href'), blocked.url()).href, expected);
    }
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
      await page.locator(guideAnchor).waitFor({ state: 'attached' });
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
      await page.locator(guideAnchor).waitFor({ state: 'attached' });
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
    'the exported Dynamic ReAct guide opens both views and keeps the static record without the app',
    { timeout: 30_000 },
    async (t) => {
      const exportRoot = resolve(process.env.DOCS_DEMO_EXPORT);
      const overlay = await serve(t, exportRoot, '/', true);
      const staticSite = await serve(t, exportRoot, '/');
      const browser = await openBrowser(t);
      for (const view of dynamicReactViews) {
        const route = dynamicReactGuidePath(view);
        const page = await openPage(browser);
        const appRequests = [];
        page.on('request', (request) => {
          if (new URL(request.url()).pathname.startsWith(demoPath)) appRequests.push(request);
        });
        equal((await page.goto(overlay + route))?.status(), 200);
        await page.locator(`#${view.anchor}`).waitFor({ state: 'attached' });
        const launch = page.getByRole('link', { name: view.launchLink });
        await launch.scrollIntoViewIfNeeded();
        const url = new URL(await launch.getAttribute('href'), page.url());
        equal(url.href, overlay + versionedDemoPath(view));
        deepStrictEqual(appRequests, [], 'the guide fetches no demo bytes before navigation');
        url.hash = '';
        const [navigation] = await Promise.all([
          page.waitForEvent('response', (response) =>
            response.url() === url.href && response.request().resourceType() === 'document'),
          launch.click(),
        ]);
        equal(navigation.status(), 200);
        equal(appRequests[0], navigation.request());
        await page.getByRole('heading', { name: view.heading }).waitFor();
        await page.getByRole('link', { name: /Back to Dynamic ReAct/ }).click();
        equal(page.url(), overlay + route);
        await page.close();

        const fallback = await openPage(browser, { javaScriptEnabled: false });
        equal((await fallback.goto(staticSite + route))?.status(), 200);
        await fallback.getByRole('link', { name: view.launchLink }).click();
        equal(fallback.url(), staticSite + versionedDemoPath(view));
        const section = fallback.locator(`#${view.slug}`);
        await section.getByText('The interactive viewer is unavailable', { exact: false }).waitFor();
        await section.getByRole('link', { name: view.staticLink }).click();
        equal(fallback.url(), staticSite + route);
        if (view.slug === 'dynamic-react') {
          const recording = fallback.locator('figure').filter({ hasText: 'Final mock answer' });
          await recording.getByText(dynamicReactAnswer, { exact: false }).waitFor();
          await recording.getByRole('cell', {
            name: 'My account is [EMAIL] — please refund $42',
            exact: true,
          }).waitFor();
        } else {
          const figure = fallback.locator('img[src$="/dynamic-react-context-light.svg"]');
          await figure.scrollIntoViewIfNeeded();
          await figure.evaluate((image) => image.decode());
        }
        await fallback.close();
      }
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
        equal(launchUrl.href, overlay + versionedDemoPath(view));
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
        equal((await fallback.goto(staticSite + versionedDemoPath(view)))?.status(), 200);
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
