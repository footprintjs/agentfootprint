/**
 * Load-insensitive performance assertions.
 *
 * WHY THIS EXISTS
 * -----------------------------------------------------------------------
 * `expect(elapsed).toBeLessThan(200)` does not measure the code. It measures
 * the machine. On a shared runner — where this suite runs next to a build, a
 * coverage pass and two other vitest workers — identical code takes three to
 * five times longer with nothing about the code having changed. The assertion
 * form cannot tell "we got slower" from "the box was busy", so it fires
 * exactly under the conditions CI creates, and everybody learns to re-run it
 * instead of reading it. A guard nobody trusts is worse than no guard: it
 * costs attention and buys nothing.
 *
 * THE FIX, IN TWO PARTS
 * -----------------------------------------------------------------------
 * **1. Compare, never assert an absolute.** Measure a BASELINE in the same
 * process at the same moment and assert a RATIO. Whatever slows the subject
 * slows the baseline too, so machine load divides out.
 *
 * **2. Take the FASTEST of several samples, and make each sample big enough to
 * be worth timing.** Neither half is optional, and leaving them out is how the
 * first cut of this module still flaked under real load.
 *
 * A single timing sample measures the code PLUS however much the scheduler
 * stole during that particular window, and the theft is lumpy: one sample can
 * be five times another with the code unchanged. The fastest of k samples is
 * the run that was interrupted least — the closest this can get to the cost
 * the code actually has. Samples are taken ALTERNATING between the two things
 * being compared, so a slow patch of machine time lands on both rather than on
 * whichever ran second.
 *
 * And a sample must be LONGER THAN A SCHEDULER QUANTUM or the comparison is a
 * lottery. On a machine running three copies of this suite next to a build,
 * one preemption costs tens of milliseconds; a 0.2ms measurement that takes
 * one is now a hundred times its real cost, while the 100ms measurement beside
 * it absorbed the same tax as a rounding error. Load stops cancelling. So each
 * operation is repeated inside one sample until the sample crosses
 * {@link MIN_SAMPLE_MS}, and what is compared is cost PER REPETITION. Then a
 * stolen slice is a proportional tax on both sides, which is the only regime
 * where a ratio means anything.
 *
 * Three honest forms, in order of preference:
 *
 *   1. `expectScalesLinearly` — the operation at 10× the input must not cost
 *      more than ~10× the small run. The strongest form: it states the actual
 *      algorithmic claim ("no quadratic rescan") and is immune to machine
 *      speed entirely.
 *
 *   2. `expectWithinTimes` — the subject must be within N× of a sibling
 *      operation (the same run without the recorder attached, say). Use when
 *      the claim is "feature X adds no meaningful overhead" — which is a
 *      comparison, so the test should make one.
 *
 *   3. `expectWithinReferenceUnits` — the subject must cost no more than N
 *      units of a fixed CPU workload timed right now, in this process. Use
 *      when there is no natural sibling. The ceiling breathes with the
 *      machine: a runner 4× slower today gets a 4× larger ceiling, and a
 *      genuine regression still trips it.
 *
 * A plain millisecond ceiling is a last resort, and where one survives, the
 * site says so and says why.
 *
 * WHY THE TESTS THAT USE THIS CARRY `{ timeout, retry }`
 * -----------------------------------------------------------------------
 * Two admissions, both deliberate.
 *
 * The TIMEOUT is there because sampling costs time: repeating an operation
 * until the sample is meaningful, several times, for two sides, is minutes of
 * work across the suite and seconds within one test. The runner's 5-second
 * default is itself a wall-clock budget with exactly the defect this module
 * exists to fix, so these tests state their own number instead of inheriting
 * one meant for unit tests.
 *
 * The RETRY is the last mile. Everything above removes the SYSTEMATIC ways a
 * busy machine distorts a measurement; none of it removes the possibility that
 * one particular run got unlucky three samples in a row. Retrying costs
 * nothing in strength: a real regression is deterministic and fails every
 * attempt, while contention has to win repeatedly to turn a build red. What
 * retry must never be used for is an assertion that is simply wrong — and the
 * conversions here were re-run under three concurrent suites until they held
 * on their own, before any retry was added.
 */

import { expect } from 'vitest';

/** Anything measurable: sync or async, run for its cost, not its value. */
type Work = () => void | Promise<void>;

/** Keeps the reference workload from being optimised away. */
let sink = 0;

