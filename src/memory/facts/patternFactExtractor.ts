/**
 * patternFactExtractor — zero-dep regex-based fact extractor.
 *
 * Catches common self-disclosures:
 *   - "my name is Alice"            → user.name = "Alice"
 *   - "I'm Bob"                     → user.name = "Bob"
 *   - "I live in SF"                → user.location = "SF"
 *   - "my email is x@y.z"           → user.email = "x@y.z"
 *   - "I prefer dark mode"          → user.preferences = "dark mode"
 *
 * These are heuristics, not a production NER system. Miss rates are
 * real — users who want high-quality fact extraction should upgrade
 * to `llmFactExtractor({ provider })`.
 *
 * Why ship this?
 *   Users who enable `factPipeline()` without configuring an
 *   extractor get *some* value out of the box — at zero LLM cost.
 *   The facts the pattern extractor misses are still better-captured
 *   by beats (which run in a separate pipeline).
 */
import type { Message } from '../../types/messages';
import type { FactExtractArgs, FactExtractor } from './extractor';
import type { Fact } from './types';
import { asConfidence } from './types';

/** Extract plaintext from any Message content shape. */
function textOf(message: Message): string {
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const block of c) {
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
 * Each rule gets a single chance to extract a fact from a user message.
 * First match wins (per rule) — later messages overwrite earlier
 * extractions for the same `key`. That's by design: facts are stable
 * claims; repeated assertions are the user confirming / updating.
 *
 * Patterns are kept intentionally simple so behavior is predictable
 * and debuggable. Trailing punctuation is stripped from captures.
 */
interface Rule {
  readonly key: string;
  readonly category: string;
  readonly patterns: readonly RegExp[];
  readonly confidence: number;
}

const RULES: readonly Rule[] = [
  {
    key: 'user.name',
    category: 'identity',
    confidence: 0.9,
    patterns: [
      // "my name is Alice" / "My name is Alice Smith" — lead-in case-insensitive
      // via explicit [Mm], but captured name must be capitalized to avoid matching
      // "my name is bob" (lowercase name is almost certainly not self-disclosure).
      /\b[Mm]y name is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
      // "I'm Alice" / "I am Alice" — capitalized single word to reduce false positives
      /\bI(?:'m|\s+am)\s+([A-Z][a-zA-Z]+)(?=[\s,.!?]|$)/,
    ],
  },
  {
    key: 'user.email',
    category: 'contact',
    confidence: 0.95,
    patterns: [
      // Basic RFC-5322-ish: username@domain.tld. Not exhaustive; good enough.
      /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/,
    ],
  },
  {
    key: 'user.location',
    category: 'profile',
    confidence: 0.8,
    patterns: [
      // "I live in San Francisco" / "I'm in NYC" / "I live in New York City"
      // Captures 1-3 capitalized words (handles multi-word place names).
      /\bI\s+(?:live|am)\s+in\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})(?=[.!?,;]|$)/,
    ],
  },
  {
    key: 'user.preferences',
    category: 'preference',
    confidence: 0.7,
    patterns: [
      // "I prefer dark mode" / "I like pizza" / "I prefer hot coffee"
      // Captures 1-3 words — stops at sentence-ending punctuation.
      /\bI\s+(?:prefer|like)\s+([a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*){0,2})(?=[.!?,;]|$)/,
    ],
  },
];

/** Trim trailing punctuation / whitespace from an extracted value. */
function cleanValue(s: string): string {
  return s.replace(/[\s.!?,;:]+$/, '').trim();
}

export function patternFactExtractor(): FactExtractor {
  return {
    async extract(args: FactExtractArgs): Promise<readonly Fact[]> {
      // Track matches by key so later messages in this turn override
      // earlier ones (user may restate with correction). Within a turn,
      // last-write-wins per key.
      const byKey = new Map<string, Fact>();

      for (const msg of args.messages) {
        if (msg.role !== 'user') continue;
        const text = textOf(msg);
        if (text.length === 0) continue;

        for (const rule of RULES) {
          for (const pattern of rule.patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const raw = match[1];
            if (!raw) continue;
            const value = cleanValue(raw);
            if (value.length === 0) continue;
            byKey.set(rule.key, {
              key: rule.key,
              value,
              confidence: asConfidence(rule.confidence),
              category: rule.category,
            });
            break; // first pattern-match per rule wins for this message
          }
        }
      }

      return Array.from(byKey.values());
    },
  };
}
