/**
 * deploy/oidc-token — choose the identity strategy from CONFIG, and let only a
 * PERSON's token through the door.
 *
 * A company install signs people in at its own identity provider (AD FS, Entra
 * ID, Keycloak, Okta). This file boots the door the way a deployment does —
 * `IDENTITY_*` settings → `identityFromConfig` → `standingAgent` — and then
 * shows what the `oidc-token` strategy lets in and what it refuses:
 *
 *   1. a person's access token → served, and the run's principal is the id
 *      claim (`oid`), never the pairwise `sub`;
 *   2. an application's OWN token (the client-credentials shape any app in an
 *      Entra tenant can get for your API: right issuer, right audience, valid
 *      signature, no delegated scope) → 401 `not-a-user-token`;
 *   3. a person's token obtained by a client this API does not list → 401
 *      `wrong-client`;
 *   4. a token with no `exp` → 401 `unverifiable` (every token expires);
 *   5. the boot refusals: production with no strategy, and a typo'd key.
 *
 * The identity provider here is FAKE and in-process: a signing key made at
 * start-up, a discovery document served through the `fetch` option, and the
 * key set handed to `jose` through the `backend` option. Those two seams are
 * the only difference from a real deployment, where `identityFromConfig` reads
 * `https://<issuer>/.well-known/openid-configuration` and the published keys
 * itself. No network, no credentials.
 *
 * This file is its own integration test: every line it prints is checked, and a
 * wrong answer throws.
 *
 * Run:  npm run example examples/deploy/oidc-token.ts
 */

import * as jose from 'jose';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  memorySessions,
  nodeHost,
  standingAgent,
  type IngressRecord,
} from '../../src/doors/hosting.js';
import {
  identityConfigFromEnv,
  IdentityConfigError,
  identityFromConfig,
  type DiscoveryFetch,
  type JoseBackend,
} from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/oidc-token',
  title: "Identity from config — only a person's token is a person",
  group: 'deploy',
  description:
    "identityFromConfig reads IDENTITY_* settings once at boot and hands standingAgent an oidc-token verifier: a person's access token is served under its oid, an application's own client-credentials token is refused as not-a-user-token, a token from an unlisted client as wrong-client, a token with no exp as unverifiable — and production with no strategy refuses to start. The IdP is a fake, in-process.",
  defaultInput: 'Which arrays are near capacity?',
  providerSlots: ['default'],
  tags: ['hosting', 'identity', 'security', 'oidc', 'config'],
};

const ISSUER = 'https://login.example.test/tenant-1/v2.0';
const API = 'api://neo';
const WEB_CLIENT = 'neo-web';

