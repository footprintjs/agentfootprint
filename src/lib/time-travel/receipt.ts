/**
 * receipt — what the model was actually handed, recorded at the stop where it
 * was handed it.
 *
 * Role:  Fold. This module owns the receipt's SHAPE and the one function that
 *        mints one (`buildReceipt`); every chart's request assembly calls it
 *        and commits the result under the scope key `receipt`, so the record
 *        lands in the call-llm bundle that already exists. Nothing here
 *        executes, reads scope, or emits.
 * Reads: its arguments.
 * Emits: N/A.
 *
 * ── THE FIRST LAW: NO AUTHORITY OMISSIONS ──────────────────────────────────
 * A receipt never names — and never counts — what a caller's ROLE was not
 * allowed to see. Committed state is readable by the trace toolpack's
 * debugging tools, so a receipt carrying `hiddenSkillIds`, or even "3 skills
 * withheld", would turn a permission decision into a leak path: the thing the
 * check exists to hide, restated one layer down where nobody is checking. A
 * reader that needs those ids reads them from the fold (`hiddenSkillIds` is
 * committed state, and reading it is governed where it is read), not from
 * here.
 *
 * ATTENTION omissions are a different fact and MAY ride the receipt:
 * `omittedForAttention` says a slot's budget dropped content. Nobody was
 * refused anything — the request simply did not fit — and a reader chasing "why
 * did it not know that?" needs to see it. Even there the summaries are hashed,
 * never quoted, for the same reason everything else on a receipt is.
 *
 * Measured on 9.88.0 and re-measured on 9.91.0 across all four minting charts,
 * NO chart shape supplies it: a slot writes its drops to `slotCompositions`
 * inside its own subflow and no boundary bubbles that record out, so a chart's
 * request assembly has nothing to pass. The field is on the
 * shape because `buildReceipt` is a pure exported mint a caller can hand the
 * fact to, and because the law it obeys is worth stating once rather than the
 * day the record starts crossing. What is NOT done is go looking for it: a
 * tracked read of an always-absent key is a read edge the trace then has to
 * explain.
 *
 * ── THE SECOND LAW: HASHES AND REFERENCES, NEVER BYTES ─────────────────────
 * A receipt is a fingerprint, not a copy. It records that a piece of a given
 * shape and size was in a given position, and nothing about what it said. The
 * bytes are already governed — `recordSystemPrompt` is opt-in for exactly this
 * reason, redaction patterns scrub the committed mirror, and a window strategy
 * decides what survives. A receipt that carried content would quietly reopen
 * all three.
 *
 * ── THE THIRD LAW: HASHES ARE SALTED WITH THE RUN ID ───────────────────────
 * `hash = sha256(runId + '\u001f' + content)`, first 16 hex characters. The
 * salt is what stops a short piece from being fingerprinted ACROSS runs: an
 * unsalted hash of a one-line system prompt, a tool schema, or a two-word user
 * turn is a dictionary lookup away from being read back, and the receipt is
 * committed state that travels in recordings. Salted per run, the same
 * sentence in two runs has two hashes, so the fingerprint answers "is this the
 * same as THAT piece of THIS run?" — which is the only question the
 * conformance law asks — and answers nothing else.
 *
 * Hashes are NOT redacted, and the salt is what makes shipping THEM safe — not
 * an assumption that something scrubbed them. It says nothing about the rest of
 * the recording, and this law must not be read as if it did.
 *
 * WHAT A RECORDING ACTUALLY CONTAINS. An agent run is not redacted:
 * `Agent.create(...)` has no redaction door, so a secret in a system prompt is
 * in the commit log and in `servedAt(k).system.text`, verbatim. Redaction in
 * this library is EXECUTOR-level — `flowchartAsTool({ redact })` /
 * `runbookAsTool({ redact })` set a policy on an inner run, and footprintjs
 * scrubs at COMMIT time, so a redacted key never enters that inner commit log
 * (the live `sharedState` is a different view; since 9.89.1 both tools serve
 * the redacted mirror of it too — `servableSnapshot` — so an inner record is
 * scrubbed in every field). A snapshot taken with `redact: true` also omits `initialState`,
 * so folding it reports `basis: 'log-only'` and `servedView.ts` raises
 * `no-fold-base` rather than rebuilding a short view in silence. Treat a
 * recording as the plaintext it is; the salt protects the fingerprints, and
 * only the fingerprints.
 *
 * ── THE FOURTH LAW: THE RECEIPT IS MINTED AT THE PROVIDER PORT ─────────────
 * Everything on a receipt describes the request AS HANDED TO
 * `LLMProvider.complete` — the port, not the wire. Anything downstream of that
 * boundary is outside what this record can witness: a decorated provider, a
 * vendor adapter's own serializer, a consumer's hand-written `complete`, or the
 * vendor's server-side defaults. `RECEIPT_BOUNDARY` states it in one sentence
 * for a renderer to print, and `servedView.ts` · `SERVED_GAPS` names the two
 * places a reader is most likely to mistake it for wire-level proof.
 */