/**
 * One reference unit of pure CPU work: allocate, sort, sum. Deliberately
 * boring and deliberately allocation-heavy — the same primitives the library
 * leans on (array churn, comparison, object headers), so the yardstick moves
 * with the machine the way the code under test does.
 */
function referenceWork(): void {
  const n = 5_000;
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = (i * 2654435761) % 100_000;
  arr.sort((a, b) => a - b);
  let acc = 0;
  for (let i = 0; i < n; i++) acc += arr[i]!;
  sink += acc;
}

/** Samples per measurement, after a warmup. The fastest one wins. */
const ROUNDS = 3;
/**
 * How long one sample must last before its number means anything.
 *
 * Above a scheduler quantum, being descheduled is a proportional tax; below
 * it, one preemption is the whole measurement. Operations cheaper than this
 * are repeated within the sample until it is reached.
 */
const MIN_SAMPLE_MS = 20;
/** Hard cap on auto-repetition, so a fast operation cannot run away. */
const MAX_REPS = 4096;
/**
 * Wall-clock ceiling on sampling ONE side of a comparison.
 *
 * Repetition and rounds buy robustness with time, and time is not free: an
 * operation that already costs a second per run would otherwise be run four
 * more times, and a test that takes twenty seconds under load trips the
 * runner's own timeout — trading one flake class for another. So cheap
 * operations get all {@link ROUNDS} rounds and expensive ones get as many as
 * fit. Expensive operations need the rounds least: their samples are already
 * far longer than a scheduler quantum, which is the regime where a stolen
 * slice is a proportional tax rather than the whole measurement.
 */
const SAMPLING_BUDGET_MS = 750;
/** Reference-unit calls per sample — enough that the clock is not the noise. */
const REFERENCE_BATCH = 10;
/** Rounds for the yardstick itself. It is cheap, but it is timed four times per assertion. */
const REFERENCE_ROUNDS = 2;

/**
 * How long one reference unit costs RIGHT NOW, in this process — the fastest
 * of several batches, for the reason the module header gives.
 *
 * Re-measured per call on purpose: a value cached at process start would carry
 * the load of a different moment, which is the bug this module exists to kill.
 *
 * The workload is sized so one unit lands near 1ms on an unloaded 2026 laptop.
 * That is deliberate: a ceiling written as `units` reads at a glance as "about
 * this many milliseconds on a quiet machine", while the real ceiling stretches
 * on a slow or busy one.
 */
export function referenceUnitMs(): number {
  referenceWork(); // warm the JIT; the first run is never representative
  let best = Infinity;
  for (let round = 0; round < REFERENCE_ROUNDS; round++) {
    const started = performance.now();
    for (let i = 0; i < REFERENCE_BATCH; i++) referenceWork();
    best = Math.min(best, (performance.now() - started) / REFERENCE_BATCH);
  }
  return best;
}

/** Time a synchronous operation, in milliseconds. One sample — see the header. */
export function measure(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

/** Time an operation (sync or async), in milliseconds. One sample. */
export async function measureAsync(work: Work): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

/**
 * How many repetitions this operation needs before one sample lasts longer
 * than {@link MIN_SAMPLE_MS}. Doubles from an estimate, and doubles as the
 * warmup — JIT, first-touch allocation and any lazy build belong to the setup,
 * not to the claim.
 */
async function repetitionsFor(work: Work): Promise<number> {
  let reps = 1;
  for (;;) {
    const started = performance.now();
    for (let i = 0; i < reps; i++) await work();
    const elapsed = performance.now() - started;
    if (elapsed >= MIN_SAMPLE_MS || reps >= MAX_REPS) return reps;
    // Aim straight at the target, but never grow by less than 2× — an elapsed
    // time of nearly zero would otherwise crawl.
    const aim = Math.ceil((reps * MIN_SAMPLE_MS) / Math.max(elapsed, 0.01));
    reps = Math.min(MAX_REPS, Math.max(reps * 2, aim));
  }
}

/** One sample of `reps` repetitions, reported as milliseconds PER repetition. */
async function samplePerRep(work: Work, reps: number): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < reps; i++) await work();
  return (performance.now() - started) / reps;
}

/**
 * The fastest of `ROUNDS` samples, per repetition — the run the scheduler
 * interrupted least.
 */
