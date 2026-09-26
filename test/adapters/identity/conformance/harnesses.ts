/**
 * Harnesses for the identity conformance battery: how each shipped strategy is
 * presented each credential shape. A later strategy adds its own harness here
 * and runs the same `identityStrategyConformance`.
 */

import {
  hashPassword,
  jwksIdentity,
  localPasswords,
  oidcIdentity,
  type OidcIdentityOptions,
} from '../../../../src/identity.js';
import {
  signInKeyOf,
  signInSource,
  verifyRequestIdentity,
  type IdentityVerificationOptions,
  type VerifiedIdentity,
} from '../../../../src/hosting/index.js';
import {
  login,
  mountDoor,
  TEST_COST as LOCAL_TEST_COST,
} from '../../../hosting/signInDoorHarness.js';
import type { IdentityStrategyHarness, Presentation } from './cases.js';
import {
  appOnlyClaims,
  fakeIdp,
  personClaims,
  seconds,
  type FakeIdp,
  type PersonShape,
} from './fakeIdp.js';

export const IDS = {
  a: '6f1d2c3b-0000-4a5b-9c8d-aaaaaaaaaaaa',
  b: '6f1d2c3b-0000-4a5b-9c8d-bbbbbbbbbbbb',
  oddBytes: ' MiXeD/Case Idé ',
} as const;

/** One token per shape, signed by `idp` (or not, for the forgeries). */
export async function tokenFor(
  idp: FakeIdp,
  shape: PersonShape,
  which: Presentation,
): Promise<string> {
  const t = seconds.now();
  const person = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
    personClaims(shape, IDS.a, overrides);
  switch (which) {
    case 'person-a':
      return idp.sign(person());
    case 'person-b':
      return idp.sign(personClaims(shape, IDS.b));
    case 'person-a-again':
      return idp.sign(person({ iat: t - 30, jti: 'second-sign-in' }));
    case 'odd-bytes-id':
      return idp.sign(personClaims(shape, IDS.oddBytes));
    case 'expired':
      return idp.sign(person({ iat: t - 7200, nbf: t - 7200, exp: t - 3600 }));
    case 'no-exp':
      return idp.sign(person({ exp: undefined }));
    case 'not-yet-valid':
      return idp.sign(person({ nbf: t + 3600, exp: t + 7200 }));
    case 'wrong-issuer':
      return idp.sign(person({ iss: 'https://elsewhere.example.test/' }));
    case 'wrong-audience':
      return idp.sign(person({ aud: 'api://somebody-else' }));
    case 'forged':
      return idp.sign(person(), { key: 'other' });
    case 'alg-none':
      return idp.unsigned(person());
    case 'garbage':
      return 'not-a-jwt-at-all';
    case 'app-only':
      return idp.sign(appOnlyClaims(shape));
    case 'idtyp-app':
      return idp.sign(person({ idtyp: 'app' }));
    case 'oid-equals-sub':
      return idp.sign(person({ sub: IDS.a }));
    case 'roles-without-scope':
      return idp.sign(person({ scp: undefined, roles: ['Reports.Read'] }));
    case 'wrong-scope':
      return idp.sign(person({ scp: 'User.Read openid' }));
    case 'wrong-client':
      return idp.sign(person({ azp: 'somebody-elses-client' }));
    case 'service-account':
      return idp.sign({
        iss: shape.issuer,
        aud: shape.audience,
        iat: t,
        exp: t + 300,
        sub: 'svc-7c1d',
        scp: `profile email ${shape.scope}`,
        azp: 'some-daemon',
        preferred_username: 'service-account-some-daemon',
      });
    case 'no-client':
      return idp.sign(person({ azp: undefined }));
    case 'roles-string-with-space':
      return idp.sign(person({ roles: 'x neo-users' }));
    case 'roles-overage':
      return idp.sign(
        person({
          _claim_names: { roles: 'src1' },
          _claim_sources: { src1: { endpoint: 'https://graph.example.test/getMemberObjects' } },
        }),
      );
  }
}

export const SHAPE_DEFAULTS = { audience: 'api://neo', scope: 'access_as_user', client: 'neo-web' };

