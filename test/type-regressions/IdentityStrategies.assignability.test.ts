/**
 * Compile-level regression test — the identity strategies' public types, in
 * the direction a consumer writes them (`npm run test:types` checks the
 * assignments; vitest runs the assertions).
 *
 * Pins:
 *   1. What `identityFromConfig` hands out is exactly what `standingAgent`
 *      takes — no cast between the chooser and the door.
 *   2. `oidcIdentity` IS an `IdentityVerifier` (the port did not grow).
 *   3. `IdentityFailureClass` carries the four new words, and an exhaustive
 *      switch over it names all eleven — the changelog's "a consumer's
 *      exhaustive switch must add them" is this file failing to compile
 *      without them.
 *   4. `jwksIdentity` takes a roles PATH and `rolesFormat`.
 */
import { describe, expect, it } from 'vitest';

import {
  identityConfigFromEnv,
  identityFromConfig,
  jwksIdentity,
  oidcIdentity,
  type IdentityChoice,
  type IdentityConfig,
  type IdentityStrategyName,
  type JwksIdentityOptions,
  type OidcIdentity,
} from '../../src/doors/security';
import type {
  IdentityFailureClass,
  DoorIdentity,
  IdentityVerificationOptions,
  IdentityVerifier,
  StandingAgentOptions,
} from '../../src/doors/hosting';

import { signInSource, type SignInStore } from '../../src/doors/hosting';

function describeFailure(failure: IdentityFailureClass): string {
  switch (failure) {
    case 'no-token':
    case 'expired':
    case 'not-yet-valid':
    case 'wrong-audience':
    case 'wrong-issuer':
    case 'unverifiable':
    case 'claimed-another-user':
      return 'the token';
    case 'not-a-user-token':
    case 'wrong-client':
    case 'roles-unknown':
      return 'the person test';
    case 'two-credentials':
      return 'the credential seam';
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

/** 9.26 consumer code — must keep compiling (review idI34 S-6: the interface did not become a union). */
async function reuse926(o: IdentityVerificationOptions, token: string) {
  return o.verify(token);
}
interface AppIdentity926 extends IdentityVerificationOptions {
  readonly audit: boolean;
}

describe('identity strategies — public types', () => {
  it('9.26 code that calls o.verify and extends IdentityVerificationOptions still compiles', async () => {
    const app: AppIdentity926 = { verify: async () => ({ userId: 'u' }), audit: true };
    expect((await reuse926(app, 't')).userId).toBe('u');
  });

  it('a door identity may be sign-in only; verify-less WITHOUT signIn does not compile', () => {
    const store = {} as SignInStore;
    const signInOnly: DoorIdentity = {
      signIn: signInSource({ store, idleMinutes: 60 }),
    };
    // @ts-expect-error — neither a verify nor a sign-in source: nothing to check with.
    const nothing: DoorIdentity = { allowAnonymous: true };
    expect(signInOnly.verify).toBeUndefined();
    expect(nothing).toBeDefined();
  });

  it("the chooser's identity is the door's identity, with no cast", () => {
    const fromChoice = (choice: IdentityChoice): DoorIdentity | undefined => choice.identity;
    const intoDoor = (identity: DoorIdentity | undefined): StandingAgentOptions['identity'] =>
      identity;
    expect(typeof fromChoice).toBe('function');
    expect(typeof intoDoor).toBe('function');
    const boot: Promise<IdentityChoice> = identityFromConfig(
      { strategy: 'open' },
      { production: false },
    );
    return boot.then((choice) =>
      expect(choice.strategy satisfies IdentityStrategyName).toBe('open'),
    );
  });

  it('oidcIdentity is an IdentityVerifier, and env maps onto IdentityConfig', () => {
    const verifier: OidcIdentity = oidcIdentity({
      issuer: 'https://idp.example.test',
      audience: 'api://neo',
      userIdClaim: 'oid',
      requiredScope: 'access_as_user',
      allowedClients: 'any',
    });
    const port: IdentityVerifier = verifier;
    const config: IdentityConfig = identityConfigFromEnv({});
    expect(typeof port.verify).toBe('function');
    expect(config).toEqual({});
  });

  it('IdentityFailureClass names the person test and the credential seam', () => {
    expect(describeFailure('not-a-user-token')).toBe('the person test');
    expect(describeFailure('two-credentials')).toBe('the credential seam');
    expect(describeFailure('expired')).toBe('the token');
  });

  it('jwksIdentity takes a roles path and a roles format', () => {
    const options: JwksIdentityOptions = {
      jwksUrl: 'https://idp.example.test/keys',
      issuer: 'https://idp.example.test',
      audience: 'api',
      rolesClaim: ['realm_access', 'roles'],
      rolesFormat: 'space-delimited',
    };
    expect(typeof jwksIdentity(options).verify).toBe('function');
  });
});
