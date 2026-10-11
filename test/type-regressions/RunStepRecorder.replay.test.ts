/** Saved-event replay remains public; the deprecated wrapper and its types do not. */
import { describe, expect, it } from 'vitest';
import { runStepRecorder, type DomainEvent, type RunStep } from '../../src/doors/observe.js';
// @ts-expect-error the standalone replay wrapper is removed
import type { buildRunSteps } from '../../src/doors/observe.js';
// @ts-expect-error pass a drill path directly to getSteps instead
import type { BuildRunStepsOptions } from '../../src/doors/observe.js';
// @ts-expect-error getSteps returns the supported readonly RunStep array
import type { RunStepGraph } from '../../src/doors/observe.js';

const saved: readonly DomainEvent[] = [];
const rec = runStepRecorder();
rec.ingestDomainEvents(saved);
const steps: readonly RunStep[] = rec.getSteps(['__root__']);

describe('public saved-event replay contract', () => {
  it('accepts readonly saved events and exposes the existing step vocabulary', () => {
    expect(steps).toEqual([]);
    expect(typeof rec.ingestDomainEvent).toBe('function');
  });
});
