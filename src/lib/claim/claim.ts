/**
 * Claim<T> — a value that says how it knows itself.
 *
 * Pattern: tagged union + tiny constructors. Pure, zero dependencies.
 * Role:    the library's honesty primitive — ONE vocabulary leaf, many doors.
 *          Every dynamic fact a subsystem states about the world is a Claim,
 *          never a bare value — so "unknown" carries its reason, and a count
 *          that nobody measured can never be rendered as a zero. It lives
 *          under lib/ (not under any one door) because two doors already need
 *          it: `agentfootprint/maps` (the mount kernel) and
 *          `agentfootprint/cache` (the hit-rate meter, 9.59.0). Both re-export
 *          THESE symbols, so `known` from either door is the same function.
 *
 * Why it exists: two recorded failures came from a system stating a value it
 * did not hold — a final summary written from a trimmed memory, and a served
 * list whose silent cap read as completeness. The type makes the third state
 * (we do not know, and here is why) impossible to skip: a consumer must
 * branch on `kind` to reach a value at all.
 *
 * @example
 *   import { known, unknown, isKnown } from 'agentfootprint/maps';
 *
 *   const total = known(11, 'the app declared total on the choices block');
 *   const cache = unknown('the provider reported no cache fields', 'usage payload');
 *   if (isKnown(total)) render(total.value); // the only door to the value
 */

/** A fact stated with its evidence, or an absence stated with its reason. */
export type Claim<T> =
  | {
      readonly kind: 'known';
      readonly value: T;
      /** Where this value came from — one plain sentence, kept on the record. */
      readonly evidence: string;
    }
  | {
      readonly kind: 'unknown';
      /** Why the value is not known. Mandatory: an unexplained unknown is a shrug. */
      readonly reason: string;
      readonly evidence?: string;
    }
  | {
      readonly kind: 'not-applicable';
      /** Why the question does not apply here (e.g. "a decision tree holds no cursor"). */
      readonly evidence: string;
    };

/** State a value with the evidence that backs it. */
export function known<T>(value: T, evidence: string): Claim<T> {
  return { kind: 'known', value, evidence };
}

/** State an absence with its reason — never render this as zero or empty. */
export function unknown<T = never>(reason: string, evidence?: string): Claim<T> {
  return { kind: 'unknown', reason, ...(evidence !== undefined && { evidence }) };
}

/** State that the question does not apply to this subject. */
export function notApplicable<T = never>(evidence: string): Claim<T> {
  return { kind: 'not-applicable', evidence };
}

/** Type guard — the only door to `.value`. */
export function isKnown<T>(claim: Claim<T>): claim is Extract<Claim<T>, { kind: 'known' }> {
  return claim.kind === 'known';
}

/**
 * The value when known, else the caller's stated fallback. The fallback is a
 * REQUIRED argument on purpose: defaulting to `undefined` silently would put
 * the shrug back into the type that exists to remove it.
 */
export function valueOr<T>(claim: Claim<T>, fallback: T): T {
  return claim.kind === 'known' ? claim.value : fallback;
}

/**
 * One plain sentence for a record or a prompt — states the value WITH its
 * standing, so a rendered unknown reads as "unknown (reason)", never as a
 * gap the reader fills in.
 */
export function describeClaim<T>(claim: Claim<T>): string {
  switch (claim.kind) {
    case 'known':
      return `${String(claim.value)} (${claim.evidence})`;
    case 'unknown':
      return `unknown — ${claim.reason}`;
    case 'not-applicable':
      return `not applicable — ${claim.evidence}`;
  }
}
