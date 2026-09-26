/**
 * The identity-strategy conformance battery (rule 22).
 *
 * Every strategy passes ONE suite against fakes before it ships, and later
 * strategies reuse it: `proxy-token` presents the same token shapes through a
 * different header; the password strategies present a username and password
 * instead, and answer `undefined` (not applicable) for shapes they cannot
 * produce. The LAWS are shared; only the presentation differs.
 *
 * Framework-free on purpose (the `SessionLifecycle` battery's shape): a case
 * throws to fail, so it runs under vitest, a plain script, or a consumer's own
 * runner. Three outcomes besides a pass:
 *
 *  - `'not-applicable'` — the harness cannot present that shape at all (a
 *    password strategy has no `alg: none` token).
 *  - `'declared'` — the harness CAN present it, and says by name, with a
 *    reason, that the strategy does not satisfy the law. The case still RUNS;
 *    a declared case that passes is reported `stale`, because a suppression
 *    nobody revisits is how a fixed defect keeps its exemption.
 *  - `'failed'`.
 */

import {
  IdentityNotVerifiedError,
  VerifierUnavailableError,
  type IdentityFailureClass,
  type IdentityVerifier,
  type VerifiedIdentity,
} from '../../../../src/doors/hosting.js';

/** Every credential shape a case can ask a harness for. */
export type Presentation =
  | 'person-a'
  | 'person-b'
  | 'person-a-again'
  | 'odd-bytes-id'
  | 'expired'
  | 'no-exp'
  | 'not-yet-valid'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'forged'
  | 'alg-none'
  | 'garbage'
  | 'app-only'
  | 'idtyp-app'
  | 'oid-equals-sub'
  | 'roles-without-scope'
  | 'wrong-scope'
  | 'wrong-client'
  | 'no-client'
  | 'roles-string-with-space'
  | 'roles-overage';

export interface IdentityStrategyHarness {
  /** What the strategy is called in a report. */
  readonly name: string;
  /** The strategy under test. */
  readonly verifier: IdentityVerifier;
  /** A credential of that shape, or `undefined` when the strategy cannot be presented one. */
  present(shape: Presentation): Promise<string | undefined>;
  /** The id each person shape must verify as. */
  readonly ids: { readonly a: string; readonly b: string; readonly oddBytes: string };
  /** The same strategy while its IdP is unreachable, when the harness can arrange it. */
  outage?(): Promise<IdentityVerifier>;
  /** Cases this strategy does not satisfy, by name, with the reason. */
  readonly declared?: Partial<Record<IdentityCaseName, string>>;
}

export type IdentityCaseName =
  | 'a-person-is-verified-as-their-id'
  | 'two-people-are-two-ids-and-one-person-is-one'
  | 'the-id-is-taken-as-bytes'
  | 'every-token-expires'
  | 'each-registered-claim-refuses-by-its-class'
  | 'a-forgery-is-unverifiable'
  | 'an-application-is-not-a-person'
  | 'only-a-listed-client-obtains-a-person'
  | 'a-roles-string-is-one-role'
  | 'unknown-roles-are-not-none'
  | 'an-outage-is-503-not-401'
  | 'the-credential-never-travels';

export interface IdentityCase {
  readonly name: IdentityCaseName;
  readonly law: string;
  run(harness: IdentityStrategyHarness): Promise<'passed' | 'not-applicable'>;
}

