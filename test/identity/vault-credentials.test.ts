/**
 * vaultCredentials — 7-pattern tests.
 *
 *   P1 Unit         — id, the KV v2 URL, the token header, the mount default
 *   P2 Boundary     — path mapping: `paths` map, `resolve` fn, bare service id;
 *                     the unknown-service refusal
 *   P3 Scenario     — the four field shapes become the four credential kinds,
 *                     and `toHeaders()` is what a tool applies
 *   P4 Property     — re-resolves on EVERY call (no cache, no lease); a KV v1
 *                     response is named as such
 *   P5 Security     — THE SECRECY PIN: no token and no secret value in any
 *                     message any failure path can throw; http refused; unbuilt
 *                     auth methods refused BY NAME
 *   P6 Performance  — one HTTP round trip per resolution, nothing else
 *   P7 ROI          — swaps in for staticTokens with the tool code unchanged
 */

import { describe, expect, it } from 'vitest';

import { vaultCredentials } from '../../src/adapters/identity/vault.js';
import type { VaultCredentialsOptions } from '../../src/adapters/identity/vault.js';
import { isCredentialIssued } from '../../src/identity/types.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import type { CredentialProvider } from '../../src/identity/types.js';

// ── The secrets under test. Nothing in this file may echo them. ──────

const VAULT_TOKEN = 'hvs.SUPERSECRETROOTTOKEN9821';
const GITHUB_PAT = 'ghp_liveProductionToken_31337';
const DB_PASSWORD = 'correct-horse-battery-staple';
const API_KEY = 'ak_live_9f8e7d6c5b4a';

/** Everything that must never appear in a message, an error, or a log line. */
const SECRETS = [VAULT_TOKEN, GITHUB_PAT, DB_PASSWORD, API_KEY];

// ── A scripted Vault ─────────────────────────────────────────────────

interface VaultScript {
  /** `'<mount>/data/<path>'` → the KV v2 body's inner data object. */
  readonly secrets?: Readonly<Record<string, Record<string, unknown>>>;
  /** Force a status for every request. */
  readonly status?: number;
  /** Force a raw body (bypasses `secrets`). */
  readonly body?: unknown;
  /** Reply with something that is not JSON at all. */
  readonly notJson?: boolean;
  /** Throw from fetch itself (DNS, TLS, refused connection). */
  readonly transportError?: Error;
}

