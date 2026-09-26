/**
 * Compile-level regression test — the identity strategies' public types, in
 * the direction a consumer writes them (`npm run test:types` checks the
 * assignments; vitest runs the assertions).
 *
 * Pins:
 *   1. What `identityFromConfig` hands out is exactly what `standingAgent`
 *      takes — no cast between the chooser and the door.
 *   2. `oidcIdentity` IS an `IdentityVerifier` (the port did not grow).
 *   3. `IdentityFailureClass` carries the three new words, and an exhaustive
 *      switch over it names all ten — the changelog's "a consumer's
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
  IdentityVerificationOptions,
  IdentityVerifier,
  StandingAgentOptions,
} from '../../src/doors/hosting';

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
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

describe('identity strategies — public types', () => {
  it("the chooser's identity is the door's identity, with no cast", () => {
    const fromChoice = (choice: IdentityChoice): IdentityVerificationOptions | undefined =>
      choice.identity;
    const intoDoor = (
      identity: IdentityVerificationOptions | undefined,
    ): StandingAgentOptions['identity'] => identity;
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

  it('IdentityFailureClass names the person test', () => {
    expect(describeFailure('not-a-user-token')).toBe('the person test');
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
