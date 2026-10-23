/**
 * consentRequest — the request a consent gate puts to a person: how it is
 * named, what it is bound to, and how a decision is held to it, once.
 *
 * Role:   the ONE owner of that law. A consent gate (a tool's `checkIn`, a
 *         middleware's `ask`) pauses the run; `mintConsentRequest` mints the request
 *         at the pause, and `heldDecision` + `spendDecision` hold a resume's
 *         decision to it. The dispatch loop (`agent/stages/toolCalls.ts`) is
 *         the only writer and the only place a decision is used; `Agent.resume`
 *         asks the same pure question earlier, so a mismatch is refused before
 *         anything moves.
 * Reads:  the call about to pause; at a resume, the paused run's own state
 *         (`gatedCallOf`) and the decision.
 * Writes: nothing — the dispatch loop writes what `mintConsentRequest` returns.
 *
 * ── WHY THE ID IS A COMMITMENT, NOT ONLY A NAME ─────────────────────────────
 * `id = sha256(domain ‖ nonce ‖ canonicalJson(call))`, where the call is
 * everything that runs on approval: the gate, the tool, the call id, the
 * served party, the arguments and — for an ask — the middleware, where the
 * chain resumes and the names of the rules from the asking one on (a resume
 * refuses an agent whose chain no longer runs those rules, and a rule after
 * the ask that hands back other arguments than the ones approved — the tool
 * does not run). The nonce is 128 random bits kept in the paused run's state.
 *
 *   - A random nonce makes every pause's id unique and unguessable, so a
 *     decision for one pause can never answer another — even two pauses of
 *     the same tool, with the same model-chosen call id and the same
 *     arguments.
 *   - Re-deriving the id from the state at resume binds the decision to the
 *     exact call: a checkpoint whose arguments, tool, call id, party or chain
 *     position changed after the person was asked derives a different id, and
 *     no nonce makes it derive the old one (that would be a SHA-256 preimage).
 *     The person's decision quotes the id they were shown, so a checkpoint
 *     changed after the ask cannot be made to match it.
 *   - What it does NOT stop is a hostile writer of the checkpoint store: one
 *     who rewrites the call, the nonce and the request shown together BEFORE
 *     the person decides (they then approve what they were shown), or who
 *     switches the pause into a kind whose resume takes no decision (a
 *     credential-consent pause). The binding detects drift and replay, not
 *     that writer; a host that does not trust its store signs checkpoints or
 *     keeps them server-side.
 *   - The id carries no run value. The nonce does unlock it — whoever holds
 *     the nonce can confirm a guess of the arguments — so the state key that
 *     carries it (`pausedRequest`) is named with the arguments in the
 *     conversation redaction vocabulary (`redaction/conversation.ts`).
 *
 * ── THE DOMAIN ─────────────────────────────────────────────────────────────
 * The call is fingerprinted as JSON, because JSON is what a person is shown and
 * what a stored checkpoint holds. A call JSON cannot write down faithfully (a
 * `Date`, a `Map`, `Infinity` — `lib/jsonFaithful.ts`) cannot be bound, and
 * `mintConsentRequest` says so instead of fingerprinting a value two different calls
 * would share. JSON's own equivalences hold: a property whose value is
 * `undefined` is the property absent, and `-0` is `0`.
 *
 * ── ONCE ───────────────────────────────────────────────────────────────────
 * A request is spent the moment a resume uses a decision for it, approved or
 * declined (`DecisionLedger`), and "once" holds PER LEDGER. The default is one
 * ledger in this process's memory, shared by every agent that names none — a
 * pool that rebuilds an evicted instance, a host that builds a runner per
 * request, a composition's nested agents all spend in it. It is gone after a
 * restart and no other process sees it: where more than one process (or a
 * restart) can resume the same paused run, every agent that can resume it is
 * given one ledger in a store they all reach (`Agent.create({ decisionLedger })`).
 * A host that keeps the pause stops offering it once a resume of it fails,
 * unless the resume refused before its decision could reach a ledger
 * (`wasRefusedBeforeUse`, `hosting/answeredPause.ts`).
 */

