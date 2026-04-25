/**
 * llmExtractor — LLM-backed beat extractor.
 *
 * Uses an LLMProvider (typically a cheap model like Claude Haiku or
 * GPT-4o-mini) to produce semantically rich beats. One extraction LLM
 * call per turn. Opt-in — default is `heuristicExtractor()` which is
 * free.
 *
 * The extractor asks the LLM for a JSON response in this shape:
 *
 * ```json
 * {
 *   "beats": [
 *     {
 *       "summary": "User revealed their name is Alice",
 *       "importance": 0.9,
 *       "refs": ["msg-1-0"],
 *       "category": "identity"
 *     }
 *   ]
 * }
 * ```
 *
 * The extractor parses, clamps importance via `asImportance()`, and
 * returns the beats. Malformed responses fall back to an empty array
 * — a bad extraction should not break the agent turn.
 *
 * Usage:
 * ```ts
 * import { anthropic } from 'agentfootprint';
 * import { llmExtractor, narrativePipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 * const pipeline = narrativePipeline({
 *   store: new InMemoryStore(),
 *   extractor: llmExtractor({ provider: anthropic('claude-haiku-4-5') }),
 * });
 * ```
 */
import type { LLMProvider, LLMMessage as Message } from '../../adapters/types';
import type { BeatExtractor, ExtractArgs } from './extractor';
import type { NarrativeBeat } from './types';
import { asImportance } from './types';

export interface LLMExtractorConfig {
  /** The provider used for extraction. Typically a cheap/fast model. */
  readonly provider: LLMProvider;

  /**
   * Override the system prompt. Defaults to a one-paragraph instruction
   * that elicits the JSON shape described in the module docs.
   */
  readonly systemPrompt?: string;

  /**
   * Dev-mode logger invoked when the LLM response fails to parse.
   * Defaults to `console.warn` — production consumers can route the
   * signal to their telemetry pipeline.
   */
  readonly onParseError?: (error: unknown, rawContent: string) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are an extractor that distills a single turn of a conversation into narrative beats for long-term memory.

A "beat" is a one-sentence, self-contained summary of something salient that happened this turn — a fact the user revealed, a decision the agent made, an important question, a result returned.

Return JSON in this exact shape:
{
  "beats": [
    {
      "summary": "one sentence",
      "importance": 0.0_to_1.0,
      "refs": ["msg-<turn>-<index>", ...],
      "category": "identity|preference|fact|task|question|tool-result|other"
    }
  ]
}

Guidelines:
- Importance 0.9+ for identity, strong preferences, commitments.
- Importance 0.5-0.7 for questions, task progress.
- Importance 0.3 or lower for low-salience tool chatter.
- Return [] if nothing salient happened.
- Return ONLY the JSON object — no prose, no code fences.`;

/** Build a stable ref id matching heuristicExtractor's convention. */
function refId(turnNumber: number, index: number): string {
  return `msg-${turnNumber}-${index}`;
}

/** Serialize messages for the extractor LLM's user prompt. */
function formatMessagesForExtractor(messages: readonly Message[], turnNumber: number): string {
  const lines: string[] = [`Turn ${turnNumber}:`];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;
    const ref = refId(turnNumber, i);
    const content =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
        ? m.content
            .map((b) => {
              if (b && typeof b === 'object') {
                const blk = b as { type?: string; text?: string };
                if (blk.type === 'text' && typeof blk.text === 'string') return blk.text;
              }
              return '';
            })
            .filter(Boolean)
            .join(' ')
        : '';
    lines.push(`[${ref}] ${m.role}: ${content}`);
  }
  return lines.join('\n');
}

/**
 * Parse the extractor's raw JSON response into validated beats.
 * Returns an empty array on any parse / shape failure — the `onParseError`
 * callback fires so consumers can observe failures without crashing turns.
 */
function parseBeatsResponse(
  raw: string,
  onParseError: (err: unknown, raw: string) => void,
): readonly NarrativeBeat[] {
  try {
    const parsed = JSON.parse(raw);
    const rawBeats = (parsed?.beats ?? []) as unknown[];
    if (!Array.isArray(rawBeats)) return [];

    const beats: NarrativeBeat[] = [];
    for (const rb of rawBeats) {
      if (!rb || typeof rb !== 'object') continue;
      const b = rb as Record<string, unknown>;
      if (typeof b.summary !== 'string' || b.summary.length === 0) continue;
      const refs = Array.isArray(b.refs) ? b.refs.filter((r) => typeof r === 'string') : [];
      const category = typeof b.category === 'string' ? b.category : undefined;
      beats.push({
        summary: b.summary,
        importance: asImportance(b.importance),
        refs,
        ...(category ? { category } : {}),
      });
    }
    return beats;
  } catch (err) {
    onParseError(err, raw);
    return [];
  }
}

export function llmExtractor(config: LLMExtractorConfig): BeatExtractor {
  const { provider } = config;
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const onParseError =
    config.onParseError ??
    ((err: unknown, raw: string): void => {
      // eslint-disable-next-line no-console
      console.warn(
        '[agentfootprint] llmExtractor: failed to parse LLM response — returning no beats',
        { error: err, rawPreview: raw.slice(0, 200) },
      );
    });

  return {
    async extract(args: ExtractArgs): Promise<readonly NarrativeBeat[]> {
      const userContent = formatMessagesForExtractor(args.messages, args.turnNumber);

      const response = await provider.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        args.signal ? { signal: args.signal } : undefined,
      );

      return parseBeatsResponse(response.content ?? '', onParseError);
    },
  };
}
