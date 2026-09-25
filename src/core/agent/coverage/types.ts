/**
 * coverage/types — the shared vocabulary of the two coverage primitives.
 *
 * Pattern: one value type, two consumers — `absent()` says "I looked HERE and
 *          found nothing", `coverage()` says "my answer covers THIS and not
 *          THAT". Both are statements about the same thing: the ground a
 *          result stands on. Spelling them with one vocabulary is what lets
 *          the answer-level block merge an absence's boundary with a
 *          verdict's without translating between two grammars.
 * Role:    core/ layer, pure data. No imports, no behavior.
 * Emits:   N/A.
 */

/**
 * One piece of ground, and (optionally) why it is where it is.
 *
 * `what` is prose the TOOL AUTHOR wrote — a source, a window, a filter, a
 * fleet ("the fcns database on shq-fab-a", "the last 24h", "all four
 * arrays"). It is never composed from the model's arguments by this library,
 * because the library does not know which of them are real.
 */
export interface CoverageItem {
  /** The source, window, filter or population. Non-empty. */
  readonly what: string;
  /**
   * Why it sits where it does. REQUIRED on `cannotCover` (a permanent blind
   * spot is a claim about capability, and a claim with no reason cannot be
   * acted on or disproved); optional on `checked` and `notChecked`, where
   * "we did" and "we did not need to" are often the whole story.
   */
  readonly why?: string;
  /**
   * A short plain form of `what`, for a person reading a report — "every VM
   * disk in the RVTools export of 2026-09-19" for a `what` that names the two
   * tables it read. Optional; at most 80 characters, one line, and never
   * longer than `what`.
   *
   * RECORD-ONLY: it rides the events (`tools.absent`,
   * `tools.coverage_declared`), the tracked `coverageDeclared` rows and the
   * answer account, and is REMOVED from what the model is served
   * (`read.ts` · `servedToModel`). It is also withheld from the evidence
   * corpus (`evidence.ts`), because it is the field an author is most tempted
   * to personalise: NEVER interpolate the caller's arguments into it — a true
   * short form restates `what`, so no value should live only here.
   */
  readonly short?: string;
  /**
   * What kind of ground a `notChecked` or `cannotCover` item is — a CLOSED
   * set, read by the answer account's existence check:
   *
   *   • `'existence'` — whether the thing asked about exists at all, or is
   *     the kind of thing the question assumes ("whether that name is a
   *     storage array").
   *   • `'scope'` — a population, family or source outside what this tool
   *     reaches ("hosts that are not VMware").
   *
   * Refused on `checked`. RECORD-ONLY, like `short`. Absent = not declared:
   * a reader never infers a kind from `what`. Library code never switches
   * EXHAUSTIVELY over this union (every switch has a `default` arm), so a
   * later member is an additive change for producers.
   */
  readonly kind?: 'existence' | 'scope';
}

/** What an author may write in a coverage list: bare prose, or prose + why. */
export type CoverageInput = string | CoverageItem;

/**
 * The three lists, normalized. This is the shape everything downstream reads —
 * the renderer, the event payload, the answer-level block.
 *
 * The three are NOT interchangeable, and the difference is the whole point:
 *
 *   • `checked` — ground this result actually stands on. A clean verdict here
 *     means VERIFIED.
 *   • `notChecked` — ground this run could have covered and did not (budget,
 *     a timeout, a scope the caller chose). A clean verdict says nothing
 *     about it. Re-asking with a wider scope can move it to `checked`.
 *   • `cannotCover` — ground no call to this tool will ever reach (no
 *     collector, no permission, no such telemetry). A clean verdict says
 *     nothing about it, and no retry ever will. This is the list that turns
 *     "everything looks fine" into "everything I can see looks fine".
 */
export interface Coverage {
  readonly checked: readonly CoverageItem[];
  readonly notChecked: readonly CoverageItem[];
  readonly cannotCover: readonly CoverageItem[];
}

/** What a tool author passes to {@link import('./ledger.js').coverage}. */
export interface CoverageDeclaration {
  readonly checked?: readonly CoverageInput[];
  readonly notChecked?: readonly CoverageInput[];
  readonly cannotCover?: readonly CoverageInput[];
}

/**
 * The other TOOL a suggestion points at, typed (9.113.0) — `tryInsteadTool`
 * on the declaration, `try_instead_tool` on the envelope.
 *
 * The `tryInstead` sentence puts a tool's name inside prose ("…or check
 * cluster_inventory for the collected names."), and a reader that wants to
 * know WHICH tool was suggested could only find out by parsing that sentence.
 * This library never parses a tool name out of prose, so the name rides here
 * as data — BESIDE the sentence, never in its place: `try_instead` stays a
 * string, so every reader of it reads what it always read.
 *
 * `tool` is NOT looked up. The tool may be served by a provider that resolves
 * per iteration, or be offered on a later turn; `absent()` requires a
 * non-empty name and records it as declared. Which names a provider accepts is
 * `core/tools.ts` · `assertValidToolName`'s question, and the library only
 * warns about it (dev mode), here as at `defineTool`.
 */
