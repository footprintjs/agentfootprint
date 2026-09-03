/**
 * evidenceIndex — what the run can PROVE it read, as a lookup set.
 *
 * Pattern: build once per judgement, ask many times (the same "one pass, then
 *          query" shape the slice layer uses).
 * Role:    core/ layer. The other half of `namesAndNumbersFromEvidence`.
 * Emits:   N/A.
 *
 * ## Why the walk is STRUCTURAL
 *
 * The obvious implementation is `allToolResults.includes(value)`. It is wrong
 * in the direction that matters: a fabricated FCID `0xef0101` "appears" in a
 * blob that contains `0xef01011` or `naa.0xef0101ab`, so the invented value
 * reads as grounded and the check quietly passes everything. So a tool result
 * that parses as JSON is WALKED — every key, every leaf — and each leaf is
 * indexed both whole and tokenized. A result that is not JSON is tokenized as
 * text. Either way the comparison is token-exact, never substring.
 *
 * ## What counts as evidence, and what deliberately does not
 *
 *   • **Tool results** — the `role: 'tool'` turns in `scope.history` AS IT
 *     STANDS AT JUDGEMENT. A value the model read from a tool is grounded.
 *
 *     Say that precisely, because "the whole conversation" is only true for an
 *     agent with no window strategy. `.window()` / `.compaction()` /
 *     `tokenBudget` REWRITE `scope.history` in place (window.ts, `scope.history
 *     = result.window`), so on those agents this corpus is the LIVE WINDOW and
 *     a result the window has dropped is not in it — the same value then reads
 *     as ungrounded. `keepLastToolResults` (default 2) is what keeps the most
 *     recent observations pinned; nothing pins the rest. Anything computed from
 *     this index therefore describes what the run can still SEE, never
 *     everything it ever read.
 *   • **Object KEYS count.** A map keyed by WWN puts real identifiers in key
 *     position, and the model saw them exactly as it saw the values.
 *   • **Tool call ARGUMENTS do not count.** The model typed those. Grounding a
 *     value because the model passed it to a tool would let any invention
 *     launder itself through one failed lookup.
 *   • **The model's own earlier answers do not count**, for the same reason.
 *   • **An `absent(…)` result grounds everything EXCEPT `looked_for`.** Its
 *     coverage lists, its `try_instead`, its note and any extra key the tool
 *     attached (a `known_shares` list, say) are the tool's own words about the
 *     world, and an answer that follows the absence's advice must not be
 *     called ungrounded for doing so. `looked_for` alone quotes the arguments
 *     the model passed, so indexing it would ground an invented identifier
 *     through the one operation that proves nothing about it: a lookup that
 *     found nothing. See `../coverage/evidence.ts`.
 *
 * The EXEMPT index is built from a different corpus with the same machinery:
 * the user's own message, the conversation's user/system turns, and the
 * system-prompt content this turn was built from. A value the user supplied is
 * not a fabrication — the user gave it — and neither is one the app's own
 * prompt or skill body put in front of the model.
 *
 * ## WHEN a value was read, and why the corpus is still conversation-wide
 *
 * The corpus above answers "did the run read this?" and says nothing about
 * WHEN. That gap has a measured cost: an agent answered a fresh question with
 * ZERO tool calls, and the gate approved it because all seven values appeared
 * in an inventory result fetched four turns earlier for a different question.
 * Grounded, and four turns out of date.
 *
 * The fix is NOT to narrow the corpus to this turn. "And what about that
 * disk?" legitimately leans on the previous turn's rows, and flagging those
 * would make the gate cry wolf until somebody switched it off. So the corpus
 * stays whole and every indexed form carries the TURN it was last served in
 * — one number, stamped during the walk that was happening anyway.
 *
 * A TURN starts at each `role: 'user'` message the library did NOT author.
 * `isLibraryAuthoredTurn` (frames.ts) is a statement about AUTHORSHIP, not
 * about time — it exists to keep the exempt corpus from swallowing the gate's
 * own corrections — and it is reused here for a different reason that happens
 * to need the same predicate: a frame the library wrote is not a person asking
 * something new. Excluding them is load-bearing rather than tidy. The evidence
 * recheck appends a `role: 'user'` turn MID-RUN, so counting it as a boundary
 * would push this turn's own tool results into the "earlier" bucket and file a
 * notice against every revised answer.
 *
 * Turn 1 is the first user message still in the window; anything indexed
 * before one (a history with no user turn at all) is turn 0, which is also
 * `currentTurn`, so nothing can read as earlier and no notice can be filed
 * from a conversation with no boundary in it.
 *
 * **The ordinals are WINDOW-RELATIVE**, and that is the honest bound: they
 * count the user turns the run can still see, so under a window strategy
 * "turn 2 of 4" may be the conversation's turn 9 of 13. The BOUNDARY is
 * exact regardless — the current request is un-droppable by every window
 * strategy (`'current-request'`, window/currentRequest.ts) — so "this turn
 * versus earlier" holds; only the DISTANCE is a floor.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import { absenceEvidenceProjection } from '../coverage/index.js';
import { isLibraryAuthoredTurn } from './frames.js';
import { lookupForms, normalizeToken, tokenize } from './normalize.js';

/**
 * Ceiling on indexed tokens. Generous — a 200 000-token corpus is roughly a
 * 5 MB tool result — because the cost of hitting it is not "slower", it is
 * "the gate stops accusing" (see {@link EvidenceCorpus.truncated}).
 */