import type { LLMMessage, LLMToolSchema } from '../../adapters/types.js';
import type { ContextRole, ContextSlot, ContextSource } from '../../events/types.js';
import { contributingPieces } from '../../core/agent/composeRequest.js';
import { sha256Hex } from './sha256.js';

/** What {@link receiptPieces} needs from one committed injection record — the
 *  three fields a receipt keeps of a system piece, and none of the rest. */
export interface SystemPieceRecord {
  readonly rawContent?: string;
  readonly slot: ContextSlot;
  readonly source: ContextSource;
}

/**
 * The separator between two fields inside one digest input — ASCII UNIT
 * SEPARATOR, which no prompt, tool name or JSON payload can contain (`JSON.
 * stringify` escapes it). Written as an escape rather than a literal control
 * character so a reader can see it and a formatter cannot eat it.
 *
 * Without it a digest is a bare concatenation, and a bare concatenation is
 * ambiguous: `role + content` cannot tell `'user' + 'x'` from `'use' + 'rx'`.
 */
const SEP = '\u001F';

/** The separator between two tool calls inside one message's digest. */
const CALL_SEP = '\u001C';

/** The separator between the fields of ONE tool call. */
const CALL_FIELD_SEP = '\u001D';

/** The separator between the top-level parts of a message's digest. */
const FIELD_SEP = '\u001E';

/**
 * What a digest input records in place of a value JSON cannot express — a
 * cycle, a `BigInt`, anything `stableJson` refuses. It is a MARK, not an empty
 * string: two unserializable values are recorded as unserializable rather than
 * as identical, which is what stops the cache comparison claiming "the strategy
 * changed nothing" about two requests it could not read.
 */
export const UNSERIALIZABLE = '\u001F<unserializable>';

/**
 * The boundary every receipt field is true at, in one sentence — exported so a
 * renderer prints the library's own wording instead of inferring a stronger
 * claim from a `null`.
 *
 * WHY IT IS A CONSTANT AND NOT A COMMENT. A reader who sees
 * `cache.transform: 'unchanged'` will conclude "this request was not rewritten"
 * unless something on the screen says otherwise, and the person who reads the
 * screen is rarely the person who read the source. Print it beside the record.
 *
 * ── THE MECHANISM, WHICH THE PRINTED SENTENCE NO LONGER NAMES (9.88.0) ─────
 * `buildReceipt` is called with the request about to be passed to
 * `LLMProvider.complete` — the PORT, this library's last sight of it. Four
 * stages call it since 9.91.0: the agent charts' (`stages/callLLM.ts`),
 * `LLMCall.ts` · `callLLM`, and the two message-API charts' through
 * `messageApiReceipt.ts`. Three things sit downstream of that call and none of them is on the
 * record: a provider decorated by the consumer (`complete()` wrapping
 * `complete()`), a vendor adapter's own serializer, and the vendor's
 * server-side defaults. `test/lib/time-travel/receipt-conformance.test.ts`
 * reproduces the first of those — a decorator that appends a system suffix and
 * a ghost tool after the mint, with `cache.transform` still reading
 * `'unchanged'`, correctly.
 *
 * The sentence below used to say all of that, and it was PRINTED beside a
 * trace by renderers that append it to a gap. A printed sentence names no
 * module, function or call: it says which fields, what they mean here, and
 * what to do — the rule in `test/helpers/gapProseClaims.ts`. So the mechanism
 * lives in this comment, where a maintainer reads it and review catches its
 * rot, and the constant says only the thing a reader must not get wrong.
 *
 * @example
 * ```ts
 * import { RECEIPT_BOUNDARY, receiptAt } from 'agentfootprint';
 *
 * const receipt = receiptAt(agent.getSnapshot()!, 1)!;
 * if (receipt.cache.transform === 'unchanged') {
 *   console.log(`the cache strategy changed nothing. ${RECEIPT_BOUNDARY}`);
 * }
 * ```
 */