function fakeVault(script: VaultScript = {}): {
  fetch: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const headers = ((init as { headers?: Record<string, string> })?.headers ?? {}) as Record<
      string,
      string
    >;
    calls.push({ url, headers });

    if (script.transportError) throw script.transportError;
    if (script.notJson) {
      return new Response('<html>login</html>', {
        status: script.status ?? 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (script.body !== undefined) {
      return new Response(JSON.stringify(script.body), { status: script.status ?? 200 });
    }
    if (script.status && script.status >= 400) {
      // What Vault really answers: the errors array, which this adapter must
      // never echo (it is the one place a backend can smuggle payload into a
      // message).
      return new Response(JSON.stringify({ errors: ['permission denied'] }), {
        status: script.status,
      });
    }
    // `<address>/v1/<mount>/data/<path>` → key on everything after `/v1/`.
    const key = url.split('/v1/')[1] ?? '';
    const found = script.secrets?.[key];
    if (!found) return new Response(JSON.stringify({ errors: [] }), { status: 404 });
    return new Response(JSON.stringify({ data: { data: found, metadata: { version: 3 } } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function baseOptions(overrides: Partial<VaultCredentialsOptions> = {}): VaultCredentialsOptions {
  return {
    address: 'https://vault.internal:8200',
    token: VAULT_TOKEN,
    ...overrides,
  } as VaultCredentialsOptions;
}

/** Collect every string a failed call can put in front of a human or a model:
 *  the message, the stack, and the JSON projection of the error object. */
async function failureStrings(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const e = err as Error;
    return [e.message, e.stack ?? '', JSON.stringify(e, Object.getOwnPropertyNames(e))].join('\n');
  }
  throw new Error('expected the call to fail, and it did not');
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('vaultCredentials — P1 unit', () => {
  it('P1 default id is `vault`, and `id` overrides it', () => {
    expect(vaultCredentials(baseOptions()).id).toBe('vault');
    expect(vaultCredentials(baseOptions({ id: 'corp-vault' })).id).toBe('corp-vault');
  });

  it('P1 reads KV v2: `<address>/v1/<mount>/data/<path>` with X-Vault-Token', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await provider.getCredential({ service: 'github' });

    expect(vault.calls).toHaveLength(1);
    expect(vault.calls[0]?.url).toBe('https://vault.internal:8200/v1/secret/data/github');
    expect(vault.calls[0]?.headers['X-Vault-Token']).toBe(VAULT_TOKEN);
  });

  it('P1 `mount` and `namespace` reach the URL and the header', async () => {
    const vault = fakeVault({ secrets: { 'kv/data/github': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(
      baseOptions({ mount: 'kv', namespace: 'teams/agents', _fetch: vault.fetch }),
    );
    await provider.getCredential({ service: 'github' });
    expect(vault.calls[0]?.url).toBe('https://vault.internal:8200/v1/kv/data/github');
    expect(vault.calls[0]?.headers['X-Vault-Namespace']).toBe('teams/agents');
  });

  it('P1 the token falls back to VAULT_TOKEN', async () => {
    const previous = process.env.VAULT_TOKEN;
    process.env.VAULT_TOKEN = VAULT_TOKEN;
    try {
      const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
      const provider = vaultCredentials({
        address: 'https://vault.internal:8200',
        _fetch: vault.fetch,
      });
      await provider.getCredential({ service: 'github' });
      expect(vault.calls[0]?.headers['X-Vault-Token']).toBe(VAULT_TOKEN);
    } finally {
      if (previous === undefined) delete process.env.VAULT_TOKEN;
      else process.env.VAULT_TOKEN = previous;
    }
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('vaultCredentials — P2 boundary', () => {
  it('P2 `paths` maps service → path inside the mount', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/ci/github': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(
      baseOptions({ paths: { github: 'ci/github' }, _fetch: vault.fetch }),
    );
    const r = await provider.getCredential({ service: 'github' });
    expect(isCredentialIssued(r)).toBe(true);
    expect(vault.calls[0]?.url).toContain('/v1/secret/data/ci/github');
  });

  it('P2 an unknown service is refused by name, listing the known ones', async () => {
    const vault = fakeVault();
    const provider = vaultCredentials(
      baseOptions({ paths: { github: 'ci/github' }, _fetch: vault.fetch }),
    );
    await expect(provider.getCredential({ service: 'slack' })).rejects.toThrow(
      /no secret path configured for service 'slack'.*Known services: github/s,
    );
    expect(vault.calls).toHaveLength(0);
  });

  it('P2 `resolve` computes the path, and refusing one is a named error', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/agents/slack': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(
      baseOptions({
        resolve: (service) => (service === 'slack' ? `agents/${service}` : undefined),
        _fetch: vault.fetch,
      }),
    );
    await provider.getCredential({ service: 'slack' });
    expect(vault.calls[0]?.url).toContain('/v1/secret/data/agents/slack');
    await expect(provider.getCredential({ service: 'github' })).rejects.toThrow(
      /`resolve\('github'\)` returned no path/,
    );
  });

  it('P2 with neither mapping, the service id IS the path', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/slack': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await provider.getCredential({ service: 'slack' });
    expect(vault.calls[0]?.url).toBe('https://vault.internal:8200/v1/secret/data/slack');
  });

  it('P2 `paths` AND `resolve` together is refused — two spellings can disagree', () => {
    expect(() =>
      vaultCredentials({
        address: 'https://v:8200',
        token: VAULT_TOKEN,
        paths: { a: 'a' },
        resolve: () => 'b',
      } as unknown as VaultCredentialsOptions),
    ).toThrow(/pass `paths` OR `resolve`, not both/);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('vaultCredentials — P3 scenario', () => {
  it('P3 `token` → bearer', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
    const r = await vaultCredentials(baseOptions({ _fetch: vault.fetch })).getCredential({
      service: 'github',
    });
    expect(isCredentialIssued(r)).toBe(true);
    if (!isCredentialIssued(r)) return;
    expect(r.credential.kind).toBe('bearer');
    expect(r.credential.toHeaders()).toEqual({ authorization: `Bearer ${GITHUB_PAT}` });
    // A KV v2 secret carries no lease, so there is nothing to report.
    expect(r.expiresAt).toBeUndefined();
  });

  it('P3 `api_key` (+ optional `header`) → apiKey', async () => {
    const vault = fakeVault({
      secrets: {
        'secret/data/plain': { api_key: API_KEY },
        'secret/data/named': { apiKey: API_KEY, header: 'x-internal-key' },
      },
    });
    const provider = vaultCredentials(
      baseOptions({ paths: { plain: 'plain', named: 'named' }, _fetch: vault.fetch }),
    );

    const plain = await provider.getCredential({ service: 'plain' });
    expect(isCredentialIssued(plain) && plain.credential.toHeaders()).toEqual({
      'x-api-key': API_KEY,
    });

    const named = await provider.getCredential({ service: 'named' });
    expect(isCredentialIssued(named) && named.credential.toHeaders()).toEqual({
      'x-internal-key': API_KEY,
    });
  });

  it('P3 `username` + `password` → basic', async () => {
    const vault = fakeVault({
      secrets: { 'secret/data/db': { username: 'agent', password: DB_PASSWORD } },
    });
    const r = await vaultCredentials(baseOptions({ _fetch: vault.fetch })).getCredential({
      service: 'db',
    });
    expect(isCredentialIssued(r)).toBe(true);
    if (!isCredentialIssued(r)) return;
    expect(r.credential.kind).toBe('basic');
    const expected = Buffer.from(`agent:${DB_PASSWORD}`, 'utf8').toString('base64');
    expect(r.credential.toHeaders()).toEqual({ authorization: `Basic ${expected}` });
  });

  it('P3 `headers` → the universal escape', async () => {
    const vault = fakeVault({
      secrets: {
        'secret/data/legacy': { headers: { 'x-sig': API_KEY, 'x-tenant': 'acme', bad: 3 } },
      },
    });
    const r = await vaultCredentials(baseOptions({ _fetch: vault.fetch })).getCredential({
      service: 'legacy',
    });
    expect(isCredentialIssued(r) && r.credential.toHeaders()).toEqual({
      'x-sig': API_KEY,
      'x-tenant': 'acme',
    });
  });

  it('P3 `toCredential` wins, and returning undefined falls back to the table', async () => {
    const vault = fakeVault({
      secrets: {
        'secret/data/odd': { personal_access_token: GITHUB_PAT },
        'secret/data/ordinary': { token: GITHUB_PAT },
      },
    });
    const provider = vaultCredentials(
      baseOptions({
        paths: { odd: 'odd', ordinary: 'ordinary' },
        toCredential: (secret) => {
          const pat = secret.personal_access_token;
          if (typeof pat !== 'string') return undefined;
          return { kind: 'bearer', toHeaders: () => ({ authorization: `token ${pat}` }) };
        },
        _fetch: vault.fetch,
      }),
    );
    const odd = await provider.getCredential({ service: 'odd' });
    expect(isCredentialIssued(odd) && odd.credential.toHeaders()).toEqual({
      authorization: `token ${GITHUB_PAT}`,
    });
    const ordinary = await provider.getCredential({ service: 'ordinary' });
    expect(isCredentialIssued(ordinary) && ordinary.credential.toHeaders()).toEqual({
      authorization: `Bearer ${GITHUB_PAT}`,
    });
  });

  it('P3 a credential cannot enter tracked scope (structuredClone rejects it)', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
    const r = await vaultCredentials(baseOptions({ _fetch: vault.fetch })).getCredential({
      service: 'github',
    });
    expect(isCredentialIssued(r)).toBe(true);
    if (!isCredentialIssued(r)) return;
    expect(() => structuredClone(r.credential)).toThrow();
    // …and an accidental JSON.stringify emits the kind, never the secret.
    expect(JSON.stringify(r.credential)).toBe('{"kind":"bearer"}');
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('vaultCredentials — P4 property', () => {
  it('P4 every call re-reads the secret — no cache, no lease (the 9.7.0 model)', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await provider.getCredential({ service: 'github' });
    await provider.getCredential({ service: 'github' });
    await provider.getCredential({ service: 'github' });
    expect(vault.calls).toHaveLength(3);
  });

  it('P4 a KV v1 response is named as v1, not reported as an empty secret', async () => {
    // v1 answers with the fields directly under `data` — no inner envelope.
    const vault = fakeVault({ body: { data: { token: GITHUB_PAT } } });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await expect(provider.getCredential({ service: 'github' })).rejects.toThrow(
      /not KV v2 shaped.*reads KV \*\*v2\*\* only.*kvVersion/s,
    );
  });

  it('P4 a secret matching none of the shapes is refused, naming the four', async () => {
    const vault = fakeVault({ secrets: { 'secret/data/weird': { totally_bespoke: 'x' } } });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await expect(provider.getCredential({ service: 'weird' })).rejects.toThrow(
      /none of the field shapes this adapter reads.*toCredential/s,
    );
  });
});

// ─── P5 Security — THE SECRECY PIN ───────────────────────────────────

describe('vaultCredentials — P5 security', () => {
  it('P5 no failure path can put the Vault token or a secret value in a message', async () => {
    const provider = (script: VaultScript): CredentialProvider =>
      vaultCredentials(
        baseOptions({
          paths: { github: 'ci/github' },
          _fetch: fakeVault(script).fetch,
        }),
      );

    const failures = await Promise.all([
      // Unknown service (never reaches the network).
      failureStrings(() => provider({}).getCredential({ service: 'nope' })),
      // 403 — the shape where a real Vault echoes `{"errors":[…]}`.
      failureStrings(() => provider({ status: 403 }).getCredential({ service: 'github' })),
      failureStrings(() => provider({ status: 401 }).getCredential({ service: 'github' })),
      failureStrings(() => provider({ status: 404 }).getCredential({ service: 'github' })),
      failureStrings(() => provider({ status: 503 }).getCredential({ service: 'github' })),
      // Not JSON at all (a proxy login page).
      failureStrings(() => provider({ notJson: true }).getCredential({ service: 'github' })),
      // KV v1 shape — carries a real secret in the body.
      failureStrings(() =>
        provider({ body: { data: { token: GITHUB_PAT } } }).getCredential({ service: 'github' }),
      ),
      // No `data` at all.
      failureStrings(() => provider({ body: { errors: [] } }).getCredential({ service: 'github' })),
      // A secret whose fields the table does not recognise — the body IS the
      // secret, and the refusal must not describe it.
      failureStrings(() =>
        provider({
          secrets: { 'secret/data/ci/github': { pat: GITHUB_PAT, pw: DB_PASSWORD } },
        }).getCredential({ service: 'github' }),
      ),
      // Transport failure — a fetch that echoes its own request into the error.
      failureStrings(() =>
        provider({
          transportError: new Error(
            `connect ECONNREFUSED — request was GET /v1/secret/data/ci/github ` +
              `with X-Vault-Token: ${VAULT_TOKEN}`,
          ),
        }).getCredential({ service: 'github' }),
      ),
    ]);

    for (const text of failures) {
      for (const secret of SECRETS) {
        expect(text, `a failure message leaked a secret:\n${text}`).not.toContain(secret);
      }
      // Nor the header name whose value is the token — an error naming it is
      // one refactor away from naming what it carried.
      expect(text.toLowerCase()).not.toContain('x-vault-token');
    }
  });

  it('P5 an error names the service, the mount path and the status, and nothing else', async () => {
    const vault = fakeVault({ status: 403 });
    const provider = vaultCredentials(
      baseOptions({ paths: { github: 'ci/github' }, _fetch: vault.fetch }),
    );
    const text = await failureStrings(() => provider.getCredential({ service: 'github' }));
    expect(text).toContain("service 'github'");
    expect(text).toContain("'secret/ci/github'");
    expect(text).toContain('403');
    // The body Vault really sent is not in it.
    expect(text).not.toContain('permission denied');
  });

  it('P5 a plain-http address is refused, naming the risk', () => {
    expect(() =>
      vaultCredentials({ address: 'http://vault.internal:8200', token: VAULT_TOKEN }),
    ).toThrow(/refusing a plain-http address.*allowHttp: true/s);
    // …and `allowHttp` is the deliberate opt-out, for a loopback dev server.
    expect(
      vaultCredentials({
        address: 'http://127.0.0.1:8200',
        token: VAULT_TOKEN,
        allowHttp: true,
      }).id,
    ).toBe('vault');
  });

  it('P5 unbuilt auth methods are refused BY NAME, with the option that would carry them', () => {
    const asked = (auth: string): string => {
      try {
        vaultCredentials({
          address: 'https://vault.internal:8200',
          token: VAULT_TOKEN,
          auth,
        } as unknown as VaultCredentialsOptions);
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error(`auth '${auth}' should have been refused`);
    };

    expect(asked('approle')).toMatch(/`roleId` \+ `secretId`/);
    expect(asked('kubernetes')).toMatch(/service-account token path/);
    expect(asked('approle')).toMatch(/tell us your auth shape/);
    // An auth method nobody listed still gets a teaching refusal, not a crash.
    expect(asked('gcp')).toMatch(/V1 authenticates with a TOKEN only/);
  });

  it('P5 a missing address / token is refused before anything is attempted', () => {
    expect(() => vaultCredentials({ address: '', token: VAULT_TOKEN })).toThrow(
      /`address` is required/,
    );
    const previous = process.env.VAULT_TOKEN;
    delete process.env.VAULT_TOKEN;
    try {
      expect(() => vaultCredentials({ address: 'https://vault.internal:8200' })).toThrow(
        /no Vault token.*VAULT_TOKEN/s,
      );
    } finally {
      if (previous !== undefined) process.env.VAULT_TOKEN = previous;
    }
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('vaultCredentials — P6 performance', () => {
  it('P6 one resolution is exactly one HTTP round trip', async () => {
    const vault = fakeVault({
      secrets: {
        'secret/data/github': { token: GITHUB_PAT },
        'secret/data/db': { username: 'agent', password: DB_PASSWORD },
      },
    });
    const provider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));
    await provider.getCredential({ service: 'github' });
    await provider.getCredential({ service: 'db' });
    expect(vault.calls).toHaveLength(2);
  });

  it('P6 a hung vault fails on the timeout rather than hanging the run', async () => {
    // The adapter hands `fetch` an `AbortSignal.timeout`, which is how every
    // real implementation cancels — so the double honours the signal, as a
    // `_fetch` you inject must. A resolution sits in front of a tool call; a
    // vault that never answers has to fail rather than hang the run.
    const hangs = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason ?? new Error('aborted')),
        );
      })) as unknown as typeof fetch;
    const provider = vaultCredentials(baseOptions({ timeoutMs: 20, _fetch: hangs }));
    await expect(provider.getCredential({ service: 'github' })).rejects.toThrow(
      /could not reach Vault.*timed out/s,
    );
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('vaultCredentials — P7 ROI', () => {
  it('P7 it is a drop-in for staticTokens: same port, same applicator', async () => {
    const dev: CredentialProvider = staticTokens({ github: GITHUB_PAT });
    const vault = fakeVault({ secrets: { 'secret/data/github': { token: GITHUB_PAT } } });
    const prod: CredentialProvider = vaultCredentials(baseOptions({ _fetch: vault.fetch }));

    // The tool's code — identical against both.
    const headersFrom = async (p: CredentialProvider): Promise<Record<string, string>> => {
      const r = await p.getCredential({ service: 'github' });
      return isCredentialIssued(r) ? r.credential.toHeaders() : {};
    };

    expect(await headersFrom(prod)).toEqual(await headersFrom(dev));
  });
});
