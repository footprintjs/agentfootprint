import { toWireJson } from '../../../../lib/wireJson.js';
import type { OtelAttributeValue } from '../types.js';

// ─── Bounding helpers (PII / cardinality discipline) ─────────────────

/** Hard caps for attribute payloads. Evidence is bounded upstream
 *  (#5 `maxFieldChars`); these are defense-in-depth for the OTLP wire. */
const MAX_ATTR_CHARS = 256;
const MAX_LIST_ITEMS = 20;

export function bound(value: unknown): string {
  const s = typeof value === 'string' ? value : toWireJson(value) ?? String(value);
  return s.length > MAX_ATTR_CHARS ? `${cutAt(s, MAX_ATTR_CHARS - 1)}…` : s;
}

/**
 * The first `n` UTF-16 units of `s`, one fewer when the cut would split a
 * surrogate pair — a lone high surrogate is not valid Unicode, and a strict
 * OTLP/JSON decoder rejects it.
 */
function cutAt(s: string, n: number): string {
  const code = s.charCodeAt(n - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

/** The longest model- or caller-supplied text a span NAME carries. */
const MAX_SPAN_NAME_PART = 64;

/**
 * A tool or model name as a span-name component. Span names never pass
 * {@link capAttrs}, and a tool name is the MODEL's text when it names no
 * registered tool — so it is capped here (registered names are at most 64
 * characters by the providers' own rule, and pass unchanged).
 */
export function spanNamePart(name: string): string {
  return name.length > MAX_SPAN_NAME_PART ? `${cutAt(name, MAX_SPAN_NAME_PART - 1)}…` : name;
}

export function boundList(items: readonly string[]): readonly string[] {
  const capped = items.slice(0, MAX_LIST_ITEMS).map(bound);
  return items.length > MAX_LIST_ITEMS
    ? [...capped, `…+${items.length - MAX_LIST_ITEMS} more`]
    : capped;
}

/**
 * The CONTENT attributes — the ones a content switch opened on purpose, each
 * with its own size rule (tool content and the explanation: omitted over
 * `maxContentChars`, never cut; `gen_ai.task.*`: exported as they always
 * were). Every OTHER string leaving this adapter is capped by
 * {@link capAttrs}.
 */
const CONTENT_KEYS: ReadonlySet<string> = new Set([
  'gen_ai.task.input',
  'gen_ai.task.output',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'agentfootprint.tool.args.content',
  'agentfootprint.tool.result.content',
  'gen_ai.evaluation.explanation',
]);

/**
 * The ONE cap on the way out: every string attribute — span, span event, the
 * flattened fallback — at most {@link MAX_ATTR_CHARS}, every string list at
 * most {@link MAX_LIST_ITEMS} items, except {@link CONTENT_KEYS}. The
 * projections bound what they build; this funnel is what makes "every
 * exported string is capped" true of fields nobody thought to bound — a
 * caller-sized session id, a principal, a label. Returns the SAME object
 * when nothing needed a cap, so an unaffected span is byte-identical.
 */
export function capAttrs(
  attrs: Record<string, OtelAttributeValue>,
): Record<string, OtelAttributeValue> {
  let out: Record<string, OtelAttributeValue> | undefined;
  for (const [key, value] of Object.entries(attrs)) {
    if (CONTENT_KEYS.has(key)) continue;
    let capped: OtelAttributeValue = value;
    if (typeof value === 'string' && value.length > MAX_ATTR_CHARS) capped = bound(value);
    else if (
      Array.isArray(value) &&
      (value.length > MAX_LIST_ITEMS || value.some((item) => item.length > MAX_ATTR_CHARS))
    )
      capped = boundList(value);
    if (capped !== value) {
      out ??= { ...attrs };
      out[key] = capped;
    }
  }
  return out ?? attrs;
}