export const RECEIPT_BOUNDARY =
  'A receipt describes the request as this library last saw it. Whatever ' +
  'handled it after that could have changed it, and nothing on the receipt ' +
  'would show that.';

/** The scope key the receipt is committed under. */
export const RECEIPT_KEY = 'receipt';

/** The scope key holding the name of the tool a `'tool-forced'` output
 *  strategy put on the wire. `seed` commits it; `servedView.ts` · `servedAt`
 *  reads it — so a rebuild can NAME the forced tool without reading the
 *  receipt it is being checked against. */
export const FORCED_OUTPUT_TOOL_KEY = 'forcedOutputToolName';

/** How many hex characters of the digest a receipt keeps. 16 — 64 bits, which
 *  is far past collision range for the few dozen pieces of one run, and short
 *  enough to read in a terminal. */
export const RECEIPT_HASH_CHARS = 16;

/** One piece of the composed system string. */
export interface ReceiptPiece {
  readonly hash: string;
  readonly slot: ContextSlot;
  readonly source: ContextSource;
}

/** One message as it went out. */
export interface ReceiptMessage {
  readonly role: ContextRole;
  readonly hash: string;
  /** The message's own join key when it has one — a tool result's
   *  `toolCallId`. Absent for every other message. */
  readonly key?: string;
}

/** A line that existed on the request only and was never written to history. */
export interface ReceiptRequestOnlyMessage {
  readonly role: ContextRole;
  readonly hash: string;
  /** Which library mechanism composed it. `'staged-refs-nudge'` today. */
  readonly reason: string;
}

/**
 * One `cache_control` breakpoint the cache strategy actually APPLIED — three
 * scalars, no bytes.
 *
 * `cache.transformHash` collapses a whole rewrite into one bit ("something
 * changed"), and a digest over the whole prepared request is not comparable
 * across epochs. The question that decides an Anthropic bill is narrower and
 * concrete: *did the breakpoints move between call 3 and call 4?* Two receipts'
 * `markersApplied` answer it by inspection.
 *
 * APPLIED, not offered: `scope.cacheMarkers` holds the CANDIDATES the strategy
 * was given, and a strategy clamps them to what the provider allows. The
 * candidates are on the record; which survived is not, which is why they ride
 * here.
 *
 * @example did the breakpoints move between two turns?
 * ```ts
 * import { receiptAt } from 'agentfootprint';
 *
 * const at = (k: number) =>
 *   JSON.stringify(receiptAt(agent.getSnapshot()!, k)?.cache.markersApplied);
 * at(3) === at(4); // false ⇒ the cached prefix moved, and the bill with it
 * ```
 */
export interface ReceiptCacheMarker {
  readonly field: 'system' | 'tools' | 'messages';
  readonly boundaryIndex: number;
  readonly ttl: 'short' | 'long';
}

