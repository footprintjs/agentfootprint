/**
 * types — the negative-claim checker's vocabulary: what it is handed (one run leg's calls, in
 * order) and what it files (rows of identities and codes — never a value, never a sentence).
 *
 * Role: integrity/ layer (L3), types only. The record's shapes that PR 2 owns live apart in
 * `searchRow.ts`, so their swap on rebase is one edit there.
 */

import type { Disposition } from '../disposition/types.js';
import type { ComposedSearchRow, DeclaredTool, SearchCheckedItem } from './searchRow.js';
import type { TextSpan } from './units.js';

/** What the tool-call ledger says of a call (`answer-validation/types.ts · AnswerToolCall`). */
export type LedgerOutcome = 'ok' | 'error' | 'not-run';

/** What a call returned, read by the record's one reader (`core/agent/emptiness.ts`). */
export type ReadEmptiness =
  | 'declared-absent'
  | 'undeclared-empty'
  | 'non-empty'
  | 'clarify'
  | 'unknown';

/**
 * One call of the record, in the order the calls were made. The checker classifies no tool
 * itself beyond the one rule of § 5.1: a call is a READ when its tool declares `search` or its
 * row is an `among` miss; every other call is not.
 */
export interface TurnCall {
  /** The library-minted result identity, `claim-result/<ns>/<runId>/<ordinal>`. */
  readonly resultId: string;
  /** The provider's call id — descriptive only; it never selects a call. */
  readonly toolCallId?: string;
  readonly toolName: string;
  /** The conversation turn the call ran in. */
  readonly turn: number;
  /** The batch (iteration) it was dispatched in; calls of one batch have no order. */
  readonly batch: number;
  /** Handed to `execute` — a call refused before dispatch (a schema refusal) never ran. */
  readonly dispatched: boolean;
  readonly outcome: LedgerOutcome;
  /** The arguments as sent, after the inputs layer's fill. */
  readonly arguments: Readonly<Record<string, unknown>>;
  /** What the call returned — present when it ran and returned. */
  readonly emptiness?: ReadEmptiness;
  /** How many rows it returned, as the record counted them. */
  readonly rows?: number;
  /** The rows it read, as plain records — only their identity and filtered fields are read. */
  readonly rowsRead?: readonly Readonly<Record<string, unknown>>[];
  /** The column that names a row (`resultColumns`' id column); else a fact's `entity`. */
  readonly idColumn?: string;
  /** The composed row (§ 3.2) — present when the call returned through a `search` tool. */
  readonly row?: ComposedSearchRow;
  /** The composed executed scope of a call that has no row (it did not return). */
  readonly scope?: readonly SearchCheckedItem[];
  /** A redaction policy kept a key the check reads out of the record. */
  readonly keptOut?: true;
  /** When the read ran, for a dated stale-turn note. */
  readonly readAt?: string;
}

/** The record one check reads: one run leg's calls and the declarations behind them. */
export interface TurnRecord {
  /** The leg the answer belongs to — its recording namespace and its run id. */
  readonly leg: { readonly namespace: string; readonly runId: string };
  readonly turn: number;
  /** The leg's clock (the time layer's injected `now`) — no clock is ever read. */
  readonly clock: string;
  /** Every call the record holds, in the order they were made. */
  readonly calls: readonly TurnCall[];
  /** `toolCallLedger.complete` — false when a call may be missing. */
  readonly ledgerComplete: boolean;
  readonly tools: Readonly<Record<string, DeclaredTool>>;
}

// ─── the typed door ──────────────────────────────────────────────────────

export type NegativeKind = 'none' | 'not-found' | 'complete';

export type TypedVerdict =
  | 'established'
  | 'contradicted-by-rows'
  | 'wider-search-has-rows'
  | 'search-incomplete'
  | 'superseded-by-write'
  | 'later-read-failed'
  | 'citation-unresolved'
  | 'cited-call-undeclared'
  | 'coverage-unverified'
  | 'call-not-read'
  | 'kind-mismatch'
  | 'about-mismatch'
  | 'record-incomplete'
  | 'stale-turn';

/** When a stale read was made. */
export interface StaleSince {
  readonly turn: number;
  readonly readAt?: string;
}

/** The typed row: identities and codes only (design § 5.4). */
export interface TypedNegativeRow {
  readonly id: string;
  readonly path: string;
  readonly index: number;
  readonly kind: NegativeKind | 'unknown';
  readonly code: TypedVerdict;
  readonly disposition: Disposition;
  readonly tools: readonly string[];
  readonly results: readonly string[];
  readonly staleSince?: StaleSince;
}

/** The library's statement of an established claim — delivered beside the row, never on it. */
export interface NegativeStatement {
  readonly text: string;
  readonly clauses: readonly string[];
  readonly version: string;
}

export interface TypedJudgement {
  readonly row: TypedNegativeRow;
  readonly statement?: NegativeStatement;
}

// ─── the prose door ──────────────────────────────────────────────────────

export type ProseNote =
  | 'record-incomplete'
  | 'stale-turn'
  | 'entity-unresolved'
  | 'subject-unmatched'
  | 'contradicted-by-rows'
  | 'readings-disagree'
  | 'call-not-read'
  | 'coverage-unverified'
  | 'declaration-overclaimed'
  | 'empty-undeclared'
  | 'clarify-open'
  | 'rows-undecided'
  | 'scope-wider'
  | 'coverage-gap'
  | 'gap-relevance-unknown'
  | 'cap-reached'
  | 'paged'
  | 'partial'
  | 'search-incomplete'
  | 'period-not-held'
  | 'period-partly-held'
  | 'period-unknown'
  | 'period-undeclared'
  | 'later-read-failed'
  | 'superseded-by-write';

/** One prose claim, noted. No note = noted established. Observe-only: nothing withholds. */
export interface ProseClaimRow {
  readonly kind: 'negative-claim';
  readonly field: string;
  readonly claim: 'none' | 'complete';
  readonly span: TextSpan;
  readonly phraseId: string;
  readonly packVersion: string;
  readonly notes: readonly ProseNote[];
  /** The result identities of the reads the claim resolved to. */
  readonly results: readonly string[];
  /** A fallback's candidate — never a binding. */
  readonly candidates?: readonly string[];
  readonly staleSince?: StaleSince;
}

/** A unit the grammar could not judge, said out loud. */
export interface ProseNoteRow {
  readonly kind: 'negative-claim-note';
  readonly field: string;
  readonly code: 'in-code-block' | 'language-unsupported';
  readonly span: TextSpan;
  readonly packVersion: string;
  readonly phraseId?: string;
}

export type ProseRow = ProseClaimRow | ProseNoteRow;
