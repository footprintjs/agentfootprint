/**
 * formatDefault — render picked entries into injection-ready messages.
 *
 * Reads from scope:  `selected`, `retrieved`
 * Writes to scope:   `formatted` (messages to inject into the LLM prompt),
 *                    `retrieved` (each admitted chunk's prompt fragment)
 *
 * Why a separate stage from the picker?
 *   Retrieval and presentation are orthogonal concerns. A picker decides
 *   WHICH memories survive the budget; a formatter decides HOW they appear
 *   to the LLM. Consumers can swap either without touching the other. In
 *   research settings, format variations ("JSON envelope" vs "XML tags" vs
 *   "natural paragraphs") are worth ablating.
 *
 * ─── Two flavors, because they are two different claims ────────────────
 *
 *   `'memory'` (default, unchanged since 7.20.0) — recall from THIS
 *   conversation. Each entry is a turn, so it is rendered with the turn's
 *   role and number:
 *
 *     Relevant context from prior conversations. Use when it helps answer the current turn.
 *
 *     <memory role="user" turn="5" updated="2026-04-18T06:00:00Z">
 *     I live in San Francisco.
 *     </memory>
 *
 *   `'rag'` (8.8.0) — retrieval from a document corpus. An indexed chunk
 *   has no role and no turn; it has a document, a position in it, and a
 *   similarity score. Printing `role="unknown" turn="0"` on a page of a
 *   PDF, which is what the memory shape did, told the model three things
 *   that were not true and withheld the one thing it needed to cite:
 *
 *     Relevant passages retrieved from the document corpus. Cite the source id when you use one.
 *
 *     <source id="refunds.md#3" doc="refunds.md" heading="Refund timing" score="0.81">
 *     Refunds are processed within 3 business days of approval.
 *     </source>
 *
 *   Role chosen (both flavors): `system`. This is NOT the ongoing dialogue,
 *   it is context the application is adding. A `user` role would confuse
 *   turn-taking; `assistant` would be a false claim.
 *
 *   Wrapping: entries are grouped into ONE system message rather than N.
 *   One message is easier for a model to reason about — and the record
 *   still resolves to one `InjectionRecord` PER chunk, because each chunk's
 *   exact bytes are kept on the retrieval record (`promptFragment`) and
 *   joining them with `\n\n` reproduces this message exactly.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryEntry } from '../entry/index.js';
import type { LLMMessage as Message } from '../../adapters/types.js';
import type { MemoryState } from './types.js';
import { chunkProvenance, chunkText } from '../retrieval/provenance.js';
import type { RetrievedCandidate } from '../retrieval/types.js';

/** Which claim the injected block is making about its entries. */
export type MemoryFormatFlavor = 'memory' | 'rag';

export interface FormatDefaultConfig {
  /**
   * Header prepended to the injected message. Explains to the LLM what
   * follows and what it's for. Override if your app has specific phrasing
   * guidance ("long-term memory" vs "user preferences", etc.). Defaults
   * per `flavor`.
   */
  readonly header?: string;
  /**
   * Footer appended after all entries. Empty by default. Useful for
   * explicit guidance ("Use this context only when relevant. Do not
   * mention retrieval unless asked.").
   */
  readonly footer?: string;
  /**
   * Which rendering the entries get. Default `'memory'` — conversation
   * recall, byte-identical to every release before 8.8.0. `defineRAG`
   * sets `'rag'`.
   */
  readonly flavor?: MemoryFormatFlavor;
  /**
   * Custom per-entry renderer. Receives the entry (and, for retrieval
   * pipelines, its candidate record); returns the block string. Use for
   * app-specific formatting: custom source attributions, hiding tier
   * info, etc. Overrides `flavor`.
   */
  readonly renderEntry?: (entry: MemoryEntry<Message>, candidate?: RetrievedCandidate) => string;
  /**
   * When `true`, inject even if `selected` is empty (emits only header
   * and footer). Usually NOT desired — an empty memory block is noise.
   * Default: skip emitting when selected is empty.
   */
  readonly emitWhenEmpty?: boolean;
}

