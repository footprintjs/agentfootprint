import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { SeedStageDeps } from './seed.js';

/**
 * The time layer's half of seed — the turn's clock stamp, then the person's
 * words read for time (`./timeLayer.ts` · `stampClock`, `readTimeWords`),
 * filed LAST, after the turn number is final. Loaded through `import()` only
 * when `.time()` armed the agent — the optional-family law of docs-next's
 * site budget — so a plain seed never loads it and stays synchronous.
 */
export function fileTime(scope: TypedScope<AgentState>, deps: SeedStageDeps): void | Promise<void> {
  if (deps.timeClock === undefined && deps.timeReader === undefined) return;
  return import('./timeLayer.js').then((time) => {
    time.stampClock(scope, deps);
    if (!deps.hostDecision) return time.readTimeWords(scope, deps);
  });
}
