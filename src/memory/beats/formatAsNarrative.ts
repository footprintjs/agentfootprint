/**
 * formatAsNarrative — render selected NarrativeBeats into a single
 * cohesive paragraph for prompt injection.
 *
 * Reads from scope:  `selected` (MemoryEntry<NarrativeBeat>[])
 * Writes to scope:   `formatted` (Message[] — single system message, or empty)
 *
 * Contrasts with `formatDefault` which produces per-entry `<memory>`
 * blocks for raw-message recall. `formatAsNarrative` composes beats
 * into a story paragraph:
 *
 *   Relevant context from prior conversations:
 *
 *   From earlier: User revealed their name is Alice. User asked about
 *   refunds for order ORD-123. Assistant confirmed the refund was
 *   processed.
 *
 * Why a paragraph vs per-beat blocks?
 *   Beats are already summaries — wrapping each in its own tag adds
 *   boilerplate tokens without adding information. A connected
 *   paragraph flows more naturally into the LLM's context.
 *
 * Source citations:
 *   When `showRefs` is enabled, the rendered line appends `(refs: msg-1-0, msg-1-2)`
 *   so the LLM (and consumer debugging) can walk beats back to source
 *   messages. Off by default — cites add tokens and some LLMs parrot them.
 *
 * Empty-input behavior:
 *   `selected.length === 0` → writes `formatted: []` (no system message).
 *   Matches `formatDefault`'s "skip empty" behavior — injecting an
 *   empty header-only block is worse than no injection at all.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { MemoryState } from '../stages';
import type { NarrativeBeat } from './types';

export interface FormatAsNarrativeConfig {
  /**
   * Header prepended to the injected message. Defaults to
   * `"Relevant context from prior conversations. Use when it helps
   * answer the current turn."` — matches `formatDefault`.
   */
  readonly header?: string;

  /** Footer appended after the beats paragraph. Empty by default. */
  readonly footer?: string;

  /**
   * When `true`, each beat line appends `(refs: msg-x-y, ...)`. Off
   * by default — saves tokens and avoids LLMs echoing the refs in
   * their replies. Turn on for audit / debug use cases.
   */
  readonly showRefs?: boolean;

  /**
   * Connective phrase inserted before the beats paragraph. Defaults
   * to `"From earlier: "`. Set to `""` to disable.
   */
  readonly leadIn?: string;

  /**
   * Inject the message even when `selected` is empty. Usually
   * undesired — empty memory noise displaces real context. Off by
   * default.
   */
  readonly emitWhenEmpty?: boolean;
}

const DEFAULT_HEADER =
  'Relevant context from prior conversations. Use when it helps answer the current turn.';
const DEFAULT_LEAD_IN = 'From earlier: ';

/**
 * Escape `</memory>` inside beat summaries — matches the defense
 * applied by `formatDefault` even though this formatter doesn't use
 * `<memory>` tags. Future consumers may wrap the paragraph in tags
 * (e.g. for custom prompt shells) and the escape prevents any
 * beat-content-sourced early-close of that wrapper.
 */
function escapeMemoryTag(text: string): string {
  return text.replace(/<\/memory>/gi, '</m\u200Demory>');
}

/** Render one beat as a single sentence (with optional ref suffix). */
function renderBeat(entry: MemoryEntry<NarrativeBeat>, showRefs: boolean): string {
  const beat = entry.value;
  const sentence = escapeMemoryTag(beat.summary.trim());
  if (!showRefs || beat.refs.length === 0) return sentence;
  return `${sentence} (refs: ${beat.refs.join(', ')})`;
}

export function formatAsNarrative(config: FormatAsNarrativeConfig = {}) {
  const header = config.header ?? DEFAULT_HEADER;
  const footer = config.footer ?? '';
  const showRefs = config.showRefs ?? false;
  const leadIn = config.leadIn ?? DEFAULT_LEAD_IN;
  const emitWhenEmpty = config.emitWhenEmpty ?? false;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    // `selected` is typed as MemoryEntry<Message>[] on MemoryState, but
    // in the narrative pipeline it carries MemoryEntry<NarrativeBeat>
    // entries. Cast at the boundary — the beats pipeline guarantees
    // the payload shape because extractBeats produced it.
    const selected = (scope.selected ?? []) as unknown as readonly MemoryEntry<NarrativeBeat>[];

    if (selected.length === 0 && !emitWhenEmpty) {
      scope.formatted = [];
      return;
    }

    // Render beats as sentences joined into a paragraph. A trailing
    // period after each sentence gives the LLM a natural break; if the
    // beat's summary already ends with terminal punctuation we skip
    // adding one.
    const sentences = selected.map((entry) => {
      const s = renderBeat(entry, showRefs);
      return /[.!?]$/.test(s) ? s : `${s}.`;
    });

    const paragraph = `${leadIn}${sentences.join(' ')}`;
    const content = `${header ? `${header}\n\n` : ''}${paragraph}${footer ? `\n\n${footer}` : ''}`;

    scope.formatted = [{ role: 'system', content }];
  };
}