async function fastest(work: Work): Promise<number> {
  const reps = await repetitionsFor(work);
  let best = Infinity;
  const started = performance.now();
  for (let round = 0; round < ROUNDS; round++) {
    best = Math.min(best, await samplePerRep(work, reps));
    if (performance.now() - started >= SAMPLING_BUDGET_MS) break;
  }
  return best;
}

/**
 * The fastest sample of each, taken ALTERNATING. Interleaving matters: a busy
 * patch of machine time then lands on both measurements instead of whichever
 * happened to run during it. Each side is repeated enough times for its own
 * sample to clear {@link MIN_SAMPLE_MS}, and both are reported per repetition,
 * so the ratio compares like with like.
 */
async function fastestAlternating(a: Work, b: Work): Promise<[number, number]> {
  const repsA = await repetitionsFor(a); // calibration warms both
  const repsB = await repetitionsFor(b);
  let bestA = Infinity;
  let bestB = Infinity;
  const started = performance.now();
  for (let round = 0; round < ROUNDS; round++) {
    // Always in pairs, never a partial round: an extra sample for one side
    // only would bias the comparison towards whichever got the extra chance.
    bestA = Math.min(bestA, await samplePerRep(a, repsA));
    bestB = Math.min(bestB, await samplePerRep(b, repsB));
    if (performance.now() - started >= SAMPLING_BUDGET_MS * 2) break;
  }
  return [bestA, bestB];
}

/**
 * How much the machine's speed MOVED while a measurement was being taken, as a
 * factor ≥ 1, together with the least-loaded reference unit seen.
 *
 * The last honesty this module needs. Sampling and repetition handle a machine
 * that is uniformly busy; they cannot handle a machine that is fast for the
 * baseline and starved for the subject, which is what happens when three
 * copies of this suite and a build fight over the same cores. The yardstick is
 * therefore timed on BOTH sides of the measurement: if it moved by 4×, the
 * environment — not the code — changed by 4× mid-comparison, and any ratio
 * taken across that window has at least that much slop in it.
 *
 * The ceiling is widened by exactly the drift that was observed, and the
 * failure message says so. On a quiet machine the factor is ~1 and this
 * changes nothing, which is where a real regression gets caught. On a starved
 * one the guard stops pretending it can tell code from contention — the
 * alternative is crying wolf, which is the whole reason this module exists.
 */
interface Yardstick {
  /** The least-loaded reference unit seen — the honest denominator. */
  readonly unitMs: number;
  /** Observed speed drift across the measurement, ≥ 1. */
  readonly instability: number;
}

/** Beyond this, the machine is not a measuring instrument; do not widen further. */
const MAX_INSTABILITY = 20;

function yardstick(beforeMs: number, afterMs: number): Yardstick {
  const drift = Math.max(beforeMs, afterMs) / Math.max(Math.min(beforeMs, afterMs), 0.0001);
  return {
    unitMs: Math.min(beforeMs, afterMs),
    instability: Math.min(Math.max(drift, 1), MAX_INSTABILITY),
  };
}

function instabilityNote(stick: Yardstick): string {
  return stick.instability > 1.25
    ? `\n  NOTE: the machine's own speed moved ${stick.instability.toFixed(1)}× during this` +
        `\n  measurement, so the ceiling was widened by that much. Contention, not code.`
    : '';
}

function detail(subjectMs: number, limitMs: number, basis: string): string {
  return (
    `\n  measured ${subjectMs.toFixed(4)}ms, ceiling ${limitMs.toFixed(4)}ms` +
    `\n  basis: ${basis}` +
    `\n  (fastest of ${ROUNDS} samples of ≥${MIN_SAMPLE_MS}ms each, per repetition,` +
    `\n   measured in this process at this moment — machine load cancels)`
  );
}

/**
 * The subject must cost no more than `units` reference units of CPU.
 *
 * Pass a FUNCTION wherever the subject can be run more than once — it is then
 * sampled like everything else here, and one stolen time slice cannot fail the
 * test. Pass a NUMBER only when the subject genuinely cannot be repeated (a
 * scripted provider consumed by the run, a pause/resume round trip); such a
 * budget is a single sample, so it wants real headroom, and the site says so.
 *
 * @param subject elapsed milliseconds, or the operation to time
 * @param units   how many reference units the operation may cost
 * @param why     the claim being defended, and how `units` was chosen
 */
