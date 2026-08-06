/**
 * OllamaThinkingHandler — normalizes a local reasoning model's thinking
 * into the framework's `ThinkingBlock[]` contract.
 *
 * Local reasoning models (deepseek-r1, qwen3, gpt-oss, …) reason in the
 * open, and where that reasoning LANDS depends on how they were asked:
 *
 *   1. ASKED (`ollama('qwen3', { think: true })`, or the agent's
 *      `.thinking({ budget })`) — Ollama lifts the reasoning out of the
 *      answer into `message.thinking`. The adapter forwards it as
 *      `{ kind: 'field', thinking }`. This is the good path.
 *
 *   2. NOT ASKED — the same model writes `<think>…</think>` straight into
 *      the answer text. The adapter recognizes the shape and forwards the
 *      whole answer as `{ kind: 'inline', content }`.
 *
 * **The library recognizes the inline shape; it never rewrites the
 * answer.** Blocks produced from case 2 describe text that is STILL
 * present, verbatim, in `LLMResponse.content` — because silently editing
 * a model's answer is a meaning change, and that is the application's
 * decision to make, not this library's. If you want the reasoning out of
 * the answer, ask for it: turn `think` on, and the model stops putting it
 * there.
 *
 * **No signature** — nothing on this wire is signed, so there is no
 * round-trip integrity invariant (unlike Anthropic). `signature` stays
 * undefined.
 *
 * **No `summary` flag** — this is raw reasoning, not a structured summary
 * (unlike OpenAI's `reasoning_summary`).
 *
 * **`parseChunk`** — the adapter already emits `LLMChunk.thinkingDelta`
 * directly while streaming (Ollama sends `message.thinking` deltas frame
 * by frame), so the framework does not need this to see live reasoning.
 * It is implemented anyway for consumers driving the handler themselves.
 */

import type { ThinkingBlock, ThinkingHandler } from './types.js';

/**
 * What `OllamaProvider` puts on `LLMResponse.rawThinking`.
 *
 * Tagged rather than a bare string so the handler never has to GUESS which
 * of the two situations it is looking at — and so a consumer reading the
 * raw value can tell whether the reasoning is also sitting in the answer.
 */
export type OllamaRawThinking =
  | { readonly kind: 'field'; readonly thinking: string }
  | { readonly kind: 'inline'; readonly content: string };

/** `<think>…</think>`, including an unclosed one from a truncated answer. */
const THINK_TAG = /<think>([\s\S]*?)(?:<\/think>|$)/gi;

/**
 * Pull the reasoning out of text that carries `<think>` tags.
 *
 * All tag PARSING lives here, in the handler — the adapter only notices
 * that a `<think` substring is present and tags the payload accordingly.
 * Exported so a consumer driving normalization by hand can reuse it.
 */
export function extractInlineThinking(text: string): readonly string[] {
  if (!text.includes('<think')) return [];
  const out: string[] = [];
  // `matchAll` needs the /g flag and a fresh lastIndex per call.
  THINK_TAG.lastIndex = 0;
  for (const match of text.matchAll(THINK_TAG)) {
    const inner = (match[1] ?? '').trim();
    if (inner.length > 0) out.push(inner);
  }
  return out;
}

function isRawThinking(raw: unknown): raw is OllamaRawThinking {
  return typeof raw === 'object' && raw !== null && 'kind' in raw;
}

export const ollamaThinkingHandler: ThinkingHandler = {
  id: 'ollama',
  providerNames: ['ollama'],

  normalize(raw: unknown): readonly ThinkingBlock[] {
    if (raw === undefined || raw === null) return [];

    // Bare string — a hand-fed value, or a consumer-authored adapter that
    // passes `message.thinking` straight through. Treat it as reasoning,
    // but still honor tags if they are in there.
    if (typeof raw === 'string') return blocksFromText(raw);

    if (isRawThinking(raw)) {
      if (raw.kind === 'field') {
        return typeof raw.thinking === 'string' ? blocksFromText(raw.thinking) : [];
      }
      if (raw.kind === 'inline') {
        if (typeof raw.content !== 'string') return [];
        return extractInlineThinking(raw.content).map(toBlock);
      }
    }

    // Unknown shape — empty rather than throw. The framework catches throws
    // and emits parse_failed; graceful empty is the right answer for a
    // wire that may grow fields we have not seen yet.
    return [];
  },

  parseChunk(chunk: unknown): { thinkingDelta?: string } {
    if (typeof chunk !== 'object' || chunk === null) return {};
    const message = (chunk as { message?: { thinking?: unknown } }).message;
    const thinking = message?.thinking;
    return typeof thinking === 'string' && thinking.length > 0 ? { thinkingDelta: thinking } : {};
  },
};

/** Text → blocks. Tagged text yields one block per tag; plain text one block. */
function blocksFromText(text: string): readonly ThinkingBlock[] {
  const tagged = extractInlineThinking(text);
  if (tagged.length > 0) return tagged.map(toBlock);
  const trimmed = text.trim();
  return trimmed.length > 0 ? [toBlock(trimmed)] : [];
}

function toBlock(content: string): ThinkingBlock {
  return { type: 'thinking', content };
}
