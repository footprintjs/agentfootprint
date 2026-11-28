/**
 * llm-ledger/types — the entry shapes and the ledger's closed words.
 *
 * Pattern: declarations only. Every entry kind is one interface over one
 *          shared base; `entries.ts` is the one check that a value has one of
 *          these shapes, and `build.ts` holds the builders that make them.
 * Role:    the closed leaf's vocabulary. Every exported name carries the
 *          `Ledger` prefix, because `receipt` already names what the model was
 *          handed elsewhere in this package.
 * Emits:   N/A.
 *
 * All seq numbers are the entry numbers of ONE session, 1…n, shared by every
 * kind. A reference to another entry (a cite, a claim, `submit`, `note`,
 * `restsOn`) is always to an EARLIER entry.
 */
import type { JsonValue } from 'foottrace/canonical-json';

/** Who wrote an entry. */
export type LedgerBy = 'host' | 'agent' | 'ledger' | 'person';

/** Whether the ledger saw it happen (`observed`) or was told (`reported`). */
export type LedgerHow = 'observed' | 'reported';

/** The nine entry kinds. */
export type LedgerKind =
  | 'opened'
  | 'receipt'
  | 'supplied'
  | 'note'
  | 'withdrawal'
  | 'submit'
  | 'check'
  | 'released'
  | 'delivered';

/** What a note says it is. */
export type LedgerNoteKind = 'claim' | 'ruled-out' | 'question';
export type LedgerClaimStanding = 'sure' | 'qualified';

/** Who supplied a value the agent did not read. */
export type LedgerSupplier = 'person' | 'app' | 'system';

/** A check's disposition: the same four words as `integrity/disposition/types.ts` · `Disposition`. */
export type LedgerDisposition = 'checked-pass' | 'checked-fail' | 'not-applicable' | 'unreachable';

/** A claim's verdict. There is no "contradicted" in this release. */
export type LedgerVerdict = 'verified' | 'consistent-with-reported' | 'unsupported' | 'open';

/** Why a rule gave no answer of its own. No message is ever stored beside it. */
export type LedgerCheckWhy = 'rule-threw' | 'rule-timeout' | 'bad-result';

/** A person's answer to a withheld report. */
export type LedgerAnswer = 'release' | 'withhold';

/**
 * The closed refusal words a call answers with. A refusal never carries a
 * source value. `store-refused` travels with the store's code.
 */
export type LedgerRefusal =
  | 'no-session'
  | 'bad-session'
  | 'session-exists'
  | 'bad-input'
  | 'too-large'
  | 'unknown-receipt'
  | 'not-a-receipt'
  | 'unknown-note'
  | 'not-a-note'
  | 'not-a-claim'
  | 'already-withdrawn'
  | 'withdrawn-note'
  | 'bad-window'
  | 'unknown-rule'
  | 'rule-not-loaded'
  | 'ledger-full'
  | 'busy'
  | 'store-refused';

/** `sha256:` and 64 lower-case hex digits. */
export type LedgerDigest = string;

/** A half-open time window `[from, to)`, both ends RFC 3339 instants with an offset. */
export interface LedgerWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * A stored decision record. Its shape is the engine's (`decisionRecord` /
 * `fixedRecord`, not yet released); until then it is admitted as bounded,
 * canonical JSON.
 */
export type LedgerDecisionRecord = { readonly [key: string]: JsonValue };

/** What every entry carries. `at` is the host's clock, RFC 3339 UTC. */
export interface LedgerEntryBase<K extends LedgerKind> {
  readonly v: 1;
  readonly seq: number;
  readonly kind: K;
  readonly by: LedgerBy;
  readonly how: LedgerHow;
  readonly at: string;
}

/** The first entry of every session: what it runs. */
export interface LedgerOpened extends LedgerEntryBase<'opened'> {
  /** The `id@version` list this session runs. */
  readonly rules: readonly string[];
  readonly confirm: boolean;
  readonly askRunsRules: boolean;
}

