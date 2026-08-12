/**
 * githubDeviceSignIn — let the REPORTER sign in, so the issue is filed as them.
 *
 *   import { githubDeviceSignIn } from 'agentfootprint/observe';
 *
 *   const signIn = await githubDeviceSignIn({ clientId: 'Iv1.0123456789abcdef' });
 *   show(`Go to ${signIn.verificationUri} and enter ${signIn.userCode}`);
 *   const { token, login } = await signIn.completed;   // resolves on authorize
 *
 * GitHub's OAuth **device flow**, spoken as three plain `fetch` calls and
 * nothing else: request a code, show it to the human, poll until they approve.
 * Zero dependencies, and it runs in a browser as well as on a server — there is
 * no client secret in this flow, which is exactly why it is the one that works
 * from a page.
 *
 * ## Why this exists beside a server token
 *
 * A server-side PAT files every report as the application. That is right for an
 * automated "Report a problem" button: the app owns the repo, the app owns the
 * token. It is wrong when the value is ATTRIBUTION — a field tester filing
 * upstream should appear as themselves, so a maintainer can ask them a
 * follow-up question and so their report counts as theirs.
 *
 * | | server PAT | device sign-in |
 * |---|---|---|
 * | Who the issue is from | the application | the reporter |
 * | Where the token lives | server environment | the reporter's session, in memory |
 * | Human steps | none | one: enter a code, approve |
 * | Right for | in-app "report a problem" | field testers filing upstream |
 *
 * The token this returns is handed to {@link githubBugReporter} as `token`,
 * with no special-casing anywhere: a token is a token.
 *
 * ## Keep it in memory, for the session only
 *
 * **Never `localStorage`, never a cookie, never a log line.** A device-flow
 * token is a live credential for the account that approved it; persisting it in
 * a browser turns one XSS into a lasting account compromise. Hold it in a
 * variable, use it, drop it when the tab closes.
 *
 * ## Scopes are coarse here, and that is GitHub's design
 *
 * The device flow issues a CLASSIC OAuth token, and classic scopes are coarse:
 * `public_repo` (the default here) grants write across every public repository
 * the account can reach, and `repo` grants it across private ones too. There is
 * no fine-grained equivalent in this flow. That trade buys attribution — the
 * issue is really from that person — and it is the reason the default stops at
 * `public_repo`: filing an issue needs no more, and the token disappears with
 * the session. Where least privilege matters more than attribution, use a
 * fine-grained PAT on a server instead (see {@link githubBugReporter}).
 *
 * ## The collaborator caveat, stated rather than discovered
 *
 * A reporter who signs in as themselves can file an issue on a public repo, and
 * can commit evidence ONLY to a repository they can write to. Pointing
 * `evidenceRepo` at a private repo the reporter is not a collaborator on will
 * fail with a 404 (GitHub hides private repos from tokens that cannot see
 * them). Either add the reporter as a collaborator, or let them attach the zip
 * to the issue by hand — `exportBugReport` gives them the file either way.
 *
 * ## Secrecy
 *
 * The token appears in no message this module can produce. The three failure
 * shapes of the flow — the human denied it, the code expired, the poll was
 * aborted — are named plainly, with GitHub's `error_description` only, never a
 * response body or a request.
 */

/** The endpoints, so a GitHub Enterprise Server deployment can move them. */
const DEFAULT_AUTH_BASE = 'https://github.com';
const DEFAULT_API_BASE = 'https://api.github.com';

