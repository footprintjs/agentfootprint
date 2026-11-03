import type { InstructionDeliveryLease, ToolResultStatus } from './dependencyTypes.js';
import type { CoverageItemPayload } from './toolSemantics.js';

/**
 * One typed tool effect was judged (9.19.0) — the effects channel's own
 * record, fired in batch call order from the stage that judged it.
 *
 *   • `'accepted'` — a `propose-transition` passed the graph's reachability
 *     law (the cursor moves at the next evaluation unless a same-batch
 *     declared edge wins — that suppression is `skill.reroute_superseded
 *     { source: 'tool-proposal' }`), or a `require-instruction` named a
 *     registered instruction and its lease was granted.
 *   • `'refused'` — the teaching refusal: unreachable target, no graph to
 *     route, unknown instruction id, a body whose declared channel cannot
 *     be pushed, or a malformed effect. `refusalReason` says which.
 *   • `'superseded'` — an accepted transition proposal lost the batch to an
 *     EARLIER accepted proposal naming a different target
 *     (`skill.route_conflict { source: 'tool-proposal' }` reports the same
 *     batch once, winner + losers).
 *
 * No effects = this event never fires (zero-cost-when-unused).
 */
export interface ToolEffectPayload {
  readonly kind: 'propose-transition' | 'require-instruction';
  readonly outcome: 'accepted' | 'refused' | 'superseded';
  /**
   * The accepted `propose-transition` named the skill the cursor was ALREADY
   * in — a STAY, accepted as a no-op (9.86.0).
   *
   * Nothing moved and nothing activated, because the run is already in the
   * state the proposal asked for; no `pendingToolTransition` was written and
   * the tool's result carries no refusal suffix. Before this the reachable set
   * — which filters the cursor out of its own successor set, correctly, for a
   * MOVE — made a stay look unreachable and the proposal was refused.
   *
   * An ADDITIVE optional field rather than a fourth `outcome`: a consumer
   * switching exhaustively over `outcome` must keep compiling. Read it to tell
   * a no-op stay from a hop that will actually move the cursor.
   *
   * A stay COMPETES for the batch's one transition slot like any other
   * accepted proposal (9.86.1): judged first, it holds the slot, and a later
   * sibling proposing a hop is `'superseded'` with the batch's
   * `skill.route_conflict` naming the stay as the winner; judged after an
   * accepted hop, the stay is the one superseded. 9.86.0 let a stay through
   * without claiming the slot, so two `'accepted'` events could land in one
   * batch while the cursor moved.
   */
  readonly stay?: true;
  /** The tool whose result carried the effect. */
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  /** propose-transition: the proposed cursor target. */
  readonly targetSkillId?: string;
  /** propose-transition: the effect's own declared reason. */
  readonly reason?: string;
  /** require-instruction: the registered injection id it pushes. */
  readonly instructionId?: string;
  /** require-instruction: the granted (or asked-for) lease. */
  readonly deliveryLease?: InstructionDeliveryLease;
  /** outcome `'refused'`: the teaching sentence, verbatim. */
  readonly refusalReason?: string;
  /** outcome `'superseded'`: what outran it. */
  readonly supersededBy?: 'earlier-proposal';
}

/**
 * A tool's result was refused for exceeding the tool's own declared
 * `resultCeiling` (9.20.0) — the record of the size the content channels never
 * carry. The model read a teaching refusal ("No data was returned", plus how
 * to narrow); the oversized payload entered NO channel — not history, not
 * `stream.tool_end`, not this event. The delivered result carries status
 * `'invalid'`, so `onToolStatus` edges can route the overflow.
 *
 * No `resultCeiling` on the tool = this event never fires
 * (zero-cost-when-unused).
 */
export interface ToolResultRefusedPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The stringified result's TRUE length — the fact the refusal replaced. */
  readonly sizeChars: number;
  /** The tool's declared ceiling it exceeded. */
  readonly maxChars: number;
  /** The declared parameter names the refusal suggested narrowing by. */
  readonly narrowBy?: readonly string[];
  /** When the refused result was an effects envelope: the status the tool
   *  DECLARED before delivery was refused (its declared effects were still
   *  judged — a proposed transition does not die with an oversized payload). */
  readonly declaredStatus?: ToolResultStatus;
}

/**
 * A tool returned exactly what it returned before, for exactly the same
 * arguments (9.26.0) — and the model was told so.
 *
 * A NOTE was appended to that result; the call ran, the result is unchanged
 * beside the note, and nothing was refused. Payloads never ride this event:
 * `argsFingerprint` and `resultFingerprint` are short non-cryptographic
 * digests, which answer "is this the same?" and nothing else. See
 * `core/agent/repeatedCall.ts` for why the fingerprints and not the values.
 */
