/**
 * THE MIGRATION LAW — 9.37.0's injectivity fix re-keys nobody it did not have to.
 *
 * `identity-injective.test.ts` proves the new encoding is injective, and pins
 * eight literal namespaces so a refactor cannot silently move a live key. What
 * neither of those can say is the thing the release actually promised
 * operators: *your* keys did not move. The 9.37.0 changelog said it with a
 * number — "18,225 realistic tuples identical, and zero of the changed ones
 * fall outside the class {contains `/`, contains `%`, is exactly `_`}" — but
 * that measurement lived in an ad-hoc script that was never committed, so the
 * claim could only be believed, never re-run. A number nothing reproduces is
 * prose wearing a lab coat. This file is the missing evidence.
 *
 * THE LAW, stated so it survives the corpus changing under it:
 *
 *   A tuple whose fields contain none of the three characters the new encoder
 *   reserves — the separator `/`, the escape introducer `%`, and the absence
 *   sentinel `_` (as a whole field) — encodes byte-identically to the
 *   pre-9.37 encoder. And the converse: every tuple that DID change has a
 *   field in that class.
 *
 * That biconditional is the assertion; the counts ride along behind it. A bare
 * count drifts the moment somebody adds a fixture, and then it is measuring
 * the corpus rather than the code.
 *
 * ONE HONEST REFINEMENT the changelog's sentence left out. The class above
 * describes the tenant and the principal, which the old encoder gave an
 * absence spelling (`|| '_'`). It never gave `conversationId` one: a missing
 * conversation id was interpolated raw, so it became the literal string
 * `"undefined"`, and an empty one became an empty segment. Those two DO
 * re-key, and they are not in the published class. They are also not
 * "well-behaved deployments": `conversationId` is a required field, and a
 * deployment that was passing `undefined` for it had every conversation of
 * every scope piled on one shelf named `undefined`. The law below therefore
 * requires the conversation id to be actually given, and the sweep exercises
 * the absent forms explicitly rather than quietly excluding them.
 */
import { describe, expect, it } from 'vitest';
import { identityNamespace, type MemoryIdentity } from '../../../src/memory/identity';

// ── The historical encoder, kept as a reference implementation ──────────

/**
 * `identityNamespace` EXACTLY as it shipped up to and including 9.36.x
 * (`git show fb1fa793:src/memory/identity/types.ts` — the commit before the
 * fix). It is duplicated here on purpose and must never be "cleaned up":
 *
 *   • it is the ONLY thing that can answer "did this key move?", and the
 *     answer stops being checkable the moment the old shape exists nowhere;
 *   • it is not a second production path — nothing outside this file may
 *     import it, and it takes the pre-fix parameter type (a `conversationId`
 *     that callers were free to leave `undefined`, which is precisely how it
 *     produced the literal `"undefined"`).
 *
 * Its bugs are the point. `${undefined}` really did interpolate to
 * `"undefined"`, and a raw `/` really did donate a field boundary — this
 * function reproduces both, because a reference implementation that quietly
 * fixed them would prove nothing about what is on disk.
 */
function identityNamespaceBefore9_37(identity: {
  tenant?: string;
  principal?: string;
  conversationId?: string;
}): string {
  const tenant = identity.tenant || '_';
  const principal = identity.principal || '_';
  return `${tenant}/${principal}/${identity.conversationId}`;
}

// ── The corpus: ids a real deployment actually holds ────────────────────

/**
 * Realistic values, not adversarial ones — that job belongs to
 * `identity-injective.test.ts`. These are the shapes tenant ids, subject
 * claims and thread ids come in: slugs, GUIDs, Entra domains, `auth0|…` subs,
 * emails, ULIDs, dates. `undefined` is in the tenant and principal lists
 * because a single-tenant deployment is a realistic deployment.
 *
 * The three lists are sized 25 × 27 × 27 = 18,225, which is the figure the
 * 9.37.0 changelog published. Sizing to a number that had no committed corpus
 * is a reconstruction, and is labelled as one — what makes it evidence is that
 * every tuple is checked below, not that the total is familiar.
 */