export interface GithubDeviceSignInOptions {
  /**
   * The OAuth App's client id. **Public by design** — the device flow has no
   * client secret, so this belongs in your front-end code. Create the app once
   * under the organisation, tick "Enable Device Flow", and copy the id.
   */
  readonly clientId: string;
  /**
   * Classic OAuth scopes. Default `['public_repo']` — enough to file an issue
   * and commit to a public evidence repo, and no more. `['repo']` is what a
   * private evidence repo needs, and it is a much larger grant; ask for it only
   * when the flow really commits there.
   */
  readonly scopes?: readonly string[];
  /** Cancel the polling (a closed dialog, an unmounted component). */
  readonly signal?: AbortSignal;
  /** GitHub's web origin. GHES: `https://github.your-company.com`. */
  readonly authBase?: string;
  /** GitHub's API root. GHES: `https://github.your-company.com/api/v3`. */
  readonly apiBase?: string;
  /** Test seam — inject `fetch`. Bypasses the network entirely. */
  readonly _fetch?: typeof fetch;
  /** Test seam — inject the wait between polls. */
  readonly _sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Who signed in, and with what. */
export interface GithubDeviceIdentity {
  /** The access token. Memory-only; see the module docs. */
  readonly token: string;
  /** Usually `bearer`. */
  readonly tokenType: string;
  /** The scopes GitHub actually granted — not necessarily the ones asked for. */
  readonly scopes: readonly string[];
  /** The GitHub login the issue will be filed as. `undefined` if `/user` refused. */
  readonly login?: string;
}

/** The code to show a human, and the promise that resolves when they approve. */
export interface GithubDeviceSignIn {
  /** The code the human types — show it verbatim, it is case-sensitive. */
  readonly userCode: string;
  /** The page they type it into. */
  readonly verificationUri: string;
  /** Seconds until `userCode` stops working. */
  readonly expiresIn: number;
  /** Seconds GitHub asked us to wait between polls. */
  readonly interval: number;
  /**
   * Resolves when the human approves, rejects when they deny it, when the code
   * expires, or when `signal` aborts. Polling starts immediately — awaiting
   * this later does not miss an approval.
   */
  readonly completed: Promise<GithubDeviceIdentity>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const abortedError = (): Error =>
  new Error('githubDeviceSignIn: sign-in was cancelled before the code was approved.');

/**
 * Start a device-flow sign-in.
 *
 * Resolves as soon as GitHub hands back a code — that is the point, because
 * the human cannot approve a code they have not been shown. The waiting happens
 * on the returned `completed` promise.
 *
 * @throws TypeError when `clientId` is missing (naming where it comes from).
 * @throws Error naming the status when GitHub refuses to issue a code.
 */
export async function githubDeviceSignIn(
  options: GithubDeviceSignInOptions,
): Promise<GithubDeviceSignIn> {
  if (typeof options?.clientId !== 'string' || options.clientId.trim() === '') {
    throw new TypeError(
      'githubDeviceSignIn: `clientId` is required. Create an OAuth App once under your ' +
        'organisation (Settings → Developer settings → OAuth Apps), tick "Enable Device ' +
        'Flow", and pass its Client ID here. It is public by design — the device flow has no ' +
        'client secret, which is why it can run in a browser.',
    );
  }

  const authBase = (options.authBase ?? DEFAULT_AUTH_BASE).replace(/\/+$/, '');
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const doFetch = options._fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options._sleep ?? defaultSleep;
  const scopes = options.scopes ?? ['public_repo'];

  const start = await postForm({
    doFetch,
    url: `${authBase}/login/device/code`,
    what: 'request a device code',
    form: { client_id: options.clientId, scope: scopes.join(' ') },
  });

  const deviceCode = stringField(start, 'device_code');
  const userCode = stringField(start, 'user_code');
  const verificationUri = stringField(start, 'verification_uri');
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error(
      `githubDeviceSignIn: GitHub did not return a device code${errorSuffix(start)}. Check that ` +
        'the OAuth App exists and has Device Flow enabled.',
    );
  }
  const expiresIn = numberField(start, 'expires_in') ?? 900;
  const interval = numberField(start, 'interval') ?? 5;

  const completed = pollForToken({
    doFetch,
    sleep,
    authBase,
    apiBase,
    clientId: options.clientId,
    deviceCode,
    interval,
    expiresIn,
    ...(options.signal !== undefined && { signal: options.signal }),
  });
  // Nobody has to await `completed` for polling to run; make sure an unawaited
  // rejection is not an unhandled one in the meantime.
  completed.catch(() => undefined);

