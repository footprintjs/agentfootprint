/**
 * The answer account — the typed shape `accountForAnswer` returns.
 *
 * ONE public name, `AnswerAccount`. Its family (a sentence, a pointer into the
 * record, a chip, a row …) is reached by indexed access —
 * `AnswerAccount['rows'][number]['lines'][number]` — rather than as a dozen more
 * exported names: every export is a page on the API site, and the site's export
 * file-count budget has cost a release before. The names below are exported from
 * this MODULE for the library's own files and tests; the barrel exports only
 * `AnswerAccount`, `AnswerAccountDeclarations` and `AnswerAccountShownLeaf`.
 *
 * Read the folder README for the laws (weakest voucher, "not recorded", leaves
 * only, own run only).
 */

/**
 * Who vouches for a fact or a sentence. Ranked for the weakest-input rule,
 * strongest first: `person` (the question only) > `library` (recorded by the
 * library itself) > `tool:<name>` (a tool's recorded declaration) > `model` (the
 * model's recorded declaration) > `app` (the app's declaration handed in when the
 * report is made — NOT on the record).
 */
export type AccountSource = 'person' | 'library' | `tool:${string}` | 'model' | 'app';

/** `recorded` ⇒ at least one pointer resolves into the record. */
export type FactStatus = 'recorded' | 'not-recorded' | 'not-applicable';

/** Why a fact the account looks for is not on the record. */
export type MissingReason =
  /** The event that would carry it is not in this recording. */
  | 'no-event'
  /** The library does not record this yet (standing, routing confidence). */
  | 'not-built'
  /** The tool or app did not declare it (no short, no kind, no coverage, no shape). */
  | 'not-declared'
  /** It happened in an earlier leg of a resumed answer. */
  | 'before-pause'
  /** Present, but not in a shape the account reads (counted in `unread`). */
  | 'unreadable';

/**
 * Where "show me" lands. Always a LEAF: `path` names one value, never a whole
 * payload. `path` is an RFC 6901 JSON pointer into the event's PAYLOAD, into the
 * state key's value, or into the history message — except the two derived
 * forms: `#emptiness` (a `{ rows, at }` count the account computed, never the
 * rows themselves) and `#meta/runId` (the event's own
 * run identity).
 */
export type RecordPointer =
  | {
      readonly kind: 'event';
      readonly index: number;
      readonly type: string;
      readonly path: string;
      readonly runtimeStageId?: string;
    }
  | { readonly kind: 'state'; readonly key: string; readonly path: string }
  | {
      readonly kind: 'history';
      readonly index: number;
      readonly path: string;
      readonly toolCallId?: string;
    }
  | {
      readonly kind: 'declaration';
      readonly owner: 'app';
      readonly field: string;
      readonly id?: string;
      readonly version?: string;
    };

/** One fact the account read (or looked for and did not find). */
export interface AccountFact<T> {
  readonly value: T | null;
  readonly source: AccountSource;
  readonly status: FactStatus;
  readonly pointers: readonly RecordPointer[];
  readonly missing?: MissingReason;
  /** The value was cut to bound the account's size; the rest is in the record. */
  readonly clipped?: true;
}

/** A value a sentence was filled with. `from` resolves to `value` (clipped values: to its start). */
export interface SentenceVar {
  readonly value: string | number;
  readonly from?: RecordPointer;
  readonly source: AccountSource;
  /** The value was longer than 2,000 characters and was cut; the rest is in the record. */
  readonly clipped?: true;
}

/** The sentence's text split for styling — typed text, never HTML. */
export type SentencePart =
  | { readonly text: string }
  /** A tool or skill id, verbatim. */
  | { readonly code: string }
  /** Words quoted from the record (the question as recorded). */
  | { readonly quote: string; readonly source: AccountSource }
  /** A declared label — drawn strong, with its own voucher. */
  | { readonly label: string; readonly source: AccountSource };

/** Which template filled a sentence, and which version of its words. */
export interface TemplateRef {
  readonly id: string;
  readonly version: number;
}

/** One line of the account. */
export interface Sentence {
  /** The whole sentence, plain. */
  readonly text: string;
  readonly parts: readonly SentencePart[];
  readonly template: TemplateRef;
  readonly vars: Readonly<Record<string, SentenceVar>>;
  /** The weakest of the truth-deciding inputs' sources (a label part is presentation, not truth). */
  readonly source: AccountSource;
  readonly status: FactStatus;
  readonly pointers: readonly RecordPointer[];
  readonly missing?: MissingReason;
  /** Chips that belong to THIS line (a kind, "not recorded", "decided = delivered"). */
  readonly chips?: readonly Chip[];
  /** A bulleted item under the nearest line above it that is not an item (declared coverage, flagged values). */
  readonly item?: true;
}