const TENANTS: ReadonlyArray<string | undefined> = [
  undefined,
  'acme',
  'acme-corp',
  'acme_corp',
  'ACME',
  'acme.io',
  'contoso.onmicrosoft.com',
  'globex',
  'initech',
  'umbrella-health',
  'tenant-1',
  'tenant-42',
  'tenant-000123',
  't1',
  'a',
  'org.engineering',
  'eu-west-tenant',
  'workspace~7',
  '11111111-2222-3333-4444-555555555555',
  'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  '1234567890',
  'prod',
  'staging',
  'customer:9931',
  'Ünïcode-GmbH',
];

const PRINCIPALS: ReadonlyArray<string | undefined> = [
  undefined,
  'alice',
  'bob',
  'user-42',
  'user_42',
  'u1',
  'alice@example.com',
  'josé.álvarez@example.com',
  'auth0|abc123',
  'auth0|64f0c1e2b7a9d3f012345678',
  'google-oauth2|107691503500061507151',
  'okta.00u1a2b3c4D5E6F7g8h9',
  'S-1-5-21-3623811015-3361044348-30300820-1013',
  'svc-indexer',
  'svc.billing-worker',
  'agent-7',
  'admin',
  'support-lead',
  'e2f1a4c8-9b3d-4f5a-8c17-2d6b0e9a1f34',
  'employee#4412',
  'AzureAD\\alice',
  '田中太郎',
  'anonymous-visitor',
  'api-key-holder-19',
  'bot:nightly-sync',
  'tester+ci@example.com',
  'p1',
];

const CONVERSATIONS: ReadonlyArray<string> = [
  'c1',
  'c2',
  'conv_9',
  'thread-7',
  'thread-2026-08-14',
  'sess.2026-08-14',
  'session-000001',
  'run-42',
  '01JAV8Q0Z1K2M3N4P5R6S7T8U9',
  '9f8e7d6c-5b4a-3210-fedc-ba9876543210',
  'a1b2c3d4',
  'chat',
  'default',
  'onboarding',
  'support-ticket-8891',
  'escalation.2',
  'daily-standup',
  'x',
  '0',
  '20260814T093000Z',
  'wa-15551234567',
  'slack-C01ABCDEF-1723640400.001',
  'email-thread-99',
  'voice-call-311',
  'demo',
  'regression-suite',
  'c-final',
];

/**
 * Values in the changed class — one per reason, plus the two absent
 * conversation-id forms the published sentence did not cover. They are swept
 * alongside the realistic corpus so the converse half of the law is tested on
 * tuples that really do move, instead of being satisfied vacuously.
 */
const IN_CLASS: ReadonlyArray<string | undefined> = [
  'acme/hr',
  'https://issuer.example/users/alice',
  '100%',
  'a%2Fb',
  '_',
];
const ABSENT_CONVERSATION: ReadonlyArray<string | undefined> = [undefined, ''];

// ── The class, as a predicate ──────────────────────────────────────────

/** The three characters the new encoder reserves, as the law names them. */
const SEPARATOR = '/';
const ESCAPE = '%';
const ABSENT = '_';

/** Does this value survive re-encoding untouched? */
function outsideReservedClass(value: string): boolean {
  return !value.includes(SEPARATOR) && !value.includes(ESCAPE) && value !== ABSENT;
}

/** `tenant` / `principal`: absent is fine — the old encoder spelled it `_` too. */
function optionalFieldIsUnaffected(value: string | undefined): boolean {
  return value === undefined || value === '' || outsideReservedClass(value);
}

/** `conversationId`: absence is NOT fine — the old encoder had no spelling for it. */
function conversationIdIsUnaffected(value: string | undefined): boolean {
  return value !== undefined && value !== '' && outsideReservedClass(value);
}

function tupleIsUnaffected(
  tenant: string | undefined,
  principal: string | undefined,
  conversationId: string | undefined,
): boolean {
  return (
    optionalFieldIsUnaffected(tenant) &&
    optionalFieldIsUnaffected(principal) &&
    conversationIdIsUnaffected(conversationId)
  );
}

/** Build the identity the two encoders are handed — omitted means omitted. */
function identityOf(
  tenant: string | undefined,
  principal: string | undefined,
  conversationId: string | undefined,
): MemoryIdentity {
  return {
    ...(tenant !== undefined && { tenant }),
    ...(principal !== undefined && { principal }),
    conversationId: conversationId as string,
  };
}

// ── Property: the law ──────────────────────────────────────────────────