  return { userCode, verificationUri, expiresIn, interval, completed };
}

async function pollForToken(args: {
  readonly doFetch: typeof fetch;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly authBase: string;
  readonly apiBase: string;
  readonly clientId: string;
  readonly deviceCode: string;
  readonly interval: number;
  readonly expiresIn: number;
  readonly signal?: AbortSignal;
}): Promise<GithubDeviceIdentity> {
  let waitSeconds = args.interval;
  const deadline = Date.now() + args.expiresIn * 1000;

  for (;;) {
    if (args.signal?.aborted) throw abortedError();
    await args.sleep(waitSeconds * 1000, args.signal);
    if (Date.now() > deadline) {
      throw new Error(
        `githubDeviceSignIn: the code expired after ${args.expiresIn}s without being ` +
          'approved. Start the sign-in again to get a fresh one.',
      );
    }

    const body = await postForm({
      doFetch: args.doFetch,
      url: `${args.authBase}/login/oauth/access_token`,
      what: 'exchange the device code',
      form: {
        client_id: args.clientId,
        device_code: args.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    });

    const token = stringField(body, 'access_token');
    if (token) {
      const scope = stringField(body, 'scope') ?? '';
      const login = await readLogin(args.doFetch, args.apiBase, token);
      return {
        token,
        tokenType: stringField(body, 'token_type') ?? 'bearer',
        scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : [],
        ...(login !== undefined && { login }),
      };
    }

    const error = stringField(body, 'error');
    switch (error) {
      case 'authorization_pending':
        // The human has not finished yet. This is the normal answer.
        break;
      case 'slow_down':
        // GitHub's own back-pressure: it tells us the new interval, and polling
        // faster than it asked gets the flow rate-limited out entirely.
        waitSeconds = numberField(body, 'interval') ?? waitSeconds + 5;
        break;
      case 'expired_token':
        throw new Error(
          'githubDeviceSignIn: the code expired before it was approved. Start the sign-in ' +
            'again to get a fresh one.',
        );
      case 'access_denied':
        throw new Error(
          'githubDeviceSignIn: the sign-in was denied on GitHub, so no token was issued. ' +
            'Nothing has been filed.',
        );
      default:
        throw new Error(
          `githubDeviceSignIn: GitHub refused the device code exchange${errorSuffix(body)}.`,
        );
    }
  }
}

/** Attribution: which login will the issue read as? Never fatal — a token that
 *  cannot read `/user` can still file an issue. */
async function readLogin(
  doFetch: typeof fetch,
  apiBase: string,
  token: string,
): Promise<string | undefined> {
  try {
    const res = await doFetch(`${apiBase}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { login?: unknown };
    return typeof body?.login === 'string' ? body.login : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One `application/x-www-form-urlencoded` POST that asks for JSON back.
 *
 * The device flow's endpoints answer form-encoded by default; `accept: json` is
 * what makes them speak JSON. A thrown fetch is re-wrapped so no implementation
 * can put the request — which carries the device code, and later the token — in
 * the message.
 */
async function postForm(args: {
  readonly doFetch: typeof fetch;
  readonly url: string;
  readonly what: string;
  readonly form: Readonly<Record<string, string>>;
}): Promise<Record<string, unknown>> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await args.doFetch(args.url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(args.form).toString(),
    });
  } catch (err) {
    throw new Error(
      `githubDeviceSignIn: could not reach GitHub to ${args.what} ` +
        `(${err instanceof Error ? err.name || 'network error' : 'network error'}).`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  // A 4xx/5xx with no parsed error field is all we may say: the response body
  // of this endpoint can echo the request.
  if (!res.ok && typeof record.error !== 'string') {
    throw new Error(
      `githubDeviceSignIn: GitHub answered ${res.status} when asked to ${args.what}.`,
    );
  }
  return record;
}

const stringField = (body: Record<string, unknown>, key: string): string | undefined =>
  typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : undefined;

const numberField = (body: Record<string, unknown>, key: string): number | undefined =>
  typeof body[key] === 'number' ? (body[key] as number) : undefined;

/** GitHub's `error` / `error_description` — the only response text we echo. */
function errorSuffix(body: Record<string, unknown>): string {
  const code = stringField(body, 'error');
  const description = stringField(body, 'error_description');
  if (!code && !description) return '';
  return ` (${[code, description].filter(Boolean).join(': ').slice(0, 200)})`;
}
