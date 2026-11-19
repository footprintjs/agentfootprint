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
} from './browser-test-helpers.mjs';

const view = 'context-walkthrough';
const chunk = 'ContextWalkthrough';
const guide = '/context-engineering/';
const returnPath = `${guide}#context-answer-story`;
const heading = 'Recorded context walkthrough';
// The recorded snapshot and Lens context renderer measured 529,048 B gzip,
// leaving 20,952 B of headroom after inspection and step changes.
const contextAssetLimit = 550_000;
const { steps, commit } = JSON.parse(
  await readFile(new URL('../../docs-next/lib/context-walkthrough-figure.json', import.meta.url), 'utf8'),
);
const answerSteps = ['question', 'selection', 'reference', 'prepare', 'model', 'finding', 'answer'];
const conflictSteps = ['same-claim', 'conflict', 'pause', 'repair', 'check-output', 'checked-answer'];

function walkthroughPath(step, version = appVersion) {
  const query = new URLSearchParams({ view, agentfootprint: version, step });
  return `${demoPath}?${query}#${view}`;
}

async function checkRecordedValues(panel, id) {
  const { index, values } = steps[id];
  await panel.locator(`[data-testid="context-view"][data-step="${index}"]`).waitFor();
  const json = panel.getByTestId('context-json');
  await json.waitFor();
  const actual = JSON.parse(await json.textContent());
  for (const [key, value] of Object.entries(values)) {
    deepStrictEqual(actual[key], value, `${id}: ${key} matches the recorded excerpt`);
  }
}

test('the built context inspector reads recorded stops with the Agent runtime blocked', { timeout: 30_000 }, async (t) => {
  const prefix = '/project';
  const origin = await serve(t, demoRoot, prefix + demoPath);
  const demoUrl = origin + prefix + demoPath;
  const browser = await openBrowser(t);
  const page = await openPage(browser);
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assets = recordDemoAssets(page, demoUrl);

  // Find the pinned Agent build's tool registry independent of Vite's chunk names.
  const scripts = (await readdir(resolve(demoRoot, 'assets'))).filter((name) => name.endsWith('.js'));
  const agentRegistry = await Promise.all(scripts.map(async (file) => {
    const contents = await readFile(resolve(demoRoot, 'assets', file), 'utf8');
    return contents.includes('Tool names must be unique') ? file : undefined;
  }));
  const runtimeFiles = new Set(agentRegistry.filter(Boolean));
  ok(runtimeFiles.size, 'the built live demos contain the Agent tool registry');
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const file = url.pathname.split('/').at(-1);
    if (url.origin !== origin || runtimeFiles.has(file) ||
      /^(?:DynamicReactRun|HowToBuildLens)-.*\.js$/.test(file) ||
      ['fetch', 'xhr'].includes(request.resourceType())) {
      unexpected.push(request.url());
      return route.abort();
    }
    return route.continue();
  });

  const deepLink = origin + prefix + walkthroughPath('finding');
  equal((await page.goto(deepLink))?.status(), 200);
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await page.getByText('This inspector reads a saved mock run.').waitFor();
  await page.getByText(`agentfootprint@${appVersion}`, { exact: false }).waitFor();
  const releaseSource = page.getByRole('link', { name: commit.slice(0, 12) });
  await releaseSource.waitFor();
  equal(await page.getByRole('button', { name: 'Run', exact: true }).count(), 0);

  const menu = page.getByRole('combobox', { name: 'Answer step' });
  await menu.waitFor();
  equal(await menu.inputValue(), 'finding');
  deepStrictEqual(await menu.locator('option').evaluateAll((options) => options.map((option) => option.value)), answerSteps);
  const panel = page.getByRole('region', { name: 'Recorded context' });
  const inspector = panel.getByTestId('context-view');
  await inspector.getByText(/Answer 1/).first().waitFor();
  const findingCommit = await inspector.getAttribute('data-commit');
  await inspector.getByTestId('context-mode-json').press('Enter');
  await checkRecordedValues(panel, 'finding');

  await releaseSource.focus();
  await page.keyboard.press('Tab');
  ok(await menu.evaluate((element) => document.activeElement === element), 'the step select is reachable by keyboard');
  await menu.selectOption('answer');
  await page.waitForURL(origin + prefix + walkthroughPath('answer'));
  await inspector.getByText(/Run end/).first().waitFor();
  await checkRecordedValues(panel, 'answer');
  notEqual(await inspector.getAttribute('data-commit'), findingCommit);
  await menu.selectOption('reference');
  await page.waitForURL(origin + prefix + walkthroughPath('reference'));
  await checkRecordedValues(panel, 'reference');

  const theme = page.getByRole('button', { name: 'Dark theme' });
  const before = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
  await theme.press('Enter');
  equal(await theme.getAttribute('aria-pressed'), 'true');
  notEqual(await panel.evaluate((element) => getComputedStyle(element).backgroundColor), before);
  const back = page.getByRole('link', { name: /Back to Context Engineering/ });
  equal(new URL(await back.getAttribute('href'), page.url()).href, origin + prefix + returnPath);
  deepStrictEqual(errors, []);
  deepStrictEqual(unexpected, [], 'the inspector requests no live Agent chunks and makes no data requests');
  deepStrictEqual([...new Set(assets.values())], [200]);
  ok([...assets.keys()].some((file) => file.startsWith(`assets/${chunk}-`) && file.endsWith('.js')));
  await measureAssetBytes('Context walkthrough requested assets', [...assets.keys()], contextAssetLimit);
});