const DEFAULT_HEADER =
  'Relevant context from prior conversations. Use when it helps answer the current turn.';

const RAG_HEADER =
  'Relevant passages retrieved from the document corpus. Cite the source id when you use one.';

/**
 * Escape any closing tag in user-controlled content so it can't close the
 * surrounding citation block prematurely. Without this guard, content
 * containing the literal close tag could trick the LLM into treating
 * subsequent text as "outside memory" — a small but real prompt-injection
 * vector. We insert a zero-width-joiner after the first character of the
 * tag name so the sequence survives tokenization but does NOT parse as a
 * closing tag.
 */
function escapeCloseTag(text: string, tag: string): string {
  const head = tag[0] ?? '';
  const rest = tag.slice(1);
  // U+200D ZERO WIDTH JOINER — invisible, survives tokenization, and
  // breaks the literal tag match. Same byte the memory formatter has
  // used since 7.x; keeping it identical keeps that output byte-stable.
  return text.replace(new RegExp(`</${tag}>`, 'gi'), `</${head}‍${rest}>`);
}

/** Escape a value for an XML-ish attribute. Corpus metadata is not trusted input. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function defaultRenderEntry(entry: MemoryEntry<Message>): string {
  const msg = entry.value;
  const turnAttr = entry.source?.turn !== undefined ? ` turn="${entry.source.turn}"` : '';
  const updatedAttr =
    entry.updatedAt !== undefined ? ` updated="${new Date(entry.updatedAt).toISOString()}"` : '';

  const text = msg.content ?? '';

  const role = msg.role ?? 'unknown';
  return `<memory role="${role}"${turnAttr}${updatedAttr}>\n${escapeCloseTag(
    text,
    'memory',
  )}\n</memory>`;
}

/**
 * Corpus rendering — the chunk's own coordinates, and the score that put
 * it here. Every attribute is omitted when it is not known, because a
 * fabricated page number is worse than a missing one.
 */
function ragRenderEntry(entry: MemoryEntry<Message>, candidate?: RetrievedCandidate): string {
  const prov = chunkProvenance(entry.value);
  const docUri = candidate?.docUri ?? prov.docUri;
  const page = candidate?.page ?? prov.page;
  const heading = candidate?.heading ?? prov.heading;

  const parts = [`id="${attr(entry.id)}"`];
  if (docUri !== undefined) parts.push(`doc="${attr(docUri)}"`);
  if (page !== undefined) parts.push(`page="${page}"`);
  if (heading !== undefined) parts.push(`heading="${attr(heading)}"`);
  if (candidate?.score !== undefined) parts.push(`score="${candidate.score.toFixed(2)}"`);

  // `chunkText` reads `.content`, which both shapes carry — a document
  // from `indexDocuments` and a chat message keep their text there.
  const text = chunkText(entry.value);
  return `<source ${parts.join(' ')}>\n${escapeCloseTag(text, 'source')}\n</source>`;
}

/** Emit through the scope's emit channel when there is one. */
function emit(scope: TypedScope<MemoryState>, type: string, payload: unknown): void {
  const emitter = (scope as unknown as { $emit?: (t: string, p: unknown) => void }).$emit;
  if (typeof emitter === 'function') emitter.call(scope, type, payload);
}

function summarize(text: string, n = 80): string {
  return text.length <= n ? text : text.slice(0, n - 1) + '…';
}