/**
 * The sampling knobs the call went out with — scalars and short strings, no
 * bytes, no privacy change.
 *
 * They decide the answer as surely as the prompt does: the same context at
 * `temperature: 0` and at `1.2` is a different call, and "why did this turn
 * ramble?" is unanswerable from a record that kept the prompt and dropped the
 * dial.
 *
 * READ OFF THE PREPARED REQUEST — the object the port is handed, after the
 * cache strategy has had it. This is the one part of a receipt that describes
 * the post-strategy request rather than the pre-strategy one, and deliberately
 * so: a strategy holds the whole composed request and can move a dial, and
 * `params` claims in this very docstring to be what the PORT got.
 * `servedView.ts` · `SERVED_GAPS` says the same from the other side —
 * `cache-transform` names every field the log rebuilds pre-strategy, and
 * `params` is not among them.
 *
 * PORT VALUES ONLY — see {@link RECEIPT_BOUNDARY}. An unset `maxTokens` may
 * still become the model's own maximum inside a vendor SDK, and the receipt
 * records that the library sent nothing, never what the vendor decided.
 *
 * @example compare the dial two turns went out on
 * ```ts
 * import { receiptAt } from 'agentfootprint';
 *
 * const snapshot = agent.getSnapshot()!;
 * receiptAt(snapshot, 1)?.params.temperature; // 0.25
 * receiptAt(snapshot, 2)?.params.temperature; // 0.25 — the dial did not move
 * receiptAt(snapshot, 1)?.params.stop;        // undefined: none was sent
 * ```
 */
export interface ReceiptParams {
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** `LLMRequest.thinking.budget` — the reasoning-token ceiling asked for. */
  readonly thinkingBudget?: number;
  readonly stop?: readonly string[];
  /** The forced tool choice, as the port carried it. */
  readonly toolChoice?: { readonly type: string; readonly name?: string };
}

/** What a slot's budget dropped before the request was composed. */
export interface ReceiptAttentionOmission {
  readonly count: number;
  /** One hash per dropped summary — see the first law for why not the text. */
  readonly hashes: readonly string[];
}

/**
 * THE RECEIPT. One per composed request, committed at the call-llm stop.
 *
 * @example
 * ```ts
 * import { receiptAt } from 'agentfootprint';
 *
 * // Epochs are the run's OWN iteration numbers and start at 1.
 * const receipt = receiptAt(agent.getSnapshot()!, 1);
 * receipt?.tools.withheld;        // 'wrap-up' on the out-of-budget call
 * receipt?.messages.count;        // how many turns went out
 * receipt?.params.temperature;    // the dial this turn went out on
 * ```
 */
export interface Receipt {
  readonly system: {
    readonly hash: string;
    readonly chars: number;
    readonly pieces: readonly ReceiptPiece[];
  };
  readonly messages: {
    readonly count: number;
    readonly entries: readonly ReceiptMessage[];
    readonly requestOnly: readonly ReceiptRequestOnlyMessage[];
  };
  readonly tools: {
    readonly names: readonly string[];
    readonly schemaHashes: Readonly<Record<string, string>>;
    /** The tool the model was forced to answer through, or `null`. */
    readonly forced: string | null;
    /** Why the tool list is empty when it would not otherwise be. */
    readonly withheld: 'wrap-up' | null;
  };
  readonly cache: {
    /**
     * What the comparison between the request handed TO the cache strategy and
     * the one it handed back could establish. BRANCH ON THIS, never on
     * `transformHash === null`:
     *
     * - `'unchanged'` — the two serialize identically.
     * - `'rewritten'` — they do not, and `transformHash` fingerprints the
     *   result.
     * - `'unknown'`   — one of them could not be serialized at all, so the
     *   receipt refuses to claim either.
     *
     * It scopes to the CACHE STRATEGY and to nothing else — see
     * {@link RECEIPT_BOUNDARY}.
     */
    readonly transform: 'unchanged' | 'rewritten' | 'unknown';
    /** Hash of the request the cache strategy handed back, when it differed
     *  from the one it was given; `null` otherwise. */
    readonly transformHash: string | null;
    /** The breakpoints the strategy actually applied, in the order it applied
     *  them — see {@link ReceiptCacheMarker}. Empty when it applied none. */
    readonly markersApplied: readonly ReceiptCacheMarker[];
  };
  /** The sampling knobs the call went out with — see {@link ReceiptParams}. */
  readonly params: ReceiptParams;
  /**
   * Absent when no slot reported a drop — which, measured on 9.88.0 and again
   * on 9.91.0 across every chart that mints, is EVERY run: no boundary bubbles
   * `slotCompositions` out of the slot subflow that writes it, so request
   * assembly has nothing to pass. It is
   * a key of `servedView.ts` · `UNGAPPED_FIELDS` for that reason: its absence
   * is universal and says nothing about any particular recording. Absent means
   * nobody recorded a drop, never that nothing was dropped.
   */
  readonly omittedForAttention?: ReceiptAttentionOmission;
  readonly basis: {
    readonly epoch: number;
    readonly runId: string;
    readonly model: string;
    readonly provider: string;
  };
}