export interface ToolRepeatedCallPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** How many times this exact call+result has landed this turn, including
   *  this one. The note fires on the threshold landing only. */
  readonly occurrences: number;
  /** Digest of the arguments — never the arguments. */
  readonly argsFingerprint: string;
  /** Digest of the result — never the result. */
  readonly resultFingerprint: string;
  /**
   * Which fingerprint decided the match, when it was not the usual pair
   * (9.62.0). `'arguments'` means this landing matched on the tool's
   * arguments ALONE — the tool declared `repeatedWhen: 'arguments'`
   * (`tools/tools.ts`), so `resultFingerprint` above is still a true digest
   * of what came back but played no part in deciding this was a repeat.
   *
   * Additive and default-omitted: every event this library emitted before
   * 9.62.0, and every event for a tool that has not opted in, carries no
   * `mode` key at all — not `mode: undefined` written out, the key simply
   * absent — so an existing payload-key-set assertion anywhere does not see
   * a new field appear under it.
   */
  readonly mode?: 'arguments';
}

/**
 * A tool looked and found nothing, and said so with `absent(…)`.
 *
 * The event exists because the RECORD is where "we looked here and there was
 * nothing" has to survive: read off the answer alone, a clean run and a run
 * that searched an empty collector look identical. Carries the coverage the
 * tool declared — never the arguments the model passed, which are the model's
 * own words about what it wanted, not the tool's about what it covered.
 */
export interface ToolAbsentPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** What the tool says it was looking for (its own prose). */
  readonly lookedFor?: string;
  /** Ground the search DID cover. Non-empty by construction — `absent()`
   *  refuses a declaration that names no coverage. */
  readonly checked: readonly CoverageItemPayload[];
  /** Ground this search did not reach — the absence proves nothing there. */
  readonly notChecked?: readonly CoverageItemPayload[];
  /** Ground no call to this tool can reach. No retry changes it. */
  readonly cannotCover?: readonly CoverageItemPayload[];
  /**
   * Where the tool said to go instead — its `tryInstead` sentence, trimmed as
   * `absent()` mints it (9.113.0; an envelope minted elsewhere may have
   * handed the model a padded copy). Prose for the model: never parse a tool
   * name out of it (a name found inside prose is an inference); read
   * {@link ToolAbsentPayload.tryInsteadTool}.
   *
   * Before 9.113.0 the suggestion was never on this event: it rode only
   * inside the raw tool result (`agentfootprint.stream.tool_end`'s `result`,
   * the tool turn in history), where a reader had to recognize the envelope
   * again to find it.
   *
   * Additive and default-omitted: an absence that suggests nothing carries no
   * `tryInstead` key at all (the `ToolRepeatedCallPayload.mode` precedent).
   */
  readonly tryInstead?: string;
  /**
   * The other TOOL the suggestion points at, typed (9.113.0) — the tool's
   * `tryInsteadTool` as declared, copied. The name is not looked up: the tool
   * may be served by a provider, or never have been offered on this run.
   * Default-omitted like {@link ToolAbsentPayload.tryInstead}; either may
   * come without the other.
   */
  readonly tryInsteadTool?: TryInsteadToolPayload;
  /**
   * Where the search looked and when that source was measured, as the tool
   * declared it (honesty step 7b) — `absent({ …, provenance })`, in the
   * record's camelCase form. Default-omitted: an absence that declares no
   * source carries no key, and one whose source the rule set refuses (an
   * envelope minted elsewhere) carries none either (dev-warned).
   */
  readonly provenance?: ProvenancePayload;
  /**
   * What the search's READ covered in time, as the tool declared it (honesty
   * step 7b) — instants verbatim, camelCase like `lookedFor`. Default-omitted.
   */
  readonly period?: PeriodPayload;
  /**
   * What the LIBRARY composed for a tool that declares its `search` — the
   * facets by reference, the gaps, `complete`. Present only for such a tool;
   * every other absence carries no key. Composed VALUES ride no event in any
   * mode: they live on the committed `coverageDeclared` row, under the run's
   * redaction policy. For a `checked: 'declared'` absence, `checked` above
   * holds the declaration's constants only (the source, the fixed
   * qualifiers) and may be empty.
   */
  readonly composition?: CoverageCompositionPayload;
  /**
   * In place of `lookedFor` while `.negativeClaims()` is armed — a reference
   * to the committed row's field. Unarmed, `lookedFor` is today's bytes.
   */
  readonly lookedForRef?: CoverageFieldReference;
}

/** Where a value an event leaves out lives: the row the result identity addresses. */
export interface CoverageFieldReference {
  /** The row's address — `claim-result/<namespace>/<runId>/<ordinal>`. */
  readonly resultId: string;
  readonly field: 'lookedFor';
}

/**
 * One composed facet as it rides an event — a REFERENCE, never its value:
 * `{ resultId, argument }` names the committed row and the argument whose
 * value lives there.
 */
