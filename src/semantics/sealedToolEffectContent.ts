import { copyJson } from '../lib/boundedJson.js';
import { utf8Length } from '../lib/utf8.js';

/** Limit on each effect-bearing content proof, measured in serialized UTF-8 bytes. */
export const TOOL_EFFECT_CONTENT_BYTES = 64 * 1024;

const ownedContent = new WeakMap<object, number>();

/**
 * Prepare bounded JSON data for a tool result carrying effects. Result
 * middleware can inspect the value, but cannot edit it in place. Use a
 * replacement value to rewrite it. Invalid or oversized text throws.
 */
export function sealToolEffectContent(json: string): unknown {
  if (typeof json !== 'string' || json.length > TOOL_EFFECT_CONTENT_BYTES)
    throw new Error('Tool effect content exceeds its JSON byte limit.');
  const bytes = utf8Length(json);
  if (bytes > TOOL_EFFECT_CONTENT_BYTES)
    throw new Error('Tool effect content exceeds its JSON byte limit.');
  // Only the parser supplies these containers. No user object is reflected
  // on before its enumeration cost is known to fit the input text budget.
  const value = copyJson(JSON.parse(json), TOOL_EFFECT_CONTENT_BYTES, true);
  if (typeof value === 'object' && value !== null) ownedContent.set(value, bytes);
  return value;
}

/** Measure only scalars and containers produced by the bounded JSON owner. */
export function ownedToolEffectContentBytes(value: unknown): number | undefined {
  if (value === null || typeof value === 'boolean') return 5;
  if (typeof value === 'number')
    return Number.isFinite(value) && !Object.is(value, -0) ? String(value).length : undefined;
  if (typeof value === 'string' && value.length <= TOOL_EFFECT_CONTENT_BYTES) {
    const bytes = utf8Length(value);
    return bytes <= TOOL_EFFECT_CONTENT_BYTES ? bytes : undefined;
  }
  if (typeof value === 'object' && value !== null) return ownedContent.get(value);
  return undefined;
}