/**
 * The receipt's hash: run-salted SHA-256, first {@link RECEIPT_HASH_CHARS} hex
 * characters. Exported because it is half of the conformance law — a reader
 * that rebuilds a served view proves the rebuild by hashing it the same way.
 *
 * @example
 * ```ts
 * import { receiptAt, receiptHash, servedAt } from 'agentfootprint';
 *
 * const view = servedAt(agent.getSnapshot()!, 1)!;
 * const receipt = receiptAt(agent.getSnapshot()!, 1)!;
 * receiptHash(receipt.basis.runId, view.system.text) === receipt.system.hash; // true
 * ```
 */
export function receiptHash(runId: string, content: string): string {
  return sha256Hex(`${runId}${SEP}${content}`).slice(0, RECEIPT_HASH_CHARS);
}

/**
 * JSON with object keys in sorted order, at every depth — so two structurally
 * equal values hash the same however they were built. Property order survives
 * `structuredClone`, but it does NOT survive every path a value takes through
 * a delta-encoded commit log and back, and a fingerprint that depends on
 * insertion order is a fingerprint that reports a change nobody made.
 *
 * Returns `undefined` — never `''` — for anything JSON cannot express (a
 * cycle, a `BigInt`, a value whose `toJSON` throws). It does not throw,
 * because a receipt is bookkeeping and must never be able to stop a run; and
 * it does not collapse, because `''` made every unreadable value equal to
 * every other one. Two requests that both failed to serialize compared EQUAL,
 * and the receipt wrote `transformHash: null` — "the cache strategy changed
 * nothing" — about a pair it had not read. Callers substitute
 * {@link UNSERIALIZABLE} where a digest needs bytes, and branch where a
 * comparison needs truth.
 */
