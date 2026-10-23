/** Data anchoring for prose observations, never an entity binding or proof.
 * Only dispatched read calls contribute app-declared words and actual sent or
 * resolved names. A clause elsewhere in the answer cannot lend its anchor.
 * Role: integrity/ leaf over the admitted TurnRecord; no model or user context. */
import type { DetectedClaim } from './detect.js';
import { sameName } from '../../lib/normalize.js';
import { spell, type Token } from './matcher.js';
import { isRead, scopeOf } from './readings.js';
import type { TurnRecord } from './types.js';
import type { ProseWorkBudget } from './work.js';

/** Precompute each native spelling once. Prefix fallback prevents a long sent
 * name and a repeated-token answer from multiplying every matching prefix. */
function anchorPattern(
  raw: string,
  name: boolean,
  work?: ProseWorkBudget,
): (text: string, tokens: readonly Token[]) => boolean {
  const words = spell(raw, work);
  work?.charge(words.length);
  const fallback = new Array<number>(words.length).fill(0);
  for (let i = 1, matched = 0; i < words.length; i += 1) {
    work?.charge(1);
    while (matched > 0 && words[i] !== words[matched]) {
      work?.charge(1);
      matched = fallback[matched - 1] ?? 0;
    }
    if (words[i] === words[matched]) matched += 1;
    fallback[i] = matched;
  }
  return (text, tokens) => {
    if (words.length === 0) return false;
    let matched = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      work?.charge(1);
      const token = tokens[i] as Token;
      const word = token.text;
      while (matched > 0 && word !== words[matched]) {
        work?.charge(1);
        matched = fallback[matched - 1] ?? 0;
      }
      if (word === words[matched]) matched += 1;
      if (matched === words.length) {
        const first = tokens[i + 1 - words.length] as Token;
        // Token folding only locates a candidate: identifiers, mixed case,
        // punctuation and whitespace still use the library's one name rule.
        if (!name) return true;
        work?.charge(token.end - first.start + raw.length + 1);
        if (sameName(text.slice(first.start, token.end), raw)) return true;
        matched = fallback[matched - 1] ?? 0;
      }
    }
    return false;
  };
}

/** Build once per checked text. The runtime bounds the record before this reader. */
export function proseAnchorOf(
  record: TurnRecord,
  work?: ProseWorkBudget,
): (claim: DetectedClaim, text: string) => boolean {
  const names = new Set<string>();
  const phrases = new Set<string>();
  const declared = new Set<string>();
  const addNames = (value: unknown): void => {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
        names.add(String(item));
    }
  };
  const addSaid = (said: readonly string[] | undefined): void => {
    for (const phrase of said ?? []) phrases.add(phrase);
  };
  for (const call of record.calls) {
    if (!call.dispatched || !isRead(call)) continue;
    const scope = call.row?.composed === 'remote' ? call.scope ?? [] : scopeOf(call) ?? [];
    const host = new Set(scope.filter((item) => item.from === 'host').map((item) => item.argument));
    if (!declared.has(call.toolName)) {
      declared.add(call.toolName);
      const search = record.tools[call.toolName]?.search;
      if (search !== undefined) {
        addSaid(search.subject.said);
        addSaid(search.source.said);
        for (const item of search.fixed ?? []) if (!host.has(item.name)) addSaid(item.said);
        for (const argument of search.arguments) {
          if (host.has(argument.name)) continue;
          for (const said of Object.values(argument.said ?? {})) addSaid(said);
        }
      }
    }
    // A kept-out payload contributes no names, even when a historical carrier
    // still holds its bytes. The public declaration can still anchor a note
    // that the record is incomplete.
    if (call.keptOut === true) continue;
    for (const [argument, value] of Object.entries(call.arguments)) {
      if (!host.has(argument)) addNames(value);
    }
    for (const item of scope) {
      if (item.from === 'host' || item.from === 'result') continue;
      addSaid(item.said);
      if (item.from === 'call') addNames(item.value);
      if (item.resolved !== undefined) {
        addNames(item.resolved.id);
        addNames(item.resolved.name);
        addNames(item.resolved.aliases);
      }
    }
  }
  const patterns = [
    ...[...phrases].map((phrase) => anchorPattern(phrase, false, work)),
    ...[...names].map((name) => anchorPattern(name, true, work)),
  ];
  return (claim, text) => {
    // A bare protocol-like "none" is not an absence about a named thing,
    // even when a searched value happens to have that spelling.
    if (claim.phraseId === 'none.none' && claim.tokens.length === 1) return false;
    return patterns.some((matches) => matches(text, claim.tokens));
  };
}