export type ChipMark =
  | 'said-by'
  | 'declared'
  | 'not-declared'
  | 'undeclared-empty'
  | 'decided-delivered'
  | 'decided-not-delivered'
  | 'not-recorded'
  | 'signals'
  | 'none-found'
  | 'before-pause'
  | 'kind';

export interface Chip {
  readonly mark: ChipMark;
  readonly text: string;
  readonly tone: 'plain' | 'ok' | 'warn' | 'bad';
  readonly template: TemplateRef;
}

export type RowId =
  | 'asked'
  | 'understood'
  | 'checked'
  | 'not-checked'
  | 'found'
  | 'how-sure'
  | 'anything-wrong';

/** One of the seven rows, always present, in `RowId` order. */
export interface Row {
  readonly id: RowId;
  readonly heading: Sentence;
  /** The row's lines, in order. A line with `item: true` is a bullet under the line before it. */
  readonly lines: readonly Sentence[];
  /** "…and n more tool calls" when the calls were folded (the omitted ones are in `show me`). */
  readonly more?: Sentence;
  readonly chips: readonly Chip[];
  readonly status: FactStatus;
}

export type SignalId =
  | 'decided-not-delivered'
  | 'existence-not-checked'
  | 'undeclared-empty-used'
  | 'undeclared-empty-in-view';

/** The three checks the account runs. */
export type CheckId = 'decided-delivered' | 'existence' | 'empty-results';

export interface Signal {
  readonly id: SignalId;
  readonly check: CheckId;
  readonly sentence: Sentence;
  readonly tone: 'warn' | 'bad';
}

/** A check that applies to this answer but could not be run on this record. */
export interface Unreachable {
  readonly check: CheckId;
  readonly missing: MissingReason;
  readonly sentence: Sentence;
}

/** How one tool call of THIS run went. */
export type CallOutcome =
  | 'ran'
  | 'failed'
  /** A rule refused it BEFORE the tool ran. */
  | 'refused'
  /** A person was asked and declined. */
  | 'declined'
  | 'not-dispatched'
  /** A start with no recorded end — the record does not say how it ended. */
  | 'unknown';

/** Whether the result the MODEL read was empty, and who says so. */
export type Emptiness = 'declared-absent' | 'undeclared-empty' | 'non-empty' | 'unknown';

export interface ToolCallFact {
  /** Cut at 200 characters (a model-chosen id is data, and the account is bounded). */
  readonly toolCallId: string;
  /** Cut at 200 characters; `''` when no event names the tool (then `unnamed`). */
  readonly toolName: string;
  /** No event of the call names its tool: the call is counted, judged and said to be unnamed. */
  readonly unnamed?: true;
  readonly outcome: CallOutcome;
  /** The rule that refused a `refused` call (a middleware, a permission rule id). */
  readonly refusedBy?: string;
  /** An AFTER-tool deny: the tool ran, the model read the rule's refusal. */
  readonly withheldBy?: string;
  readonly emptiness: Emptiness;
  /** Rows counted in the model's view (a counted rowset only). */
  readonly rows?: number;
  /** `app` when the emptiness rests on the app's declared `rowsAt`. */
  readonly emptinessSource?: 'library' | 'app';
  /** Whose view the emptiness was read from. */
  readonly view?: 'result' | 'model-result' | 'model-result-record-only';
  readonly coverage?: {
    readonly kind: 'absent' | 'coverage';
    /** The tool's own words, cut at 200 characters (the "It found" line prints up to 2,000). */
    readonly lookedFor?: string;
    readonly checked: number;
    readonly notChecked: number;
    readonly cannotCover: number;
    readonly kinds: number;
    readonly tryInsteadTool?: string;
  };
  readonly expectation?: { readonly basis: string; readonly expect?: string };
  readonly pointers: readonly RecordPointer[];
}

/** An earlier answer's tool result that was in front of the model when it answered. */
export interface InViewFact {
  readonly toolName: string;
  readonly toolCallId: string;
  /** User messages after the result, up to and including the current one. Always >= 1. */
  readonly distance: number;
  /** A window strategy was configured, so the distance is a floor. */
  readonly windowed: boolean;
  readonly emptiness: Emptiness;
  readonly rows?: number;
  readonly emptinessSource?: 'library' | 'app';
  readonly pointers: readonly RecordPointer[];
}