test('the built context walkthrough links to the static lesson when unavailable', { timeout: 30_000 }, async (t) => {
  const prefix = '/project';
  const origin = await serve(t, demoRoot, prefix + demoPath);
  const browser = await openBrowser(t);
  const noscript = await openPage(browser, { javaScriptEnabled: false });
  const expected = origin + prefix + returnPath;
  const route = origin + prefix + walkthroughPath('finding');
  equal((await noscript.goto(route))?.status(), 200);
  const link = noscript.locator(`#${view}`).getByRole('link');
  await link.waitFor();
  equal(new URL(await link.getAttribute('href'), noscript.url()).href, expected);

  const unavailable = await openPage(browser);
  const requests = [];
  unavailable.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith(`${prefix}${demoPath}assets/${chunk}-`)) {
      requests.push(request.url());
    }
  });
  await unavailable.goto(origin + prefix + walkthroughPath('finding', '0.0.0'));
  await unavailable.getByText('The interactive viewer is unavailable for this version.', { exact: false }).waitFor();
  deepStrictEqual(requests, [], 'an unsupported version does not load the inspector');
  const back = unavailable.getByRole('link', { name: /Back to Context Engineering/ });
  equal(new URL(await back.getAttribute('href'), unavailable.url()).href, expected);
  await unavailable.route(`**/assets/${chunk}-*.js`, (request) => request.abort());
  await unavailable.goto(route);
  await unavailable.getByText('The interactive viewer is unavailable.', { exact: false }).waitFor();
  equal(new URL(await back.getAttribute('href'), unavailable.url()).href, expected);
});

if (process.env.DOCS_DEMO_EXPORT) {
  test('the exported context lesson keeps both stories and opens the recorded inspector', { timeout: 30_000 }, async (t) => {
    const exportRoot = resolve(process.env.DOCS_DEMO_EXPORT);
    const overlay = await serve(t, exportRoot, '/', true);
    const staticSite = await serve(t, exportRoot, '/');
    const browser = await openBrowser(t);
    const page = await openPage(browser);
    const appRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(demoPath)) appRequests.push(request);
    });
    const anchor = '#context-answer-finding';
    equal((await page.goto(overlay + guide + anchor))?.status(), 200);
    const launch = page.locator(anchor).getByRole('link', { name: /Inspect this step in the demo/ });
    await launch.scrollIntoViewIfNeeded();
    const url = new URL(await launch.getAttribute('href'), page.url());
    equal(url.href, overlay + walkthroughPath('finding'));
    deepStrictEqual(appRequests, [], 'the static lesson makes no eager demo requests');
    url.hash = '';
    const [navigation] = await Promise.all([
      page.waitForEvent('response', (response) =>
        response.url() === url.href && response.request().resourceType() === 'document'),
      launch.click(),
    ]);
    equal(navigation.status(), 200);
    equal(appRequests[0], navigation.request());
    await page.getByRole('region', { name: 'Recorded context' }).waitFor();
    equal(await page.getByRole('combobox', { name: 'Answer step' }).inputValue(), 'finding');
    await page.getByRole('link', { name: /Back to Context Engineering/ }).click();
    equal(page.url(), overlay + returnPath);
    await page.close();

    const fallback = await openPage(browser, { javaScriptEnabled: false });
    equal((await fallback.goto(staticSite + guide + anchor))?.status(), 200);
    await fallback.locator(anchor).getByRole('link', { name: /Inspect this step in the demo/ }).click();
    equal(fallback.url(), staticSite + walkthroughPath('finding'));
    const section = fallback.locator(`#${view}`);
    await section.getByText('The interactive viewer is unavailable', { exact: false }).waitFor();
    await section.getByRole('link', { name: 'See the recorded context in the lesson' }).click();
    equal(fallback.url(), staticSite + returnPath);
    for (const [story, ids] of [['answer', answerSteps], ['conflict', conflictSteps]]) {
      for (const id of ids) {
        const step = fallback.locator(`#context-${story}-${id}`);
        await step.locator('.cx-visual .cx-scene').first().waitFor();
        const summary = story === 'answer' ? 'Recorded context excerpt' : 'Illustrative context JSON';
        await step.getByText(summary, { exact: true }).click();
        const code = step.locator('pre code');
        await code.waitFor();
        const values = JSON.parse(await code.textContent());
        if (story === 'answer') deepStrictEqual(values, steps[id].values);
        else ok(Object.keys(values).length > 0, `${id} retains its authored example`);
      }
    }
  });
}
