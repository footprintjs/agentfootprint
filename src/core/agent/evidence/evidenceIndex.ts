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
 *   • **Tool results** — the `role: 'tool'` turns in the conversation. This is
 *     the whole corpus. A value the model read from a tool is grounded.
 *   • **Object KEYS count.** A map keyed by WWN puts real identifiers in key
 *     position, and the model saw them exactly as it saw the values.
 *   • **Tool call ARGUMENTS do not count.** The model typed those. Grounding a
 *     value because the model passed it to a tool would let any invention
 *     launder itself through one failed lookup.
 *   • **The model's own earlier answers do not count**, for the same reason.
 *   • **An `absent(…)` result grounds its COVERAGE only.** An absence names
 *     what was looked FOR, which in practice quotes the arguments the model
 *     passed — so indexing the whole frame would ground an invented
 *     identifier through the one operation that proves nothing about it: a
 *     lookup that found nothing. `checked` / `not_checked` / `cannot_cover`
 *     are the tool's own words about the world and do count. See
 *     `../coverage/evidence.ts`.
 *
 * The EXEMPT index is built from a different corpus with the same machinery:
 * the user's own message, the conversation's user/system turns, and the
 * system-prompt content this turn was built from. A value the user supplied is
 * not a fabrication — the user gave it — and neither is one the app's own
 * prompt or skill body put in front of the model.
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
  readonly values: ReadonlySet<string>;
  /**
   * True when the ceiling was hit and the index is INCOMPLETE. The gate
   * downgrades itself to record-only when this is set: a partial corpus can
   * call a grounded value fabricated, and an accusation from a half-read
   * corpus is worse than no accusation at all.
   */
  readonly truncated: boolean;
}

/** Mutable accumulator while walking. */
interface Sink {
  readonly values: Set<string>;
  budget: number;
}

function add(sink: Sink, raw: string): void {
  const norm = normalizeToken(raw);
  if (norm === '') return;
  for (const form of lookupForms(norm)) {
    if (sink.budget <= 0) return;
    if (sink.values.has(form)) continue;
    sink.values.add(form);
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
      // An `absent(…)` frame grounds its COVERAGE and nothing else: the rest
      // of it is prose about the REQUEST, which usually quotes the model's own
      // arguments, and indexing that would ground every identifier a model
      // invented as long as it handed the invention to one tool that found
      // nothing. See `../coverage/evidence.ts` — it is the frames.ts argument
      // on the tool side of the conversation. `undefined` (every other result
      // ever returned) keeps the walk it always had.
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
 * Build the evidence corpus from a conversation: every `role: 'tool'` turn.
 *
 * In a single-turn run these are exactly this turn's tool results. In a
 * continued conversation the earlier turns' results are in here too, and that
 * is deliberate: the model really did read them, and calling a value from turn
 * one a fabrication in turn two would be false.
 */
export function evidenceFromHistory(history: readonly LLMMessage[]): EvidenceCorpus {
  const sink: Sink = { values: new Set<string>(), budget: MAX_INDEX_TOKENS };
  for (const msg of history) {
    if (msg.role !== 'tool') continue;
    indexResult(msg.content, sink);
  }
  return { values: sink.values, truncated: sink.budget <= 0 };
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
 */
export function exemptFromRun(args: {
  readonly userMessage?: string;
  readonly history: readonly LLMMessage[];
  readonly systemPromptInjections?: readonly InjectionRecord[];
}): ReadonlySet<string> {
  const sink: Sink = { values: new Set<string>(), budget: MAX_INDEX_TOKENS };
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
  return sink.values;
}