export interface RoutingFacts {
  readonly configured: AccountFact<
    | {
        readonly routing?: string;
        readonly continuity?: string;
        readonly scorer?: string;
      }
    | 'none'
  >;
  readonly verdict: AccountFact<{
    readonly by: string;
    readonly from?: string;
    readonly to?: string;
    readonly decisive?: boolean;
    readonly scorer?: string;
  }>;
  readonly scores: AccountFact<{
    readonly top: number;
    readonly next: number;
    readonly nextId: string;
    readonly allOthersEqual: boolean;
  }>;
  readonly confidence: AccountFact<number>;
  readonly appDecision: AccountFact<{ readonly skillId: string }>;
  readonly delivered: AccountFact<readonly string[]>;
  /** ≤ 12, ids and rule names cut at 200 (the model's `read_skill` argument is model-chosen). */
  readonly refusals: readonly {
    readonly requestedId: string;
    readonly by: string;
    readonly kind: 'rule' | 'person';
  }[];
  readonly refusalsOmitted?: number;
}

export interface EvidenceFact {
  readonly posture: string;
  readonly candidates: number;
  readonly lookedUp?: number;
  /** The values not found, each cut at 200 characters. */
  readonly unsupported: readonly string[];
  /** `unsupported` is at the event's cap (12), so the true count may be higher. */
  readonly capped: boolean;
  readonly action: string;
  readonly afterRevision: boolean;
  readonly truncated?: boolean;
}

/** The typed facts every sentence is filled from. */
export interface AnswerFacts {
  readonly routing: RoutingFacts;
  readonly calls: readonly ToolCallFact[];
  /** Calls past the 50-call cap, counted, not listed. */
  readonly callsOmitted?: number;
  /** On a resumed leg: tool calls answered in history before the pause, named only (≤ 50, names cut at 200). */
  readonly beforePause: readonly { readonly toolName: string; readonly toolCallId: string }[];
  readonly beforePauseOmitted?: number;
  /** ≤ 50, newest first; every one of them is judged by the checks. */
  readonly inView: readonly InViewFact[];
  readonly inViewOmitted?: number;
  readonly evidence: AccountFact<EvidenceFact>;
  readonly standing: AccountFact<'known' | 'not-sure' | 'ask'>;
  /** The library-appended limits block of the answer, when `.limitsTravelWithTheAnswer()` added one. */
  readonly limitsBlock: AccountFact<string>;
  readonly errors: {
    readonly failed: number;
    readonly refused: number;
    readonly declined: number;
    readonly notDispatched: number;
    readonly withheld: number;
  };
  readonly checks: {
    readonly reachable: readonly CheckId[];
    readonly unreachable: readonly CheckId[];
    readonly notApplicable: readonly CheckId[];
  };
}

/** Facts about the run the account read. */
export interface RunFact {
  readonly runId: string;
  readonly turnNumber?: number;
  readonly model?: string;
  readonly resumedLeg: boolean;
}

/**
 * One answer's account: facts, each with who vouches for it and where it lives
 * in the record, and the fixed sentences rendered from them.
 */
export interface AnswerAccount {
  readonly kind: 'agentfootprint/answer-account';
  readonly shape: 1;
  readonly templates: { readonly set: 'answer-account'; readonly version: number };
  readonly run: AccountFact<RunFact>;
  readonly question: AccountFact<string>;
  readonly answer: AccountFact<string>;
  readonly facts: AnswerFacts;
  /** Always the seven, in `RowId` order. */
  readonly rows: readonly Row[];
  /** Priority order. */
  readonly signals: readonly Signal[];
  readonly unreachable: readonly Unreachable[];
  readonly summary: {
    readonly sentence: Sentence;
    readonly tone: 'ok' | 'warn' | 'bad' | 'unknown';
  };
  /** Rows passed over as unreadable, including a sentence whose fill failed. */
  readonly unread: number;
  /** Events of another run, never read. */
  readonly foreign: number;
  /** `unfiltered` only when no run id is known — the account then reads every event. */
  readonly scope: 'own-run' | 'unfiltered';
}

/**
 * Data the APP declares when the report is made — not on the record. Everything
 * filled from it is vouched `app`.
 */
export interface AnswerAccountDeclarations {
  readonly id?: string;
  readonly version?: string;
  /** Plain labels for skills whose runs carry no declared title. The record wins when it has one. */
  readonly skills?: Readonly<Record<string, { readonly label?: string }>>;
  /** Where the rows of an OBJECT-shaped result live. Top-level key only. */
  readonly tools?: Readonly<Record<string, { readonly rowsAt?: string }>>;
  /** The app decides entries itself, outside the library's routing. */
  readonly routing?: { readonly appDecides?: boolean };
}

/**
 * One "show me" leaf as it leaves the server: a JSON leaf, a DERIVED emptiness
 * count (never the rows), or why it is withheld.
 */
export type AnswerAccountShownLeaf =
  | { readonly value: string | number | boolean | null }
  | { readonly rows: number; readonly at: string }
  | { readonly withheld: 'not-shown-here' | 'too-large' | 'not-found' | 'foreign' };
