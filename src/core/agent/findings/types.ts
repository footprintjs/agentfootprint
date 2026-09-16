/**
 * findings/types — the model's own standings, as record.
 *
 * Pattern: plain row types over ONE flat append-only ledger.
 * Role:    core/ layer leaf. What the model DECLARES about a tool call (a
 *          basis, before the result exists) and about the previous batch's
 *          results (a standing, after) lands as rows in
 *          `AgentState.findingsLedger`. `ledger.ts` is the one writer;
 *          `reserved.ts` is the one reader of the wire shape. Nothing in this
 *          folder infers: an absent declaration is absent on the record.
 *
 * WHICH "FINDINGS". These are the MODEL'S findings — what it says it stands
 * on, keeps open, ruled out or found to be noise. They are not the Context
 * Integrity rail's (`core/agent/integrityFindings.ts` files `ContextError`s
 * the LIBRARY detected). Nothing here is detected; everything here is
 * declared, and the row says so by carrying the declaring call.
 *
 * VOCABULARY. The word is `standing`. `integrity/disposition/types.ts` owns
 * 'disposition' for the checker's own verdicts (`checked-pass` and friends),
 * and the two must never share a name.
 *
 * ASSERTIONS. A `fact` row's assertions are `contextfootprint`'s `Assertion`
 * (through `integrity/assertion/types.ts`), so the same `conflictsOf` that
 * judges tool truth can judge what the model stands on. The stratum is a
 * DECLARED mapping, never a reading of the value: `fact` → `'asserted'`;
 * `open` and `ruled-out` → `'quoted'` (only a stood-on reading contradicts);
 * `noise` → no assertions at all. `epoch` is never set (the ledger is the
 * unversioned current world), and `runtimeStageId` is never stored — the
 * trace row carrying the write already names the writer.
 */

import type { Assertion } from '../../../integrity/assertion/types.js';

/** The reserved optional property every SERVED tool schema carries when armed. */
export const RESERVED_ARGUMENT = '_findings' as const;
/** The reserved top-level key a JSON answer may carry its standings under. */
export const RESERVED_ANSWER_KEY = '_findings' as const;

/** Why the model makes a call: it expects the answer, or it is looking. */
export type Basis = 'direct' | 'exploratory';
/** How useful the model expects the result to be — a bucket, never a number. */
export type Expect = 'low' | 'medium' | 'high';
/** What the model says a previous result IS to it. Absent = undeclared, never 'open'. */
export type Standing = 'fact' | 'open' | 'noise' | 'ruled-out';

/** The closed vocabularies, in the order the schema enumerates them. */
export const BASIS_VALUES: readonly Basis[] = Object.freeze(['direct', 'exploratory']);
export const EXPECT_VALUES: readonly Expect[] = Object.freeze(['low', 'medium', 'high']);
export const STANDING_VALUES: readonly Standing[] = Object.freeze([
  'fact',
  'open',
  'noise',
  'ruled-out',
]);

/** One assertion as the model DECLARES it — identity, predicate, value; no stratum yet. */
export interface DeclaredAssertion {
  readonly subject: { readonly kind: string; readonly id: string };
  readonly predicate: string;
  readonly value: unknown;
}

/** One previous result's standing, as declared on the wire. */
export interface PreviousStanding {
  /** The tool_result id the model is speaking about. */
  readonly toolCallId: string;
  readonly standing: Standing;
  /** Whether the result was what the call was after. */
  readonly sought?: boolean;
  /** What the model stands on (`fact`) or quotes (`open`, `ruled-out`). Ignored for `noise`. */
  readonly assertions?: readonly DeclaredAssertion[];
  /** `open`: what would settle it. */
  readonly settles?: string;
  /** `ruled-out`: one line naming what was ruled out. */
  readonly line?: string;
}

/**
 * The wire shape under `_findings` — on a tool call's args, or as the top-level
 * key of a JSON answer. Every field optional: the model declares what it
 * declares, and `reserved.ts · splitFindings` drops what it cannot read.
 */
export interface FindingsDeclaration {
  readonly basis?: Basis;
  readonly expect?: Expect;
  readonly previous?: readonly PreviousStanding[];
}

/** Where a standing was declared: on a later tool call, or on the answer. */
export type DeclaredOn = { readonly toolCallId: string } | 'answer';

/** The model's basis for ONE tool call, filed before the call runs. */
export interface BasisRow {
  readonly kind: 'basis';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly basis: Basis;
  readonly expect?: Expect;
  /**
   * How many entries of the same `_findings` value `splitFindings` dropped as
   * malformed. A count about the emission, present only when non-zero — it is
   * what `findings.declared` reports, and the row is the only place a count
   * about THIS declaration can live (the writer emits from rows alone).
   */
  readonly malformed?: number;
}

/** The model's standing on ONE previous result. The LAST row per `toolCallId` is current. */
export interface StandingRow {
  readonly kind: 'standing';
  /** The PREVIOUS result's id — the result being judged, not the judging call. */
  readonly toolCallId: string;
  /** From the batch; absent when the id named no result in it (`unknownId`). */
  readonly toolName?: string;
  /** The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`). */
  readonly ref?: string;
  readonly standing: Standing;
  readonly sought?: boolean;
  readonly settles?: string;
  readonly line?: string;
  /** Mapped by the stratum rule; always present, `[]` for `noise`. */
  readonly assertions: readonly Assertion[];
  readonly declaredOn: DeclaredOn;
  /**
   * The DECLARING iteration. The result's own tool-calls stage is derivable
   * from the commit log by `toolCallId` and is never guessed here.
   */
  readonly iteration: number;
  /** Set when `toolCallId` named no result in the previous batch. */
  readonly unknownId?: true;
}

/** One witness of a conflict — identities only, never the value. */
export interface ConflictWitness {
  readonly toolCallId: string;
  readonly subject: { readonly kind: string; readonly id: string };
  readonly predicate: string;
}

/**
 * The algebra's fact at the write that created it: two stood-on readings on
 * one key disagree. Written from `conflictsOf`'s output only, once per key.
 */
export interface ConflictRow {
  readonly kind: 'conflict';
  /** The `assertionKey` the readings share. */
  readonly key: string;
  readonly witnesses: readonly ConflictWitness[];
  readonly iteration: number;
}

export type FindingsRow = BasisRow | StandingRow | ConflictRow;

/** The committed key: flat, append-only, a fresh array on every write. */
export type FindingsLedger = readonly FindingsRow[];