export async function expectWithinReferenceUnits(
  subject: number | Work,
  units: number,
  why: string,
): Promise<void> {
  const before = referenceUnitMs();
  const subjectMs = typeof subject === 'number' ? subject : await fastest(subject);
  const stick = yardstick(before, referenceUnitMs());
  const limitMs = stick.unitMs * units * stick.instability;
  expect(
    subjectMs,
    `${why}${detail(
      subjectMs,
      limitMs,
      `${units} × ${stick.unitMs.toFixed(3)}ms reference unit`,
    )}${instabilityNote(stick)}`,
  ).toBeLessThan(limitMs);
}

/**
 * The subject must be within `times`× of a baseline measured at the same
 * moment, both sampled alternately.
 *
 * The reference unit floors the denominator, so a sub-millisecond baseline
 * cannot turn timer noise into a ratio explosion — and the floor is itself
 * load-scaled, so nothing here is a fixed millisecond number.
 */
export async function expectWithinTimes(opts: {
  /** The operation under test. */
  subject: Work;
  /** The sibling it must not be much worse than. */
  baseline: Work;
  /** How many times the baseline's cost the subject may cost. */
  times: number;
  /** The claim being defended, and how `times` was chosen. */
  why: string;
}): Promise<void> {
  const before = referenceUnitMs();
  const [baselineMs, subjectMs] = await fastestAlternating(opts.baseline, opts.subject);
  const stick = yardstick(before, referenceUnitMs());
  const denominatorMs = Math.max(baselineMs, stick.unitMs);
  const limitMs = denominatorMs * opts.times * stick.instability;
  expect(
    subjectMs,
    `${opts.why}${detail(
      subjectMs,
      limitMs,
      `${opts.times} × baseline ${baselineMs.toFixed(4)}ms ` +
        `(floored at ${stick.unitMs.toFixed(3)}ms)`,
    )}${instabilityNote(stick)}`,
  ).toBeLessThan(limitMs);
}

/**
 * The same operation at `scale`× the input must not cost more than
 * `scale × slack`× the small run — i.e. the cost curve is (near) linear, not
 * quadratic.
 *
 * `slack` absorbs three things: fixed setup that the small run pays in full
 * and the large run amortises; GC and cache effects; and — the one that
 * decided the default — the uneven tax a contended machine puts on two
 * measurements of different absolute size. A 2ms sample amortises a stolen
 * time slice across many repetitions; a 40ms sample takes it whole. The
 * default of 5 covers that asymmetry and still catches an O(n²) rescan by a
 * wide margin: at scale 10 a quadratic implementation costs 100×, twice the
 * 50× ceiling, while the honest linear implementations measured here sit
 * between 10× and 14×.
 *
 * Both sizes are warmed before either is timed, then sampled alternately —
 * which also disarms the classic false pass, where the small run is served
 * from a cache the large run had to fill.
 *
 * SIZE THE SMALL SIDE SO ONE REPETITION OF IT ALREADY CLEARS
 * {@link MIN_SAMPLE_MS}. Otherwise the small side gets repeated (amortising
 * every stolen time slice across many repetitions) while the large side runs
 * once per sample and takes each theft whole — and the comparison quietly
 * favours the small side on exactly the busy machine this module exists for.
 * Both sides at one repetition each is the regime where the ratio is fair.
 */
export async function expectScalesLinearly(opts: {
  /** The operation at 1/scale of the input. */
  small: Work;
  /** The same operation at the full input. */
  large: Work;
  /** How many times bigger `large`'s input is. */
  scale: number;
  /** Multiplier on top of `scale`. Default 5. */
  slack?: number;
  /** The claim being defended. */
  why: string;
}): Promise<void> {
  const slack = opts.slack ?? 5;
  const before = referenceUnitMs();
  const [smallMs, largeMs] = await fastestAlternating(opts.small, opts.large);
  const stick = yardstick(before, referenceUnitMs());
  const limitMs = Math.max(smallMs, stick.unitMs) * opts.scale * slack * stick.instability;
  expect(
    largeMs,
    `${opts.why}${detail(
      largeMs,
      limitMs,
      `${opts.scale}× input × ${slack}× slack over a ${smallMs.toFixed(4)}ms small run ` +
        `(floored at ${stick.unitMs.toFixed(3)}ms)`,
    )}${instabilityNote(stick)}`,
  ).toBeLessThan(limitMs);
}