import type { FlowchartCheckpoint } from 'footprintjs';
import { canonicalJson } from '../lib/canonicalJson.js';
import { isJsonFaithful } from '../lib/jsonFaithful.js';
import { sha256Hex } from '../lib/sha256.js';
import { looksLikeDecision, type CheckInDecision } from './checkin.js';
import {
  DecisionRequiredError,
  ResumeDecisionError,
  type ConsentGate,
  type ConsentGateKind,
} from './pause.js';

/**
 * The call a consent gate asked a person about — what runs on approval. Read
 * loosely (`unknown`) because at a resume it comes from a checkpoint: whatever
 * the state holds is what would run, and that is what gets fingerprinted.
 */
export interface GatedCall {
  readonly gate: ConsentGateKind;
  /** The tool's name. */
  readonly tool: unknown;
  /** The model's id for the call. */
  readonly toolCallId: unknown;
  /** The party the tool resolves against (`AgentState.pausedToolParty`), when one was recorded. */
  readonly party?: unknown;
  /** The arguments the call runs with. */
  readonly args: unknown;
  /** `'ask'` only — the middleware that asked. */
  readonly middleware?: unknown;
  /** `'ask'` only — the asking link's index; the chain resumes after it. */
  readonly askIndex?: unknown;
  /**
   * `'ask'` only — the names of the asking link and of every link after it,
   * in chain order: the rules the call still passes once the person answers.
   * A position alone would let a redeploy that removed or moved a later rule
   * resume past it; the names make that a refusal (`'chain-changed'`).
   */
  readonly chain?: unknown;
}

/** A consent gate's request as the paused run's state carries it (`AgentState.pausedRequest`). */
export interface PendingRequest {
  /** The id a decision quotes — 64 hex characters. */
  readonly id: string;
  /** 128 random bits, hex — the commitment's key. Never served on the request. */
  readonly nonce: string;
}

