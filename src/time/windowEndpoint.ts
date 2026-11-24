import { compareInstants, instantOf, spellInstant, type InstantText } from './instant.js';
import { isTimeRange, type Edge, type TimeRange } from './range.js';

export type WindowPrecision = 'hour' | 'minute' | 'second' | 'fraction';

/** The cutoff as confirmed, before conversion to a half-open interval. */
export interface WindowEndpoint {
  readonly cutoff: InstantText;
  readonly end: Edge;
  readonly precision: WindowPrecision;
}

export interface RecordedWindow extends TimeRange {
  readonly endpoint?: WindowEndpoint;
}

export interface ControlWindowInput extends TimeRange {
  readonly end?: Edge;
  readonly precision?: WindowPrecision;
}

/** Only the boundary instant belongs to an inclusive end. */
function exclusiveEnd(endpoint: WindowEndpoint): InstantText | undefined {
  if (endpoint.end === 'exclusive') return endpoint.cutoff;
  return adjacentInstant(endpoint.cutoff, 1);
}

export function adjacentInstant(value: InstantText, by: -1 | 1): InstantText | undefined {
  const at = instantOf(value, 'strict');
  if (at === undefined) return undefined;
  const nanos = at.nanos + by;
  const carry = Math.floor(nanos / 1_000_000);
  return spellInstant({ ms: at.ms + carry, nanos: nanos - carry * 1_000_000 }, at.offsetMinutes);
}

/** Read the precision without rounding. An explicitly supplied precision must fit the cutoff. */
export function windowEndpointOf(
  cutoff: unknown,
  end: unknown = 'exclusive',
  precision?: unknown,
): WindowEndpoint | undefined {
  const instant = instantOf(cutoff, 'strict');
  if (instant === undefined || (end !== 'exclusive' && end !== 'inclusive')) return undefined;
  const grain = precision === undefined ? instant.precision : precision;
  const localMs = instant.ms + instant.offsetMinutes * 60_000;
  if (grain !== 'fraction') {
    const step =
      grain === 'hour' ? 3_600_000 : grain === 'minute' ? 60_000 : grain === 'second' ? 1_000 : 0;
    if (step === 0 || localMs % step !== 0 || instant.nanos !== 0) return undefined;
  }
  return { cutoff: cutoff as InstantText, end, precision: grain as WindowPrecision };
}

/** Reject contradictory endpoint evidence while accepting historical two-key ranges. */
export function endpointFits(value: unknown, range: TimeRange): value is WindowEndpoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { cutoff, end, precision, ...extra } = value as Record<string, unknown>;
  if (end === undefined || precision === undefined || Object.keys(extra).length > 0) return false;
  const endpoint = windowEndpointOf(cutoff, end, precision);
  const expected = endpoint === undefined ? undefined : instantOf(exclusiveEnd(endpoint), 'strict');
  const actual = instantOf(range.to, 'strict');
  return expected !== undefined && actual !== undefined && compareInstants(expected, actual) === 0;
}

export function isRecordedWindow(value: unknown): value is RecordedWindow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { endpoint, ...range } = value as Record<string, unknown>;
  return isTimeRange(range) && (endpoint === undefined || endpointFits(endpoint, range));
}

/** Admit an explicit control and detach it from the caller's object. */
export function readControlWindow(value: unknown): RecordedWindow | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { from, to, end, precision, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return undefined;
  const endpoint = windowEndpointOf(to, end, precision);
  if (endpoint === undefined) return undefined;
  const range = { from, to: exclusiveEnd(endpoint) };
  return isTimeRange(range) ? { ...range, endpoint } : undefined;
}