export interface CoverageFacetReferencePayload {
  readonly facet: 'source' | 'subject' | 'population' | 'filter' | 'period' | 'names';
  readonly from: 'call' | 'default' | 'host' | 'result';
  readonly ref: { readonly resultId: string; readonly argument?: string };
  /** Omission narrowed nothing (`whenOmitted: { any: true }`) — no value to keep out. */
  readonly any?: true;
}

/** One typed gap as it rides an event — the words name arguments and verdicts, never a value. */
export interface CoverageGapPayload {
  readonly kind:
    | 'argument-unsent'
    | 'cap-reached'
    | 'paged'
    | 'period'
    | 'partial'
    | 'credential-limited'
    | 'match'
    | 'ranking'
    | 'scope'
    | 'prose';
  readonly what: string;
  readonly why?: string;
  readonly bears?:
    | 'source'
    | 'population'
    | 'period'
    | 'completeness'
    | { readonly filter: string; readonly values?: readonly (string | number | boolean)[] };
  readonly argument?: string;
}

/** What the library composed for one call of a `search` tool, as an event carries it. */
export interface CoverageCompositionPayload {
  /** `'remote'` — a declaration over MCP or from a ToolProvider; it establishes nothing. */
  readonly origin: 'local' | 'remote';
  /** The committed row's address. */
  readonly resultId: string;
  readonly complete: boolean;
  /** Each facet that came from the call, a default, the host or the result — by reference. */
  readonly facets: readonly CoverageFacetReferencePayload[];
  readonly gaps: readonly CoverageGapPayload[];
}

/** An absence's source and time as it rides an event — detached plain data. */
export interface ProvenancePayload {
  readonly measuredAt: string;
  readonly source: string;
  readonly ageSeconds?: number;
  readonly sourceExportDate?: string;
}

/**
 * A declared period as it rides an event (honesty step 7b) — detached plain
 * data, the instants the tool declared, never parsed or reformatted.
 */
export interface PeriodPayload {
  readonly queried: { readonly from: string; readonly to: string };
  /** What the store holds, or `'unknown'` — the tool said it cannot vouch for it. */
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  readonly readAt?: string;
}

/** A suggestion to try another tool, as it rides an event: detached plain
 *  data, copied out of the tool's own declaration. */
export interface TryInsteadToolPayload {
  readonly tool: string;
  readonly why?: string;
}

/**
 * A tool returned a verdict WITH its own boundary — `coverage(result, …)`.
 *
 * The sibling of the evidence gate on the record: the gate's events say which
 * VALUES an answer could not support, this one says which LIMITS it did not
 * state. Fires per declaring call, whatever `.limitsTravelWithTheAnswer()`
 * is set to — the recording half is unconditional, only the appending half is
 * opt-in.
 */
/**
 * A code-runner tool ran a program the model wrote.
 *
 * **The code itself is deliberately NOT here.** Generated code quotes the data
 * it was given — a row, a serial, an address — so shipping it to every attached
 * exporter would put customer data on a wire nobody audited for it. This is the
 * same rule the session events already follow with `keyHash`, never the key.
 *
 * What travels instead is `shapeHash`: the program with its string literals,
 * numbers and identifier names stripped, leaving the CALL SHAPE — which
 * operations, in what order. Two runs that compute the same thing over
 * different data share a shape hash, which is exactly the grouping that makes
 * this useful: rank the shapes by how often they recur and the top of that list
 * is a backlog of tools somebody keeps having to write by hand.
 */
export interface ToolsCodeRunPayload {
  /** The name the model CALLED the code runner by, since an app may mount
   *  more than one — the registered name, which differs from the runner's
   *  own option name when a runner is re-exposed under another schema name. */
  readonly tool: string;
  /** The language the runner was configured for. */
  readonly language: string;
  /** How many declared artifact inputs were staged as files for this run. */
  readonly stagedInputs: number;
  /** Characters of stdout returned, AFTER the runner's cap. */
  readonly outputChars: number;
  /** True when the output hit `maxOutputChars` and was cut. */
  readonly truncated: boolean;
  /**
   * Whether the program ran to completion, as the code runner REPORTED it.
   * ABSENT when the runner reported neither an exit status nor an error —
   * the outcome is unknown, and an absent `ok` is never success. A `false`
   * is told apart by the three fields below.
   */
  readonly ok?: boolean;
  /** The program's exit status — exactly when the code runner reported one;
   *  never inferred, never defaulted. */
  readonly exitCode?: number;
  /** `true`: the code runner flagged an error and reported no exit status, so
   *  whether the code ran is NOT confirmed — not a failed program. */
  readonly serviceError?: true;
  /** The signal that ended the process before it exited, when the code runner
   *  knows it (`'SIGKILL'`): no exit status exists, and none is recorded. */
  readonly terminatedBy?: string;
  /** A stable hash of the normalized call shape. Never the code. */
  readonly shapeHash: string;
}