/** A fake OpenID provider: one RSA key, its discovery document, a token minter. */
async function fakeIdentityProvider(): Promise<{
  fetch: DiscoveryFetch;
  backend: JoseBackend;
  mint(claims: Record<string, unknown>): Promise<string>;
}> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const keySet = jose.createLocalJWKSet({ keys: [jwk] });
  const discovery = JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys` });
  return {
    fetch: async (url) =>
      url === `${ISSUER}/.well-known/openid-configuration`
        ? { status: 200, text: async () => discovery }
        : { status: 404, text: async () => 'not found' },
    backend: {
      createRemoteJWKSet: () => keySet,
      jwtVerify: (token, key, options) =>
        jose.jwtVerify(token, key as typeof keySet, options) as Promise<{
          payload: Record<string, unknown>;
        }>,
    },
    mint: (claims) =>
      new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(privateKey),
  };
}

/** What Entra ID puts in a person's access token for this API (v2). */
function personToken(oid: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: API,
    iat: now,
    exp: now + 3600,
    oid,
    sub: `pairwise-${oid.slice(0, 4)}`, // per-application: never the owner
    scp: 'access_as_user',
    azp: WEB_CLIENT,
    ...extra,
  };
}

function expect(label: string, actual: unknown, wanted: unknown): string {
  if (actual !== wanted) {
    throw new Error(`${label}: expected ${String(wanted)}, got ${String(actual)}`);
  }
  return `${label} → ${String(actual)}`;
}

export async function run(input: string): Promise<string> {
  const lines: string[] = [];
  const records: IngressRecord[] = [];
  const idp = await fakeIdentityProvider();

  // #region identity-from-config
  // What an install writes in its env file. The id claim and the required
  // scope have no defaults: they decide who owns every conversation, and
  // whether an application's own token counts as a person.
  const env = {
    IDENTITY_STRATEGY: 'oidc-token',
    IDENTITY_ISSUER: ISSUER,
    IDENTITY_AUDIENCE: API,
    IDENTITY_USER_ID_CLAIM: 'oid',
    IDENTITY_REQUIRED_SCOPE: 'access_as_user',
    IDENTITY_ALLOWED_CLIENTS: WEB_CLIENT,
  };
  const choice = await identityFromConfig(identityConfigFromEnv(env), {
    production: true, // the APP decides; the library never guesses from NODE_ENV
    fetch: idp.fetch, // ← the fake IdP's two seams; a real install omits both
    backend: idp.backend,
  });
  for (const line of choice.banner) lines.push(`  | ${line}`);

  const handle = await standingAgent({
    agent: Agent.create({ provider: mock({ reply: 'Two arrays are above 85%.' }), model: 'm' })
      .system('You answer capacity questions.')
      .build(),
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    identity: choice.identity, // the verifier the chooser built; undefined for 'open'
    onIngressDecision: (record) => records.push(record), // every refusal, by CLASS
  });
  // #endregion identity-from-config

  const ask = async (token: string, sessionId: string) => {
    const res = await fetch(`${handle.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ input, sessionId }),
    });
    const body = (await res.json()) as { output?: string; error?: string };
    const failure = records[records.length - 1]?.identityFailure ?? 'none';
    if (body.error?.includes(token)) throw new Error('a refusal quoted the token');
    return { status: res.status, failure, ...body };
  };

  try {
    const person = await ask(await idp.mint(personToken('6f1d2c3b-aaaa')), 'priya-1');
    lines.push(expect("a person's access token", person.status, 200) + ` "${person.output}"`);
    const served = records[records.length - 1];
    lines.push(expect('  the run is filed under the oid', served?.userId, '6f1d2c3b-aaaa'));

    // Any application in the tenant can get this for our API by the
    // client-credentials grant. The signature is valid; it is still not a person.
    const appOnly = personToken('sp-7c1e', {
      sub: 'sp-7c1e', // oid == sub: Microsoft's app-only test
      scp: undefined,
      roles: ['Task.Write'], // app roles instead of a delegated scope
      azp: 'some-daemon',
    });
    const app = await ask(await idp.mint(appOnly), 'daemon-1');
    lines.push(
      expect("an application's own token", `${app.status} ${app.failure}`, '401 not-a-user-token'),
    );

    const other = await ask(
      await idp.mint(personToken('6f1d2c3b-aaaa', { azp: 'unlisted-app' })),
      'priya-2',
    );
    lines.push(
      expect(
        'a person via an unlisted client',
        `${other.status} ${other.failure}`,
        '401 wrong-client',
      ),
    );

    const forever = await ask(
      await idp.mint(personToken('6f1d2c3b-aaaa', { exp: undefined })),
      'priya-3',
    );
    lines.push(
      expect('a token with no exp', `${forever.status} ${forever.failure}`, '401 unverifiable'),
    );
    lines.push('  (no refusal quoted its token)');
  } finally {
    await handle.close();
  }

  // The boot refusals: missing or wrong config stops the install.
  lines.push(expect('production with no strategy', await bootRefusal({}), 'IDENTITY_STRATEGY'));
  lines.push(
    expect(
      'a misspelled key',
      await bootRefusal({ IDENTITY_STRATEGY: 'open', IDENTITY_ISSUR: ISSUER }),
      'IDENTITY_ISSUR',
    ),
  );
  return lines.join('\n');
}

/** The key a boot refusal names, or 'started'. */
async function bootRefusal(env: Record<string, string>): Promise<string> {
  try {
    await identityFromConfig(identityConfigFromEnv(env), { production: true });
    return 'started';
  } catch (err) {
    if (err instanceof IdentityConfigError) return err.key ?? 'no key';
    throw err;
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