/** What {@link mintConsentRequest} hands the dispatch loop. */
export interface BoundRequest {
  readonly request: PendingRequest;
  /**
   * The detached copy of the arguments the request is bound to. The call
   * carries THIS copy from here on — on the request the person is shown, in
   * the paused run's state, and into the tool on approval — so nothing that
   * still holds the original can change what was approved.
   */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * Where the consent requests that have been answered are recorded, so one
 * decision runs one call — once per LEDGER.
 *
 * By default every agent that names none spends in one ledger in this
 * process's memory: "once" holds across this process's agents — a pool that
 * rebuilds an evicted instance, a server that builds an agent per request —
 * and only there. A restart forgets it, and another process never saw it.
 * When more than one process can resume the same paused run, or a restart
 * must not forget, give every agent that can resume it one ledger backed by a
 * store they all reach (`Agent.create({ decisionLedger })`).
 */
export interface DecisionLedger {
  /**
   * Record `requestId` as answered. Resolve `true` when THIS call recorded it
   * and `false` when it was already recorded — atomically per id: of two
   * concurrent calls for one id, exactly one may see `true`. Anything other
   * than `true` refuses the decision; a throw fails the resume. Both fail
   * closed: the tool does not run.
   */
  spend(requestId: string): boolean | Promise<boolean>;
}

/**
 * A NEW {@link DecisionLedger} in this process's memory. Grows by one id per
 * answered request.
 *
 * Agents that name no ledger already share one of these per process, so this
 * is for a ledger of their own: agents given different ledgers spend
 * separately, and a decision spent in one is not known to the others.
 */
export function inMemoryDecisionLedger(): DecisionLedger {
  const spent = new Set<string>();
  return {
    spend(requestId: string): boolean {
      if (spent.has(requestId)) return false;
      spent.add(requestId);
      return true;
    },
  };
}

/**
 * The ledger every agent that names none spends in — one per process, so a
 * decision runs once across every agent instance this process builds, not
 * once per instance. It lives as long as the process (one id per answered
 * request); request ids are unique per pause, so sharing it never makes one
 * agent's answer collide with another's.
 */
const PROCESS_LEDGER: DecisionLedger = inMemoryDecisionLedger();

/** This process's ledger — where an agent that names no `decisionLedger` spends. */
export function processDecisionLedger(): DecisionLedger {
  return PROCESS_LEDGER;
}

const DOMAIN = 'agentfootprint/consent-request/v1';
const HEX_ID = /^[0-9a-f]{64}$/;
const HEX_NONCE = /^[0-9a-f]{32}$/;

/**
 * Mint the request for a call about to pause, over a detached copy of its
 * arguments. `undefined` when the call cannot be bound — its arguments cannot
 * be copied, are not an object, or are not values JSON writes down faithfully
 * — and the gate must refuse the call instead of pausing.
 */
export function mintConsentRequest(call: GatedCall): BoundRequest | undefined {
  let args: unknown;
  try {
    args = structuredClone(call.args);
  } catch {
    return undefined;
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const nonce = randomHex(16);
  const id = requestIdOf(nonce, { ...call, args });
  return id === undefined
    ? undefined
    : { request: { id, nonce }, args: args as Readonly<Record<string, unknown>> };
}

/**
 * The paused call as the paused run's state records it — the one reading both
 * the resume's early check and the dispatch loop take, so they cannot disagree
 * about what the request was bound to.
 */
export function gatedCallOf(read: (key: string) => unknown, gate: ConsentGateKind): GatedCall {
  return gate === 'ask'
    ? {
        gate,
        tool: read('pausedToolName'),
        toolCallId: read('pausedToolCallId'),
        party: read('pausedToolParty'),
        args: read('pausedAskArgs'),
        middleware: read('pausedAskMiddleware'),
        askIndex: read('pausedAskIndex'),
        chain: read('pausedAskChain'),
      }
    : {
        gate,
        tool: read('pausedToolName'),
        toolCallId: read('pausedToolCallId'),
        party: read('pausedToolParty'),
        args: read('pausedCheckInArgs'),
      };
}

/**
 * Hold a resume's input to the request the run is paused on. Pure: it spends
 * nothing (see {@link spendDecision}).
 *
 * @param recorded the paused run's `pausedRequest`, as read — never trusted.
 * @param call     the paused call, as read ({@link gatedCallOf}).
 * @param rules    the resuming agent's own `toolMiddleware` chain, by link
 *   name — an ask's approval holds only for the rules it was asked under.
 * @returns a detached copy of the decision.
 * @throws DecisionRequiredError when the input is not a decision at all.
 * @throws ResumeDecisionError (`'no-request'`, `'request-not-recorded'`,
 *   `'other-request'`, `'call-changed'`, `'chain-changed'`) when it cannot
 *   answer this request.
 */
export function heldDecision(
  input: unknown,
  gate: ConsentGate,
  recorded: unknown,
  call: GatedCall,
  rules: readonly string[],
): CheckInDecision {
  const decision = decisionCopyOf(input);
  if (decision === undefined) throw new DecisionRequiredError(gate, input);
  const requestId =
    typeof decision.requestId === 'string' && decision.requestId.length > 0
      ? decision.requestId
      : undefined;
  // A pause that recorded no request can be answered by nothing — said first,
  // because no decision, however it is built, would change that. No refusal
  // carries an id (`ResumeDecisionError`): it would hand out the one it
  // requires.
  const pending = readPendingRequest(recorded);
  if (pending === undefined) throw new ResumeDecisionError('request-not-recorded', gate.kind);
  if (requestId === undefined) throw new ResumeDecisionError('no-request', gate.kind);
  if (requestId !== pending.id) throw new ResumeDecisionError('other-request', gate.kind);
  if (requestIdOf(pending.nonce, call) !== pending.id) {
    throw new ResumeDecisionError('call-changed', gate.kind);
  }
  // The checkpoint is the one the person was asked over; the agent resuming it
  // must still be one that runs the same rules from the asking link on.
  if (call.gate === 'ask' && !sameChain(call.chain, rules, call.askIndex)) {
    throw new ResumeDecisionError('chain-changed', gate.kind);
  }
  return decision as CheckInDecision;
}

/**
 * Whether `wouldRun` are the arguments the paused request was minted over —
 * decided by re-deriving the request's id with them in place of the recorded
 * ones: the call that runs must be the call the id the person was shown
 * commits to. Key order and JSON's own equivalences do not count; a value
 * JSON cannot write down faithfully never matches.
 *
 * Held to the REQUEST, never to a copy: an ask's resume hands the rest of the
 * chain a copy of the approved arguments, and a link that edited that copy in
 * place would make any comparison against it agree with itself.
 *
 * @param recorded the paused run's `pausedRequest`, as read.
 * @param call     the paused call, as read ({@link gatedCallOf}); its own
 *   `args` are replaced by `wouldRun`.
 */
export function runsAsAsked(recorded: unknown, call: GatedCall, wouldRun: unknown): boolean {
  const pending = readPendingRequest(recorded);
  return (
    pending !== undefined && requestIdOf(pending.nonce, { ...call, args: wouldRun }) === pending.id
  );
}

/**
 * The same question as {@link heldDecision}, asked of a checkpoint before a
 * resume starts — so a mismatch is refused while nothing has moved. Reads the
 * paused stage's own state (the root's, or the innermost subflow's on the
 * pause path). A state it cannot find is left to the dispatch loop, which asks
 * again where the decision is used.
 */
export function checkDecisionAgainst(
  checkpoint: FlowchartCheckpoint,
  gate: ConsentGate,
  input: unknown,
  rules: readonly string[],
): void {
  const state = pausedStateOf(checkpoint);
  if (state === undefined) {
    if (decisionCopyOf(input) === undefined) throw new DecisionRequiredError(gate, input);
    return;
  }
  const read = (key: string): unknown => state[key];
  heldDecision(input, gate, read('pausedRequest'), gatedCallOf(read, gate.kind), rules);
}

/**
 * Spend the decision's request in `ledger`.
 *
 * @throws ResumeDecisionError `'already-answered'` when a resume already spent it.
 */
export async function spendDecision(
  ledger: DecisionLedger,
  decision: CheckInDecision,
  gate: ConsentGateKind,
): Promise<void> {
  const fresh = await ledger.spend(decision.requestId);
  if (fresh !== true) throw new ResumeDecisionError('already-answered', gate);
}

/**
 * What a resume threw BEFORE its decision could reach a ledger, and the paused
 * request it was refusing (`undefined` when the pause recorded none). Keyed by
 * the thrown object itself, which reaches the caller unchanged, through a
 * composition too — so an error raised anywhere else is not the sign, whatever
 * it calls itself, and nothing depends on the caller's decision object
 * surviving a copy. The library's own refusals are fresh objects. One object
 * an app throws both before a resume starts and, in a concurrent resume of the
 * same request, after its decision was used would be read as the sign for
 * both; that process's ledger still refuses the request.
 */
const refusedBeforeUse = new WeakMap<object, string | undefined>();

/**
 * Register `error` as thrown before the decision could reach a ledger —
 * called by `Agent.resume` for anything before its run starts, and by the
 * dispatch loop for anything before it spends. Internal.
 */
export function noteRefusedBeforeUse(error: unknown, requestId: string | undefined): void {
  if (typeof error === 'object' && error !== null) refusedBeforeUse.set(error, requestId);
}

/**
 * The one positive sign that a failed resume used nothing of its decision:
 * `error` is what this library threw, before the decision could reach a
 * ledger, while refusing `requestId`. Anything else — any other error, of any
 * code, a store's included — may have come after, and a door that keeps the
 * pause marks it answered (`hosting/answeredPause.ts`). Internal.
 */
export function wasRefusedBeforeUse(error: unknown, requestId: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    refusedBeforeUse.has(error) &&
    refusedBeforeUse.get(error) === requestId
  );
}

/** The id of the request a paused run's state records (`pausedRequest`), or `undefined`. */
export function recordedRequestId(recorded: unknown): string | undefined {
  return readPendingRequest(recorded)?.id;
}

/**
 * The id of the request a checkpoint's paused stage records, or `undefined`
 * — never a throw, whatever the checkpoint holds.
 */
export function pausedRequestIdOf(checkpoint: FlowchartCheckpoint): string | undefined {
  try {
    const state = pausedStateOf(checkpoint);
    return state === undefined ? undefined : recordedRequestId(state.pausedRequest);
  } catch {
    return undefined;
  }
}

/** The request's id for `call` under `nonce`, or `undefined` when the call is not faithful JSON. */
function requestIdOf(nonce: string, call: GatedCall): string | undefined {
  const body = {
    gate: call.gate,
    tool: call.tool,
    toolCallId: call.toolCallId,
    party: call.party,
    args: call.args,
    middleware: call.middleware,
    askIndex: call.askIndex,
    chain: call.chain,
  };
  if (!isJsonFaithful(body)) return undefined;
  return sha256Hex(`${DOMAIN}\u001f${nonce}\u001f${canonicalJson(body)}`);
}

/**
 * Whether `rules` (an agent's whole chain, by link name) runs `recorded` (the
 * names an ask bound, from its own link on) from `askIndex` — the same links,
 * by name, in the same order, and no others after them.
 */
function sameChain(recorded: unknown, rules: readonly string[], askIndex: unknown): boolean {
  if (!Array.isArray(recorded) || typeof askIndex !== 'number' || !Number.isInteger(askIndex)) {
    return false;
  }
  if (askIndex < 0) return false;
  const live = rules.slice(askIndex);
  return live.length === recorded.length && live.every((name, at) => name === recorded[at]);
}

function readPendingRequest(recorded: unknown): PendingRequest | undefined {
  if (typeof recorded !== 'object' || recorded === null) return undefined;
  const { id, nonce } = recorded as { id?: unknown; nonce?: unknown };
  return typeof id === 'string' &&
    HEX_ID.test(id) &&
    typeof nonce === 'string' &&
    HEX_NONCE.test(nonce)
    ? { id, nonce }
    : undefined;
}

/**
 * A copy of the input's decision fields, each read ONCE and then judged — the
 * input is caller data, and a getter or a proxy must not answer the check one
 * way and the use another. `undefined` when the copy is not decision-shaped,
 * or the input cannot be read at all.
 */
function decisionCopyOf(input: unknown): Partial<CheckInDecision> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  let copy: Record<string, unknown>;
  try {
    const source = input as Record<string, unknown>;
    copy = {
      requestId: source.requestId,
      approved: source.approved,
      by: source.by,
      at: source.at,
      note: source.note,
      value: source.value,
    };
  } catch {
    return undefined;
  }
  if (!looksLikeDecision(copy)) return undefined;
  const { note, value, ...fields } = copy;
  return {
    ...(fields as Partial<CheckInDecision>),
    ...(note !== undefined && { note: note as string }),
    ...(value !== undefined && { value: value as CheckInDecision['value'] }),
  };
}

function pausedStateOf(checkpoint: FlowchartCheckpoint): Record<string, unknown> | undefined {
  const path = checkpoint.subflowPath;
  if (!Array.isArray(path) || path.length === 0) return objectOrUndefined(checkpoint.sharedState);
  const innermost = path[path.length - 1];
  return typeof innermost === 'string'
    ? objectOrUndefined(checkpoint.subflowStates?.[innermost])
    : undefined;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function randomHex(bytes: number): string {
  const buffer = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (const byte of buffer) out += byte.toString(16).padStart(2, '0');
  return out;
}