/** What one read was told to have returned — tokens, never the text. */
export interface LedgerReceipt extends LedgerEntryBase<'receipt'> {
  readonly source: string;
  readonly query?: string;
  readonly window?: LedgerWindow;
  readonly limit?: { readonly rows: number; readonly hit: boolean };
  /** UTF-8 bytes of the text the host handed in. */
  readonly bytes: number;
  readonly nothingFound: boolean;
  /** Distinct tokens, first-seen order. */
  readonly tokens: readonly string[];
  /** Present only when something was not kept: tokens past the cap, text past the byte cap. */
  readonly cut?: { readonly tokensDropped: number; readonly bytesUnread: number };
  /**
   * Present only when the part read holds numbers written with thousands separators
   * (`1,234`): how many. Their values are not tokens, so the receipt is incomplete.
   */
  readonly groupedNumbers?: number;
  /**
   * Present only when the part read holds pieces next to a backslash that read two ways
   * (`\node1234`: a path's name, or a newline and `ode1234`): how many. Neither is a token.
   */
  readonly escapedPieces?: number;
  /** How many values the host's redactor masked before recording. */
  readonly hidden?: number;
  readonly ref?: { readonly uri: string; readonly digest: LedgerDigest };
  readonly externalId?: string;
}

/** A value given to the agent by the person, the app or the system: exempt, never support. */
export interface LedgerSupplied extends LedgerEntryBase<'supplied'> {
  readonly from: LedgerSupplier;
  readonly tokens: readonly string[];
  readonly bytes: number;
  readonly digest: LedgerDigest;
}

/** What the agent noted, and which receipts it cites. */
export interface LedgerNote extends LedgerEntryBase<'note'> {
  readonly noteKind: LedgerNoteKind;
  readonly claimStanding?: LedgerClaimStanding;
  readonly text: string;
  readonly values?: readonly string[];
  readonly window?: LedgerWindow;
  /** Receipt seqs, sorted, unique. */
  readonly cites: readonly number[];
}

/** The agent takes a note back. */
export interface LedgerWithdrawal extends LedgerEntryBase<'withdrawal'> {
  readonly note: number;
  readonly why: string;
}

/** The agent hands in a draft and names the notes it rests on. */
export interface LedgerSubmit extends LedgerEntryBase<'submit'> {
  readonly claims: readonly number[];
  readonly draftDigest: LedgerDigest;
  readonly draftBytes: number;
}

/** One rule's finding on one subject of one submit. */
export interface LedgerCheck extends LedgerEntryBase<'check'> {
  readonly submit: number;
  readonly subject: { readonly note: number } | { readonly draft: true };
  /** `id@version`. */
  readonly rule: string;
  readonly disposition: LedgerDisposition;
  readonly verdict?: LedgerVerdict;
  /** Receipt seqs, sorted, unique. */
  readonly restsOn: readonly number[];
  readonly decision?: LedgerDecisionRecord;
  readonly counts: {
    readonly visible: number;
    readonly missing: number;
    readonly supplied: number;
    readonly incomplete: number;
  };
  readonly missing?: readonly string[];
  readonly why?: LedgerCheckWhy;
}

/** A person's answer to a submit held for them, through the host. */
export interface LedgerReleased extends LedgerEntryBase<'released'> {
  readonly submit: number;
  readonly answer: LedgerAnswer;
  readonly why?: 'no-person-channel';
}

/** What the host delivered, compared with the last submit's draft. */
export interface LedgerDelivered extends LedgerEntryBase<'delivered'> {
  readonly digest: LedgerDigest;
  readonly bytes: number;
  readonly submit: number | null;
  readonly matches: boolean;
}

/** Any entry. */
export type LedgerEntry =
  | LedgerOpened
  | LedgerReceipt
  | LedgerSupplied
  | LedgerNote
  | LedgerWithdrawal
  | LedgerSubmit
  | LedgerCheck
  | LedgerReleased
  | LedgerDelivered;
