/**
 * entraIdentity — the narrow Entra adapter, and the ONE design fact under
 * test: no silent downgrade, no leaked secret.
 *
 * The whole risk in a `CredentialProvider` is the SILENT DOWNGRADE: a request
 * that asked to act on behalf of a person, answered with a token scoped to
 * the agent. It succeeds, the data comes back, and nothing downstream can
 * tell. This adapter has no user-delegation surface (Entra OBO is a later
 * train), so it refuses `mode: 'user'` and `userToken` by name — and these
 * tests hold it to that.
 *
 * The second risk is secrecy: a message thrown from here reaches the LLM as a
 * tool result AND rides `agentfootprint.credential.failed` to every sink, so
 * no SDK text and no token value may ever ride a thrown message.
 *
 * Nothing here reaches Azure, needs `@azure/identity` installed, or touches
 * an env credential — fakes are injected through the `_credential` and `_sdk`
 * seams.
 *
 * The ONE exception is the peer-dependency block at the bottom, and it is the
 * repo's standing rule rather than a lapse (test/adapters/google/googlePin.ts:41-53):
 * a missing-peer refusal is proved by stubbing MODULE RESOLUTION — `vi.doMock`
 * on `lazyRequire` — never by the package happening to be absent from
 * node_modules. Absence is not a test seam: it is an environment fact that
 * anyone can flip by adding `@azure/identity` to devDependencies or by
 * checking this repo out inside a hoisting workspace, and when it flips a
 * unit test stops asserting a refusal and starts running the live
 * DefaultAzureCredential chain — `az account get-access-token` on a developer
 * box, a hang on the IMDS probe in CI. The stub makes the refusal
 * deterministic and keeps the promise this header makes.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AZURE_AI_SCOPE,
  AZURE_MANAGEMENT_SCOPE,
  entraIdentity,
} from '../../../src/adapters/identity/azure.js';
import type {
  AccessTokenLike,
  AzureIdentitySdkModule,
  TokenCredentialLike,
} from '../../../src/adapters/identity/azure.js';
import { isCredentialIssued } from '../../../src/identity/types.js';

// ── Fixtures ────────────────────────────────────────────────────────

interface FakeCredentialState {
  /** Every scopes argument getToken received, in call order. */
  readonly scopes: (string | readonly string[])[];
  getTokenCalls: number;
}

/** A pre-built TokenCredential double for the `_credential` seam. */
function fakeCredential(
  options: {
    token?: string;
    expiresOnTimestamp?: number;
    /**
     * Answer with NO `expiresOnTimestamp` field at all. The `??` default below
     * always substitutes one, so the absent case is otherwise unreachable —
     * and it is a real shape: the field is required in the duck type, but an
     * older SDK rung or a hand-rolled credential can omit it, and the adapter
     * promises to omit `expiresAt` rather than invent one.
     */
    omitExpiry?: boolean;
    /** Return this exact answer (e.g. `null`) instead of a token object. */
    answer?: AccessTokenLike | null;
    onGetToken?: () => never;
  } = {},
) {
  const state: FakeCredentialState = { scopes: [], getTokenCalls: 0 };
  const credential: TokenCredentialLike = {
    getToken(scopes) {
      state.scopes.push(scopes);
      state.getTokenCalls += 1;
      if (options.onGetToken) options.onGetToken();
      if ('answer' in options) return Promise.resolve(options.answer ?? null);
      if (options.omitExpiry) {
        // Cast on purpose: the point of the case is a response that does NOT
        // satisfy the declared shape, which is what the guard defends against.
        return Promise.resolve({ token: options.token ?? 'entra-access-token' } as AccessTokenLike);
      }
      return Promise.resolve({
        token: options.token ?? 'entra-access-token',
        expiresOnTimestamp: options.expiresOnTimestamp ?? 1_900_000_000_123,
      });
    },
  };
  return { credential, state };
}

interface FakeSdkState {
  constructions: number;
  readonly scopes: (string | readonly string[])[];
}

/** An `@azure/identity` module double for the `_sdk` seam. */
function fakeSdk(token = 'sdk-vended-token') {
  const state: FakeSdkState = { constructions: 0, scopes: [] };
  const sdk: AzureIdentitySdkModule = {
    DefaultAzureCredential: class {
      constructor() {
        state.constructions += 1;
      }
      getToken(scopes: string | readonly string[]) {
        state.scopes.push(scopes);
        return Promise.resolve({ token, expiresOnTimestamp: 1_900_000_000_123 });
      }
    },
  };
  return { sdk, state };
}

