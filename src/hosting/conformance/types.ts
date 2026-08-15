/**
 * hosting/conformance/types — what a store presents to the battery, and what
 * the battery hands back.
 */

import type { CheckpointEnvelope, SessionLifecycle } from '../types.js';

/**
 * Every case in the battery, by name.
 *
 * A closed union on purpose. A harness DECLARES the cases it cannot satisfy by
 * writing their names down, and a name that is a free-form string is a name
 * that goes stale silently — a declaration for a case that was renamed would
 * keep suppressing nothing at all, which is the same shape as the bug this
 * whole suite exists to catch.
 */
export type SessionLifecycleCaseName =
  | 'absent-session-hydrates-undefined'
  | 'persist-hydrate-round-trip'
  | 'unreadable-is-not-absent'
  | 'forget-removes-the-conversation'
  | 'ownership-is-derived-from-the-envelope'
  | 'ownership-fills-in-on-a-later-signed-turn'
  | 'ownership-survives-a-leaner-turn'
  | 'ownership-is-not-taken-by-a-different-signer'
  | 'contested-write-leaves-no-split-brain'
  | 'owner-of-is-undefined-for-missing-and-unowned'
  | 'list-by-user-pages-with-a-stable-tie-break'
  | 'awkward-session-ids-round-trip'
  | 'retention-says-who-deletes-and-deletes-only-the-old'
  | 'optional-members-are-feature-detected';

/**
 * Members a case cannot run without.
 *
 * `listByUser`, `ownerOf` and `retention` are OPTIONAL on the port, and
 * `forget` is not on it at all — so a store that lacks one is not failing
 * anything, and a case about it is reported `'not-applicable'` rather than
 * passed or failed. That distinction is the port's own feature-detection rule,
 * applied to its own test battery.
 */
export type SessionStoreMember = 'listByUser' | 'ownerOf' | 'forget' | 'retention';

/**
 * How the battery reaches one store.
 *
 * A factory rather than an instance, because most of the battery needs a store
 * with NOTHING in it — a listing case that saw another case's rows would be
 * asserting on somebody else's fixtures — and because a store that has been
 * closed, or whose file was removed, cannot be reset in place. One store per
 * case, disposed after it, is the only shape that holds for a `Map`, a file, a
 * transaction and a managed service at once.
 */
export interface SessionStoreHarness {
  /** What this store is called in a report. */
  readonly name: string;
  /**
   * A fresh store holding no sessions. Called once per case.
   *
   * May be sync or async: some stores open a file, some await a connection,
   * and a battery that demanded one shape would exclude half the stores it is
   * here to check.
   */
  createStore(): SessionLifecycle | Promise<SessionLifecycle>;
  /**
   * Release what `createStore` acquired. Called after every case, including
   * the ones that failed — a store left open by a failing case is a file
   * handle leak that shows up three cases later as a confusing second failure.
   */
  disposeStore?(store: SessionLifecycle): void | Promise<void>;
  /**
   * Replace one session's stored bytes with something that is NOT a readable
   * envelope, behind the store's back.
   *
   * There is no portable way to do this — it is a poke at the backing table,
   * the file, or the document — so it is the harness's job. A store that
   * cannot be corrupted from outside must DECLARE
   * `'unreadable-is-not-absent'` with the reason.
   */
  corrupt?(store: SessionLifecycle, sessionId: string): void | Promise<void>;
  /**
   * Cases this store cannot satisfy, BY NAME, each with the reason.
   *
   * The reason is required, and it is the point. A store may legitimately be
   * unable to satisfy a case — a service whose owner field is immutable at
   * creation cannot fill one in on turn two — and the honest way to record
   * that is a sentence somebody can disagree with. A silent skip is a pass
   * with the evidence removed.
   *
   * A declared case still RUNS. If it turns out to pass, the report says so,
   * and the declaration is stale: a gate that absolves itself is worth
   * catching, and so is a gate nobody needed.
   */
  readonly declared?: Partial<Record<SessionLifecycleCaseName, string>>;
}

/** The helpers a case is handed, beside the store. */
export interface ConformanceKit {
  /** A session id nothing else in this run uses. */
  id(suffix: string): string;
  /** A stored conversation, signed by `principal` when one is given. */
  envelope(text: string, principal?: string, savedAt?: number): CheckpointEnvelope;
  /** The harness, for the cases that need one of its hooks. */
  readonly harness: SessionStoreHarness;
}

/** One case in the battery. */
export interface SessionLifecycleCase {
  readonly name: SessionLifecycleCaseName;
  /** The law it holds, in one sentence — printed beside a failure. */
  readonly law: string;
  /** Store members without which this case does not apply. */
  readonly members?: readonly SessionStoreMember[];
  /** Harness hooks without which this case cannot run at all. */
  readonly harnessNeeds?: readonly 'corrupt'[];
  run(store: SessionLifecycle, kit: ConformanceKit): Promise<void>;
}

/**
 * How one case came out.
 *
 *  - `'passed'` — the store holds the law.
 *  - `'not-applicable'` — the case is about an OPTIONAL member this store does
 *    not implement. Feature detection, not a gap.
 *  - `'declared'` — the store implements the member and cannot satisfy the
 *    case, and said so by name. `stillFails: false` means the declaration is
 *    stale: it passes now.
 *  - `'failed'` — including "needed a harness hook nobody provided and nobody
 *    declared", because an undeclared skip is exactly what this suite refuses
 *    to let look like a pass.
 */
export type SessionLifecycleOutcome = {
  readonly case: SessionLifecycleCaseName;
  readonly law: string;
} & (
  | { readonly status: 'passed' }
  | { readonly status: 'not-applicable'; readonly missing: SessionStoreMember }
  | { readonly status: 'declared'; readonly reason: string; readonly stillFails: boolean }
  | { readonly status: 'failed'; readonly error: Error }
);

/** What one store's whole run came to. */
export interface SessionLifecycleReport {
  /** The harness name. */
  readonly store: string;
  readonly outcomes: readonly SessionLifecycleOutcome[];
  readonly passed: number;
  readonly notApplicable: number;
  readonly declared: number;
  readonly failed: number;
  /** True when nothing failed. Declarations do not make a store non-conformant
   *  — they make it conformant WITH STATED LIMITS, which is a different claim
   *  and the report prints both. */
  readonly ok: boolean;
}
