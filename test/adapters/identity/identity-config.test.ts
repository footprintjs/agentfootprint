/**
 * identityFromConfig + identityConfigFromEnv — the config chooser. 7-pattern
 * tests (unit · scenario · integration · property · security · performance ·
 * ROI).
 *
 * The laws being pinned (the identity-strategies design, §7.2 and rule 9):
 *   • Production names its strategy, even `open`; `production` is an input.
 *   • A typo is never `open`: unknown strategy, unknown key, a key a LATER
 *     release reads — each refused by name.
 *   • Keys set with no strategy refuse ("configured a sign-in, forgot to switch
 *     it on"); keys set beside an explicit `open` WARN in the banner.
 *   • Every required `oidc-token` key is required; the id claim has no default.
 *   • Config errors refuse at boot; an unreachable IdP starts, says so, 503s.
 *   • The banner never carries a secret.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  identityConfigFromEnv,
  IdentityConfigError,
  identityFromConfig,
  type IdentityConfig,
} from '../../../src/identity.js';
import { memorySessions, standingAgent, type IngressRecord } from '../../../src/doors/hosting.js';
import { inProcessHost } from '../../hosting/testHost.js';
import { appOnlyClaims, fakeIdp, personClaims, type FakeIdp } from './conformance/fakeIdp.js';
import { IDS, SHAPE_DEFAULTS } from './conformance/harnesses.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function oidcConfig(idp: FakeIdp, extra: Partial<IdentityConfig> = {}): IdentityConfig {
  return {
    strategy: 'oidc-token',
    issuer: idp.issuer,
    audience: SHAPE_DEFAULTS.audience,
    userIdClaim: 'oid',
    requiredScope: SHAPE_DEFAULTS.scope,
    allowedClients: [SHAPE_DEFAULTS.client],
    ...extra,
  };
}

async function refusal(run: () => Promise<unknown> | unknown): Promise<IdentityConfigError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof IdentityConfigError) return err;
    throw err;
  }
  throw new Error('expected a boot refusal');
}

const shapeOf = (idp: FakeIdp) => ({ issuer: idp.issuer, ...SHAPE_DEFAULTS });

// ─── 1. UNIT — the env mapping ───────────────────────────────────────

describe('identityConfigFromEnv — unit', () => {
  it('maps the IDENTITY_* names onto the config object, trimming values and ignoring empties', () => {
    expect(
      identityConfigFromEnv({
        PATH: '/usr/bin',
        IDENTITY_STRATEGY: 'oidc-token',
        IDENTITY_ISSUER: ' https://fs.corp.example/adfs ',
        IDENTITY_AUDIENCE: 'urn:neo:api',
        IDENTITY_USER_ID_CLAIM: 'urn:neo:objectguid',
        IDENTITY_REQUIRED_SCOPE: 'user_impersonation',
        IDENTITY_SCOPE_CLAIM: 'scp',
        IDENTITY_ALLOWED_CLIENTS: 'neo-web, lab-cli  other',
        IDENTITY_ROLES_CLAIM: '["realm_access","roles"]',
        IDENTITY_JWKS_URL: '',
        IDENTITY_CLOCK_TOLERANCE_SECONDS: '30',
      }),
    ).toEqual({
      strategy: 'oidc-token',
      issuer: 'https://fs.corp.example/adfs',
      audience: 'urn:neo:api',
      userIdClaim: 'urn:neo:objectguid',
      requiredScope: 'user_impersonation',
      scopeClaim: 'scp',
      allowedClients: ['neo-web', 'lab-cli', 'other'],
      rolesClaim: ['realm_access', 'roles'],
      clockToleranceSeconds: 30,
    });
  });

  it("reads 'any' alone as the check turned off, and a URI roles claim as ONE name", () => {
    expect(
      identityConfigFromEnv({
        IDENTITY_ALLOWED_CLIENTS: 'any',
        IDENTITY_ROLES_CLAIM: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
      }),
    ).toEqual({
      allowedClients: 'any',
      rolesClaim: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
    });
  });

  it.each([
    [{ IDENTITY_STRATEGY: 'oidc' }, 'IDENTITY_STRATEGY', /not a strategy.*open, oidc-token/],
    [{ IDENTITY_ISSUR: 'https://x' }, 'IDENTITY_ISSUR', /not a setting this release reads/],
    [
      { IDENTITY_PROXY_SIGN_OUT_URL: '/oauth2/sign_out' },
      'IDENTITY_PROXY_SIGN_OUT_URL',
      /the proxy sign-out link, which is not in this release/,
    ],
    [{ IDENTITY_DIAGNOSE: '1' }, 'IDENTITY_DIAGNOSE', /the first-token report/],
    [{ IDENTITY_REQUIRED_ROLE: 'neo-users' }, 'IDENTITY_REQUIRED_ROLE', /the role gate/],
    [{ IDENTITY_ALLOWED_CLIENTS: 'any, neo-web' }, 'IDENTITY_ALLOWED_CLIENTS', /'any' beside/],
    [{ IDENTITY_ROLES_CLAIM: '[realm_access.roles' }, 'IDENTITY_ROLES_CLAIM', /JSON array/],
    [
      { IDENTITY_CLOCK_TOLERANCE_SECONDS: 'soon' },
      'IDENTITY_CLOCK_TOLERANCE_SECONDS',
      /whole number/,
    ],
  ])('refuses %j, naming the key', async (env, key, message) => {
    const err = await refusal(() => identityConfigFromEnv(env));
    expect(err.key).toBe(key);
    expect(err.message).toMatch(message);
  });
});

// ─── 2. SCENARIO — the boot refusals and the three outcomes ──────────

describe('identityFromConfig — boot refusals', () => {
  it('PRODUCTION NAMES ITS STRATEGY: unset refuses in production, even with nothing else set', async () => {
    const err = await refusal(() => identityFromConfig({}, { production: true }));
    expect(err.key).toBe('IDENTITY_STRATEGY');
    expect(err.message).toMatch(/even 'open'/);
  });

  it("outside production, unset is today's open — and the banner says production would refuse it", async () => {
    const choice = await identityFromConfig({}, { production: false });
    expect(choice.strategy).toBe('open');
    expect(choice.identity).toBeUndefined();
    expect(choice.banner.join('\n')).toMatch(/production would refuse this/);
  });

  it("an explicit open starts in production, and says 'no identity' out loud", async () => {
    const choice = await identityFromConfig({ strategy: 'open' }, { production: true });
    expect(choice.strategy).toBe('open');
    expect(choice.banner.join('\n')).toMatch(/anyone who can reach this port can use it/);
  });

  it('production is an INPUT: missing or not a boolean refuses', async () => {
    await refusal(() => identityFromConfig({ strategy: 'open' }, {} as never));
    await refusal(() => identityFromConfig({ strategy: 'open' }, { production: 'yes' } as never));
  });

  it('keys set with no strategy refuse in every environment: a sign-in nobody switched on', async () => {
    const err = await refusal(() =>
      identityFromConfig({ issuer: 'https://idp.example.test' }, { production: false }),
    );
    expect(err.message).toMatch(/IDENTITY_ISSUER \(issuer\) is set but IDENTITY_STRATEGY is not/);
  });

  it('keys beside an explicit open produce banner warnings, not a refusal', async () => {
    const choice = await identityFromConfig(
      { strategy: 'open', issuer: 'https://idp.example.test' },
      { production: true },
    );
    expect(choice.banner.join('\n')).toMatch(
      /WARNING IDENTITY_ISSUER \(issuer\) is set, but the strategy is open/,
    );
  });

  it('all five strategies start in this release (none is refused as not in it)', async () => {
    const { STRATEGIES_IN_THIS_RELEASE, IDENTITY_STRATEGIES } = await import(
      '../../../src/adapters/identity/strategies/vocabulary.js'
    );
    expect([...STRATEGIES_IN_THIS_RELEASE].sort()).toEqual([...IDENTITY_STRATEGIES].sort());
  });

  it('a key another strategy reads refuses; browser sign-in keys half-set refuse', async () => {
    const idp = await fakeIdp();
    const boot = { production: false, fetch: idp.fetch, backend: idp.backend };
    const half = await refusal(() =>
      identityFromConfig(oidcConfig(idp, { publicUrl: 'https://neo.corp.example' }), boot),
    );
    expect(half.key).toBe('IDENTITY_CLIENT_ID');
    expect(half.message).toMatch(/browser sign-in is half set/);
    const users = await refusal(() =>
      identityFromConfig(oidcConfig(idp, { localUsers: 'a:b' }), { production: false }),
    );
    expect(users.message).toMatch(/belongs to local-password, not oidc-token/);
    const client = await refusal(() =>
      identityFromConfig(
        {
          strategy: 'local-password',
          clientId: 'x',
          publicUrl: 'http://localhost:1',
          localUsers: 'a:b',
        },
        { production: false },
      ),
    );
    expect(client.message).toMatch(/belongs to oidc-token, not local-password/);
  });

  it('an unknown strategy or an unknown field refuses (JavaScript callers bypass the types)', async () => {
    await refusal(() => identityFromConfig({ strategy: 'sso' } as never, { production: false }));
    const later = await refusal(() =>
      identityFromConfig({ strategy: 'open', proxySignOutUrl: '/oauth2/sign_out' } as never, {
        production: false,
      }),
    );
    expect(later.message).toMatch(/the proxy sign-out link/);
    await refusal(() =>
      identityFromConfig({ strategy: 'open', isuer: 'x' } as never, { production: false }),
    );
  });

  it.each([
    ['issuer', 'IDENTITY_ISSUER'],
    ['audience', 'IDENTITY_AUDIENCE'],
    ['userIdClaim', 'IDENTITY_USER_ID_CLAIM'],
    ['requiredScope', 'IDENTITY_REQUIRED_SCOPE'],
    ['allowedClients', 'IDENTITY_ALLOWED_CLIENTS'],
  ] as const)(
    'oidc-token without %s refuses by name, before any network read',
    async (field, key) => {
      const idp = await fakeIdp();
      const config = { ...oidcConfig(idp), [field]: undefined };
      const err = await refusal(() =>
        identityFromConfig(config, { production: false, fetch: idp.fetch }),
      );
      expect(err.key).toBe(key);
      expect(idp.discoveryReads).toBe(0);
    },
  );

  it('a plain-http issuer refuses in production and on a non-loopback host; loopback is a dev-only warning', async () => {
    const idp = await fakeIdp('http://127.0.0.1:18480/realms/corp');
    const prod = await refusal(() =>
      identityFromConfig(oidcConfig(idp), {
        production: true,
        fetch: idp.fetch,
        backend: idp.backend,
      }),
    );
    expect(prod.key).toBe('IDENTITY_ISSUER');
    const dev = await identityFromConfig(oidcConfig(idp), {
      production: false,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    expect(dev.banner.join('\n')).toMatch(
      /plain-http issuer accepted because this is not production/,
    );
    const remote = await fakeIdp('http://idp.corp.example/realms/corp');
    await refusal(() =>
      identityFromConfig(oidcConfig(remote), { production: false, fetch: remote.fetch }),
    );
  });

  it.each(['http-404', 'html', 'no-jwks-uri', 'other-issuer'] as const)(
    'a discovery CONFIG ERROR (%s) refuses to boot',
    async (mode) => {
      const idp = await fakeIdp();
      idp.discovery(mode);
      const err = await refusal(() =>
        identityFromConfig(oidcConfig(idp), {
          production: true,
          fetch: idp.fetch,
          backend: idp.backend,
        }),
      );
      expect(err.key).toBe('IDENTITY_ISSUER');
      expect(err.message).toMatch(/discovery refused/);
    },
  );

  it('an UNREACHABLE IdP starts the app, warns in the banner, and answers 503 until it is back', async () => {
    const idp = await fakeIdp();
    idp.discovery('down');
    const choice = await identityFromConfig(oidcConfig(idp), {
      production: true,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    expect(choice.banner.join('\n')).toMatch(/WARNING discovery is unreachable/);
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    await expect(choice.identity!.verify(token)).rejects.toMatchObject({
      code: 'ERR_IDENTITY_VERIFIER_UNAVAILABLE',
    });
  });
});

// ─── 3. INTEGRATION — config → door → the record ─────────────────────

describe('identityFromConfig — integration', () => {
  it('env → config → standingAgent: a person is served; an app-only token is refused and RECORDED by class', async () => {
    const idp = await fakeIdp();
    const choice = await identityFromConfig(
      identityConfigFromEnv({
        IDENTITY_STRATEGY: 'oidc-token',
        IDENTITY_ISSUER: idp.issuer,
        IDENTITY_AUDIENCE: SHAPE_DEFAULTS.audience,
        IDENTITY_USER_ID_CLAIM: 'oid',
        IDENTITY_REQUIRED_SCOPE: SHAPE_DEFAULTS.scope,
        IDENTITY_ALLOWED_CLIENTS: SHAPE_DEFAULTS.client,
      }),
      { production: true, fetch: idp.fetch, backend: idp.backend },
    );
    const records: IngressRecord[] = [];
    const host = inProcessHost();
    await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
      sessions: memorySessions(),
      host,
      identity: choice.identity,
      onIngressDecision: (record) => records.push(record),
    });

    const person = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    const served = await host.deliver({
      input: 'hello',
      sessionId: 's1',
      headers: { authorization: `Bearer ${person}` },
    });
    expect(served.error).toBeUndefined();
    expect(served.output).toBe('ok');

    const app = await idp.sign(appOnlyClaims(shapeOf(idp)));
    const refused = await host.deliver({
      input: 'hello',
      sessionId: 's2',
      headers: { authorization: `Bearer ${app}` },
    });
    expect(refused.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
    expect(refused.error).not.toContain(app);
    const last = records[records.length - 1];
    expect(last).toMatchObject({
      outcome: 'identity-refused',
      identityFailure: 'not-a-user-token',
    });
    expect(JSON.stringify(records)).not.toContain(app);
  });

  it('boots against discovery served over a real socket', async () => {
    const idp = await fakeIdp();
    const served = await idp.listen();
    try {
      const choice = await identityFromConfig(
        { ...oidcConfig(idp), issuer: served.issuer },
        { production: false },
      );
      const token = await served.sign(
        personClaims({ issuer: served.issuer, ...SHAPE_DEFAULTS }, IDS.b),
      );
      expect((await choice.identity!.verify(token)).userId).toBe(IDS.b);
      expect(choice.banner.join('\n')).toMatch(/discovery ok/);
    } finally {
      await served.close();
    }
  });
});

// ─── 4. PROPERTY — no stray IDENTITY_ name is ever silently read ─────

describe('identityConfigFromEnv — properties', () => {
  it('every IDENTITY_* name is either read or refused — never ignored', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
    let seed = 7;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 300; i += 1) {
      let suffix = '';
      const len = 1 + Math.floor(next() * 14);
      for (let j = 0; j < len; j += 1) suffix += letters[Math.floor(next() * letters.length)];
      const name = `IDENTITY_${suffix}`;
      let read = false;
      let refused = false;
      try {
        read = Object.keys(identityConfigFromEnv({ [name]: '12' })).length === 1;
      } catch (err) {
        refused = err instanceof IdentityConfigError;
      }
      expect(read || refused, name).toBe(true);
    }
  });
});

// ─── 5. SECURITY — the banner and refusals carry no secret ───────────

describe('identityFromConfig — security', () => {
  it('the banner names settings, never a token or a claim value', async () => {
    const idp = await fakeIdp();
    const choice = await identityFromConfig(oidcConfig(idp), {
      production: true,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    await choice.identity!.verify(token);
    const banner = choice.banner.join('\n');
    expect(banner).not.toContain(token);
    expect(banner).not.toContain(IDS.a);
    expect(banner).not.toContain('Priya Shah');
    expect(banner).toMatch(/user id claim oid/);
    expect(banner).toMatch(/required scope 'access_as_user' in 'scp'/);
    expect(banner).toMatch(/allowed clients: neo-web/);
  });

  it("allowedClients 'any' is REFUSED in production (review B-1), and stated loudly in development", async () => {
    const idp = await fakeIdp();
    const boot = { fetch: idp.fetch, backend: idp.backend };
    const err = await refusal(() =>
      identityFromConfig(oidcConfig(idp, { allowedClients: 'any' }), { production: true, ...boot }),
    );
    expect(err.key).toBe('IDENTITY_ALLOWED_CLIENTS');
    expect(err.message).toMatch(/service account/);
    const dev = await identityFromConfig(oidcConfig(idp, { allowedClients: 'any' }), {
      production: false,
      ...boot,
    });
    expect(dev.banner.join('\n')).toMatch(/any — the client check is OFF/);
  });

  it('the banner states the rule for listed clients: service accounts turned off', async () => {
    const idp = await fakeIdp();
    const choice = await identityFromConfig(oidcConfig(idp), {
      production: true,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    expect(choice.banner.join('\n')).toMatch(
      /neo-web \(each must have service accounts \/ client credentials turned off\)/,
    );
  });
});

// ─── 6. PERFORMANCE — boot reads discovery once; requests reuse it ───

describe('identityFromConfig — performance', () => {
  it('discovery is read at boot and never again for the verifier it hands out', async () => {
    const idp = await fakeIdp();
    const choice = await identityFromConfig(oidcConfig(idp), {
      production: true,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    for (let i = 0; i < 5; i += 1) {
      await choice.identity!.verify(await idp.sign(personClaims(shapeOf(idp), `u${i}`)));
    }
    expect(idp.discoveryReads).toBe(1);
  });
});

// ─── 7. ROI — one call replaces the app's own chooser ────────────────

describe('identityFromConfig — ROI', () => {
  it('the same two lines start open on a laptop and oidc-token in production', async () => {
    const idp = await fakeIdp();
    const boot = async (env: Record<string, string>, production: boolean) =>
      identityFromConfig(identityConfigFromEnv(env), {
        production,
        fetch: idp.fetch,
        backend: idp.backend,
      });
    expect((await boot({}, false)).strategy).toBe('open');
    const prod = await boot(
      {
        IDENTITY_STRATEGY: 'oidc-token',
        IDENTITY_ISSUER: idp.issuer,
        IDENTITY_AUDIENCE: SHAPE_DEFAULTS.audience,
        IDENTITY_USER_ID_CLAIM: 'oid',
        IDENTITY_REQUIRED_SCOPE: SHAPE_DEFAULTS.scope,
        IDENTITY_ALLOWED_CLIENTS: SHAPE_DEFAULTS.client,
      },
      true,
    );
    expect(prod.strategy).toBe('oidc-token');
    expect(prod.identity).toBeDefined();
  });
});
