/**
 * The compaction meter's readings EXPIRE (8.14.0).
 *
 * `compactionMeter` answers one question for the window stage: "how big was
 * the last window, as the PROVIDER counted it?" Through 8.13.0 it answered
 * with whatever it had last heard — forever. A provider that reported usage on
 * call #1 and then stopped (a proxy that drops the field, an
 * OpenAI-compatible endpoint that omits it while streaming, a flaky gateway)
 * left that first number standing, and every later window decision was made
 * on it. Messages were evicted on a count nobody had taken, which is the exact
 * opposite of the promise this instrument exists to keep: **counted, never
 * guessed.**
 *
 * The fix is a stamp, not a heuristic. Each reading records the iteration whose
 * call produced it, and `lastCall(n)` hands it back only while it is still the
 * newest thing there is. Otherwise it answers `undefined` — an ABSENT number,
 * which every strategy already knows how to refuse to act on.
 */

import { describe, expect, it } from 'vitest';

import { compactionMeter } from '../../src/recorders/core/CompactionMeter.js';
import type { EmitEvent } from 'footprintjs';

function llmEnd(iteration: number, usage: unknown): EmitEvent {
  return {
    name: 'agentfootprint.stream.llm_end',
    payload: { iteration, usage },
    runtimeStageId: `call-llm#${iteration}`,
  } as unknown as EmitEvent;
}

describe('compactionMeter — a reading is current, or it is not there', () => {
  it('a fresh reading is returned for the iteration that follows its call', () => {
    const meter = compactionMeter();
    meter.onEmit(llmEnd(1, { input: 900, output: 10 }));
    // The window stage runs at the loop head: at iteration 2 the last
    // completed call was made during iteration 1.
    expect(meter.lastCall(2)?.input).toBe(900);
    expect(meter.lastCall(2)?.meteredAtIteration).toBe(1);
  });

  it('the SAME reading is gone one iteration later', () => {
    const meter = compactionMeter();
    meter.onEmit(llmEnd(1, { input: 900, output: 10 }));
    expect(meter.lastCall(2)).toBeDefined();
    // Nothing new arrived, so at iteration 3 the newest call reported nothing.
    // 900 is not a smaller answer or an older answer — it is not an answer.
    expect(meter.lastCall(3)).toBeUndefined();
  });

  it('a fresh reading each iteration keeps answering, indefinitely', () => {
    const meter = compactionMeter();
    for (let i = 1; i <= 25; i++) {
      meter.onEmit(llmEnd(i, { input: 100 * i, output: 1 }));
      expect(meter.lastCall(i + 1)?.input).toBe(100 * i);
    }
    expect(meter.unmeteredSinceLastGood()).toBe(0);
  });

  it('malformed usage does NOT overwrite a good reading — and does not preserve it either', () => {
    const meter = compactionMeter();
    meter.onEmit(llmEnd(1, { input: 900, output: 10 }));
    meter.onEmit(llmEnd(2, { input: undefined, output: undefined }));
    // Still the real number at the boundary it was taken for…
    expect(meter.lastCall(2)?.input).toBe(900);
    // …and absent at the next one, because call #2 counted nothing.
    expect(meter.lastCall(3)).toBeUndefined();
    expect(meter.unmeteredSinceLastGood()).toBe(1);
  });

  it('counts every uncounted call so the stage can say so once', () => {
    const meter = compactionMeter();
    meter.onEmit(llmEnd(1, { input: 900, output: 10 }));
    for (let i = 2; i <= 6; i++) meter.onEmit(llmEnd(i, {}));
    expect(meter.unmeteredSinceLastGood()).toBe(5);
    // A good reading resets it: the provider started counting again.
    meter.onEmit(llmEnd(7, { input: 42, output: 1 }));
    expect(meter.unmeteredSinceLastGood()).toBe(0);
    expect(meter.lastCall(8)?.input).toBe(42);
  });

  it('a reading that cannot say WHEN it was taken is not taken at all', () => {
    const meter = compactionMeter();
    // `LLMEndPayload.iteration` is required, so this shape is not one this
    // build produces — but an unstampable reading can never be checked for
    // staleness, and a number that can never expire is the original bug.
    meter.onEmit({
      name: 'agentfootprint.stream.llm_end',
      payload: { usage: { input: 5000, output: 1 } },
      runtimeStageId: 'call-llm#1',
    } as unknown as EmitEvent);
    expect(meter.lastCall(2)).toBeUndefined();
    expect(meter.unmeteredSinceLastGood()).toBe(1);
  });

  it('clear() forgets the reading AND the uncounted tally', () => {
    const meter = compactionMeter();
    meter.onEmit(llmEnd(1, { input: 900, output: 10 }));
    meter.onEmit(llmEnd(2, {}));
    meter.clear();
    expect(meter.lastCall(2)).toBeUndefined();
    expect(meter.unmeteredSinceLastGood()).toBe(0);
  });

  it('ignores events that are not llm_end', () => {
    const meter = compactionMeter();
    meter.onEmit({
      name: 'agentfootprint.stream.llm_start',
      payload: { iteration: 1, usage: { input: 9, output: 9 } },
      runtimeStageId: 'call-llm#1',
    } as unknown as EmitEvent);
    expect(meter.lastCall(2)).toBeUndefined();
    expect(meter.unmeteredSinceLastGood()).toBe(0);
  });
});
