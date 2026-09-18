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

/**
 * The cap on the two one-line texts a basis row carries (`proposition`,
 * `predicts`): `ledger.ts · basisRowFrom` cuts a longer declaration here and
 * STATES the cut on the row (`…[clipped N chars]`), the same law
 * `serve.ts · FINDINGS_PIECE_LIMITS.lineChars` applies to a served line. The
 * emission in `history` keeps the model's full text; the row is the record's
 * bounded copy.
 */
export const PROPOSITION_CHARS = 240;

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
  /**
   * What the call tests — one line, declared BEFORE the result exists, so a
   * later `ruled-out` or `open` standing on that result can be read against
   * a proposition the model wrote without seeing the result. Optional; the
   * schema recommends it when `basis` is `'exploratory'`.
   */
  readonly proposition?: string;
  /** What the result should show if the proposition holds — one line, optional. */
  readonly predicts?: string;
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
   * The declared proposition and prediction, each at most `PROPOSITION_CHARS`
   * with any cut stated in the text itself. Present only when declared —
   * never defaulted, never inferred from the call's arguments.
   */
  readonly proposition?: string;
  readonly predicts?: string;
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
  /**
   * From the identified result (`offer.ts · knownResults`: the served
   * history's tool messages plus the previous batch); absent when the id
   * named none (`unknownId`), or when the served message carried no name.
   */
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
  /**
   * Set when `toolCallId` named no result the run could identify — neither a
   * served `role: 'tool'` message nor an entry of the previous batch
   * (`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
   * as written, never resolved.
   */
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

/**
 * The cap on the tool result text handed to the judge (9.104.0): a result
 * longer than this is cut before it enters the classifier's `state`, and the
 * cut is STATED on the row (`clipped: true`) — the record says what the judge
 * was shown, never implies it read the whole result.
 */
export const JUDGE_RESULT_CHARS = 4000;

/**
 * A SECOND SOURCE's reading of one result (9.104.0, `.findings({ judge })`):
 * a calibrated classifier (`agentfootprint/classify`) asked what the result
 * is worth for the proposition the model declared before the call — or, when
 * the call declared none, for the user's question (`against` says which).
 * Written beside the model's own `StandingRow`, never merged with it and
 * never served in its place: `foldLedger(...).standingOf` stays the model's
 * reading, `foldLedger(...).judgments` is the judge's. A disagreement between
 * the two is a FACT of the record, resolved by nobody.
 *
 * Every field is the provider's own data or a measurement around the call —
 * `probabilities` as sent (never renormalised), `confidence` as sent,
 * `testsSubject` the provider's probability that the result tests the
 * proposition at all, `usage` when the provider reported it, `latencyMs`
 * measured by the adapter. Nothing here is inferred by the library.
 */
export interface JudgmentRow {
  readonly kind: 'judgment';
  /** The RESULT judged — the tool call's id, the same key `StandingRow` uses. */
  readonly toolCallId: string;
  readonly toolName: string;
  readonly source: 'judge';
  /** The classifier's port name and the provider's resolved model string. */
  readonly judge: { readonly name: string; readonly model: string };
  /** What the result was judged AGAINST: the call's declared proposition, or the user's question. */
  readonly against: 'proposition' | 'question';
  readonly standing: Standing;
  readonly probabilities: Readonly<Record<Standing, number>>;
  readonly confidence: number;
  /** The provider's probability that the result tests the proposition / question at all. */
  readonly testsSubject?: number;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly latencyMs: number;
  /** Set when the result text was cut at `JUDGE_RESULT_CHARS` before the judge saw it. */
  readonly clipped?: true;
  /** The iteration whose dispatch landed the result. */
  readonly iteration: number;
}

/**
 * The judge was asked and produced no answer (9.104.0): the provider's
 * status and error text (the PROVIDER's words, not the model's — allowed on
 * the record) and the latency spent. Never a guessed standing: a failed
 * judgment is an absent judgment with a reason.
 */
export interface JudgmentErrorRow {
  readonly kind: 'judgment-error';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly source: 'judge';
  /** The classifier's port name; the model string is unknown when the call failed. */
  readonly judge: { readonly name: string };
  readonly status?: number;
  readonly message: string;
  readonly latencyMs: number;
  readonly iteration: number;
}

/**
 * The cap on a contingent row's `value` (9.110.0): a normalized DATA token
 * longer than this is cut and the cut is STATED in the text
 * (`…[clipped N chars]`), the law `PROPOSITION_CHARS` sets for a basis row's
 * texts. A token the extractor calls data is an identifier or a number, so
 * the cut is a floor against a pathological result, not a working bound.
 */
export const CONTINGENT_VALUE_CHARS = 120;

/** One result that carried a contingent value, with the standing the model gave it. */
export interface ContingentCarrier {
  readonly toolCallId: string;
  /** The result's CURRENT standing — never `fact` (a fact carrier means the value stands). */
  readonly standing: Standing;
}

/**
 * A value the model USED — in its answer, or as an argument of a later
 * call — that came only from results the model itself declared `open`,
 * `noise` or `ruled-out` (9.110.0): a theorem built on a lemma the prover
 * had already set aside. Declared standings plus the evidence corpus's
 * carriers (`evidence/evidenceIndex.ts · EvidenceCorpus.carriers`); no
 * inference, no judge, no second model — `findings/contingent.ts` is the
 * one rule. One row per contingent VALUE per moment (the answer, or the
 * call whose arguments used it), never per carrier.
 *
 * `value` is the token as the extractor normalized it (`evidence/extract.ts`
 * decides which tokens are data; `evidence/normalize.ts` the spelling), cut
 * at `CONTINGENT_VALUE_CHARS` with the cut stated. `carriers` names EVERY
 * result that carried it, in wire order, each with its standing — the whole
 * list, because the rule is "every carrier non-fact": a value with one
 * `fact` carrier, an undeclared carrier, or more carriers than the corpus
 * lists (`ValueCarriers.truncated`) files no row. `iteration` is the
 * moment's iteration — the answer's, or the dispatching call's.
 */
export interface ContingentRow {
  readonly kind: 'contingent';
  readonly declaredOn: DeclaredOn;
  readonly value: string;
  readonly carriers: readonly ContingentCarrier[];
  readonly iteration: number;
}

export type FindingsRow =
  | BasisRow
  | StandingRow
  | ConflictRow
  | JudgmentRow
  | JudgmentErrorRow
  | ContingentRow;

/** The committed key: flat, append-only, a fresh array on every write. */
export type FindingsLedger = readonly FindingsRow[];