const MAX_INDEX_TOKENS = 200_000;

/** A finished index plus the honesty flag that says whether it is complete. */
export interface EvidenceCorpus {
  /**
   * Every indexed form, stamped with the LATEST turn whose tool result
   * carried it.
   *
   * A Map rather than a Set plus a second structure: the walk already visits
   * each leaf once, so the turn is an attribute of the entry it was going to
   * write anyway. `.has()` reads exactly as it did when this was a Set, which
   * is all the grounding decision ever needed; `.get()` is the new half.
   *
   * LATEST, not first, and the direction is the whole point: the question is
   * "could this turn's own results have supplied this value?", so a form
   * served in turn 2 and again in turn 7 is turn 7's.
   */
  readonly values: ReadonlyMap<string, number>;
  /**
   * True when the ceiling was hit and the index is INCOMPLETE. The gate
   * downgrades itself to record-only when this is set: a partial corpus can
   * call a grounded value fabricated, and an accusation from a half-read
   * corpus is worse than no accusation at all.
   */
  readonly truncated: boolean;
  /**
   * The turn in progress — the ordinal every stamp above is compared against.
   * `0` means the history carries no user turn at all, so there is no
   * boundary and nothing can be attributed to an earlier one.
   */
  readonly currentTurn: number;
  /**
   * How many `role: 'tool'` results this turn served. `0` is the sharp case:
   * a turn that fetched nothing sourced every value in its answer from
   * history, by construction and without needing the index to prove it.
   */
  readonly toolResultsThisTurn: number;
}

/** Mutable accumulator while walking. */
interface Sink {
  /** form → the latest turn that served it. See {@link EvidenceCorpus.values}. */
  readonly values: Map<string, number>;
  budget: number;
  /** The turn the walk is currently inside. Bumped by each user turn. */
  turn: number;
}

function add(sink: Sink, raw: string): void {
  const norm = normalizeToken(raw);
  if (norm === '') return;
  for (const form of lookupForms(norm)) {
    // Re-stamping a form the index already holds costs no entry, so it is
    // done before the budget is consulted: a truncated index should still
    // hold the freshest turn for everything it did manage to index.
    if (sink.values.has(form)) {
      sink.values.set(form, sink.turn);
      continue;
    }
    if (sink.budget <= 0) return;
    sink.values.set(form, sink.turn);
    sink.budget -= 1;
  }
}

function addText(sink: Sink, text: string): void {
  for (const token of tokenize(text)) {
    if (sink.budget <= 0) return;
    add(sink, token);
  }
}

/** Walk a parsed JSON value, indexing keys and leaves. */
function walk(node: unknown, sink: Sink): void {
  if (sink.budget <= 0 || node === null || node === undefined) return;
  if (typeof node === 'string') {
    // Whole value first (a leaf may contain spaces and still be one value),
    // then its tokens (`"fc1/3 is down"` carries `fc1/3`).
    add(sink, node);
    addText(sink, node);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'bigint') {
    add(sink, String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const el of node) walk(el, sink);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      add(sink, key);
      walk(value, sink);
    }
  }
}

/** Index one tool result: structurally when it is JSON, as text when it is not. */
function indexResult(content: string, sink: Sink): void {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      // An `absent(…)` frame grounds everything the TOOL authored and drops
      // the one field that quotes the REQUEST (`looked_for`) — indexing that
      // would ground every identifier a model invented as long as it handed
      // the invention to one tool that found nothing. See
      // `../coverage/evidence.ts` — it is the frames.ts argument on the tool
      // side of the conversation. `undefined` (every other result ever
      // returned) keeps the walk it always had.
      const projection = absenceEvidenceProjection(parsed);
      walk(projection ?? parsed, sink);
      return;
    } catch {
      // Not JSON after all (a truncated result, a log line that happens to
      // start with a brace). Fall through to the text path rather than lose
      // the evidence entirely — a tool result that cannot be parsed is still
      // something the model read.
    }
  }
  addText(sink, content);
}

