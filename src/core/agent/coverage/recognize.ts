/**
 * The absence RECOGNIZER — a leaf: no imports but types.
 *
 * `absent.ts` mints an absence and owns its sentences; this file owns only the
 * one question every reader asks of a finished value, "is this an absence
 * envelope?". It is split out so a post-hoc reader (the answer account) can ask
 * it without loading the mint's tool-name checks. `absent.ts` re-exports both
 * names, so every existing import keeps working.
 */

import type { ToolAbsence } from './types.js';

/**
 * The reserved key that makes an absence recognizable. Exported because tests,
 * docs and any consumer inspecting a raw tool result match on it — and
 * because a reserved word on the wire has to be nameable.
 */
export const ABSENCE_MARKER = 'af_absent';

/**
 * Recognize (or decline to recognize) a value as an absence — STRICT, and the
 * strictness is the zero-cost guarantee. Only a plain object whose
 * `af_absent` is exactly `true` and whose `checked` is a non-empty array
 * qualifies; every other value any tool has ever returned takes the path it
 * always took, byte for byte.
 *
 * `undefined` means "not an absence", never "a malformed one" — this library
 * does not guess at a shape it did not mint.
 */
export function readAbsence(value: unknown): ToolAbsence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (rec[ABSENCE_MARKER] !== true) return undefined;
  if (!Array.isArray(rec.checked) || rec.checked.length === 0) return undefined;
  return value as ToolAbsence;
}
