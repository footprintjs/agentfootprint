/**
 * matcher — the prose grammar's machinery: a reply's tokens with their offsets, and the phrase
 * matcher over them. It owns NO spelling rule: every token is spelled by the library's one
 * spelling leaf (`lib/normalize.ts` · `foldCase`), and names compare by its `sameName`.
 *
 * Pattern: pure functions, linear in the text. A token is a run of letters, digits and marks,
 *          with `- _ . / : @ #` kept INSIDE an identifier (`host-07.dc1.example.com`, `eth1/3`)
 *          and an apostrophe kept inside a word (`doesn't`); every step of the one tokenizer
 *          regex consumes a character, so no input backtracks. Spans are offsets into the text
 *          as given; only each token's own text is spelled.
 * Role:    integrity/ layer (L3), read by `units.ts`, `detect.ts`, `language.ts`,
 *          `resolve.ts` and `containment.ts`.
 */

import { foldCase, sameName } from '../../lib/normalize.js';
import type { ClaimPhrase } from './phrases.js';
import type { ProseWorkBudget } from './work.js';

/** One token: its normalized text and where it sits in the text as given. */
export interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TOKEN =
  /[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}]|['\u{2019}](?=\p{L})|[-_./:@#](?=[\p{L}\p{N}]))*/gu;

/** One token as the grammar compares it: the leaf's case fold, a curly apostrophe straightened. */
export function spellToken(raw: string): string {
  return foldCase(raw.normalize('NFC')).replace(/\u{2019}/gu, "'");
}

/** The tokens of `text[from, to)`, with offsets into `text`. */
export function tokensOf(text: string, from = 0, to = text.length): Token[] {
  const out: Token[] = [];
  const slice = text.slice(from, to);
  for (const m of slice.matchAll(TOKEN)) {
    const start = from + (m.index ?? 0);
    out.push({ text: spellToken(m[0]), start, end: start + m[0].length });
  }
  return out;
}

/** A phrase's or a said word's tokens, as text. */
export function spell(phrase: string, work?: ProseWorkBudget): string[] {
  work?.charge(phrase.length + 1);
  return tokensOf(phrase).map((t) => t.text);
}

/** Whether `tokens` hold `words` as consecutive tokens, anywhere. */
export function holdsWords(
  tokens: readonly Token[],
  words: readonly string[],
  work?: ProseWorkBudget,
): boolean {
  return findWords(tokens, words, 0, work) !== -1;
}

/** The first index at which `tokens` hold `words` consecutively, or -1. */
export function findWords(
  tokens: readonly Token[],
  words: readonly string[],
  from = 0,
  work?: ProseWorkBudget,
): number {
  if (words.length === 0) return -1;
  outer: for (let i = from; i + words.length <= tokens.length; i += 1) {
    for (let j = 0; j < words.length; j += 1) {
      work?.charge(1);
      if (tokens[i + j]?.text !== words[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Whether any of the said phrases is held by `tokens`. */
export function holdsAnySaid(
  tokens: readonly Token[],
  said: readonly string[] | undefined,
  work?: ProseWorkBudget,
): boolean {
  return (said ?? []).some((phrase) => holdsWords(tokens, spell(phrase, work), work));
}

/** Whether the unit holds `name` as one of its token runs, by the leaf's name rule (`sameName`). */
export function holdsName(
  text: string,
  tokens: readonly Token[],
  name: string,
  work?: ProseWorkBudget,
): boolean {
  return nameAt(text, tokens, name, 0, work) !== -1;
}

/** The first token index at which the unit holds `name` (by `sameName`), from `from`; or -1. */
export function nameAt(
  text: string,
  tokens: readonly Token[],
  name: string,
  from: number,
  work?: ProseWorkBudget,
): number {
  const words = spell(name, work);
  for (
    let at = findWords(tokens, words, from, work);
    at !== -1;
    at = findWords(tokens, words, at + 1, work)
  ) {
    const first = tokens[at] as Token;
    const last = tokens[at + words.length - 1] as Token;
    work?.charge(last.end - first.start + name.length + 1);
    if (sameName(text.slice(first.start, last.end), name)) return at;
  }
  return -1;
}

// ─── the phrase matcher ──────────────────────────────────────────────────

const NUMBER_WORDS = new Set(
  'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(
    ' ',
  ),
);

/** A number word's value, or a digit string's. */
export function numberOf(token: string): number | undefined {
  if (/^\d{1,6}$/.test(token)) return Number(token);
  const words = [...NUMBER_WORDS];
  const at = words.indexOf(token);
  return at === -1 ? undefined : at + 1;
}

interface Slot {
  readonly test: (token: string) => boolean;
  readonly optional: boolean;
}

interface CompiledPhrase {
  readonly anchored: boolean;
  readonly slots: readonly Slot[];
}

const startsWithLetter = (token: string): boolean => /^\p{L}/u.test(token);

function compileSlot(raw: string): Slot {
  const optional = raw.endsWith('?') && raw.length > 1;
  const body = optional ? raw.slice(0, -1) : raw;
  if (body === '<word>') return { optional, test: startsWithLetter };
  if (body === '<num>') return { optional, test: (t) => numberOf(t) !== undefined };
  if (body === '<dur>') return { optional, test: (t) => /^\d{1,6}[mhdw]$/.test(t) };
  if (body.startsWith('!')) {
    const except = new Set(body.slice(1).split('|'));
    return { optional, test: (t) => startsWithLetter(t) && !except.has(t) };
  }
  const options = new Set(body.split('|'));
  return { optional, test: (t) => options.has(t) };
}

const COMPILED = new WeakMap<ClaimPhrase, CompiledPhrase>();

function compiled(phrase: ClaimPhrase): CompiledPhrase {
  const known = COMPILED.get(phrase);
  if (known !== undefined) return known;
  const anchored = phrase.literal !== true && phrase.words[0] === '^';
  const words = anchored ? phrase.words.slice(1) : phrase.words;
  const made = {
    anchored,
    slots: words.map((word) =>
      phrase.literal === true
        ? { optional: false, test: (token: string) => token === word }
        : compileSlot(word),
    ),
  };
  COMPILED.set(phrase, made);
  return made;
}

/** Only spaces between two matched tokens — a comma or a full stop breaks a phrase. */
const spaced = (text: string, left: Token, right: Token): boolean =>
  /^[ \t\u{A0}]*$/u.test(text.slice(left.end, right.start));

/** One match: the phrase and the token range it covers. */
export interface PhraseHit {
  readonly phrase: ClaimPhrase;
  readonly first: number;
  readonly last: number;
}

/** The token index after a match of `slots` from `slot`/`at`, or -1. Optional slots fork. */
function matchFrom(
  text: string,
  tokens: readonly Token[],
  slots: readonly Slot[],
  slot: number,
  at: number,
  previous: Token | undefined,
): number {
  if (slot === slots.length) return at;
  const s = slots[slot] as Slot;
  const token = tokens[at];
  if (
    token !== undefined &&
    s.test(token.text) &&
    (previous === undefined || spaced(text, previous, token))
  ) {
    const end = matchFrom(text, tokens, slots, slot + 1, at + 1, token);
    if (end !== -1) return end;
  }
  return s.optional ? matchFrom(text, tokens, slots, slot + 1, at, previous) : -1;
}

/** The first hit of `phrase` in a unit's tokens, or undefined. */
export function matchPhrase(
  text: string,
  tokens: readonly Token[],
  phrase: ClaimPhrase,
): PhraseHit | undefined {
  const { anchored, slots } = compiled(phrase);
  const starts = anchored ? Math.min(1, tokens.length) : tokens.length;
  for (let i = 0; i < starts; i += 1) {
    const end = matchFrom(text, tokens, slots, 0, i, undefined);
    if (end > i) return { phrase, first: i, last: end - 1 };
  }
  return undefined;
}

/** The earliest hit of any phrase of a pack (ties go to pack order), or undefined. */
export function firstHit(
  text: string,
  tokens: readonly Token[],
  pack: readonly ClaimPhrase[],
): PhraseHit | undefined {
  let best: PhraseHit | undefined;
  for (const phrase of pack) {
    const hit = matchPhrase(text, tokens, phrase);
    if (hit !== undefined && (best === undefined || hit.first < best.first)) best = hit;
  }
  return best;
}

/** Every phrase of a pack that matches somewhere in the unit. */
export function allHits(
  text: string,
  tokens: readonly Token[],
  pack: readonly ClaimPhrase[],
): PhraseHit[] {
  const out: PhraseHit[] = [];
  for (const phrase of pack) {
    const hit = matchPhrase(text, tokens, phrase);
    if (hit !== undefined) out.push(hit);
  }
  return out;
}
