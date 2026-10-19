/** The shared precision rule for existing figures and opt-in plain decimals. */
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
