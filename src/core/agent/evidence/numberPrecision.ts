/** The shared precision rule for existing figures and opt-in plain decimals,
 * and the one exact reading of a number written in scientific notation. */
/** Decimal places the answer wrote the value with. */
export function decimalsOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** A source spelling is kept only within this bound, never silently clipped. */
export const MAX_ROUNDING_SPELLING_CHARS = 256;

interface Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

/** Exact decimal parts, including the exponent a finite JS number can print. */
function decimalOf(spelling: string): Decimal | undefined {
  if (spelling.length > MAX_ROUNDING_SPELLING_CHARS) return undefined;
  const match = /^([-+]?)(\d+)(?:\.(\d+))?(?:e([-+]?\d+))?$/i.exec(spelling);
  if (match?.[2] === undefined) return undefined;
  const exponent = Number(match[4] ?? 0);
  // Native finite numbers print exponents from -324 to308. This also bounds
  // every power below when this internal helper receives malformed input.
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return undefined;
  const fractional = match[3] ?? '';
  const magnitude = BigInt(match[2] + fractional);
  return {
    coefficient: match[1] === '-' ? -magnitude : magnitude,
    scale: fractional.length - exponent,
  };
}

/**
 * One whole token in scientific notation: `1.12e-02`, `3.358E+03`, `-5e7`.
 * Anchored, so a lookalike glued to letters or structure — a hash
 * (`9f3e10ab`), a version (`1.2e3-rc`), an id (`host-1e5`) — never matches:
 * the tokenizer's boundaries decide what stands alone.
 */
const SCIENTIFIC = /^[-+]?\d+(?:\.\d+)?e[-+]?\d+$/i;

/** The decimal a scientific spelling states, read exactly. */
export interface ScientificDecimal {
  /** The value with no exponent and no trailing fractional zero:
   *  `1.12e-02` → `0.0112`, `3.358e+03` → `3358`. */
  readonly exact: string;
  /** The value at the precision the spelling was written with, only when
   *  that is a fraction: `1.120e-2` → `0.01120`. A spelling with no
   *  fractional places after expansion (`3.358e+03`) has none — it is
   *  matched exactly, never rounded. */
  readonly written?: string;
}

/**
 * Read one standalone scientific spelling as the decimal it states — exactly,
 * through `decimalOf` (BigInt, no Number conversion) and within its bounds:
 * the spelling at most `MAX_ROUNDING_SPELLING_CHARS` characters, its exponent
 * within ±400, and the decimal it states within the same character bound.
 * `undefined` for any other token; outside the bounds a token stays a
 * spelling only.
 *
 * @example
 * ```ts
 * scientificDecimalOf('1.12e-02'); // { exact: '0.0112', written: '0.0112' }
 * scientificDecimalOf('1.2E+21');  // { exact: '1200000000000000000000' }
 * scientificDecimalOf('9f3e10ab'); // undefined — a hash, not a number
 * ```
 */
export function scientificDecimalOf(spelling: string): ScientificDecimal | undefined {
  if (!SCIENTIFIC.test(spelling)) return undefined;
  const decimal = decimalOf(spelling);
  if (decimal === undefined) return undefined;
  const exact = plainOf(withoutTrailingZeros(decimal));
  const written = decimal.scale > 0 ? plainOf(decimal) : undefined;
  // `written` keeps every fractional digit `exact` drops, so it is the longer.
  if ((written ?? exact).length > MAX_ROUNDING_SPELLING_CHARS) return undefined;
  return written === undefined ? { exact } : { exact, written };
}

/** The same value with every trailing fractional zero dropped. */
function withoutTrailingZeros({ coefficient, scale }: Decimal): Decimal {
  let reduced = coefficient;
  let places = scale;
  while (places > 0 && reduced % 10n === 0n) {
    reduced /= 10n;
    places -= 1;
  }
  return { coefficient: reduced, scale: places };
}

/** `coefficient × 10^-scale` written out, with exactly `max(scale, 0)` fractional digits. */
function plainOf({ coefficient, scale }: Decimal): string {
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
  if (scale <= 0) return digits === '0' ? '0' : `${sign}${digits}${'0'.repeat(-scale)}`;
  const padded = digits.padStart(scale + 1, '0');
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/** True inside the answer's inclusive half-unit rounding interval.
 * Existing figures keep their exact historical numeric allowance. New plain
 * decimals supply original spellings and use the same interval without slack
 * or lossy Number subtraction. There is one rounding rule and one owner. */
export function roundsTo(
  x: number,
  f: number,
  decimals: number,
  spellings?: { readonly source: string; readonly answer: string },
): boolean {
  if (spellings === undefined) {
    const half = 0.5 * 10 ** -decimals;
    return Math.abs(x - f) <= half * (1 + 1e-9) + 1e-12;
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_ROUNDING_SPELLING_CHARS) {
    return false;
  }
  const source = decimalOf(spellings.source);
  const answer = decimalOf(spellings.answer);
  if (source === undefined || answer === undefined) return false;
  const scale = Math.max(source.scale, answer.scale, decimals + 1);
  // With256-character spellings and exponents capped at400, powers are
  // bounded at1056 decimal places before any BigInt exponentiation.
  const difference =
    source.coefficient * 10n ** BigInt(scale - source.scale) -
    answer.coefficient * 10n ** BigInt(scale - answer.scale);
  const magnitude = difference < 0n ? -difference : difference;
  return magnitude <= 5n * 10n ** BigInt(scale - decimals - 1);
}
