/**
 * googleIdentity — the narrow adapter, and the two things it refuses.
 *
 * The whole risk in a `CredentialProvider` is the SILENT DOWNGRADE: a request
 * that asked to act on behalf of a person, answered with a token scoped to the
 * agent. It succeeds, the data comes back, and nothing downstream can tell.
 * This adapter cannot vend a user token — Google's own per-user vault has no
 * Node surface — so it refuses, and these tests hold it to that.
 *
 * The second risk is secrecy: a message thrown from here reaches the LLM as a
 * tool result AND rides `agentfootprint.credential.failed` to every sink.
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';

import { CLOUD_PLATFORM_SCOPE, googleIdentity } from '../../../src/adapters/identity/google.js';
import { isCredentialIssued } from '../../../src/identity/types.js';

// ── Fixtures ────────────────────────────────────────────────────────

interface FakeState {
  readonly scopes: string[][];
  readonly impersonations: Record<string, unknown>[];
  getClientCalls: number;
}

function fakeSdk(
  options: {
    token?: string | null;
    expiryDate?: number | null;
    onGetAccessToken?: () => never;
    onGetClient?: () => never;
  } = {},
) {
  const state: FakeState = { scopes: [], impersonations: [], getClientCalls: 0 };

  const client = {
    getAccessToken: () => {
      if (options.onGetAccessToken) options.onGetAccessToken();
      return Promise.resolve({
        token: options.token === undefined ? 'ya29.a-token' : options.token,
      });
    },
    credentials: { expiry_date: options.expiryDate ?? null },
  };

  const sdk = {
    GoogleAuth: class {
      constructor(opts: { scopes?: readonly string[] }) {
        state.scopes.push([...(opts.scopes ?? [])]);
      }
      getClient() {
        state.getClientCalls += 1;
        if (options.onGetClient) options.onGetClient();
        return Promise.resolve(client);
      }
    },
    Impersonated: class {
      constructor(opts: Record<string, unknown>) {
        state.impersonations.push(opts);
      }
      getAccessToken() {
        return Promise.resolve({ token: 'impersonated-token' });
      }
      credentials = { expiry_date: options.expiryDate ?? null };
    },
  };

  return { sdk: sdk as never, state };
}

// ── The happy path ──────────────────────────────────────────────────

describe('vending the deployment’s own Google credential', () => {
  it('issues a bearer credential that applies itself to a request', async () => {
    const { sdk } = fakeSdk();
    const result = await googleIdentity({ _sdk: sdk }).getCredential({ service: 'sheets' });
    expect(isCredentialIssued(result)).toBe(true);
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.credential.kind).toBe('bearer');
    expect(result.credential.toHeaders()).toEqual({ authorization: 'Bearer ya29.a-token' });
  });

  it('reports the expiry in unix SECONDS, from the library’s milliseconds', async () => {
    const expiryMs = 1_800_000_000_000;
    const { sdk } = fakeSdk({ expiryDate: expiryMs });
    const result = await googleIdentity({ _sdk: sdk }).getCredential({ service: 'sheets' });
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.expiresAt).toBe(expiryMs / 1000);
  });

  it('omits the expiry when the library knows none — an invented one would be cached against', async () => {
    const { sdk } = fakeSdk({ expiryDate: null });
    const result = await googleIdentity({ _sdk: sdk }).getCredential({ service: 'sheets' });
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.expiresAt).toBeUndefined();
  });

  it('defaults to the cloud-platform scope', async () => {
    const { sdk, state } = fakeSdk();
    await googleIdentity({ _sdk: sdk }).getCredential({ service: 'sheets' });
    expect(state.scopes[0]).toEqual([CLOUD_PLATFORM_SCOPE]);
  });

  it('a request’s own scopes win over the provider’s default', async () => {
    const { sdk, state } = fakeSdk();
    await googleIdentity({ _sdk: sdk }).getCredential({
      service: 'sheets',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    expect(state.scopes[0]).toEqual(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  });

  it('caches the CLIENT, not the token — so the library’s own refresh keeps it fresh', async () => {
    const { sdk, state } = fakeSdk();
    const provider = googleIdentity({ _sdk: sdk });
    await provider.getCredential({ service: 'a' });
    await provider.getCredential({ service: 'b' });
    // One client, two vends: the second call still asked the client for a
    // token, which is where refresh happens.
    expect(state.getClientCalls).toBe(1);
  });

  it('a request with different scopes gets its OWN client, not one minted for the wrong ones', async () => {
    const { sdk, state } = fakeSdk();
    const provider = googleIdentity({ _sdk: sdk });
    await provider.getCredential({ service: 'a' });
    await provider.getCredential({ service: 'b', scopes: ['https://example.com/other'] });
    expect(state.getClientCalls).toBe(2);
    expect(state.scopes[1]).toEqual(['https://example.com/other']);
  });
});

// ── The refusals that stop a silent downgrade ───────────────────────

describe('what this provider will not quietly do', () => {
  it("mode: 'user' is refused by name, never served with a machine token", async () => {
    const { sdk, state } = fakeSdk();
    const error = await googleIdentity({ _sdk: sdk })
      .getCredential({ service: 'sheets', mode: 'user' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/mode: 'user'/);
    // The refusal teaches: it names what this provider IS, and what to do.
    expect(String(error)).toMatch(/deployment/i);
    expect(String(error)).toMatch(/mode: 'machine'/);
    // And nothing was vended on the way to refusing.
    expect(state.getClientCalls).toBe(0);
  });

  it("a userToken is refused rather than ignored — dropping somebody's proof is the same downgrade", async () => {
    const { sdk } = fakeSdk();
    const error = await googleIdentity({ _sdk: sdk })
      .getCredential({ service: 'sheets', mode: 'machine', userToken: 'eyJ.SECRET.jwt' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/userToken/);
    // The token itself is never echoed back.
    expect(String(error)).not.toContain('eyJ.SECRET.jwt');
  });

  it('an allowlisted provider refuses a service it does not serve, naming the fix', async () => {
    const { sdk } = fakeSdk();
    const error = await googleIdentity({ _sdk: sdk, services: ['sheets', 'drive'] })
      .getCredential({ service: 'github' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('github');
    expect(String(error)).toContain('sheets, drive');
  });

  it('with no allowlist it answers for any service — the caller knows which API they are calling', async () => {
    const { sdk } = fakeSdk();
    const result = await googleIdentity({ _sdk: sdk }).getCredential({ service: 'anything' });
    expect(result.status).toBe('issued');
  });

  it('a client that vends nothing is refused, quoting no value', async () => {
    const { sdk } = fakeSdk({ token: null });
    const error = await googleIdentity({ _sdk: sdk })
      .getCredential({ service: 'sheets' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/no access token/);
    expect(String(error)).toMatch(/secret/i);
  });
});

// ── Secrecy ─────────────────────────────────────────────────────────

describe('nothing this throws may carry a secret', () => {
  it('a failed token fetch reports the error NAME and never its text', async () => {
    const { sdk } = fakeSdk({
      onGetAccessToken: () => {
        const err = new Error('401 unauthorized: refresh_token=1//SECRET for alice@corp.com');
        err.name = 'GaxiosError';
        throw err;
      },
    });
    const error = await googleIdentity({ _sdk: sdk })
      .getCredential({ service: 'sheets' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('GaxiosError');
    expect(String(error)).not.toContain('1//SECRET');
    expect(String(error)).not.toContain('alice@corp.com');
    // Not attached as a cause either — that travels into every serializer.
    expect((error as Error).cause).toBeUndefined();
  });

  it('a missing credential names the fix rather than the library’s file paths', async () => {
    const { sdk } = fakeSdk({
      onGetClient: () => {
        throw new Error('Could not load /Users/someone/.config/gcloud/creds.json');
      },
    });
    const error = await googleIdentity({ _sdk: sdk })
      .getCredential({ service: 'sheets' })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe('GoogleCredentialsUnavailableError');
    expect(String(error)).toMatch(/application-default login/);
    expect(String(error)).not.toContain('/Users/someone');
  });
});

// ── Impersonation ───────────────────────────────────────────────────

describe('impersonating a service account', () => {
  it('wraps the environment’s client and carries the scopes through', async () => {
    const { sdk, state } = fakeSdk();
    const result = await googleIdentity({
      _sdk: sdk,
      impersonate: { targetPrincipal: 'runner@p.iam.gserviceaccount.com', lifetimeSeconds: 1800 },
    }).getCredential({ service: 'sheets' });

    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.credential.toHeaders()).toEqual({ authorization: 'Bearer impersonated-token' });
    expect(state.impersonations[0]).toMatchObject({
      targetPrincipal: 'runner@p.iam.gserviceaccount.com',
      targetScopes: [CLOUD_PLATFORM_SCOPE],
      lifetime: 1800,
    });
  });

  it('an impersonation with no target is refused at the point of use', async () => {
    const { sdk } = fakeSdk();
    await expect(
      googleIdentity({ _sdk: sdk, impersonate: { targetPrincipal: '' } }).getCredential({
        service: 'sheets',
      }),
    ).rejects.toThrow(/targetPrincipal/);
  });

  it('`Impersonated` really exists on the installed package — the pin note’s claim, checked', async () => {
    // The surface pin cannot cover this: it is a CONSTRUCTOR reached off the
    // module, not a method on the pinned `GoogleAuth` surface. So the claim is
    // asserted here instead of left as prose.
    const mod = (await import('google-auth-library')) as Record<string, unknown>;
    expect(typeof mod['Impersonated']).toBe('function');
    expect(typeof mod['GoogleAuth']).toBe('function');
  });
});

// ── Peer dependency ─────────────────────────────────────────────────

describe('the peer dependency', () => {
  it('is refused by name when it is not installed', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        throw new Error('Cannot find module');
      },
    }));
    try {
      const { googleIdentity: isolated } = await import('../../../src/adapters/identity/google.js');
      const error = await isolated()
        .getCredential({ service: 'sheets' })
        .catch((e: unknown) => e);
      expect(String(error)).toMatch(/google-auth-library/);
      expect(String(error)).toMatch(/npm install/);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('is not loaded at construction — only when the provider first vends', () => {
    vi.resetModules();
    let loaded = false;
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        loaded = true;
        throw new Error('Cannot find module');
      },
    }));
    try {
      googleIdentity();
      expect(loaded).toBe(false);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});
