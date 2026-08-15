/**
 * artifacts/conformance/types — what a store presents to the battery, and what
 * the battery hands back.
 *
 * The sibling of `hosting/conformance/types`, applied to the claim-check port
 * for the same reason: five stores, five sets of doubles, and a flaw in the
 * PORT's semantics would be invisible to all of them at once.
 */

import type { ArtifactRef, ArtifactScope, ArtifactStore } from '../types.js';

/**
 * Every case in the battery, by name.
 *
 * A closed union on purpose. A harness DECLARES the cases it cannot satisfy by
 * writing their names down, and a name that is a free-form string is a name
 * that goes stale silently — a declaration for a case that was renamed would
 * keep suppressing nothing at all, which is the same shape as the bug this
 * whole battery exists to catch.
 */
export type ArtifactStoreCaseName =
  | 'put-mints-a-ticket-head-describes-get-redeems'
  | 'payloads-round-trip-as-the-value-they-were-given'
  | 'refs-are-minted-never-derived-from-the-payload'
  | 'a-ref-alone-opens-nothing'
  | 'confusable-scopes-are-not-one-scope'
  | 'missing-expired-and-foreign-scope-are-one-absence'
  | 'expiry-is-stated-at-mint-never-sprung'
  | 'delete-removes-and-deleting-an-absence-is-agreement'
  | 'list-pages-newest-first-and-carries-no-payload'
  | 'awkward-scope-values-are-names-not-paths'
  | 'oversized-payload-is-refused-before-the-write'
  | 'parent-refs-are-proven-at-mint'
  | 'malformed-puts-are-refused-by-name'
  | 'refusals-carry-no-payload-and-no-scope'
  | 'digest-is-minted-over-the-payload-and-rides-the-ticket'
  | 'get-refuses-a-payload-that-no-longer-matches-its-digest'
  | 'get-stream-does-not-verify-the-digest'
  | 'streamed-put-round-trips-and-declares-its-bytes'
  | 'streaming-members-are-feature-detected';

/**
 * Members a case cannot run without.
 *
 * `putStream` and `getStream` are OPTIONAL on the port — a store that cannot
 * move a payload without holding it whole leaves them ABSENT rather than
 * faking one — so a store that lacks one is not failing anything, and a case
 * about it is reported `'not-applicable'` rather than passed or failed. That
 * is the port's own feature-detection rule, applied to its own battery.
 */
export type ArtifactStoreMember = 'putStream' | 'getStream';

/**
 * Harness hooks a case cannot run without.
 *
 * Each one is something no store can be asked to do through the port itself:
 * move its clock, damage its own bytes, or come into being with a different
 * budget. There is no portable way to do any of them, so they are the
 * harness's job — and a case that needs one nobody supplied FAILS rather than
 * skipping (see {@link ArtifactStoreOutcome}).
 */
export type ArtifactStoreHarnessHook = 'advanceTime' | 'corrupt' | 'boundedStore';

/**
 * How the battery reaches one store.
 *
 * A factory rather than an instance, because most of the battery needs a store
 * with NOTHING in it — a listing case that saw another case's rows would be
 * asserting on somebody else's fixtures — and because a store that has been
 * closed, or whose directory was removed, cannot be reset in place. One store
 * per case, disposed after it, is the only shape that holds for a `Map`, a
 * directory, an embedded database and a bucket at once.
 */