// ── The happy path (unit) ───────────────────────────────────────────

describe('vending the deployment’s own Entra credential', () => {
  it('issues a bearer credential that applies itself to a request', async () => {
    const { credential } = fakeCredential({ token: 'eyJ-entra-token' });
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
    });
    expect(isCredentialIssued(result)).toBe(true);
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.credential.kind).toBe('bearer');
    expect(result.credential.toHeaders()).toEqual({ authorization: 'Bearer eyJ-entra-token' });
  });

  it('reports the expiry in unix SECONDS, from the SDK’s milliseconds', async () => {
    const { credential } = fakeCredential({ expiresOnTimestamp: 1_900_000_000_123 });
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
    });
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    // Floor, not round: 1_900_000_000_123 ms → exactly 1_900_000_000 s.
    expect(result.expiresAt).toBe(1_900_000_000);
  });

  it('omits the expiry when the SDK reports a non-finite one — an invented one would be cached against', async () => {
    const { credential } = fakeCredential({ expiresOnTimestamp: Number.NaN });
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
    });
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.expiresAt).toBeUndefined();
  });

  // The guard is `finite && > 0`, and each clause earns its keep. NaN alone
  // does not pin it: relaxing `> 0` to `>= 0` — a plausible "why exclude
  // zero?" edit — turns a zero timestamp into `expiresAt: 0`, a 1970 expiry
  // that every caching caller reads as permanently expired and re-vends
  // against on literally every tool call. A negative one is the same bug with
  // a worse date. Absent is the third shape and the honest answer is the same:
  // report nothing rather than something made up.
  it.each([
    ['zero — a 1970 expiry reads as permanently expired, not as "unknown"', 0],
    ['negative — the same bug with a worse date', -1],
  ])('omits the expiry when the SDK reports %s', async (_case, expiresOnTimestamp) => {
    const { credential } = fakeCredential({ expiresOnTimestamp });
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
    });
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    expect(result.expiresAt).toBeUndefined();
  });

  it('omits the expiry when the response carries no `expiresOnTimestamp` at all', async () => {
    const { credential } = fakeCredential({ omitExpiry: true });
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
    });
    expect(isCredentialIssued(result)).toBe(true);
    if (!isCredentialIssued(result)) throw new Error('unreachable');
    // The token still vends — a missing expiry is not a failure, just unknown.
    expect(result.credential.toHeaders()).toEqual({
      authorization: 'Bearer entra-access-token',
    });
    expect(result.expiresAt).toBeUndefined();
  });

  it('defaults to the ai.azure.com data-plane scope', async () => {
    const { credential, state } = fakeCredential();
    await entraIdentity({ _credential: credential }).getCredential({ service: 'azure-ai' });
    expect(state.scopes[0]).toEqual([AZURE_AI_SCOPE]);
  });

  it('a request’s own scopes win over the provider’s configured default', async () => {
    const { credential, state } = fakeCredential();
    await entraIdentity({ _credential: credential, scopes: [AZURE_AI_SCOPE] }).getCredential({
      service: 'azure-management',
      scopes: [AZURE_MANAGEMENT_SCOPE],
    });
    expect(state.scopes[0]).toEqual([AZURE_MANAGEMENT_SCOPE]);
  });

  it('a request with EMPTY scopes falls back to the default rather than asking for nothing', async () => {
    const { credential, state } = fakeCredential();
    await entraIdentity({ _credential: credential }).getCredential({
      service: 'azure-ai',
      scopes: [],
    });
    expect(state.scopes[0]).toEqual([AZURE_AI_SCOPE]);
  });
});

// ── The refusals that stop a silent downgrade (scenario) ────────────

