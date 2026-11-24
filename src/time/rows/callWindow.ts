import { isTimeRange, sameRange } from '../range.js';
import { TIME_REFUSALS, type TimeRefusal } from '../periodForm.js';
import { isRecordedWindow } from '../windowEndpoint.js';
import type { PersonWindow } from './types.js';

const HOWS = ['filled', 'bound', 'model-chosen', 'model', 'unread', 'not-filled', 'refused'];
const WHYS = ['no-window', 'several-mentions', 'open-reading', 'no-exact-form'];

function isPersonWindow(value: unknown, isCount: (value: unknown) => boolean): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { source, mention, ...range } = value as Record<string, unknown>;
  return (
    (source === 'said' ||
      source === 'derived-from-reading' ||
      source === 'answered' ||
      source === 'control') &&
    (mention === undefined || isCount(mention)) &&
    (source === 'control') === (mention === undefined) &&
    isRecordedWindow(range)
  );
}

function isRangeList(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(isTimeRange);
}

/** A widened fill's fields: `sent` with exactly one of `differs` / `trimmedByTool`, or none of the three. */
function widenedOk(row: Readonly<Record<string, unknown>>): boolean {
  if (row.sent === undefined) return row.differs === undefined && row.trimmedByTool === undefined;
  if (!isTimeRange(row.sent)) return false;
  if (row.trimmedByTool !== undefined)
    return row.trimmedByTool === true && row.differs === undefined;
  const differs = row.differs;
  if (differs === null || typeof differs !== 'object' || Array.isArray(differs)) return false;
  const d = differs as Record<string, unknown>;
  return Object.keys(d).length === 1 && isRangeList(d.extra);
}

/** Comparison witnesses can describe only a confirmed exact range, never a fallback. */
function comparisonOk(row: Readonly<Record<string, unknown>>): boolean {
  if (row.comparison === undefined) return true;
  if (
    row.comparison === null ||
    typeof row.comparison !== 'object' ||
    Array.isArray(row.comparison)
  )
    return false;
  const { original, corrected, ...extra } = row.comparison as Record<string, unknown>;
  const person = row.person as PersonWindow;
  return (
    Object.keys(extra).length === 0 &&
    (corrected === undefined || corrected === true) &&
    (original === undefined || (corrected === true && isTimeRange(original))) &&
    (person.source === 'answered' || person.source === 'control') &&
    isTimeRange(row.asked) &&
    sameRange(row.asked, { from: person.from, to: person.to }) &&
    row.rounded === undefined &&
    row.sent === undefined
  );
}

export function isCallWindowRow(
  row: Readonly<Record<string, unknown>>,
  isCount: (value: unknown) => boolean,
): boolean {
  if (typeof row.toolCallId !== 'string' || typeof row.toolName !== 'string') return false;
  if (!HOWS.includes(row.how as string)) return false;
  const has = (k: string): boolean => row[k] !== undefined;
  const only = (...keys: string[]): boolean =>
    [
      'form',
      'asked',
      'person',
      'by',
      'rounded',
      'why',
      'sent',
      'differs',
      'trimmedByTool',
      'partlyBeyondRetention',
      'refused',
      'argument',
      'comparison',
    ].every((k) => keys.includes(k) || !has(k));
  const formOk = isCount(row.form);
  const askedOk = isTimeRange(row.asked);
  const partlyOk = row.partlyBeyondRetention === undefined || row.partlyBeyondRetention === true;
  switch (row.how) {
    case 'filled':
      return (
        only(
          'form',
          'asked',
          'person',
          'rounded',
          'sent',
          'differs',
          'trimmedByTool',
          'partlyBeyondRetention',
          'comparison',
        ) &&
        formOk &&
        askedOk &&
        isPersonWindow(row.person, isCount) &&
        (row.rounded === undefined || row.rounded === true) &&
        widenedOk(row) &&
        comparisonOk(row) &&
        partlyOk
      );
    case 'bound':
      return (
        only('form', 'asked', 'person', 'by', 'partlyBeyondRetention', 'comparison') &&
        formOk &&
        askedOk &&
        isPersonWindow(row.person, isCount) &&
        (row.by === 'quote' || row.by === 'value') &&
        comparisonOk(row) &&
        partlyOk
      );
    case 'model-chosen':
      return (
        only('form', 'asked', 'person', 'partlyBeyondRetention') &&
        formOk &&
        askedOk &&
        (row.person === undefined || isPersonWindow(row.person, isCount)) &&
        partlyOk
      );
    case 'model':
      return only('form', 'asked', 'partlyBeyondRetention') && formOk && askedOk && partlyOk;
    case 'unread':
      return only();
    case 'refused':
      return (
        only('form', 'asked', 'person', 'refused', 'argument') &&
        TIME_REFUSALS.includes(row.refused as TimeRefusal) &&
        (row.form === undefined || formOk) &&
        (row.asked === undefined || askedOk) &&
        (row.person === undefined || isPersonWindow(row.person, isCount)) &&
        // A skipped wall time names its argument and has no range. Every other refusal has a
        // range — except an OPEN reading the tool can read in no reading (`bind.ts` ·
        // `openReadingWindow`): no window was chosen, so it carries none, and no form or person.
        (row.refused === 'dst-gap'
          ? typeof row.argument === 'string' && formOk && row.asked === undefined
          : row.argument === undefined &&
            (row.asked === undefined
              ? row.form === undefined && row.person === undefined
              : askedOk))
      );
    default:
      return only('why') && WHYS.includes(row.why as string);
  }
}
