/** Bounded diagnostic beside model declarations; never source authority or model testimony. */
import type { DeclaredOn } from './types.js';
export interface ReferenceRefusalRow {
  readonly kind: 'reference-refusal';
  readonly declaredOn: DeclaredOn;
  readonly iteration: number;
  readonly reason: 'malformed' | 'unidentified';
  readonly attempted?: string;
  readonly truncated?: true;
  readonly turn?: number;
}
const DIAGNOSTIC_CHARS = 8192;

/** Serialized text is diagnostic only: a cut is explicit and never becomes an identifier. */
export function referenceRefusalRow(
  declaredOn: DeclaredOn,
  iteration: number,
  malformed: boolean,
  attempted?: unknown,
): ReferenceRefusalRow {
  let text: string | undefined;
  if (attempted !== undefined) {
    try {
      text = typeof attempted === 'string' ? attempted : JSON.stringify(attempted);
    } catch {
      text = '[attempted findings could not be serialized]';
    }
  }
  return {
    kind: 'reference-refusal',
    declaredOn,
    iteration,
    reason: malformed ? 'malformed' : 'unidentified',
    ...(text !== undefined && { attempted: text.slice(0, DIAGNOSTIC_CHARS) }),
    ...(text !== undefined && text.length > DIAGNOSTIC_CHARS && { truncated: true }),
  };
}

/** Closed saved-diagnostic shape; restoring it never grants a reference. */
export function referenceRefusalRowIsWellFormed(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return false;
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    const properties = Object.getOwnPropertyDescriptors(value);
    const allowed = ['kind', 'declaredOn', 'iteration', 'reason', 'attempted', 'truncated', 'turn'];
    if (
      Object.keys(properties).some(
        (key) => !allowed.includes(key) || !('value' in properties[key]!),
      )
    )
      return false;
    const field = (key: string): unknown => properties[key]?.value;
    const whole = (number: unknown): boolean =>
      typeof number === 'number' && Number.isSafeInteger(number) && number >= 1;
    const on = field('declaredOn');
    let validOn = on === 'answer';
    if (on !== null && typeof on === 'object' && !Array.isArray(on)) {
      const keys = Object.getOwnPropertyDescriptors(on);
      validOn =
        Object.keys(keys).length === 1 &&
        keys.toolCallId !== undefined &&
        'value' in keys.toolCallId &&
        typeof keys.toolCallId.value === 'string';
    }
    return (
      field('kind') === 'reference-refusal' &&
      validOn &&
      whole(field('iteration')) &&
      ['malformed', 'unidentified'].includes(field('reason') as string) &&
      (field('attempted') === undefined ||
        (typeof field('attempted') === 'string' &&
          (field('attempted') as string).length <= DIAGNOSTIC_CHARS)) &&
      (field('truncated') === undefined ||
        (field('truncated') === true && typeof field('attempted') === 'string')) &&
      (field('turn') === undefined || whole(field('turn')))
    );
  } catch {
    return false;
  }
}
