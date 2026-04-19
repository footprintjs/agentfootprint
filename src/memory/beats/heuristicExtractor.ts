/**
 * heuristicExtractor — zero-dep, zero-cost beat extractor.
 *
 * Produces one beat per non-system message with a simple
 * `"{role} said: {text}"` summary. Importance defaults to 0.5 except
 * for messages that trip obvious salience signals (questions from the
 * user, assistant tool-use, etc.) where a higher score fires.
 *
 * Why ship this as a default?
 *   Users who enable `narrativePipeline()` without configuring an
 *   extractor still get sensible behavior — compressed per-turn beats
 *   with provenance — without paying for an LLM call. The beats are
 *   less semantic than an LLM extractor's but still useful for recall.
 *   Users who want higher-quality beats opt into `llmExtractor()`.
 *
 * Heuristic rules (intentionally simple — this is a baseline, not
 * state-of-the-art):
 *   - User messages → importance 0.6 (users are generally salient)
 *   - User questions (ending in '?') → importance 0.75
 *   - Messages containing "my name is" / "i am" → importance 0.9
 *     (identity beats are high-value for recall)
 *   - Assistant tool-use → importance 0.5 (process step)
 *   - Assistant final answers → importance 0.5
 *   - Tool results → importance 0.3 (noise for recall most of the time)
 *
 * Category hints:
 *   - `"identity"` for name / role assertions
 *   - `"question"` for user questions
 *   - `"tool-result"` for tool outputs
 *   - undefined otherwise (category is optional)
 *
 * This is heuristic. It will miss nuances the LLM extractor catches.
 * Swap for `llmExtractor({ provider })` when quality matters.
 */
import type { BeatExtractor, ExtractArgs } from './extractor';
import type { NarrativeBeat } from './types';
import { asImportance } from './types';

/** Build a stable ref id for a message at a given position in a turn. */
function refId(turnNumber: number, index: number): string {
  return `msg-${turnNumber}-${index}`;
}

/** Extract short text from any Message content shape. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string };
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
    return parts.join(' ');
  }
  return '';
}

/**
 * Classify a user message: is it an identity claim, a question, or
 * generic? Returns `{ importance, category? }` hints for the beat.
 */
function classifyUserText(text: string): { importance: number; category?: string } {
  const lower = text.toLowerCase();
  // Identity — highest priority for recall
  if (lower.includes('my name is') || lower.includes("i'm ") || lower.includes('i am ')) {
    return { importance: 0.9, category: 'identity' };
  }
  // Question — users asking things is generally salient
  if (text.trimEnd().endsWith('?')) {
    return { importance: 0.75, category: 'question' };
  }
  return { importance: 0.6 };
}

/** Default heuristic. Takes no config; factory function for consistency. */
export function heuristicExtractor(): BeatExtractor {
  return {
    async extract(args: ExtractArgs): Promise<readonly NarrativeBeat[]> {
      const beats: NarrativeBeat[] = [];

      for (let i = 0; i < args.messages.length; i++) {
        const msg = args.messages[i];
        // Skip system messages — they're prompt framing, not conversation.
        if (msg.role === 'system') continue;

        const text = textOf(msg.content).trim();
        if (text.length === 0) continue;

        const ref = refId(args.turnNumber, i);

        if (msg.role === 'user') {
          const { importance, category } = classifyUserText(text);
          beats.push({
            summary: `User said: ${text}`,
            importance: asImportance(importance),
            refs: [ref],
            ...(category ? { category } : {}),
          });
        } else if (msg.role === 'assistant') {
          beats.push({
            summary: `Assistant replied: ${text}`,
            importance: asImportance(0.5),
            refs: [ref],
          });
        } else if (msg.role === 'tool') {
          beats.push({
            summary: `Tool result: ${text}`,
            importance: asImportance(0.3),
            refs: [ref],
            category: 'tool-result',
          });
        }
      }

      return beats;
    },
  };
}
