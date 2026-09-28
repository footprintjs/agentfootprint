/**
 * The library's doors from the SOURCES, in the shape `bench/results/harness.mjs` takes them —
 * the same names `bench/results/run.mjs` · `loadDoors` imports from the built package, so the
 * suite runs the bench's own harness against the code under test.
 */
import { Agent, absent, defineTool, describedResult } from '../../../src/index.js';
import { anthropic, mock } from '../../../src/doors/providers.js';
import { assessAnswer, recordRun } from '../../../src/doors/observe.js';

export const doors = {
  Agent,
  defineTool,
  absent,
  describedResult,
  mock,
  anthropic,
  recordRun,
  assessAnswer,
};