/**
 * Build the evidence corpus from the history AS IT STANDS: every `role: 'tool'`
 * turn still in it, each indexed form stamped with the turn that served it.
 *
 * In a single-turn run these are exactly this turn's tool results. In a
 * continued conversation the earlier turns' results are in here too, and that
 * is deliberate: the model really did read them, and calling a value from turn
 * one a fabrication in turn two would be false. Which earlier turns are still
 * here is the WINDOW's decision, not this function's — see the header.
 */
export function evidenceFromHistory(history: readonly LLMMessage[]): EvidenceCorpus {
  const sink: Sink = { values: new Map<string, number>(), budget: MAX_INDEX_TOKENS, turn: 0 };
  let toolResultsThisTurn = 0;
  for (const msg of history) {
    // A turn boundary — the person asked something new. The library's own
    // corrections are `role: 'user'` too and are NOT boundaries; see the
    // header for the bug that distinction prevents.
    if (msg.role === 'user' && !isLibraryAuthoredTurn(msg.content)) {
      sink.turn += 1;
      toolResultsThisTurn = 0;
      continue;
    }
    if (msg.role !== 'tool') continue;
    toolResultsThisTurn += 1;
    indexResult(msg.content, sink);
  }
  return {
    values: sink.values,
    truncated: sink.budget <= 0,
    currentTurn: sink.turn,
    toolResultsThisTurn,
  };
}

/**
 * Build the exempt corpus: everything the RUN put in front of the model that
 * the model did not invent — the user's message, the conversation's user and
 * system turns, and the composed system prompt (base prompt, skill bodies,
 * facts, retrieved passages).
 *
 * `rawContent` is optional on an {@link InjectionRecord} — a record that was
 * summarised or redacted contributes what it has. That direction is the safe
 * one: a missing exemption can only cost a false flag on a value the app
 * supplied, and the caller can name it in `exempt`.
 *
 * STATED REACH, because `systemPromptInjections` is broader than "the app's
 * own prompt": it also carries `.memory()` recall and RAG passages. A value
 * that reached the model through memory or retrieval is therefore EXEMPT from
 * grounding — never flagged, and never counted as tool evidence of any turn,
 * so it is invisible to the recency read too. That is the correct call for the
 * fabrication question (the run really did put those words in front of the
 * model) and a real blind spot for the recency one, and it is deliberately NOT
 * fixed here: recall is its own seam, with its own record
 * (`retrievalEvidence_<id>`, `agentfootprint.memory.attached`), and giving a
 * recalled passage a turn stamp means deciding whose turn it belongs to — the
 * one it was written in or the one it was recalled in — which is a question
 * this file has no standing to answer.
 */
export function exemptFromRun(args: {
  readonly userMessage?: string;
  readonly history: readonly LLMMessage[];
  readonly systemPromptInjections?: readonly InjectionRecord[];
}): ReadonlySet<string> {
  // The same accumulator, walked with no turn boundaries: an exemption is a
  // fact about WHO supplied a value, and the turn it arrived in changes
  // nothing about that. The keys are lifted into a Set at the end so the
  // grounding decision keeps the exact membership type it always took.
  const sink: Sink = { values: new Map<string, number>(), budget: MAX_INDEX_TOKENS, turn: 0 };
  if (args.userMessage) addText(sink, args.userMessage);
  for (const msg of args.history) {
    if (msg.role !== 'user' && msg.role !== 'system') continue;
    // …except the corrections this library wrote. They are `role: 'user'`
    // turns that QUOTE the flagged values back to the model, so indexing one
    // would exempt exactly what it challenged — the gate laundering its own
    // accusation. See frames.ts.
    if (isLibraryAuthoredTurn(msg.content)) continue;
    addText(sink, msg.content);
  }
  for (const rec of args.systemPromptInjections ?? []) {
    if (rec.rawContent) addText(sink, rec.rawContent);
    // The summary is what a redacted record has instead. Indexing it cannot
    // create a false exemption for a value nobody supplied — the summary is
    // built from the content itself.
    else if (rec.contentSummary) addText(sink, rec.contentSummary);
  }
  return new Set(sink.values.keys());
}