export function formatDefault(config: FormatDefaultConfig = {}) {
  const flavor: MemoryFormatFlavor = config.flavor ?? 'memory';
  const header = config.header ?? (flavor === 'rag' ? RAG_HEADER : DEFAULT_HEADER);
  const footer = config.footer ?? '';
  const renderEntry =
    config.renderEntry ?? (flavor === 'rag' ? ragRenderEntry : defaultRenderEntry);
  const emitWhenEmpty = config.emitWhenEmpty ?? false;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const selected = scope.selected ?? [];

    if (selected.length === 0 && !emitWhenEmpty) {
      scope.formatted = [];
      return;
    }

    const evidence = scope.retrieved;
    const byId = new Map<string, RetrievedCandidate>(
      (evidence?.candidates ?? []).map((c) => [c.id, c]),
    );

    const blocks = selected.map((entry) => renderEntry(entry, byId.get(entry.id)));
    const content =
      (header ? `${header}\n\n` : '') + blocks.join('\n\n') + (footer ? `\n\n${footer}` : '');

    scope.formatted = [{ role: 'system', content }];

    // ── Per-chunk prompt bytes ──────────────────────────────────────
    // The header rides the FIRST fragment and the footer the LAST, so
    // that `fragments.join('\n\n')` is byte-identical to `content` above.
    // That identity is what lets one retrieval become one InjectionRecord
    // per chunk without changing a single byte the model sees — and it is
    // pinned by test, because it is the whole blast radius of the change.
    //
    // `promptPosition` rides along because the record is stored in SCORE
    // order while the prompt is assembled in the PICKER's order: without
    // it, rejoining the fragments reproduces the right bytes in the wrong
    // sequence, which is a prompt the model never saw.
    if (evidence) {
      const fragments = blocks.map((block, i) => {
        const withHeader = i === 0 && header ? `${header}\n\n${block}` : block;
        return i === blocks.length - 1 && footer ? `${withHeader}\n\n${footer}` : withHeader;
      });
      const placed = new Map<string, { fragment: string; position: number }>(
        selected.map((entry, i) => [entry.id, { fragment: fragments[i] ?? '', position: i }]),
      );
      scope.retrieved = {
        ...evidence,
        ...(evidence.candidates && {
          candidates: evidence.candidates.map((c) => {
            const slot = placed.get(c.id);
            return slot === undefined
              ? c
              : { ...c, promptFragment: slot.fragment, promptPosition: slot.position };
          }),
        }),
      };
    }

    // ── Per-chunk attachment telemetry ──────────────────────────────
    // `agentfootprint.memory.attached` has been declared since 2.x and was
    // never emitted by anything. It is emitted here, once per chunk that
    // actually reached the prompt, because that is the event a consumer
    // needs to answer "which passages did this turn read". The memory
    // bridge is attached on every Agent run, so no extra wiring exists.
    for (const entry of selected) {
      const candidate = byId.get(entry.id);
      emit(scope, 'agentfootprint.memory.attached', {
        memoryId: entry.id,
        contentSummary: summarize(chunkText(entry.value)),
        ...(candidate?.score !== undefined && { score: candidate.score }),
        ...(candidate?.rank !== undefined && { rank: candidate.rank }),
        source: 'store' as const,
      });
    }

    // Context-engineering emit: memory formatted N entries into one
    // system-role message.
    //
    // LAW: this event must name the slot the content actually lands in.
    // It says `'system-prompt'` because that is where it goes, and it is
    // checkable end to end — `memoryRecallInjections` routes system-role
    // recall to `inject.systemPrompt`, `buildSystemPromptSlot` records it
    // as a `slot: 'system-prompt'` injection, and the request carries it
    // in `systemPrompt`. Two events describing one piece of content must
    // not disagree: `context.memory.injected` and `context.injected` name
    // the same slot for the same bytes.
    //
    // Until 7.20.0 this said `'messages'`, which was never true of this
    // stage — `scope.formatted` above is unconditionally role `'system'`.
    // A consumer branching on the old value was branching on a lie.
    emit(scope, 'agentfootprint.context.memory.injected', {
      slot: 'system-prompt',
      // Memory injects ONE system-role message containing every selected
      // entry as a citation block (see the headers + renderEntry).
      // The downstream delta is therefore +1 system fragment, regardless
      // of how many memory entries it carries.
      role: 'system' as const,
      deltaCount: { system: 1 },
      count: selected.length,
      // Tiers present in the injection — lets the UI show "working / long-term"
      // differentiation later without a schema change.
      tiers: Array.from(new Set(selected.map((e) => e.tier).filter(Boolean))),
    });
  };
}
