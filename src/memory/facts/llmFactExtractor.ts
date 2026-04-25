/**
 * llmFactExtractor — LLM-backed fact extractor.
 *
 * Uses an LLMProvider (typically a cheap model like Claude Haiku or
 * GPT-4o-mini) to pull stable, timeless claims out of a conversation
 * turn. Complements `patternFactExtractor` — regex catches the obvious
 * self-disclosures, the LLM catches the open-ended ones.
 *
 * The extractor asks the LLM for a JSON response in this shape:
 *
 * ```json
 * {
 *   "facts": [
 *     {
 *       "key": "user.name",
 *       "value": "Alice",
 *       "confidence": 0.95,
 *       "category": "identity",
 *       "refs": ["msg-1-0"]
 *     }
 *   ]
 * }
 * ```
 *
 * The extractor parses, clamps confidence via `asConfidence()`, dedups
 * by `key` (last occurrence wins, matching `patternFactExtractor`),
 * and returns the facts. Malformed responses fall back to `[]` — a bad
 * extraction should not break the agent turn.
 *
 * Usage:
 * ```ts
 * import { anthropic } from 'agentfootprint';
 * import { llmFactExtractor, factPipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 * const pipeline = factPipeline({
 *   store: new InMemoryStore(),
 *   extractor: llmFactExtractor({ provider: anthropic('claude-haiku-4-5') }),
 * });
 * ```
 */
import type { LLMProvider, LLMMessage as Message } from '../../adapters/types';
import type { FactExtractArgs, FactExtractor } from './extractor';
import type { Fact } from './types';
import { asConfidence } from './types';

export interface LLMFactExtractorConfig {
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

  /**
   * Include up to this many existing facts in the user prompt so the
   * model can update / refine rather than duplicate. Set to `0` to
   * skip — cheaper but loses update awareness. Default `16`.
   */
  readonly includeExistingLimit?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are an extractor that distills a turn of conversation into stable, timeless facts for long-term memory.

A "fact" is a key/value claim that is currently true — not a narration of what happened. Facts dedupe by key, so later turns overwrite earlier claims.

Return JSON in this exact shape:
{
  "facts": [
    {
      "key": "user.name",
      "value": "Alice",
      "confidence": 0.0_to_1.0,
      "category": "identity|contact|profile|preference|commitment|fact|other",
      "refs": ["msg-<turn>-<index>", ...]
    }
  ]
}

Guidelines:
- Use dotted keys for nested taxonomies: user.name, user.email, user.preferences.color, task.ORD-123.status.
- Values are JSON-serializable: strings, numbers, booleans, arrays, small objects.
- Confidence 0.9+ for direct self-disclosures ("my name is X"); 0.6-0.8 for inferences; below 0.5 for guesses.
- Only extract what the user explicitly claimed or committed to. Do not invent, do not infer personality traits.
- If a prior fact is being corrected ("actually, my name is Alicia"), emit the corrected value under the SAME key.
- Return [] if no stable claims appeared in this turn.
- Return ONLY the JSON object — no prose, no code fences.`;

/** Build a stable ref id matching the beat extractor's convention. */
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
    lines.push(`[${ref}] ${m.role}: ${m.content}`);
  }
  return lines.join('\n');
}

/** Serialize existing facts for the LLM's update-awareness context. */
function formatExistingFacts(existing: readonly Fact[], limit: number): string {
  if (limit <= 0 || existing.length === 0) return '';
  const take = existing.slice(0, limit);
  const lines = ['Previously known facts (update or extend — do NOT re-emit unchanged):'];
  for (const f of take) {
    const conf = typeof f.confidence === 'number' ? ` (conf ${f.confidence.toFixed(2)})` : '';
    const cat = f.category ? ` [${f.category}]` : '';
    lines.push(`- ${f.key}: ${JSON.stringify(f.value)}${cat}${conf}`);
  }
  return lines.join('\n');
}

/**
 * Parse the extractor's raw JSON response into validated facts.
 * Returns an empty array on any parse / shape failure — the `onParseError`
 * callback fires so consumers can observe failures without crashing turns.
 *
 * Dedup policy: within one response, if the LLM emits the same key
 * twice, the LAST occurrence wins (matches patternFactExtractor).
 */
function parseFactsResponse(
  raw: string,
  onParseError: (err: unknown, raw: string) => void,
): readonly Fact[] {
  try {
    const parsed = JSON.parse(raw);
    const rawFacts = (parsed?.facts ?? []) as unknown[];
    if (!Array.isArray(rawFacts)) return [];

    const byKey = new Map<string, Fact>();
    for (const rf of rawFacts) {
      if (!rf || typeof rf !== 'object') continue;
      const f = rf as Record<string, unknown>;
      if (typeof f.key !== 'string' || f.key.length === 0) continue;
      if (!('value' in f)) continue;
      const refs = Array.isArray(f.refs) ? f.refs.filter((r) => typeof r === 'string') : [];
      const category = typeof f.category === 'string' ? f.category : undefined;
      byKey.set(f.key, {
        key: f.key,
        value: f.value,
        confidence: asConfidence(f.confidence),
        ...(category ? { category } : {}),
        ...(refs.length > 0 ? { refs } : {}),
      });
    }
    return Array.from(byKey.values());
  } catch (err) {
    onParseError(err, raw);
    return [];
  }
}

export function llmFactExtractor(config: LLMFactExtractorConfig): FactExtractor {
  const { provider } = config;
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const includeExistingLimit = config.includeExistingLimit ?? 16;
  const onParseError =
    config.onParseError ??
    ((err: unknown, raw: string): void => {
      // eslint-disable-next-line no-console
      console.warn(
        '[agentfootprint] llmFactExtractor: failed to parse LLM response — returning no facts',
        { error: err, rawPreview: raw.slice(0, 200) },
      );
    });

  return {
    async extract(args: FactExtractArgs): Promise<readonly Fact[]> {
      const turn = formatMessagesForExtractor(args.messages, args.turnNumber);
      const prior = formatExistingFacts(args.existing ?? [], includeExistingLimit);
      const userContent = prior.length > 0 ? `${prior}\n\n${turn}` : turn;

      const response = await provider.complete({
        systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        model: 'memory-extractor',
        ...(args.signal ? { signal: args.signal } : {}),
      });

      return parseFactsResponse(response.content ?? '', onParseError);
    },
  };
}
