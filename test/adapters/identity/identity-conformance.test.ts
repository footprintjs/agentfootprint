/**
 * The identity-strategy conformance battery, run against every shipped
 * inbound verifier (rule 22). One assertion per case, so a failure names the
 * broken law.
 *
 * `jwksIdentity` runs it too, with three DECLARED cases: it has no person
 * test. That is the honest reading of the older verifier, and the reason
 * `oidcIdentity` exists — a declaration that starts passing is reported stale.
 */

import { describe, expect, it } from 'vitest';

import {
  identityStrategyConformance,
  runIdentityCase,
  type IdentityStrategyHarness,
} from './conformance/cases.js';
import { jwksHarness, localPasswordHarness, oidcHarness } from './conformance/harnesses.js';

type Build = () => Promise<IdentityStrategyHarness & { close?(): Promise<void> }>;

/**
 * [name, harness, the laws it cannot be PRESENTED at all]. A password strategy
 * has no token claims, so the token-shape laws are not applicable to it — named
 * here, so a new not-applicable case is a test failure, never silence.
 */
const suites: [string, Build, readonly string[]][] = [
  ['oidcIdentity', oidcHarness, []],
  ['jwksIdentity', jwksHarness, []],
  [
    'local-password',
    localPasswordHarness,
    [
      'every-token-expires',
      'an-application-is-not-a-person',
      'only-a-listed-client-obtains-a-person',
      'a-roles-string-is-one-role',
      'unknown-roles-are-not-none',
    ],
  ],
];

for (const [name, build, notApplicable] of suites) {
  describe(`identity conformance — ${name}`, () => {
    for (const testCase of identityStrategyConformance) {
      it(`${testCase.name}: ${testCase.law}`, async () => {
        const harness = await build();
        const outcome = await runIdentityCase(testCase, harness).finally(() => harness.close?.());
        expect(outcome.stale, `declared but passing: ${outcome.detail}`).toBeUndefined();
        expect(outcome.status, outcome.detail).not.toBe('failed');
        if (harness.declared?.[testCase.name] === undefined) {
          expect(outcome.status).toBe(
            notApplicable.includes(testCase.name) ? 'not-applicable' : 'passed',
          );
        }
      });
    }
  });
}

describe('identity conformance — the battery itself', () => {
  it('reports a case the strategy fails as failed, and a declared one that passes as stale', async () => {
    const harness = await oidcHarness();
    const broken: IdentityStrategyHarness = {
      ...harness,
      // A verifier that accepts everything as person a.
      verifier: { verify: async () => ({ userId: harness.ids.a }) },
    };
    const personCase = identityStrategyConformance.find(
      (c) => c.name === 'an-application-is-not-a-person',
    )!;
    expect((await runIdentityCase(personCase, broken)).status).toBe('failed');

    const staleDeclaration: IdentityStrategyHarness = {
      ...harness,
      declared: { 'an-application-is-not-a-person': 'pretend it cannot' },
    };
    const outcome = await runIdentityCase(personCase, staleDeclaration);
    expect(outcome).toMatchObject({ status: 'declared', stale: true });
  });

  it('answers not-applicable when a harness cannot present a shape at all', async () => {
    const harness = await oidcHarness();
    const passwordLike: IdentityStrategyHarness = { ...harness, present: async () => undefined };
    for (const testCase of identityStrategyConformance) {
      expect((await runIdentityCase(testCase, passwordLike)).status).toBe('not-applicable');
    }
  });
});
