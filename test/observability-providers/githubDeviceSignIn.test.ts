/**
 * githubDeviceSignIn — 7-pattern tests.
 *
 *   P1 Unit         — the device-code call, and the code handed back at once
 *   P2 Boundary     — missing clientId; `slow_down`; expiry; abort
 *   P3 Scenario     — pending → pending → approved → the login for attribution
 *   P4 Property     — the default scope is `public_repo`; granted scopes are
 *                     read from GitHub's answer, not from what we asked for
 *   P5 Security     — THE SECRECY PIN: denied / expired / transport failures
 *                     carry no token; a failing `/user` is not fatal
 *   P6 Performance  — one poll per interval, no busy loop
 *   P7 ROI          — the token goes into githubBugReporter unchanged
 *
 * No network and no real waiting: `_fetch` and `_sleep` are both injected.
 */

import { describe, expect, it } from 'vitest';

import { githubDeviceSignIn } from '../../src/doors/observe.js';

const TOKEN = 'gho_deviceFlowFakeToken_9821';

interface Step {
  readonly body: Record<string, unknown>;
  readonly status?: number;
}

interface Script {
  readonly device?: Step;
  /** One entry per poll, in order. The last repeats. */
  readonly polls?: readonly Step[];
  readonly user?: Step;
  readonly transportError?: Error;
}