export function stableJson(value: unknown): string | undefined {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        const next = canonical(source[key]);
        if (next === undefined) continue;
        out[key] = next;
      }
      return out;
    }
    return input;
  };
  try {
    return JSON.stringify(canonical(value)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** `stableJson`, with the unreadable marked rather than dropped — the form a
 *  digest input takes. */
function digestJson(value: unknown): string {
  return stableJson(value) ?? UNSERIALIZABLE;
}

/**
 * The bytes a tool schema's hash covers: the whole `LLMToolSchema` — `name`,
 * `description`, `inputSchema` — as sorted-key JSON, so two schemas that are
 * structurally the same hash the same however they were built, and with a
 * schema JSON cannot express (a cycle, a `BigInt`) marked {@link UNSERIALIZABLE}
 * rather than dropped or thrown on.
 *
 * WHAT TO PASS (9.89.0). The receipt hashes each tool AS HANDED TO THE PORT:
 * `buildReceipt` is given the request's tool list, and that list is the
 * `dynamicToolSchemas` the run committed, plus a forced answer tool when an
 * output strategy adds one. `servedAt(k).tools.schemas[i]` is that committed
 * list read back — the same shape, the same bytes — so a consumer holding a
 * served view already holds the object this function takes. It does not take
 * the served view, a `Tool`, or a `defineTool` definition: those carry an
 * `execute`, `wants` and other fields the model never saw.
 *
 * WHY IT IS EXPORTED. A reader that rebuilds a served view proves the rebuild
 * by hashing it the way the receipt did. `receiptHash` and `messageDigestInput`
 * were exported in 9.88.0 for the system text, the pieces and the messages,
 * and a consumer could verify all of them — and NOT the tools, because the
 * serializer behind `schemaHashes` was internal. Its only options were to copy
 * `stableJson` (a second owner of the rule, which drifts the day the digest
 * gains a field, as the message digest did in 9.88.0) or to leave the schema
 * rows unverified. This is the third digest half of the law, beside its two
 * siblings, and the ONLY spelling of the schema rule: `buildReceipt` calls it
 * too. `stableJson` stays off the root barrel for the same reason — a consumer
 * composing `hash(stableJson(tool))` would be writing the rule a second time.
 *
 * @example verify every schema row of a receipt from outside
 * ```ts
 * import { receiptAt, receiptHash, servedAt, toolDigestInput } from 'agentfootprint';
 *
 * const snapshot = agent.getSnapshot()!;
 * const view = servedAt(snapshot, 1)!;
 * const receipt = receiptAt(snapshot, 1)!;
 * for (const tool of view.tools.schemas) {
 *   receiptHash(receipt.basis.runId, toolDigestInput(tool)) ===
 *     receipt.tools.schemaHashes[tool.name]; // true, for every tool of every epoch
 * }
 * // A forced answer tool is in `schemaHashes` and NOT in `schemas` — its body
 * // is a declared gap (`forced-tool-schema`), so there is no row to check.
 * ```
 */
export function toolDigestInput(tool: LLMToolSchema): string {
  return digestJson(tool);
}

/**
 * The bytes a message's hash covers, each field behind a separator: its role,
 * its text, its `toolCallId`, its `toolName`, the calls it asked for (id, name,
 * arguments and `providerMeta`) and its `thinkingBlocks`.
 *
 * WHY `toolCallId` (9.88.0). It is the JOIN KEY — `tool_use_id` on Anthropic's
 * wire, `tool_call_id` on OpenAI's — that pairs a tool result to the call that
 * asked for it. Two parallel calls whose results happen to have identical text
 * hashed the SAME without it, so a mis-pairing (the answer to `c1` filed under
 * `c2`) was invisible to the law: exactly the defect a receipt exists to catch.
 *
 * WHY `toolName` TOO (9.88.0). On two shipped providers the id is not the join
 * key at all. `adapters/llm/GeminiProvider.ts` · `toGeminiContents` pairs a
 * `functionResponse` to its call BY NAME and says so in its own comment; the
 * id is optional there and dropped when it is not a real one.
 * `adapters/llm/OllamaProvider.ts` · `toOllamaMessages` puts `tool_name` on
 * the wire and only falls back to the id. So on those providers a receipt that
 * covered `toolCallId` alone still could not see the very mis-pairing the
 * field was added for: two `role:'tool'` messages with identical text and
 * SWAPPED names fingerprinted identically. It rides as its own field behind
 * the separator, beside the id, so a name moving between two results changes
 * both hashes and neither can absorb the other's bytes.
 *
 * WHY `thinkingBlocks` and `providerMeta` (9.88.0). `adapters/types.ts` is
 * explicit that a signed thinking block MUST be echoed byte-exact or the API
 * rejects the turn, and `providerMeta` round-trips vendor state (Gemini's
 * `thoughtSignature`, without which the turn after a tool call is refused).
 * Both are things the model receives; a fingerprint that omitted them said two
 * requests were the same when one of them would be rejected. They enter as a
 * `stableJson` FINGERPRINT, so nothing quotable is added — a signature is an
 * opaque token, not content.
 *
 * Still deliberately NOT covered: `injectedBy` (stripped before the request
 * exists) and `ephemeral` (a persistence flag, invisible to the model). Two
 * messages that hash the same are the same thing said to the model.
 */
export function messageDigestInput(message: LLMMessage): string {
  const calls = (message.toolCalls ?? []).map((call) =>
    [
      call.id,
      call.name,
      digestJson(call.args),
      call.providerMeta === undefined ? '' : digestJson(call.providerMeta),
    ].join(CALL_FIELD_SEP),
  );
  return [
    message.role,
    message.content,
    message.toolCallId ?? '',
    message.toolName ?? '',
    calls.join(CALL_SEP),
    message.thinkingBlocks === undefined || message.thinkingBlocks.length === 0
      ? ''
      : digestJson(message.thinkingBlocks),
  ].join(FIELD_SEP);
}

/** What `buildReceipt` needs from the stage that composed the request. */
export interface BuildReceiptInput {
  readonly runId: string;
  readonly epoch: number;
  readonly model: string;
  readonly provider: string;
  /** The joined system string, exactly as sent. */
  readonly systemText: string;
  /** The pieces it was joined from, in order. */
  readonly systemPieces: readonly {
    readonly text: string;
    readonly slot: ContextSlot;
    readonly source: ContextSource;
  }[];
  /** The messages that came from history, post-strip, in wire order. */
  readonly messages: readonly LLMMessage[];
  /** Lines appended to this request only, each with the mechanism that
   *  composed it. */
  readonly requestOnly: readonly { readonly message: LLMMessage; readonly reason: string }[];
  /** The tool list as sent — including a forced output tool, if there is one. */
  readonly tools: readonly LLMToolSchema[];
  readonly forced: string | null;
  readonly withheld: 'wrap-up' | null;
  /** The request handed TO the cache strategy — one half of the cache
   *  comparison, and nothing else is read off it. */
  readonly baseRequest: unknown;
  /**
   * The request it handed back: the object the provider port is given.
   *
   * The other half of the cache comparison, AND where {@link ReceiptParams} is
   * read from. A strategy is handed the whole composed request, so it can move
   * a dial as easily as a marker; reading the knobs off `baseRequest` recorded
   * what assembly PROPOSED and called it what the port was handed, which is
   * the one thing `RECEIPT_BOUNDARY` promises a receipt never does.
   */
  readonly preparedRequest: unknown;
  /** The breakpoints the strategy reported applying (`prepareRequest`'s
   *  `markersApplied`). Absent ⇒ recorded as none. */
  readonly markersApplied?: readonly {
    readonly field: 'system' | 'tools' | 'messages';
    readonly boundaryIndex: number;
    readonly ttl: 'short' | 'long';
  }[];
  /** What a slot's budget dropped, when a slot reported any. */
  readonly omittedForAttention?: { readonly count: number; readonly summaries: readonly string[] };
}

/**
 * The system pieces a receipt records, off the injection records a slot
 * committed — the SURVIVORS of the join, in the order they were joined.
 *
 * ONE OWNER, because there are now four mints (9.91.0): the agent's `call-llm`
 * stage, `LLMCall`'s, and the two message-API charts'. Written out at each of
 * them, this five-line map is four chances to disagree about which record was
 * piece 2 — and `servedAt` proves piece 2 against the receipt's piece 2, so a
 * disagreement here reads as a defect in the record.
 *
 * It calls `contributingPieces`, which is also what the join itself calls, so
 * an empty record cannot be a piece on the receipt and a blank line in the
 * string, or the other way round.
 *
 * @example
 * ```ts
 * receiptPieces([{ rawContent: 'You are a bot.', slot: 'systemPrompt', source: 'static' }]);
 * // [{ text: 'You are a bot.', slot: 'systemPrompt', source: 'static' }]
 * ```
 */
export function receiptPieces(
  records: readonly SystemPieceRecord[],
): BuildReceiptInput['systemPieces'] {
  return contributingPieces(records).map((record) => ({
    text: record.rawContent,
    slot: record.slot,
    source: record.source,
  }));
}

/**
 * The sampling knobs off the request the port was handed.
 *
 * Duck-typed and value-conditional: an agent that set no dial records no key,
 * so `params` is `{}` rather than a row of `undefined`s claiming defaults the
 * library never sent.
 */
function paramsOf(request: unknown): ReceiptParams {
  if (request === null || typeof request !== 'object') return {};
  const req = request as {
    temperature?: unknown;
    maxTokens?: unknown;
    thinking?: { budget?: unknown };
    stop?: unknown;
    toolChoice?: { type?: unknown; name?: unknown };
  };
  const stop = Array.isArray(req.stop) ? req.stop.filter((s) => typeof s === 'string') : undefined;
  return {
    ...(typeof req.temperature === 'number' && { temperature: req.temperature }),
    ...(typeof req.maxTokens === 'number' && { maxTokens: req.maxTokens }),
    ...(typeof req.thinking?.budget === 'number' && { thinkingBudget: req.thinking.budget }),
    ...(stop !== undefined && stop.length > 0 && { stop }),
    ...(typeof req.toolChoice?.type === 'string' && {
      toolChoice: {
        type: req.toolChoice.type,
        ...(typeof req.toolChoice.name === 'string' && { name: req.toolChoice.name }),
      },
    }),
  };
}

/**
 * Mint the receipt for one composed request.
 *
 * Pure and total: every branch here is arithmetic over what it was handed, so
 * a receipt cannot fail a call. The one judgement it makes is the cache
 * comparison, and it makes it in three values rather than two: `'unchanged'`
 * exactly when the strategy handed back a request that serializes identically
 * to the one it was given, `'rewritten'` when it did not, and `'unknown'` when
 * either request could not be serialized at all — because "I could not read
 * them" is not the same claim as "they were the same".
 *
 * Every value it produces is true AT THE PROVIDER PORT and nowhere past it —
 * see {@link RECEIPT_BOUNDARY}.
 */
export function buildReceipt(input: BuildReceiptInput): Receipt {
  const hash = (content: string): string => receiptHash(input.runId, content);

  const schemaHashes: Record<string, string> = {};
  for (const tool of input.tools) schemaHashes[tool.name] = hash(toolDigestInput(tool));

  // The cache verdict, three-valued. A pair the receipt could not read is
  // 'unknown' — never 'unchanged', which is what `''` used to make it.
  const base = stableJson(input.baseRequest);
  const prepared = stableJson(input.preparedRequest);
  const comparable = base !== undefined && prepared !== undefined;
  const transform: 'unchanged' | 'rewritten' | 'unknown' = !comparable
    ? 'unknown'
    : base === prepared
    ? 'unchanged'
    : 'rewritten';

  return {
    system: {
      hash: hash(input.systemText),
      chars: input.systemText.length,
      pieces: input.systemPieces.map((piece) => ({
        hash: hash(piece.text),
        slot: piece.slot,
        source: piece.source,
      })),
    },
    messages: {
      count: input.messages.length + input.requestOnly.length,
      entries: input.messages.map((message) => ({
        role: message.role,
        hash: hash(messageDigestInput(message)),
        ...(message.toolCallId !== undefined && { key: message.toolCallId }),
      })),
      requestOnly: input.requestOnly.map((line) => ({
        role: line.message.role,
        hash: hash(messageDigestInput(line.message)),
        reason: line.reason,
      })),
    },
    tools: {
      names: input.tools.map((tool) => tool.name),
      schemaHashes,
      forced: input.forced,
      withheld: input.withheld,
    },
    cache: {
      transform,
      transformHash: transform === 'rewritten' ? hash(prepared!) : null,
      markersApplied: (input.markersApplied ?? []).map((marker) => ({
        field: marker.field,
        boundaryIndex: marker.boundaryIndex,
        ttl: marker.ttl,
      })),
    },
    // The PREPARED request, not the base one: the port is handed what the cache
    // strategy returned, and a strategy that rewrote maxTokens must not leave
    // five receipt fields describing a request nobody sent. See
    // {@link RECEIPT_BOUNDARY} — this is the boundary those fields are true at.
    params: paramsOf(input.preparedRequest),
    ...(input.omittedForAttention !== undefined &&
      input.omittedForAttention.count > 0 && {
        omittedForAttention: {
          count: input.omittedForAttention.count,
          hashes: input.omittedForAttention.summaries.map((summary) => hash(summary)),
        },
      }),
    basis: {
      epoch: input.epoch,
      runId: input.runId,
      model: input.model,
      provider: input.provider,
    },
  };
}
