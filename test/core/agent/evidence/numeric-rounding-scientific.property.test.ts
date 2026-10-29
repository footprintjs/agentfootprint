/**
 * Property: a value in scientific notation and a plain decimal ground each
 * other exactly when the rounding rule says the answer is the source rounded
 * at the answer's written precision — in exact decimal arithmetic, both ways
 * round, and never across magnitude (`decimalRounding: true`).
 *
 * Seeded (`test/helpers/seededText.ts` · `seeded`), so a failure names a
 * reproducible case. The oracle is written apart from the library: instead
 * of measuring a half-unit distance it asks which `d`-place values are
 * NEAREST the source — the floor and the ceiling, both on an exact tie — in
 * BigInt.
 */
import { describe, expect, it } from 'vitest';
import { seeded } from '../../../helpers/seededText.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';

/** An exact decimal, `c × 10^-s`; a negative `s` is a whole number written to tens, hundreds… */
interface Dec {
  readonly c: bigint;
  readonly s: number;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** The same value with `s ≥ 0`. */
function normal(c: bigint, s: number): Dec {
  return s >= 0 ? { c, s } : { c: c * pow10(-s), s: 0 };
}

/** The `places`-place values nearest `value`, as integers × 10^places — two on an exact tie. */
function nearestAt(value: Dec, places: number): readonly bigint[] {
  const { c, s } = normal(value.c, value.s);
  if (places >= s) return [c * pow10(places - s)];
  const unit = pow10(s - places);
  let floor = c / unit; // BigInt division truncates toward zero
  if (c < 0n && floor * unit !== c) floor -= 1n;
  const twice = 2n * (c - floor * unit); // twice the remainder: in [0, 2 · unit)
  if (twice < unit) return [floor];
  if (twice > unit) return [floor + 1n];
  return [floor, floor + 1n];
}

/** Equal as numbers. */
function same(a: Dec, b: Dec): boolean {
  const x = normal(a.c, a.s);
  const y = normal(b.c, b.s);
  const s = Math.max(x.s, y.s);
  return x.c * pow10(s - x.s) === y.c * pow10(s - y.s);
}

/** `c × 10^-places` written plainly, with exactly `places` fractional digits. */
function plain(c: bigint, places: number): string {
  const sign = c < 0n ? '-' : '';
  const digits = (c < 0n ? -c : c).toString().padStart(places + 1, '0');
  if (places === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

const digitCount = (spelling: string): number => spelling.replace(/[^0-9]/g, '').length;

/** Random draws over one seeded stream. */
function drawsOf(next: () => number) {
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return {
    int,
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T;
    },
    /** A positive integer of `count` digits, the first one not zero. */
    digits(count: number): bigint {
      let out = String(int(1, 9));
      while (out.length < count) out += String(int(0, 9));
      return BigInt(out);
    },
    sign: (): bigint => (next() < 0.25 ? -1n : 1n),
  };
}

/**
 * `value` (not zero) in scientific notation, its precision kept: the point
 * usually after the first digit, sometimes elsewhere (`11.2e-3`, `112e-4`);
 * `e` or `E`; `+` or nothing before a positive exponent; sometimes padded.
 */
function scientific(value: Dec, next: () => number): string {
  const sign = value.c < 0n ? '-' : '';
  const digits = (value.c < 0n ? -value.c : value.c).toString();
  const point = next() < 0.7 ? 1 : 1 + Math.floor(next() * digits.length);
  const mantissa =
    point < digits.length ? `${digits.slice(0, point)}.${digits.slice(point)}` : digits;
  const exponent = digits.length - point - value.s;
  const magnitude = String(Math.abs(exponent));
  return (
    sign +
    mantissa +
    (next() < 0.5 ? 'e' : 'E') +
    (exponent < 0 ? '-' : next() < 0.5 ? '+' : '') +
    (magnitude.length < 2 && next() < 0.5 ? `0${magnitude}` : magnitude)
  );
}

const gate = resolveEvidenceGate({ decimalRounding: true });

/** The gate's judgement of the ONE value `answer` states, over a result that printed `printed`. */
function grounds(printed: string, answer: string): boolean {
  const history: readonly LLMMessage[] = [
    { role: 'user', content: 'Read the value.' },
    { role: 'tool', toolCallId: 'read-1', content: `x = ${printed}` },
  ];
  const text = `The value is ${answer}.`;
  const verdict = checkAnswer(text, {
    gate,
    evidence: evidenceFromHistory(history, gate),
    exempt: new Set(),
    figures: figureCheckOf(text, history, gate),
  });
  expect(verdict.lookedUp).toBe(1);
  return verdict.unsupported.length === 0;
}

describe('property: a printed scientific value grounds an answer decimal iff it rounds to it', () => {
  it('holds over 1,500 seeded cases: every precision, both signs, the half-unit edge', () => {
    const next = seeded(0x5c1e);
    const { int, pick, digits, sign } = drawsOf(next);
    let checked = 0;
    let groundedCount = 0;
    let doublesDisagree = 0;
    while (checked < 1500) {
      const places = int(1, 8);
      let source: Dec;
      let answer: bigint;
      if (next() < 0.6) {
        // Any source; an answer at or one unit beside its rounding.
        const count = int(1, 9);
        source = normal(sign() * digits(count), count - 1 - int(-10, 6));
        answer = pick(nearestAt(source, places)) + pick([-1n, 0n, 0n, 0n, 1n]);
      } else {
        // The source half a unit from the answer, then one digit in or out of
        // that boundary — as far as twelve places past it, beyond a double.
        answer = sign() * BigInt(int(0, 999_999));
        const past = int(1, 12);
        const offset = 5n * pow10(past) + pick([-1n, 0n, 1n]);
        const scaled = answer * pow10(1 + past);
        source = { c: next() < 0.5 ? scaled + offset : scaled - offset, s: places + 1 + past };
      }
      const written = plain(answer, places);
      if (digitCount(written) > 15) continue; // past the answer-side rounding bound
      const printed = scientific(source, next);
      const expected = nearestAt(source, places).includes(answer);
      expect({ printed, written, grounded: grounds(printed, written) }).toEqual({
        printed,
        written,
        grounded: expected,
      });
      if (Math.abs(Number(printed) - Number(written)) <= 0.5 * 10 ** -places !== expected) {
        doublesDisagree += 1;
      }
      if (expected) groundedCount += 1;
      checked += 1;
    }
    // Both outcomes, in numbers (seeded: 948 grounded of 1,500) — and the cases
    // reached the edge where comparing doubles gives the wrong answer (143).
    expect(Math.min(groundedCount, checked - groundedCount)).toBeGreaterThan(300);
    expect(doublesDisagree).toBeGreaterThan(50);
  });

  it('never grounds across magnitude: ×10^k of the value, k = ±1, ±2', () => {
    const next = seeded(0xe5ca1e);
    const { int, digits, sign } = drawsOf(next);
    for (let i = 0; i < 400; i += 1) {
      const count = int(1, 9);
      const source = normal(sign() * digits(count), count - 1 - int(-10, 6));
      const printed = scientific(source, next);
      const own = Math.max(source.s, 1);
      const itself = plain(source.c * pow10(own - source.s), own);
      if (digitCount(itself) <= 15) expect(grounds(printed, itself)).toBe(true);
      for (const shift of [-2, -1, 1, 2]) {
        const moved = normal(source.c, source.s - shift);
        const places = Math.max(moved.s, 1);
        const answer = moved.c * pow10(places - moved.s);
        const written = plain(answer, places);
        if (digitCount(written) > 15) continue;
        expect(nearestAt(source, places).includes(answer)).toBe(false);
        expect({ printed, written, grounded: grounds(printed, written) }).toEqual({
          printed,
          written,
          grounded: false,
        });
      }
    }
  });
});

describe('property: an answer in scientific notation is grounded by a printed decimal iff it rounds to it', () => {
  it('holds over 1,500 seeded cases, whole numbers matched exactly', () => {
    const next = seeded(0xdec1);
    const { int, pick, digits, sign } = drawsOf(next);
    let checked = 0;
    let groundedCount = 0;
    while (checked < 1500) {
      let printedValue: Dec;
      let answer: Dec;
      const mode = next();
      if (mode < 0.15) {
        // A whole number beside a printed value a few hundredths off it: never rounds.
        answer = { c: sign() * BigInt(int(1, 99_999)), s: 0 };
        const places = int(1, 3);
        const off = BigInt(int(1, 9)) * (next() < 0.5 ? 1n : -1n);
        printedValue = { c: answer.c * pow10(places) + off, s: places };
      } else if (mode < 0.6) {
        const count = int(1, 9);
        printedValue = normal(sign() * digits(count), count - 1 - int(-9, 6));
        // The answer's precision: places, or a whole number to units, tens, hundreds.
        const precision = int(-2, 8);
        const nudge = pick([-1n, 0n, 0n, 0n, 1n]);
        const rounded = pick(nearestAt(printedValue, Math.max(precision, 0))) + nudge;
        answer =
          precision >= 0
            ? { c: rounded, s: precision }
            : { c: rounded / pow10(-precision), s: precision };
      } else {
        const places = int(1, 5);
        answer = { c: sign() * BigInt(int(1, 99_999)), s: places };
        const past = int(1, 4);
        const offset = 5n * pow10(past) + pick([-1n, 0n, 1n]);
        const scaled = answer.c * pow10(1 + past);
        printedValue = {
          c: next() < 0.5 ? scaled + offset : scaled - offset,
          s: places + 1 + past,
        };
      }
      if (answer.c === 0n) continue;
      const zeros = int(0, 2);
      const printed = plain(printedValue.c * pow10(zeros), printedValue.s + zeros);
      if (digitCount(printed) > 15) continue;
      if (answer.s >= 1 && digitCount(plain(answer.c, answer.s)) > 15) continue;
      const written = scientific(answer, next);
      const expected =
        answer.s >= 1
          ? nearestAt(printedValue, answer.s).includes(answer.c)
          : same(printedValue, answer);
      expect({ printed, written, grounded: grounds(printed, written) }).toEqual({
        printed,
        written,
        grounded: expected,
      });
      if (expected) groundedCount += 1;
      checked += 1;
    }
    // Both outcomes, in numbers (seeded: 731 grounded of 1,500).
    expect(Math.min(groundedCount, checked - groundedCount)).toBeGreaterThan(300);
  });
});