describe('what this provider will not quietly do', () => {
  it("mode: 'user' is refused by name, never served with a machine token", async () => {
    const { credential, state } = fakeCredential();
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai', mode: 'user' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('entraIdentity');
    expect(String(error)).toMatch(/mode: 'user'/);
    // The refusal teaches: it names what this provider IS, and the fix.
    expect(String(error)).toMatch(/Fix:/);
    expect(String(error)).toMatch(/mode: 'machine'/);
    // And nothing was vended on the way to refusing.
    expect(state.getTokenCalls).toBe(0);
  });

  it("a userToken is refused rather than ignored — dropping somebody's proof is the same downgrade", async () => {
    const { credential, state } = fakeCredential();
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai', mode: 'machine', userToken: 'eyJ.SECRET.jwt' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('entraIdentity');
    expect(String(error)).toMatch(/userToken/);
    // The token itself is never echoed back.
    expect(String(error)).not.toContain('eyJ.SECRET.jwt');
    expect(state.getTokenCalls).toBe(0);
  });

  it('an allowlisted provider refuses a service it does not serve, naming the fix', async () => {
    const { credential } = fakeCredential();
    const error = await entraIdentity({
      _credential: credential,
      services: ['azure-ai', 'azure-management'],
    })
      .getCredential({ service: 'github' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('github');
    expect(String(error)).toContain('azure-ai, azure-management');
    expect(String(error)).toMatch(/Fix:/);
  });

  it('with no allowlist it answers for any service — the caller knows which API they are calling', async () => {
    const { credential } = fakeCredential();
    const result = await entraIdentity({ _credential: credential }).getCredential({
      service: 'anything',
    });
    expect(result.status).toBe('issued');
  });

  it('getToken resolving to null is refused, quoting no value', async () => {
    const { credential } = fakeCredential({ answer: null });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/no access token/);
    expect(String(error)).toMatch(/secret/i);
  });

  it('an empty-string token is refused, described by field NAME only', async () => {
    const { credential } = fakeCredential({
      answer: { token: '', expiresOnTimestamp: 1_900_000_000_123 },
    });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/no access token/);
    expect(String(error)).toMatch(/`token` field/);
  });

  // The audience is the datum most often wrong on this path, and it is the one
  // datum in a token exchange that is NOT a secret — an audience URI is public
  // and printed in every Azure doc. Withholding it leaves the reader with
  // "could not mint for the requested scope" and no way to see WHICH scope was
  // requested; a tool that declares `needs` without `scopes` never typed the
  // provider's default anywhere. `entraBearerToken` in the same train reached
  // this conclusion out loud; these two assertions keep the siblings agreeing.
  /**
   * The DIAGNOSIS half — everything before the `Fix:` line. Asserting against
   * the whole message would not pin anything here: the fix line names both
   * audiences by way of teaching the split, so a message that had stopped
   * saying which scope was actually REQUESTED would still contain the string.
   */
  const diagnosisOf = (error: unknown): string => String(error).split('Fix:')[0] ?? '';

  it('the no-token refusal QUOTES the scope it asked for — public, and the thing most often wrong', async () => {
    const { credential } = fakeCredential({ answer: null });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-management' })
      .catch((e: unknown) => e);
    // The default (data-plane) audience was used, and the DIAGNOSIS says so —
    // which is the whole point: a tool declaring `needs` without `scopes` gets
    // this default and never typed it anywhere, so "could not mint for the
    // requested scope" is unreadable without it.
    expect(diagnosisOf(error)).toContain(AZURE_AI_SCOPE);
    expect(diagnosisOf(error)).toContain('azure-management');
    expect(String(error)).toMatch(/Fix:/);
  });

  it('it quotes the scope the REQUEST named, not the provider default', async () => {
    const { credential } = fakeCredential({
      answer: { token: '   ', expiresOnTimestamp: 1_900_000_000_123 },
    });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-management', scopes: [AZURE_MANAGEMENT_SCOPE] })
      .catch((e: unknown) => e);
    expect(diagnosisOf(error)).toContain(AZURE_MANAGEMENT_SCOPE);
    // The default is NOT what was asked for, so it is not what is reported.
    expect(diagnosisOf(error)).not.toContain(AZURE_AI_SCOPE);
    // …and it still quotes nothing from the token response itself.
    expect(String(error)).toMatch(/`token` field/);
    expect(String(error)).toMatch(/secret/i);
  });

  it('lists EVERY scope that was asked for when a request names several', async () => {
    const { credential } = fakeCredential({ answer: null });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({
        service: 'azure-ai',
        scopes: [AZURE_AI_SCOPE, AZURE_MANAGEMENT_SCOPE],
      })
      .catch((e: unknown) => e);
    expect(diagnosisOf(error)).toContain(AZURE_AI_SCOPE);
    expect(diagnosisOf(error)).toContain(AZURE_MANAGEMENT_SCOPE);
    expect(diagnosisOf(error)).toMatch(/scopes \[/);
  });
});

// ── Secrecy (security) ──────────────────────────────────────────────

describe('nothing this throws may carry a secret', () => {
  it('a failed getToken reports the operation and the error NAME, never its text', async () => {
    const { credential } = fakeCredential({
      onGetToken: () => {
        const err = new Error(
          '401 unauthorized: Bearer sk-entra-DO-NOT-LEAK-7b2a for tenant contoso.example',
        );
        err.name = 'AuthenticationRequiredError';
        throw err;
      },
    });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect(String(error)).toContain('getToken');
    expect(String(error)).toContain('AuthenticationRequiredError');
    expect((error as Error).name).toBe('AzureCredentialError');
    // The poisoned SDK text never comes through…
    expect(String(error)).not.toContain('sk-entra-DO-NOT-LEAK-7b2a');
    expect(String(error)).not.toContain('contoso.example');
    // …and is not attached as a cause either — that travels into every serializer.
    expect((error as Error).cause).toBeUndefined();
  });

  it('a CredentialUnavailableError gets the no-credential diagnosis and the fix, not the SDK’s text', async () => {
    const { credential } = fakeCredential({
      onGetToken: () => {
        const err = new Error(
          'EnvironmentCredential: found no AZURE_CLIENT_SECRET in /home/x/.env',
        );
        err.name = 'CredentialUnavailableError';
        throw err;
      },
    });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe('AzureCredentialsUnavailableError');
    expect(String(error)).toMatch(/az login/);
    expect(String(error)).toMatch(/_credential/);
    // The chain is described in words, the SDK's own message withheld.
    expect(String(error)).toMatch(/managed identity/i);
    expect(String(error)).not.toContain('/home/x/.env');
  });

  it('an AggregateAuthenticationError — the whole chain came up empty — gets the same diagnosis', async () => {
    const { credential } = fakeCredential({
      onGetToken: () => {
        const err = new Error('CredentialUnavailableError chain: env, cli, powershell all failed');
        err.name = 'AggregateAuthenticationError';
        throw err;
      },
    });
    const error = await entraIdentity({ _credential: credential })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe('AzureCredentialsUnavailableError');
    expect(String(error)).toMatch(/az login/);
  });
});

// ── The `_sdk` seam: real construction, no real package (integration) ──

describe('constructing through the injected SDK module', () => {
  it('constructs DefaultAzureCredential ONCE and caches the credential across vends', async () => {
    const { sdk, state } = fakeSdk();
    const provider = entraIdentity({ _sdk: sdk });
    await provider.getCredential({ service: 'a' });
    await provider.getCredential({ service: 'b' });
    // One credential, two vends: the second call still asked it for a token,
    // which is where MSAL's own cache-and-refresh lives.
    expect(state.constructions).toBe(1);
    expect(state.scopes).toHaveLength(2);
  });

  it('one cached credential serves DIFFERENT scope sets — Azure scopes ride per getToken call', async () => {
    const { sdk, state } = fakeSdk();
    const provider = entraIdentity({ _sdk: sdk });
    await provider.getCredential({ service: 'a' });
    await provider.getCredential({ service: 'b', scopes: [AZURE_MANAGEMENT_SCOPE] });
    expect(state.constructions).toBe(1);
    expect(state.scopes[1]).toEqual([AZURE_MANAGEMENT_SCOPE]);
  });

  it('an SDK whose constructor THROWS is reported by operation + NAME, with no message and no cause', async () => {
    // The one branch where this adapter tells its own refusals apart from the
    // SDK's (`isOwnRefusal(err) ? rethrow : sdkFailure(...)`). Both other tests
    // that reach that catch throw refusals this file authored, so without this
    // case the `false` arm never runs and the secrecy law over a CONSTRUCTION
    // failure is unpinned — a "simplify to a bare rethrow" cleanup would keep
    // the suite green while sending the SDK's text to the LLM and to
    // `agentfootprint.credential.failed`.
    //
    // The scenario is real, not invented: an unsupported AZURE_TOKEN_CREDENTIALS
    // value makes the genuine `DefaultAzureCredential` constructor throw, and
    // its message echoes the offending environment value verbatim.
    const sdk: AzureIdentitySdkModule = {
      DefaultAzureCredential: class {
        constructor() {
          throw new Error(
            'Invalid value for AZURE_TOKEN_CREDENTIALS = sk-entra-DO-NOT-LEAK-7b2a. Valid ' +
              "values are 'prod' or 'dev' or any of these credentials - EnvironmentCredential, …",
          );
        }
      } as unknown as new () => TokenCredentialLike,
    };
    const error = await entraIdentity({ _sdk: sdk })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe('AzureCredentialError');
    expect(String(error)).toContain('new DefaultAzureCredential');
    // The SDK's own text — including the environment value it echoed — is gone…
    expect(String(error)).not.toContain('sk-entra-DO-NOT-LEAK-7b2a');
    expect(String(error)).not.toContain('AZURE_TOKEN_CREDENTIALS');
    // …and is not smuggled back in as a cause, which travels into serializers.
    expect((error as Error).cause).toBeUndefined();
  });

  it('a module without DefaultAzureCredential is refused: update it, or pass _credential', async () => {
    const error = await entraIdentity({ _sdk: {} })
      .getCredential({ service: 'azure-ai' })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/DefaultAzureCredential/);
    expect(String(error)).toMatch(/4\.x/);
    expect(String(error)).toMatch(/_credential/);
    // An own-authored refusal keeps its diagnosis — it is NOT rewritten as a
    // credential failure by the sdkFailure wrapper.
    expect((error as Error).name).not.toBe('AzureCredentialError');
  });
});