export interface TryInsteadTool {
  /** The tool's registered name, as a call would name it. */
  readonly tool: string;
  /** Why that tool, in the author's words ("it lists the collected names"). */
  readonly why?: string;
}

/** What a tool author passes to {@link import('./absent.js').absent}. */
export interface AbsenceDeclaration {
  /**
   * What was looked for, in the author's own words ("FLOGI entries on
   * fc1/3"). Required: an absence that cannot say what it did not find is
   * indistinguishable from a tool that returned nothing by accident.
   */
  readonly what: string;
  /**
   * The coverage of the search — REQUIRED and non-empty. An absence that
   * names no coverage is a `null` with extra steps: the reader still cannot
   * tell "I looked and there is nothing" from "I could not look", which is
   * the entire failure this primitive exists to prevent.
   */
  readonly checked: readonly CoverageInput[];
  /** Ground the search did not reach this time — an absence here proves
   *  nothing about it. */
  readonly notChecked?: readonly CoverageInput[];
  /** Ground no search by this tool can reach. Each needs a `why`. */
  readonly cannotCover?: readonly CoverageInput[];
  /**
   * Where to go INSTEAD, in one sentence ("widen the window with
   * `window: '7d'`, or ask for a different interface"). Optional, and the
   * highest-value optional field in the shape: the loop this primitive stops
   * is a model with nowhere else to go.
   *
   * Prose for the model. Nothing in this library reads a tool name out of it:
   * when the sentence points at another tool, name that tool in
   * {@link AbsenceDeclaration.tryInsteadTool} as well.
   */
  readonly tryInstead?: string;
  /**
   * The other TOOL the suggestion points at, as data (9.113.0) —
   * `{ tool, why? }`. Beside the sentence, not instead of it: the sentence is
   * what the model is told, this is what a reader reads without parsing
   * prose. Either may be given without the other; when both are given they
   * must name the same tool, and the library cannot check that they do — it
   * would have to read a tool name out of the sentence. ONE tool; a list is
   * refused (see `absent.ts` · `readToolSuggestion` for why).
   */
  readonly tryInsteadTool?: TryInsteadTool;
}

/**
 * The rendered absence — the exact object a tool hands back and the model
 * reads. Field names are snake_case and English on purpose: this value is
 * read by a language model far more often than by code, and `af_absent` is
 * the only field here that exists for the machine.
 *
 * The `af_absent` key is RESERVED vocabulary on the tool-result wire (the
 * `propose-transition` / `require-instruction` precedent): a plain object
 * carrying it is an absence, and nothing else in this library will treat any
 * other shape as one.
 */
export interface ToolAbsence {
  readonly af_absent: true;
  /** The plain-English handle. Present so a model that skims one key still
   *  reads the outcome rather than inferring it from a missing field. */
  readonly outcome: 'nothing_found';
  readonly looked_for: string;
  readonly checked: readonly CoverageItem[];
  readonly not_checked?: readonly CoverageItem[];
  readonly cannot_cover?: readonly CoverageItem[];
  /** Stated as data as well as prose — the note can be skimmed past, a
   *  `true` in a field named for the question cannot. */
  readonly retry_returns_the_same: true;
  /** The author's sentence. A string, always — the typed tool rides its own
   *  key, so a reader of this one never has to narrow it. */
  readonly try_instead?: string;
  /** The typed tool the suggestion points at (9.113.0), as declared — the
   *  author's words, `{ tool, why? }`. The model reads it as written. */
  readonly try_instead_tool?: TryInsteadTool;
  /** The static sentence. Never interpolated — see `absent.ts`. */
  readonly note: string;
}

/** The rendered coverage ledger, wrapped around the result it bounds. */
export interface CoveredResult<T = unknown> {
  readonly af_coverage: {
    readonly checked?: readonly CoverageItem[];
    readonly not_checked?: readonly CoverageItem[];
    readonly cannot_cover?: readonly CoverageItem[];
    readonly note: string;
  };
  /** The tool's own answer, untouched. */
  readonly result: T;
}

/**
 * One coverage statement as the RUN recorded it — what the event carries and
 * what accumulates in `AgentState.coverageDeclared`.
 *
 * `kind` is kept because the two read differently at the answer boundary: a
 * `'ledger'` bounds a verdict the answer is probably built on, an
 * `'absence'` bounds a search that found nothing.
 */
export interface DeclaredCoverage extends Coverage {
  readonly kind: 'absence' | 'ledger';
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  /** Present for `'absence'` only — what the search was for. */
  readonly lookedFor?: string;
}
