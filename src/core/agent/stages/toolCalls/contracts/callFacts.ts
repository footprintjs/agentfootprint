import type { CodeRunFacts } from '../../../../codeRunnerTool.js';
import type { PendingToolTransition } from '../../../../../injection-engine/leases.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ProposedCall } from '../batch/paused.js';
import type { ToolResolution } from '../../toolResolver.js';

/** What a resumed call's `execute` saw — read by its script row (`deps.scriptRecord`). */
export interface ResumedCallFacts {
  /** Set once `execute` was about to be handed the call (the program values below were read then). */
  entered?: true;
  /** The declared argument's value as the model proposed it — read before `execute`. */
  proposed?: unknown;
  /** The declared argument's value handed to `execute` — read just before it ran. */
  submitted?: unknown;
  /** The runner's facts, when the tool filed them. */
  codeRun?: CodeRunFacts;
  /** The tool's own `resultCeiling` refused the result. */
  overCeiling?: true;
  /** `execute` was entered and threw. */
  threw?: true;
}

// ── Typed tool effects (9.19.0) — ONE judge, every dispatch path ───────
// The batch loop and the resume paths all finalize results; each hands a
// recognized envelope here, so an effect can never be judged differently
// because of which door its result came through.

/** The batch's transition bookkeeping: first ACCEPTED proposal wins the
 *  one `pendingToolTransition` slot (committed at acceptance, so a pause
 *  mid-batch never drops an accepted move); later proposals to OTHER
 *  targets are suppressed + collected for the batch-end `route_conflict`
 *  aggregate. */
export interface TransitionBatchState {
  winner?: PendingToolTransition;
  losers: Array<{ toolCallId?: string; toolName: string; target: string }>;
}

// ── The batch settlement (9.113.0) — ONE implementation, four resume doors ──
// A pause returns from inside the batch loop, so the calls the model batched
// AFTER the paused one were never dispatched (`pausedBatchOf`). Each resume
// path hands its answered history here and gets back the history it commits:
// the paused call's result, then one settled result per un-dispatched
// sibling, in call order — `notDispatchedResult`, never a dispatch. A resumed
// dispatch has no second checkpoint to give (`resolveCredentialAndExecute`
// turns a pause raised there into an error result), so a sibling that would
// ask a person, meet a check-in or wait on consent could not; the model reads
// the fact and decides for itself whether to propose the call again.
//
// What a settled sibling is NOT: a result that landed. It joins neither
// `lastToolResult` nor the `toolResults` batch — `on-tool-return` triggers,
// skill-graph routes and map renewal read those as "this tool returned", and
// it did not. No gate, no after-tool chain, no judge, no cap: none of them
// ever saw the call. Nor a call that DISPATCHED: its message carries
// `LLMMessage.notDispatched`, the fact as data, so the readers that ask
// "did it run?" or "is this a tool's result?" answer without parsing the
// sentence — a permission policy's `sequence` (`extractSequence`, which
// pairs the marker with its own proposal by position) and the check-in
// trail (`checkin.ts` · `buildTrail`) leave it out, the empty-lookup
// check's producer corpus takes no text from it (`producerCorpusOf`), the
// window names no tool for it (`../../../window/toolNames.ts` ·
// `toolNameOfMessage`: the last-tool-result pin, the drop notice, the
// dangling-reference check), the findings offer, identity source, piece,
// collapse and dropped-standings record skip it (`../findings/offer.ts`), so
// does a turn's standing (`../../../window/ledgerFactPins.ts` · `turnStandingOf`),
// and the trace toolpack reports it as not dispatched (`traceToolpack/toolCallJournal.ts` ·
// `notDispatchedOf`). Its two brackets carry the same marker
// (`bracketSettled`), so the readers of the EVENT stream answer the same
// way. The wire never carries the marker (`composeRequest.ts` ·
// `stripFrameworkFields`).
// Nothing settled → the SAME array comes back, no event fires, and the
// resume leg is byte-identical to the release before.
export interface BatchSettlement {
  /** What the resume leg commits and reports on `iteration_end`. */
  readonly history: LLMMessage[];
  /** The settled siblings, in call order, each with the sentence it got. */
  readonly settled: readonly { readonly call: ProposedCall; readonly result: string }[];
  /** How many calls the paused turn proposed — the batch loop's `parallelCount`. */
  readonly size: number;
  /** The call the run paused on — what every marker of this settlement names. */
  readonly paused: { readonly toolName: string; readonly toolCallId: string };
}

// Resolve a tool by name. Hoisted to the handler closure so BOTH `execute`
// (the ReAct loop) and `resume` (an approved check-in re-executes here) share
// one resolver. The Tools slot already invoked `provider.list(ctx)` this
// iteration and cached the resolved Tool[] in `providerToolCache` — read from
// there to avoid a second discovery call (vital for async network providers).
//
// DISPATCH FOLLOWS THE OFFER (9.92.0). A name on this epoch's wire resolves
// to the implementation of the party whose contract the model read — the
// slot's own record of its merge (`servedTools`), never a re-derivation.
// Before this, `registryByName` was consulted first for every name, so a
// provider's contract on the wire could be answered by a skill's `execute`
// (an INACTIVE skill's, even) and a provider's `skip_step` by the framework's
// — recorded-not-built entries 1 and 3.
//
// A name NOT on the wire keeps the capability law's held-out clause — a
// later step's tool, a parked map's tool, a scoped tool named from a
// restored transcript still run — under ONE condition: the party that
// answers is the party the model LAST READ the name under (`lastServed`), or
// the name's only holder when it was never served this run. A name whose
// last-served party can no longer answer (a provider withdrew it) is REFUSED
// as a recorded tool result rather than handed to a party the model was
// never shown under that name; a never-served name held by two parties is
// refused the same way. Every off-wire dispatch that DOES happen is put on
// the record by `tools.answered_off_wire`.
// THE ONE RESOLVER (lifted into `./toolResolver.ts` for the inputs layer,
// which must read a call's argument rules off the implementation that WILL
// answer it) — built from the same deps objects, so both ask one function.
export type Resolution = ToolResolution;
