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
import type { LLMMessage as Message } from '../../adapters/types.js';
import type { FactExtractArgs, FactExtractor } from './extractor.js';
import type { Fact } from './types.js';
import { asConfidence } from './types.js';
import { anyOf, either, isRegExpWhitespace, trimTrailing } from '../../lib/linearText.js';

/** Extract plaintext from any Message content shape. */
function textOf(message: Message): string {
  return message.content ?? '';
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
  readonly finders: readonly Finder[];
  readonly confidence: number;
}

/** One way a rule finds its value in a message: the captured text, or `undefined`. */
type Finder = (text: string) => string | undefined;

/**
 * The first capture group of the first match. Only for a pattern that is
 * linear by construction: each of these starts at a literal lead-in (`my name
 * is`, `I am`, `I live in`), and an attempt walks only the whitespace and the
 * at most three words after its own lead-in, so no stretch of text is walked
 * by more than a few attempts. The email pattern is not one of them; it has
 * {@link firstEmail}.
 */
function firstCapture(pattern: RegExp): Finder {
  return (text) => text.match(pattern)?.[1];
}

const RULES: readonly Rule[] = [
  {
    key: 'user.name',
    category: 'identity',
    confidence: 0.9,
    finders: [
      // "my name is Alice" / "My name is Alice Smith" — lead-in case-insensitive
      // via explicit [Mm], but captured name must be capitalized to avoid matching
      // "my name is bob" (lowercase name is almost certainly not self-disclosure).
      firstCapture(/\b[Mm]y name is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/),
      // "I'm Alice" / "I am Alice" — capitalized single word to reduce false positives
      firstCapture(/\bI(?:'m|\s+am)\s+([A-Z][a-zA-Z]+)(?=[\s,.!?]|$)/),
    ],
  },
  {
    key: 'user.email',
    category: 'contact',
    confidence: 0.95,
    // Basic RFC-5322-ish: username@domain.tld. Not exhaustive; good enough.
    finders: [firstEmail],
  },
  {
    key: 'user.location',
    category: 'profile',
    confidence: 0.8,
    finders: [
      // "I live in San Francisco" / "I'm in NYC" / "I live in New York City"
      // Captures 1-3 capitalized words (handles multi-word place names).
      firstCapture(/\bI\s+(?:live|am)\s+in\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})(?=[.!?,;]|$)/),
    ],
  },
  {
    key: 'user.preferences',
    category: 'preference',
    confidence: 0.7,
    finders: [
      // "I prefer dark mode" / "I like pizza" / "I prefer hot coffee"
      // Captures 1-3 words — stops at sentence-ending punctuation.
      firstCapture(
        /\bI\s+(?:prefer|like)\s+([a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*){0,2})(?=[.!?,;]|$)/,
      ),
    ],
  },
];

/** `[A-Za-z0-9._%+-]` — what an address's local part is made of. */
const isLocalPartChar = either(isAsciiAlphanumeric, anyOf('._%+-'));

/** `[A-Za-z0-9]` */
function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || ((code | 0x20) >= 0x61 && (code | 0x20) <= 0x7a);
}

/** `\w` — the side of a `\b` a character is on. */
function isWordChar(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 0x5f;
}

/** `[A-Za-z]` */
function isAsciiLetter(code: number): boolean {
  const lower = code | 0x20;
  return lower >= 0x61 && lower <= 0x7a;
}

/** `[A-Za-z0-9.-]` — what a domain is made of. */
const isDomainChar = either(isAsciiAlphanumeric, anyOf('.-'));

/**
 * `text.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/)?.[1]`,
 * with ONE attempt per `@` instead of one per position.
 *
 * Unanchored, that pattern starts an attempt at every word boundary, and each
 * one walks the whole run of local-part characters after it looking for an
 * `@`; on `'a.'` repeated with no `@` at all, every attempt walks to the end
 * (16,000 pairs take ~0.5 s in V8). But an attempt can only succeed from
 * inside the run that ends at an `@` (`@` is not a local-part character, so
 * nothing before that run reaches it), the first attempt inside the run is at
 * its leftmost word boundary, and every later one in the same run reaches the
 * same `@` and the same domain — so it succeeds or fails with the first.
 * Runs before different `@`s do not overlap, nor do the domains after them,
 * so the whole search is one pass.
 */
export function firstEmail(text: string): string | undefined {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    const start = localPartStart(text, at);
    if (start === -1) continue;
    const end = domainEnd(text, at);
    if (end !== -1) return text.slice(start, end);
  }
  return undefined;
}

/**
 * Where `[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` ends when it starts just after `at`,
 * or -1. The greedy run gives characters back from the right, so the match
 * ends after the LAST `.` (with a domain character before it) whose letter
 * run is two or more long and ends at a word boundary. The letter runs after
 * different dots do not overlap, so this reads the domain once.
 */
function domainEnd(text: string, at: number): number {
  if (at + 1 >= text.length || !isDomainChar(text.charCodeAt(at + 1))) return -1;
  let end = -1;
  for (let dot = at + 2; dot < text.length && isDomainChar(text.charCodeAt(dot)); dot++) {
    if (text.charCodeAt(dot) !== 0x2e) continue;
    let letters = dot + 1;
    while (letters < text.length && isAsciiLetter(text.charCodeAt(letters))) letters++;
    const atBoundary = letters === text.length || !isWordChar(text.charCodeAt(letters));
    if (letters - dot - 1 >= 2 && atBoundary) end = letters;
  }
  return end;
}

/**
 * The leftmost word boundary in the run of local-part characters that ends
 * just before `at` — where the unanchored pattern's first attempt on this `@`
 * starts — or -1 when the run is empty or has no boundary.
 */
function localPartStart(text: string, at: number): number {
  let first = at;
  while (first > 0 && isLocalPartChar(text.charCodeAt(first - 1))) first--;
  for (let p = first; p < at; p++) {
    const wordBefore = p > 0 && isWordChar(text.charCodeAt(p - 1));
    if (wordBefore !== isWordChar(text.charCodeAt(p))) return p;
  }
  return -1;
}

/** `[\s.!?,;:]` — what may trail an extracted value. */
const TRAILING_NOISE = either(isRegExpWhitespace, anyOf('.!?,;:'));

/**
 * Trim trailing punctuation / whitespace from an extracted value — walked in
 * from the end, not `/[…]+$/`: the value is a person's words, and that regex
 * retries from every position of a long whitespace run
 * (`lib/linearText.ts` · "Why these exist").
 */
export function cleanValue(s: string): string {
  return trimTrailing(s, TRAILING_NOISE).trim();
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
          for (const find of rule.finders) {
            const raw = find(text);
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
