/**
 * formatDefault — render picked entries into injection-ready messages.
 *
 * Reads from scope:  `selected`
 * Writes to scope:   `formatted` (messages to inject into the LLM prompt)
 *
 * Why a separate stage from the picker?
 *   Retrieval and presentation are orthogonal concerns (MemGPT-reviewer
 *   ask). A picker decides WHICH memories survive the budget; a formatter
 *   decides HOW they appear to the LLM. Consumers can swap either without
 *   touching the other. In research settings, format variations ("JSON
 *   envelope" vs "XML tags" vs "natural paragraphs") are worth ablating.
 *
 * Default format:
 *   One `system` message containing a citation-tagged block per entry:
 *
 *     <memory source="turn:5" updated="2026-04-18T06:00:00Z">
 *     User said: I live in San Francisco.
 *     </memory>
 *
 *   Citation tags let the LLM reference sources in its response; the
 *   Anthropic-reviewer ask ("recall should carry source").
 *
 *   Role chosen: `system`. Reasoning: this is NOT the ongoing dialogue,
 *   it's context we're adding. A `user` role would confuse turn-taking;
 *   `assistant` would be a false claim. `system` matches the semantic
 *   of "context injected by the application, not part of the conversation."
 *
 *   Wrapping: entries are grouped into ONE system message rather than N
 *   separate messages. One message is easier for LLMs to reason about
 *   and avoids breaking up the conversational flow.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryState } from './types';

export interface FormatDefaultConfig {
  /**
   * Header prepended to the injected message. Explains to the LLM what
   * follows and what it's for. Override if your app has specific phrasing
   * guidance ("long-term memory" vs "user preferences", etc.).
   */
  readonly header?: string;
  /**
   * Footer appended after all entries. Empty by default. Useful for
   * explicit guidance ("Use this context only when relevant. Do not
   * mention retrieval unless asked.").
   */
  readonly footer?: string;
  /**
   * Custom per-entry renderer. Receives the entry; returns the block
   * string (without outer tags — the default wrapper adds those). Use
   * for app-specific formatting: custom source attributions, hiding
   * tier info, etc.
   */
  readonly renderEntry?: (entry: MemoryEntry<Message>) => string;
  /**
   * When `true`, inject even if `selected` is empty (emits only header
   * and footer). Usually NOT desired — an empty memory block is noise.
   * Default: skip emitting when selected is empty.
   */
  readonly emitWhenEmpty?: boolean;
}

const DEFAULT_HEADER =
  'Relevant context from prior conversations. Use when it helps answer the current turn.';

/**
 * Escape any `</memory>` in user-controlled content so it can't close the
 * surrounding citation block prematurely. Without this guard, a user
 * message containing the literal close tag could trick the LLM into
 * treating subsequent text as "outside memory" — a small but real
 * prompt-injection vector. We insert a zero-width-joiner between `m` and
 * `emory` so the sequence survives tokenization but does NOT parse as a
 * closing tag.
 */
function escapeMemoryTag(text: string): string {
  return text.replace(/<\/memory>/gi, '</m\u200Demory>');
}

function defaultRenderEntry(entry: MemoryEntry<Message>): string {
  const msg = entry.value;
  const turnAttr = entry.source?.turn !== undefined ? ` turn="${entry.source.turn}"` : '';
  const updatedAttr =
    entry.updatedAt !== undefined ? ` updated="${new Date(entry.updatedAt).toISOString()}"` : '';

  const text = msg.content ?? '';

  const role = msg.role ?? 'unknown';
  return `<memory role="${role}"${turnAttr}${updatedAttr}>\n${escapeMemoryTag(text)}\n</memory>`;
}

export function formatDefault(config: FormatDefaultConfig = {}) {
  const header = config.header ?? DEFAULT_HEADER;
  const footer = config.footer ?? '';
  const renderEntry = config.renderEntry ?? defaultRenderEntry;
  const emitWhenEmpty = config.emitWhenEmpty ?? false;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const selected = scope.selected ?? [];

    if (selected.length === 0 && !emitWhenEmpty) {
      scope.formatted = [];
      return;
    }

    const blocks = selected.map(renderEntry).join('\n\n');
    const content = (header ? `${header}\n\n` : '') + blocks + (footer ? `\n\n${footer}` : '');

    scope.formatted = [{ role: 'system', content }];

    // Context-engineering emit: memory formatted N entries into a
    // system message that lands in the Agent's Messages slot via the
    // memory-pipeline's outputMapper. Lens tags the iteration with
    // "memory · N msg(s)" so the student sees WHERE the re-injected
    // prior turns came from.
    if (typeof (scope as unknown as { $emit?: unknown }).$emit === 'function') {
      scope.$emit('agentfootprint.context.memory.injected', {
        slot: 'messages',
        // Memory injects ONE system-role message containing every selected
        // entry as a citation block (see DEFAULT_HEADER + renderEntry).
        // The downstream count delta is therefore +1 system, regardless
        // of how many memory entries it carries.
        role: 'system' as const,
        deltaCount: { system: 1 },
        count: selected.length,
        // Tiers present in the injection — lets the UI show "working / long-term"
        // differentiation later without a schema change.
        tiers: Array.from(new Set(selected.map((e) => e.tier).filter(Boolean))),
      });
    }
  };
}
