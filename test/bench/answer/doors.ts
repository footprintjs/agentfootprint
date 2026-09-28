/**
 * The library's doors from the SOURCES, in the shape `bench/answer/harness.mjs` takes them —
 * the same names `bench/answer/run.mjs` · `loadDoors` imports from the built package, so the
 * suite runs the bench's own harness against the code under test.
 */
import { Agent, absent, coverage, defineTool } from '../../../src/index.js';
import { anthropic, mock } from '../../../src/doors/providers.js';
import { assessAnswer, recordRun } from '../../../src/doors/observe.js';

export const doors = {
  Agent,
  defineTool,
  absent,
  coverage,
  mock,
  anthropic,
  recordRun,
  assessAnswer,
};
