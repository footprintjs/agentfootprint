/**
 * snippetUnits — cut a tool result into citable AttributionUnits for the
 * `'data'` channel.
 *
 * `explainChoice` can only credit the data channel with units to point
 * at — a raw tool result (arbitrary JSON or prose) is not citable as one
 * blob. This helper cuts it at the natural citation grain so a pick like
 * "open dress d42" can be attributed to the exact search-result snippet
 * that returned d42:
 *
 *   • a string → one unit per sentence/line (non-empty, trimmed),
 *   • an array element that is an object → ONE unit summarizing it — its
 *     primitive fields joined as `key: value` pairs (a search hit, a row),
 *   • any other object → its primitive fields grouped into one unit,
 *     then the walk continues into nested objects/arrays,
 *   • null/undefined/booleans/empty strings/functions/symbols → skipped.
 *
 * Bounded and total: at most `max` units, each truncated to `maxLength`
 * characters; circular references are guarded (WeakSet) — weird input
 * yields fewer units, never a throw.
 *
 * Pattern: pure synchronous function, zero imports beyond the shared
 *          types — `src/lib/influence-core/` leaf. No embedding happens
 *          here; the units feed `attributeChoice` / `explainChoice`.
 *
 * Honest claim: this is a CUTTER, not a ranker — it decides what is
 * quotable, not what mattered. Whether a snippet explains the pick is
 * the (proxy) verdict of the similarity scoring downstream.
 */
import type { AttributionUnit } from './types.js';

export interface SnippetUnitsOptions {
  /** Channel tag stamped on every unit. Default `'data'`. */
  readonly channel?: string;
  /** Unit id prefix — ids become `'<prefix>-1'`, `'<prefix>-2'`, … Default `'data'`. */
  readonly idPrefix?: string;
  /** Cap on units returned. Default 12. */
  readonly max?: number;
  /** Cap on characters per unit text (ellipsis included). Default 200. */
  readonly maxLength?: number;
}

/**
 * Cut `value` (a tool result — arbitrary JSON value or prose string)
 * into at most `max` citable units for the data channel.
 */
export function snippetUnits(value: unknown, options: SnippetUnitsOptions = {}): AttributionUnit[] {
  const channel = options.channel ?? 'data';
  const idPrefix = options.idPrefix ?? 'data';
  const max = options.max ?? 12;
  const maxLength = options.maxLength ?? 200;

  const texts: string[] = [];
  collect(value, texts, max, new WeakSet());

  return texts.map((text, i) => ({
    id: `${idPrefix}-${i + 1}`,
    channel,
    text: truncate(text, maxLength),
  }));
}

/** Walk `value` depth-first, pushing snippet texts until `max` is reached. */
function collect(value: unknown, out: string[], max: number, seen: WeakSet<object>): void {
  if (out.length >= max) return;
  if (typeof value === 'string') {
    for (const sentence of splitSentences(value)) {
      if (out.length >= max) return;
      out.push(sentence);
    }
    return;
  }
  if (isCitablePrimitive(value)) {
    out.push(String(value));
    return;
  }
  if (typeof value !== 'object' || value === null) return; // boolean/null/undefined/function/symbol
  if (seen.has(value)) return; // circular reference — already visited
  seen.add(value);

  if (Array.isArray(value)) {
    for (const element of value) {
      if (out.length >= max) return;
      if (isPlainRecord(element)) {
        // The natural citation grain: one unit per row/hit, then walk its
        // nested values (a hit may itself contain an array of hits).
        if (seen.has(element)) continue;
        seen.add(element);
        const summary = summarizeFields(element);
        if (summary !== '') out.push(summary);
        for (const nested of Object.values(element)) {
          if (typeof nested === 'object' && nested !== null) collect(nested, out, max, seen);
        }
      } else {
        collect(element, out, max, seen);
      }
    }
    return;
  }

  // Non-array object: group its primitive fields into one unit, recurse
  // into the rest.
  const summary = summarizeFields(value as Record<string, unknown>);
  if (summary !== '') out.push(summary);
  for (const nested of Object.values(value)) {
    if (out.length >= max) return;
    if (typeof nested === 'object' && nested !== null) collect(nested, out, max, seen);
  }
}

/** Join an object's own citable primitive fields as `key: value` pairs. */
function summarizeFields(record: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed !== '') pairs.push(`${key}: ${trimmed}`);
    } else if (isCitablePrimitive(v)) {
      pairs.push(`${key}: ${String(v)}`);
    }
  }
  return pairs.join(', ');
}

/** Non-string primitives worth quoting: numbers and bigints. Booleans,
 *  null, and undefined carry no citable content — skipped. */
function isCitablePrimitive(value: unknown): value is number | bigint {
  return typeof value === 'number' || typeof value === 'bigint';
}

/** A record-shaped object (not an array) — the row/hit case. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split prose into sentences/lines; non-empty, trimmed. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Cap text at `maxLength` characters, ellipsis included. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return '…';
  return `${text.slice(0, maxLength - 1)}…`;
}