function fakeGithub(script: Script): {
  fetch: typeof fetch;
  calls: { url: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  let poll = 0;
  const impl = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const options = (init ?? {}) as { body?: string; headers?: Record<string, string> };
    calls.push({ url, body: options.body ?? '', headers: options.headers ?? {} });
    if (script.transportError) throw script.transportError;

    if (url.endsWith('/login/device/code')) {
      const step = script.device ?? {
        body: {
          device_code: 'dev-code-123',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      };
      return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
    }
    if (url.endsWith('/login/oauth/access_token')) {
      const steps = script.polls ?? [
        { body: { access_token: TOKEN, token_type: 'bearer', scope: 'public_repo' } },
      ];
      const step = steps[Math.min(poll, steps.length - 1)]!;
      poll++;
      return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
    }
    if (url.endsWith('/user')) {
      const step = script.user ?? { body: { login: 'field-tester' } };
      return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

/** No real waiting — and it records how long each wait asked for. */
function fakeSleep(): {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  waits: number[];
} {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number, signal?: AbortSignal) => {
      waits.push(ms);
      return signal?.aborted
        ? Promise.reject(new Error('githubDeviceSignIn: sign-in was cancelled'))
        : Promise.resolve();
    },
  };
}

const signIn = (script: Script, extra: Record<string, unknown> = {}) => {
  const github = fakeGithub(script);
  const clock = fakeSleep();
  return {
    github,
    clock,
    start: () =>
      githubDeviceSignIn({
        clientId: 'Iv1.0123456789abcdef',
        _fetch: github.fetch,
        _sleep: clock.sleep,
        ...extra,
      }),
  };
};

async function failureStrings(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const error = err as Error;
    return [
      error.message,
      error.stack ?? '',
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ].join('\n');
  }
  throw new Error('expected the call to fail, and it did not');
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('githubDeviceSignIn — P1 unit', () => {
  it('P1 asks for a device code and hands the human’s code back immediately', async () => {
    const { start, github } = signIn({});
    const flow = await start();
    expect(flow.userCode).toBe('WXYZ-1234');
    expect(flow.verificationUri).toBe('https://github.com/login/device');
    expect(flow.expiresIn).toBe(900);
    expect(flow.interval).toBe(5);
    expect(github.calls[0]!.url).toBe('https://github.com/login/device/code');
    expect(github.calls[0]!.body).toContain('client_id=Iv1.0123456789abcdef');
  });

  it('P1 GHES bases move both endpoints', async () => {
    const { start, github } = signIn(
      {},
      { authBase: 'https://github.acme.internal', apiBase: 'https://github.acme.internal/api/v3' },
    );
    const flow = await start();
    await flow.completed;
    expect(github.calls[0]!.url).toBe('https://github.acme.internal/login/device/code');
    expect(github.calls.at(-1)!.url).toBe('https://github.acme.internal/api/v3/user');
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('githubDeviceSignIn — P2 boundary', () => {
  it('P2 a missing clientId is refused, naming where it comes from', async () => {
    await expect(githubDeviceSignIn({ clientId: '  ' })).rejects.toThrow(
      /OAuth App.*Enable Device Flow.*public by design/s,
    );
  });

  it('P2 a device-code call that returns no code is refused by name', async () => {
    const { start } = signIn({ device: { body: { error: 'unauthorized_client' } } });
    await expect(start()).rejects.toThrow(/did not return a device code.*unauthorized_client/s);
  });

  it('P2 `slow_down` is honoured — the next wait uses GitHub’s new interval', async () => {
    const { start, clock } = signIn({
      polls: [
        { body: { error: 'slow_down', interval: 12 } },
        { body: { access_token: TOKEN, token_type: 'bearer', scope: 'public_repo' } },
      ],
    });
    await (
      await start()
    ).completed;
    expect(clock.waits).toEqual([5000, 12000]);
  });

  it('P2 an expired code rejects with the restart instruction', async () => {
    const { start } = signIn({ polls: [{ body: { error: 'expired_token' } }] });
    await expect((await start()).completed).rejects.toThrow(/expired.*Start the sign-in again/s);
  });

  it('P2 an aborted sign-in rejects rather than polling forever', async () => {
    const controller = new AbortController();
    controller.abort();
    const { start } = signIn(
      { polls: [{ body: { error: 'authorization_pending' } }] },
      {
        signal: controller.signal,
      },
    );
    await expect((await start()).completed).rejects.toThrow(/cancelled/);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('githubDeviceSignIn — P3 scenario', () => {
  it('P3 pending → pending → approved, and the login comes back for attribution', async () => {
    const { start, github } = signIn({
      polls: [
        { body: { error: 'authorization_pending' } },
        { body: { error: 'authorization_pending' } },
        { body: { access_token: TOKEN, token_type: 'bearer', scope: 'public_repo,read:user' } },
      ],
    });
    const flow = await start();
    const identity = await flow.completed;
    expect(identity.token).toBe(TOKEN);
    expect(identity.tokenType).toBe('bearer');
    expect(identity.scopes).toEqual(['public_repo', 'read:user']);
    expect(identity.login).toBe('field-tester');
    expect(github.calls.filter((call) => call.url.endsWith('/access_token'))).toHaveLength(3);
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('githubDeviceSignIn — P4 property', () => {
  it('P4 the default scope is exactly `public_repo`', async () => {
    const { start, github } = signIn({});
    await start();
    expect(decodeURIComponent(github.calls[0]!.body)).toContain('scope=public_repo');
  });

  it('P4 the GRANTED scopes are GitHub’s answer, not what we asked for', async () => {
    const { start } = signIn(
      { polls: [{ body: { access_token: TOKEN, scope: 'public_repo' } }] },
      { scopes: ['repo', 'read:user'] },
    );
    expect((await (await start()).completed).scopes).toEqual(['public_repo']);
  });
});

// ─── P5 Security — THE SECRECY PIN ───────────────────────────────────

describe('githubDeviceSignIn — P5 security', () => {
  it('P5 no failure path can put the token in a message', async () => {
    const failures = await Promise.all([
      failureStrings(
        async () =>
          (
            await signIn({ polls: [{ body: { error: 'access_denied' } }] }).start()
          ).completed,
      ),
      failureStrings(
        async () =>
          (
            await signIn({ polls: [{ body: { error: 'expired_token' } }] }).start()
          ).completed,
      ),
      failureStrings(
        async () =>
          (
            await signIn({ polls: [{ body: { error: 'incorrect_device_code' } }] }).start()
          ).completed,
      ),
      failureStrings(
        async () => (await signIn({ polls: [{ body: {}, status: 500 }] }).start()).completed,
      ),
      // A fetch that echoes its own request — which by then carries the token.
      failureStrings(() =>
        signIn({
          transportError: new Error(`socket hang up — POST /login/oauth/access_token → ${TOKEN}`),
        }).start(),
      ),
    ]);
    for (const text of failures) {
      expect(text, `a failure leaked the token:\n${text}`).not.toContain(TOKEN);
    }
  });

  it('P5 a denial says nothing was filed', async () => {
    const { start } = signIn({ polls: [{ body: { error: 'access_denied' } }] });
    await expect((await start()).completed).rejects.toThrow(/denied.*Nothing has been filed/s);
  });

  it('P5 a `/user` that refuses is not fatal — the token still works, the login is absent', async () => {
    const { start } = signIn({ user: { body: { message: 'Bad credentials' }, status: 401 } });
    const identity = await (await start()).completed;
    expect(identity.token).toBe(TOKEN);
    expect(identity.login).toBeUndefined();
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('githubDeviceSignIn — P6 performance', () => {
  it('P6 one poll per interval, and it waits BEFORE the first one', async () => {
    const { start, clock } = signIn({
      polls: [
        { body: { error: 'authorization_pending' } },
        { body: { access_token: TOKEN, scope: 'public_repo' } },
      ],
    });
    await (
      await start()
    ).completed;
    expect(clock.waits).toEqual([5000, 5000]);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('githubDeviceSignIn — P7 ROI', () => {
  it('P7 the token it returns is just a token — the reporter takes it as-is', async () => {
    const { start } = signIn({});
    const { token, login } = await (await start()).completed;
    expect(login).toBe('field-tester');
    // No special casing anywhere: this is the same option a PAT arrives on.
    const { githubBugReporter } = await import('../../src/doors/observe.js');
    expect(() => githubBugReporter({ issueRepo: 'acme/a', token })).not.toThrow();
  });
});
