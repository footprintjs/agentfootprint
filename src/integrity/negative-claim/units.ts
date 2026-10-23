/**
 * units — a reply split into the units a claim is read in: Markdown-aware, then by sentence,
 * then by clause.
 *
 * Pattern: one linear pass over lines. A fenced block's lines are CODE units; a table row is one
 *          unit across its cells; a list item and a heading are one unit each; paragraph text is
 *          split into sentences (a `.`/`!`/`?` before a space or the end, so an identifier's
 *          dots never split one). Every unit is then split into clauses at "but", "however",
 *          "except", "although" and `;`, each clause its own unit with its own polarity.
 * Role:    integrity/ layer (L3), read by `detect.ts` only.
 *
 * Inline code (a backtick run closed by a run of the same length, CommonMark's rule) is returned
 * as spans, so a claim entirely inside one is noted, not judged.
 */

import { tokensOf } from './matcher.js';

/** A span of the text as given: `[start, end)`. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** One unit a claim is read in. */
export interface Unit extends TextSpan {
  /** Inside a fenced code block. */
  readonly fenced: boolean;
}

/** The units and the inline code spans of a reply. */
export interface Units {
  readonly units: readonly Unit[];
  readonly inlineCode: readonly TextSpan[];
}

interface Line {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      const end = i > start && text[i - 1] === '\r' ? i - 1 : i;
      out.push({ start, end, text: text.slice(start, end) });
      start = i + 1;
    }
  }
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const HEADING = /^ {0,3}#{1,6}\s+/;
const QUOTE = /^\s*>\s?/;
const CLAUSE_WORDS = new Set(['but', 'however', 'except', 'although']);

/** `[start, end)` with surrounding whitespace removed; undefined when nothing is left. */
function trimmed(text: string, start: number, end: number): TextSpan | undefined {
  let s = start;
  let e = end;
  while (s < e && /\s/u.test(text[s] as string)) s += 1;
  while (e > s && /\s/u.test(text[e - 1] as string)) e -= 1;
  return s < e ? { start: s, end: e } : undefined;
}

/** A block of paragraph text, split at sentence ends. */
function sentencesOf(text: string, start: number, end: number): TextSpan[] {
  const out: TextSpan[] = [];
  let from = start;
  for (let i = start; i < end; i += 1) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let j = i + 1;
    while (j < end && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j += 1;
    if (j === end || /\s/u.test(text[j] as string)) {
      const span = trimmed(text, from, j);
      if (span !== undefined) out.push(span);
      from = j;
    }
    i = j - 1;
  }
  const rest = trimmed(text, from, end);
  if (rest !== undefined) out.push(rest);
  return out;
}

/** A unit split at clause words and semicolons; the clause word opens the next clause. */
function clausesOf(text: string, span: TextSpan): TextSpan[] {
  const cuts: number[] = [];
  for (let i = span.start; i < span.end; i += 1) if (text[i] === ';') cuts.push(i);
  for (const token of tokensOf(text, span.start, span.end)) {
    if (CLAUSE_WORDS.has(token.text) && token.start > span.start) cuts.push(token.start);
  }
  if (cuts.length === 0) return [span];
  cuts.sort((a, b) => a - b);
  const out: TextSpan[] = [];
  let from = span.start;
  for (const cut of cuts) {
    const piece = trimmed(text, from, cut);
    if (piece !== undefined) out.push(piece);
    from = text[cut] === ';' ? cut + 1 : cut;
  }
  const last = trimmed(text, from, span.end);
  if (last !== undefined) out.push(last);
  return out;
}

/** Inline code spans of one line: a backtick run closed by the next run of the same length. */
function inlineCodeOf(line: Line): TextSpan[] {
  const out: TextSpan[] = [];
  let open: { length: number; start: number } | undefined;
  let i = 0;
  while (i < line.text.length) {
    if (line.text[i] !== '`') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < line.text.length && line.text[j] === '`') j += 1;
    const length = j - i;
    if (open === undefined) open = { length, start: line.start + j };
    else if (open.length === length) {
      out.push({ start: open.start, end: line.start + i });
      open = undefined;
    }
    i = j;
  }
  return out;
}

/** Split a reply into units. */
export function unitsOf(text: string): Units {
  const units: Unit[] = [];
  const inlineCode: TextSpan[] = [];
  const push = (span: TextSpan | undefined, fenced: boolean) => {
    if (span === undefined) return;
    for (const clause of clausesOf(text, span)) units.push({ ...clause, fenced });
  };
  let fence: { char: string; length: number } | undefined;
  let paragraph: { start: number; end: number } | undefined;
  const flush = () => {
    if (paragraph === undefined) return;
    for (const sentence of sentencesOf(text, paragraph.start, paragraph.end)) push(sentence, false);
    paragraph = undefined;
  };

  for (const line of linesOf(text)) {
    const marker = FENCE.exec(line.text);
    if (fence !== undefined) {
      const closes =
        marker !== null &&
        marker[1]?.[0] === fence.char &&
        (marker[1]?.length ?? 0) >= fence.length &&
        line.text.slice(marker[0].length).trim() === '';
      if (closes) fence = undefined;
      else for (const s of sentencesOf(text, line.start, line.end)) push(s, true);
      continue;
    }
    if (marker !== null) {
      flush();
      fence = { char: marker[1]?.[0] ?? '`', length: marker[1]?.length ?? 3 };
      continue;
    }
    if (line.text.trim() === '') {
      flush();
      continue;
    }
    inlineCode.push(...inlineCodeOf(line));
    const body = line.text.replace(QUOTE, (m) => ' '.repeat(m.length));
    if (body.trimStart().startsWith('|')) {
      flush();
      if (!TABLE_SEPARATOR.test(body)) push(trimmed(text, line.start, line.end), false);
      continue;
    }
    const item = LIST_ITEM.exec(body) ?? HEADING.exec(body);
    if (item !== null) {
      flush();
      push(trimmed(text, line.start + item[0].length, line.end), false);
      continue;
    }
    const start = line.start + (body.length - body.trimStart().length);
    paragraph =
      paragraph === undefined ? { start, end: line.end } : { ...paragraph, end: line.end };
  }
  flush();
  return { units, inlineCode };
}

/** Whether a span lies entirely inside one of the code spans. */
export function insideAny(span: TextSpan, code: readonly TextSpan[]): boolean {
  return code.some((c) => c.start <= span.start && span.end <= c.end);
}