// ── Peer dependency ─────────────────────────────────────────────────

describe('the peer dependency', () => {
  // MODULE RESOLUTION is stubbed, never node_modules trusted. A bare
  // `entraIdentity().getCredential(...)` would prove this refusal only for as
  // long as `@azure/identity` stays uninstalled — and the day somebody adds it
  // to devDependencies (to drive the real SDK against the foundry wire fake,
  // say), that same line stops refusing and starts constructing a real
  // DefaultAzureCredential, then calls `getToken` on it: an `az` shell-out on a
  // signed-in developer box, a hang on the IMDS probe in CI. The repo already
  // rules on this (test/adapters/google/googlePin.ts:41-53) and the sibling
  // google suite already follows it.

  /** Load `azure.ts` fresh with `lazyRequire` stubbed; report whether it ran. */
  async function withUnresolvableSdk<T>(
    body: (isolated: typeof entraIdentity, probe: { loaded: boolean }) => Promise<T> | T,
  ): Promise<T> {
    vi.resetModules();
    const probe = { loaded: false };
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        probe.loaded = true;
        throw new Error('Cannot find module');
      },
    }));
    try {
      const mod = await import('../../../src/adapters/identity/azure.js');
      return await body(mod.entraIdentity, probe);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  }

  it('is refused by name when it is not installed', async () => {
    await withUnresolvableSdk(async (isolated) => {
      const error = await isolated()
        .getCredential({ service: 'azure-ai' })
        .catch((e: unknown) => e);
      expect(String(error)).toMatch(/@azure\/identity/);
      expect(String(error)).toMatch(/npm install/);
    });
  });

  it('is not loaded at construction — only when the provider first vends', async () => {
    // `not.toThrow()` on the constructor asserts nothing about laziness: it
    // passes just as happily when the SDK is loaded EAGERLY and loads fine.
    // The property is "lazyRequire was not called", so that is what is watched
    // — false after constructing, true after the first vend, which also proves
    // the probe is wired to the thing under test.
    await withUnresolvableSdk(async (isolated, probe) => {
      const provider = isolated();
      expect(probe.loaded).toBe(false);
      await provider.getCredential({ service: 'azure-ai' }).catch(() => undefined);
      expect(probe.loaded).toBe(true);
    });
  });

  it('an injected `_credential` means the package is never reached at all', async () => {
    await withUnresolvableSdk(async (isolated, probe) => {
      const { credential } = fakeCredential();
      const result = await isolated({ _credential: credential }).getCredential({
        service: 'azure-ai',
      });
      expect(result.status).toBe('issued');
      expect(probe.loaded).toBe(false);
    });
  });
});

// ── ROI ─────────────────────────────────────────────────────────────

describe('provider identity', () => {
  it("defaults its id to 'entra-identity' and honours an override", () => {
    const { credential } = fakeCredential();
    expect(entraIdentity({ _credential: credential }).id).toBe('entra-identity');
    expect(entraIdentity({ _credential: credential, id: 'entra-prod' }).id).toBe('entra-prod');
  });

  it('exports both audiences by name — the split is the whole point of naming them', () => {
    expect(AZURE_AI_SCOPE).toBe('https://ai.azure.com/.default');
    expect(AZURE_MANAGEMENT_SCOPE).toBe('https://management.azure.com/.default');
  });
});