describe('the 9.37.0 re-encoding — what moved, and what did not', () => {
  it('leaves every realistic tuple byte-identical to its pre-9.37 namespace', () => {
    let identical = 0;
    const moved: string[] = [];
    for (const tenant of TENANTS) {
      for (const principal of PRINCIPALS) {
        for (const conversationId of CONVERSATIONS) {
          const identity = identityOf(tenant, principal, conversationId);
          const before = identityNamespaceBefore9_37(identity);
          const after = identityNamespace(identity);
          if (before === after) identical += 1;
          else if (moved.length < 5) moved.push(`${before} → ${after}`);
        }
      }
    }
    // Fixtures, not real tenants — printing them is what makes a failure
    // actionable ("which key moved?" answered, not asked).
    expect(moved).toEqual([]);
    // The count is the CROSS-PRODUCT, derived — grow the corpus and this still
    // holds. It is asserted so "all of them" can't degenerate into "the two
    // the loop happened to reach".
    expect(identical).toBe(TENANTS.length * PRINCIPALS.length * CONVERSATIONS.length);
  });

  it('reproduces the 18,225 the changelog published', () => {
    // Pins the corpus SIZE to the released figure. If a future corpus should
    // be bigger, that is fine and this line moves — but then the number in the
    // 9.37.0 entry stops describing this file, and saying so out loud beats
    // letting the two drift apart in silence.
    expect(TENANTS.length * PRINCIPALS.length * CONVERSATIONS.length).toBe(18_225);
  });

  it('changes a namespace if and only if a field is in the reserved class', () => {
    const tenants = [...TENANTS, ...IN_CLASS];
    const principals = [...PRINCIPALS, ...IN_CLASS];
    const conversations = [...CONVERSATIONS, ...IN_CLASS, ...ABSENT_CONVERSATION];

    let changed = 0;
    let unaffectedButMoved = 0;
    let inClassButStill = 0;
    for (const tenant of tenants) {
      for (const principal of principals) {
        for (const conversationId of conversations) {
          const identity = identityOf(tenant, principal, conversationId);
          const moved = identityNamespaceBefore9_37(identity) !== identityNamespace(identity);
          const unaffected = tupleIsUnaffected(tenant, principal, conversationId);
          if (moved) changed += 1;
          if (moved && unaffected) unaffectedButMoved += 1;
          if (!moved && !unaffected) inClassButStill += 1;
        }
      }
    }

    // Forward: nothing outside the class was re-keyed. This is the promise a
    // deployment relies on.
    expect(unaffectedButMoved).toBe(0);
    // Converse: the class is TIGHT, not merely sufficient — every member of it
    // really does move. A class that over-claims would quietly excuse a bug.
    expect(inClassButStill).toBe(0);
    // And the sweep is not vacuous: re-keying genuinely happens in here.
    expect(changed).toBeGreaterThan(0);
  });

  it('names the tuples that DO move, one per reason', () => {
    // The worked examples behind the class — read this instead of re-deriving
    // it from the loops above.
    const moved: ReadonlyArray<[MemoryIdentity, string, string]> = [
      // the separator: two tuples that used to spell ONE namespace
      [
        { tenant: 'acme/hr', principal: 'alice', conversationId: 'c1' },
        'acme/hr/alice/c1',
        'acme%2Fhr/alice/c1',
      ],
      [
        { tenant: 'acme', principal: 'hr/alice', conversationId: 'c1' },
        'acme/hr/alice/c1',
        'acme/hr%2Falice/c1',
      ],
      // the escape introducer, which has to be inert before any escape is emitted
      [{ tenant: '100%', conversationId: 'c1' }, '100%/_/c1', '100%25/_/c1'],
      // the absence sentinel, worn as a name
      [{ tenant: '_', conversationId: 'c1' }, '_/_/c1', '%5F/_/c1'],
      // and the refinement: a conversation id that was never given
      [{ conversationId: undefined as unknown as string }, '_/_/undefined', '_/_/_'],
    ];
    for (const [identity, before, after] of moved) {
      expect(identityNamespaceBefore9_37(identity)).toBe(before);
      expect(identityNamespace(identity)).toBe(after);
    }
    // The collision the release was about: one namespace, two scopes.
    expect(
      identityNamespaceBefore9_37({ tenant: 'acme/hr', principal: 'alice', conversationId: 'c1' }),
    ).toBe(
      identityNamespaceBefore9_37({ tenant: 'acme', principal: 'hr/alice', conversationId: 'c1' }),
    );
  });
});