/** `oidcIdentity` configured the way `identityFromConfig` builds it for Entra ID. */
export async function oidcHarness(): Promise<IdentityStrategyHarness & { idp: FakeIdp }> {
  const idp = await fakeIdp();
  const shape: PersonShape = { issuer: idp.issuer, ...SHAPE_DEFAULTS };
  const options = (fetchFrom: FakeIdp): OidcIdentityOptions => ({
    issuer: fetchFrom.issuer,
    audience: shape.audience,
    userIdClaim: 'oid',
    requiredScope: shape.scope,
    allowedClients: [shape.client],
    fetch: fetchFrom.fetch,
    backend: fetchFrom.backend,
  });
  return {
    name: 'oidcIdentity',
    idp,
    verifier: oidcIdentity(options(idp)),
    ids: IDS,
    present: (which) => tokenFor(idp, shape, which),
    async outage() {
      const down = await fakeIdp(idp.issuer);
      down.discovery('down');
      return oidcIdentity(options(down));
    },
  };
}

/** `jwksIdentity`, the older verifier: no person test, and it says so by declaration. */
export async function jwksHarness(): Promise<IdentityStrategyHarness> {
  const idp = await fakeIdp();
  const shape: PersonShape = { issuer: idp.issuer, ...SHAPE_DEFAULTS };
  const base = {
    jwksUrl: idp.jwksUri,
    issuer: idp.issuer,
    audience: shape.audience,
    userIdClaim: 'oid',
  };
  return {
    name: 'jwksIdentity',
    verifier: jwksIdentity({ ...base, backend: idp.backend }),
    ids: IDS,
    present: (which) => tokenFor(idp, shape, which),
    outage: async () =>
      jwksIdentity({
        ...base,
        backend: {
          createRemoteJWKSet: () => () => Promise.reject(new TypeError('fetch failed')),
          jwtVerify: idp.backend.jwtVerify,
        },
      }),
    declared: {
      'an-application-is-not-a-person':
        'jwksIdentity checks who SIGNED a token, not whether it stands for a person — use oidcIdentity',
      'only-a-listed-client-obtains-a-person':
        'jwksIdentity has no client check — use oidcIdentity',
      'unknown-roles-are-not-none': 'jwksIdentity reads roles as given — use oidcIdentity',
    },
  };
}

/**
 * `local-password`: the credential is the sign-in COOKIE the door minted after
 * a password login, and `verify` is the sign-in path of the one funnel. Token
 * shapes it cannot be presented (a JWT's claims) answer `undefined`.
 */
export async function localPasswordHarness(): Promise<
  IdentityStrategyHarness & { close(): Promise<void> }
> {
  const odd = 'MiXeD Casé/Id';
  const users = [
    `${IDS.a}:${await hashPassword('pw-a', LOCAL_TEST_COST)}`,
    `${IDS.b}:${await hashPassword('pw-b', LOCAL_TEST_COST)}`,
    `${odd}:${await hashPassword('pw-odd', LOCAL_TEST_COST)}`,
  ].join(',');
  const m = await mountDoor({ passwords: localPasswords(users) });
  const cookieOf = async (name: string, password: string): Promise<string> => {
    const signedIn = await login(m.url, name, password);
    return (signedIn.cookie as string).split('=')[1] as string;
  };
  const verifierOver = (identity: IdentityVerificationOptions) => ({
    verify: async (cookie: string) =>
      (await verifyRequestIdentity(
        identity,
        {},
        undefined,
        signInKeyOf(cookie),
      )) as VerifiedIdentity,
  });
  return {
    name: 'local-password',
    ids: { a: IDS.a, b: IDS.b, oddBytes: odd },
    verifier: verifierOver(m.door.identity),
    close: m.close,
    async present(shape) {
      switch (shape) {
        case 'person-a':
        case 'person-a-again':
          return cookieOf(IDS.a, 'pw-a');
        case 'person-b':
          return cookieOf(IDS.b, 'pw-b');
        case 'odd-bytes-id':
          return cookieOf(odd, 'pw-odd');
        case 'expired': {
          const value = `expired-${Math.random()}`;
          const t = Date.now() - 10 * 3_600_000;
          await m.store.create({
            key: signInKeyOf(value),
            identity: { userId: IDS.a },
            strategy: 'local-password',
            startedAt: t,
            expiresAt: t + 8 * 3_600_000,
            lastSeenAt: t,
          });
          return value;
        }
        case 'garbage':
          return 'a-cookie-value-nobody-was-issued';
        default:
          return undefined;
      }
    },
    async outage() {
      const down = {
        create: () => Promise.reject(new Error('down')),
        find: () => Promise.reject(new Error('down')),
        touch: () => Promise.reject(new Error('down')),
        delete: () => Promise.reject(new Error('down')),
      };
      return verifierOver({ signIn: signInSource({ store: down, idleMinutes: 60 }) });
    },
    declared: {
      'a-forgery-is-unverifiable':
        "a sign-in key nobody holds answers 'expired' — ended, expired and never-existed are one answer by design",
    },
  };
}
