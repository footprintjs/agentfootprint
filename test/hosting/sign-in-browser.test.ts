/**
 * The redirect sign-in in a REAL browser (Playwright, headless Chromium),
 * against the fake IdP on ANOTHER SITE (`localhost` vs `127.0.0.1`).
 * PENDING INDEPENDENT REVIEW.
 *
 * What only a browser can prove (design §5.4, §11 "unverified"):
 *   • the `SameSite=Lax` transaction cookie comes back on the IdP's cross-site
 *     top-level redirect to the callback;
 *   • the `SameSite=Strict` sign-in cookie set by that callback is then sent on
 *     the page's own same-origin fetches — the first load after the IdP
 *     redirect works.
 *
 * Skipped (not failed) when no Chromium is available: set
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, or have a Playwright headless shell in the
 * user cache (`npx playwright-core install chromium-headless-shell`).
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mountRedirect, type MountedRedirect } from './signInRedirectHarness.js';

/** A Chromium this machine already has, or undefined. */
function chromium(): string | undefined {
  const pinned = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (pinned !== undefined && existsSync(pinned)) return pinned;
  const cache =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const shells = readdirSync(cache)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const dir of shells) {
    for (const sub of readdirSync(join(cache, dir))) {
      for (const exe of ['chrome-headless-shell', 'headless_shell', 'chrome-headless-shell.exe']) {
        const candidate = join(cache, dir, sub, exe);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

let playwright: typeof import('playwright-core') | undefined;
try {
  playwright = await import('playwright-core');
} catch {
  playwright = undefined;
}
const executablePath = chromium();
const describeBrowser =
  playwright !== undefined && executablePath !== undefined ? describe : describe.skip;

describeBrowser('redirect sign-in — a real browser', () => {
  let app: MountedRedirect;
  let browser: import('playwright-core').Browser;

  beforeAll(async () => {
    app = await mountRedirect({
      idpHost: 'localhost', // another SITE than the app: SameSite is really exercised
      appHost: '127.0.0.1',
      extraRoutes: (path) =>
        path === '/after'
          ? `<!doctype html><pre id="me">…</pre><script>
               fetch('/auth/me').then(async (r) => {
                 document.getElementById('me').textContent = r.status + ' ' + (await r.text());
               });
             </script>`
          : undefined,
    });
    browser = await (playwright as typeof import('playwright-core')).chromium.launch({
      executablePath: executablePath as string,
      headless: true,
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
  });

  it('the Lax transaction cookie survives the IdP redirect, and the Strict sign-in cookie reaches the page’s own fetch', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${app.url}/auth/login?returnTo=/after`);
    // The IdP's sign-in page, on localhost.
    await page.waitForSelector('#user');
    expect(new URL(page.url()).hostname).toBe('localhost');
    await page.fill('#user', 'alice');
    await Promise.all([page.waitForURL(`${app.url}/after`), page.click('#go')]);
    await page.waitForFunction(() => document.getElementById('me')?.textContent !== '…');
    const text = (await page.textContent('#me')) ?? '';
    expect(text.startsWith('200 ')).toBe(true);
    expect(text).toContain('Alice Archer');
    const cookies = await context.cookies(app.url);
    const signIn = cookies.find((c) => c.name === 'af-signin');
    expect(signIn).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookies.some((c) => c.name.startsWith('af-signin-tx-'))).toBe(false);
    await context.close();
  }, 60_000);

  it('script cannot read the sign-in cookie (HttpOnly)', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${app.url}/auth/login?returnTo=/after`);
    await page.fill('#user', 'bob');
    await Promise.all([page.waitForURL(`${app.url}/after`), page.click('#go')]);
    expect(await page.evaluate(() => document.cookie)).not.toContain('af-signin');
    await context.close();
  }, 60_000);
});