export interface ArtifactStoreHarness {
  /** What this store is called in a report. */
  readonly name: string;
  /**
   * A fresh store holding no artifacts. Called once per case.
   *
   * May be sync or async: some stores open a file, some await a connection,
   * and a battery that demanded one shape would exclude half the stores it is
   * here to check.
   */
  createStore(): ArtifactStore | Promise<ArtifactStore>;
  /**
   * Release what `createStore` (or {@link boundedStore}) acquired. Called
   * after every case, including the ones that failed — a store left open by a
   * failing case is a handle leak that surfaces three cases later as a
   * confusing second failure.
   */
  disposeStore?(store: ArtifactStore): void | Promise<void>;
  /**
   * Move THIS store's clock forward by `ms`.
   *
   * Expiry is the one law that cannot be observed without time passing, and
   * sleeping for it would make the battery slow enough that somebody deletes
   * the case. A store built on an injectable clock implements this in one
   * line; a store whose time comes from a service it does not control must
   * DECLARE the cases below by name.
   */
  advanceTime?(store: ArtifactStore, ms: number): void | Promise<void>;
  /**
   * Replace one artifact's stored PAYLOAD with different, well-formed bytes,
   * behind the store's back — the artifact must still be readable, just no
   * longer what was put.
   *
   * There is no portable way to do this — it is a poke at the file, the row,
   * or the object — so it is the harness's job. It is what makes the integrity
   * law observable at all: `get` re-hashes and must refuse. A store nothing
   * outside it can reach must DECLARE those cases with the reason.
   */
  corrupt?(store: ArtifactStore, scope: ArtifactScope, ref: ArtifactRef): void | Promise<void>;
  /**
   * A fresh, empty store whose per-scope byte budget is `maxBytesPerScope`.
   *
   * The ceiling law needs a ceiling small enough to hit in a test, and a
   * budget is configuration rather than a verb — there is no way to ask for it
   * through the port. A store with no configurable ceiling declares the case.
   */
  boundedStore?(maxBytesPerScope: number): ArtifactStore | Promise<ArtifactStore>;
  /**
   * Cases this store cannot satisfy, BY NAME, each with the reason.
   *
   * The reason is required, and it is the point. A store may legitimately be
   * unable to satisfy a case — a `Map` closed over by its factory genuinely
   * cannot be corrupted from outside — and the honest way to record that is a
   * sentence somebody can disagree with. A silent skip is a pass with the
   * evidence removed.
   *
   * A declared case still RUNS. If it turns out to pass, the report says so,
   * and the declaration is stale: a gate that absolves itself is worth
   * catching, and so is a gate nobody needed.
   */
  readonly declared?: Partial<Record<ArtifactStoreCaseName, string>>;
}

/** The helpers a case is handed, beside the store. */
export interface ArtifactConformanceKit {
  /**
   * A scope nothing else in this run uses. Cases address their own scope so
   * two batteries pointed at one shared backend cannot read each other's rows.
   */
  scope(suffix: string): ArtifactScope;
  /**
   * The unique token behind {@link scope}, for the cases that build their own
   * scope TUPLES — the confusable pairs mean nothing if a helper rewrites the
   * very fields whose spelling is under test.
   */
  readonly token: string;
  /**
   * The STORE's own idea of now, read the only way the port exposes it: mint a
   * throwaway artifact in a private scope and read the `createdAt` it stamped.
   *
   * A store on an injected clock and a store on the wall clock are both
   * entitled to their own calendar, so a case that computed an expiry from
   * `Date.now()` would state a time the store may consider the distant future
   * — and then pass by never expiring anything.
   */
  now(store: ArtifactStore): Promise<number>;
  /** Move the store's clock. Present only where the case declared the hook. */
  advance(store: ArtifactStore, ms: number): Promise<void>;
  /** Damage a stored payload. Present only where the case declared the hook. */
  corrupt(store: ArtifactStore, scope: ArtifactScope, ref: ArtifactRef): Promise<void>;
  /** A second store with a small byte budget; disposed with the case's own. */
  bounded(maxBytesPerScope: number): Promise<ArtifactStore>;
  /** The harness, for a case that wants to name it in a message. */
  readonly harness: ArtifactStoreHarness;
}

/** One case in the battery. */
export interface ArtifactStoreCase {
  readonly name: ArtifactStoreCaseName;
  /** The law it holds, in one sentence — printed beside a failure. */
  readonly law: string;
  /** Optional port members without which this case does not apply. */
  readonly members?: readonly ArtifactStoreMember[];
  /** Harness hooks without which this case cannot run at all. */
  readonly harnessNeeds?: readonly ArtifactStoreHarnessHook[];
  run(store: ArtifactStore, kit: ArtifactConformanceKit): Promise<void>;
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
 *    declared", because an undeclared skip is exactly what this battery
 *    refuses to let look like a pass.
 */
export type ArtifactStoreOutcome = {
  readonly case: ArtifactStoreCaseName;
  readonly law: string;
} & (
  | { readonly status: 'passed' }
  | { readonly status: 'not-applicable'; readonly missing: ArtifactStoreMember }
  | { readonly status: 'declared'; readonly reason: string; readonly stillFails: boolean }
  | { readonly status: 'failed'; readonly error: Error }
);

/** What one store's whole run came to. */
export interface ArtifactStoreReport {
  /** The harness name. */
  readonly store: string;
  readonly outcomes: readonly ArtifactStoreOutcome[];
  readonly passed: number;
  readonly notApplicable: number;
  readonly declared: number;
  readonly failed: number;
  /** True when nothing failed. Declarations do not make a store
   *  non-conformant — they make it conformant WITH STATED LIMITS, which is a
   *  different claim, and the report prints both. */
  readonly ok: boolean;
}