export interface IdentityCaseOutcome {
  readonly name: IdentityCaseName;
  readonly status: 'passed' | 'not-applicable' | 'declared' | 'failed';
  /** Present when a DECLARED case passed anyway. */
  readonly stale?: true;
  readonly detail?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

class CaseFailure extends Error {}

function fail(message: string): never {
  throw new CaseFailure(message);
}

/** `'n/a'` when the harness cannot present the shape. */
async function refusalOf(
  h: IdentityStrategyHarness,
  shape: Presentation,
): Promise<IdentityFailureClass | 'accepted' | '503' | 'n/a' | 'other'> {
  const credential = await h.present(shape);
  if (credential === undefined) return 'n/a';
  try {
    await h.verifier.verify(credential);
    return 'accepted';
  } catch (err) {
    if (err instanceof IdentityNotVerifiedError) return err.failure;
    if (err instanceof VerifierUnavailableError) return '503';
    return 'other';
  }
}

async function verified(
  h: IdentityStrategyHarness,
  shape: Presentation,
): Promise<VerifiedIdentity | undefined> {
  const credential = await h.present(shape);
  if (credential === undefined) return undefined;
  try {
    return await h.verifier.verify(credential);
  } catch (err) {
    fail(`${shape} was refused (${(err as { failure?: string }).failure ?? (err as Error).name})`);
  }
}

async function expectRefusals(
  h: IdentityStrategyHarness,
  expected: Partial<Record<Presentation, IdentityFailureClass>>,
): Promise<'passed' | 'not-applicable'> {
  let ran = 0;
  const wrong: string[] = [];
  for (const [shape, want] of Object.entries(expected) as [Presentation, IdentityFailureClass][]) {
    const got = await refusalOf(h, shape);
    if (got === 'n/a') continue;
    ran += 1;
    if (got !== want) wrong.push(`${shape}: expected ${want}, got ${got}`);
  }
  if (wrong.length > 0) fail(wrong.join('; '));
  return ran === 0 ? 'not-applicable' : 'passed';
}

/** Every shape a refusal case uses — the secrecy case walks them all. */
const REFUSED_SHAPES: readonly Presentation[] = [
  'expired',
  'no-exp',
  'not-yet-valid',
  'wrong-issuer',
  'wrong-audience',
  'forged',
  'alg-none',
  'garbage',
  'app-only',
  'idtyp-app',
  'oid-equals-sub',
  'roles-without-scope',
  'wrong-scope',
  'wrong-client',
  'no-client',
  'roles-overage',
];

// ─── The battery ─────────────────────────────────────────────────────

export const identityStrategyConformance: readonly IdentityCase[] = [
  {
    name: 'a-person-is-verified-as-their-id',
    law: "A person's credential verifies, and userId is exactly the configured id claim's value.",
    async run(h) {
      const who = await verified(h, 'person-a');
      if (who === undefined) return 'not-applicable';
      if (who.userId !== h.ids.a)
        fail(`userId ${JSON.stringify(who.userId)}, expected ${JSON.stringify(h.ids.a)}`);
      return 'passed';
    },
  },
  {
    name: 'two-people-are-two-ids-and-one-person-is-one',
    law: 'Two people never share an id; one person gets the same id on every credential.',
    async run(h) {
      const a = await verified(h, 'person-a');
      const b = await verified(h, 'person-b');
      const again = await verified(h, 'person-a-again');
      if (a === undefined || b === undefined || again === undefined) return 'not-applicable';
      if (a.userId === b.userId) fail('two people verified as one id');
      if (b.userId !== h.ids.b) fail(`person b verified as ${b.userId}`);
      if (again.userId !== a.userId) fail('one person verified as two ids');
      return 'passed';
    },
  },
  {
    name: 'the-id-is-taken-as-bytes',
    law: 'Ids are opaque bytes: never trimmed, case-folded or tidied (rule 7).',
    async run(h) {
      const who = await verified(h, 'odd-bytes-id');
      if (who === undefined) return 'not-applicable';
      if (who.userId !== h.ids.oddBytes) {
        fail(`id ${JSON.stringify(h.ids.oddBytes)} came back as ${JSON.stringify(who.userId)}`);
      }
      return 'passed';
    },
  },
  {
    name: 'every-token-expires',
    law: 'A credential with no lifetime is refused (rule 15).',
    run: (h) => expectRefusals(h, { 'no-exp': 'unverifiable' }),
  },
  {
    name: 'each-registered-claim-refuses-by-its-class',
    law: 'Expired, not-yet-valid, wrong issuer and wrong audience each refuse with their own class.',
    run: (h) =>
      expectRefusals(h, {
        expired: 'expired',
        'not-yet-valid': 'not-yet-valid',
        'wrong-issuer': 'wrong-issuer',
        'wrong-audience': 'wrong-audience',
      }),
  },
  {
    name: 'a-forgery-is-unverifiable',
    law: 'A signature by an unpublished key, alg:none and garbage are one answer: unverifiable.',
    run: (h) =>
      expectRefusals(h, {
        forged: 'unverifiable',
        'alg-none': 'unverifiable',
        garbage: 'unverifiable',
      }),
  },
  {
    name: 'an-application-is-not-a-person',
    law: "Only a person's token is a person (rule 5): app-only shapes and a missing required scope refuse.",
    run: (h) =>
      expectRefusals(h, {
        'app-only': 'not-a-user-token',
        'idtyp-app': 'not-a-user-token',
        'oid-equals-sub': 'not-a-user-token',
        'roles-without-scope': 'not-a-user-token',
        'wrong-scope': 'not-a-user-token',
      }),
  },
  {
    name: 'only-a-listed-client-obtains-a-person',
    law: 'The client that obtained the token must be listed; a token naming none is refused.',
    run: (h) => expectRefusals(h, { 'wrong-client': 'wrong-client', 'no-client': 'wrong-client' }),
  },
  {
    name: 'a-roles-string-is-one-role',
    law: 'A roles claim holding one string is ONE role: "x neo-users" never grants neo-users (rule 14).',
    async run(h) {
      const who = await verified(h, 'roles-string-with-space');
      if (who === undefined) return 'not-applicable';
      if (who.roles?.includes('neo-users')) fail(`roles read as ${JSON.stringify(who.roles)}`);
      if (JSON.stringify(who.roles) !== JSON.stringify(['x neo-users'])) {
        fail(`roles read as ${JSON.stringify(who.roles)}, expected ["x neo-users"]`);
      }
      return 'passed';
    },
  },
  {
    name: 'unknown-roles-are-not-none',
    law: 'A roles claim replaced by an overage pointer refuses as roles-unknown, never "no roles".',
    run: (h) => expectRefusals(h, { 'roles-overage': 'roles-unknown' }),
  },
  {
    name: 'an-outage-is-503-not-401',
    law: "An IdP this side cannot reach is this deployment's outage (503), never the caller's bad credential.",
    async run(h) {
      if (h.outage === undefined) return 'not-applicable';
      const verifier = await h.outage();
      const credential = await h.present('person-a');
      if (credential === undefined) return 'not-applicable';
      try {
        await verifier.verify(credential);
      } catch (err) {
        if (err instanceof VerifierUnavailableError) return 'passed';
        fail(
          `an outage refused as ${(err as { failure?: string }).failure ?? (err as Error).name}`,
        );
      }
      fail('a credential was accepted while the IdP was unreachable');
    },
  },
  {
    name: 'the-credential-never-travels',
    law: 'No refusal carries the credential: not in its message, an own property, a cause, or JSON (rule 10).',
    async run(h) {
      let ran = 0;
      for (const shape of REFUSED_SHAPES) {
        const credential = await h.present(shape);
        if (credential === undefined) continue;
        try {
          await h.verifier.verify(credential);
          continue;
        } catch (err) {
          ran += 1;
          const e = err as Error & Record<string, unknown>;
          const text = [
            e.message,
            String(e.stack),
            JSON.stringify(e),
            JSON.stringify(e.cause ?? null),
            ...Object.getOwnPropertyNames(e).map((k) => String(e[k])),
          ].join('\n');
          const probe = credential.length > 24 ? credential.slice(-24) : credential;
          if (text.includes(credential) || text.includes(probe))
            fail(`${shape}: the refusal carries the credential`);
        }
      }
      return ran === 0 ? 'not-applicable' : 'passed';
    },
  },
];

/** Run one case against a harness: the three not-run decisions and the stale mark. */
export async function runIdentityCase(
  testCase: IdentityCase,
  harness: IdentityStrategyHarness,
): Promise<IdentityCaseOutcome> {
  const reason = harness.declared?.[testCase.name];
  try {
    const status = await testCase.run(harness);
    if (reason !== undefined && status === 'passed') {
      return { name: testCase.name, status: 'declared', stale: true, detail: reason };
    }
    return { name: testCase.name, status };
  } catch (err) {
    if (reason !== undefined) return { name: testCase.name, status: 'declared', detail: reason };
    return { name: testCase.name, status: 'failed', detail: (err as Error).message };
  }
}
