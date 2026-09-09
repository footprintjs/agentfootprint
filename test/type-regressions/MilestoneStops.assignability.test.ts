/**
 * Compile-level regression test — `milestoneStops` typed over `Milestone`
 * (9.89.0) is still the 9.88.0 surface.
 *
 * 9.89.0 rewrote `milestoneStops` as `filterStops(commitStops(...), keep)` and
 * typed its stops `Stop<Milestone>`, so `cursor.at()?.meta?.kind` is typed. A
 * 9.88.0 consumer wrote against the bare shapes — `Stop`, `TimeTravelStrategy`,
 * `Stop[]` — and must still compile unchanged. The root `tsconfig.json`
 * EXCLUDES `test/`, so this directory (`npm run test:types`) is the only place
 * a type-level guarantee is actually checked. Hence the file.
 *
 *   1. `milestoneStopsStrategy` is assignable to a bare `TimeTravelStrategy`;
 *   2. `milestoneStops(...)` is assignable to a bare `Stop[]`;
 *   3. `milestoneOf` takes a bare `Stop` — a stop from ANY strategy;
 *   4. and the new part: `meta` on a milestone stop is `Milestone | undefined`.
 */
import { describe, expect, it } from 'vitest';
import type { Stop, TimeTravelStrategy } from 'footprintjs/trace';
import { commitStops } from 'footprintjs/trace';

import {
  milestoneOf,
  milestoneStops,
  milestoneStopsStrategy,
  type Milestone,
} from '../../src/index.js';

// ─── 1. the strategy, where 9.88.0 put it ─────────────────────────
const bareStrategy: TimeTravelStrategy = milestoneStopsStrategy;

// ─── 2. the stops, as 9.88.0 typed them ───────────────────────────
const bareStops: Stop[] = milestoneStops([]);

// ─── 3. milestoneOf over a stop from another strategy ─────────────
const foreign: Stop[] = commitStops([]);
const fromForeign: Milestone | null = foreign[0] ? milestoneOf(foreign[0]) : null;

// ─── 4. the new part is typed ─────────────────────────────────────
const typed = milestoneStops([]);
const meta: Milestone | undefined = typed[0]?.meta;
const kind: Milestone['kind'] | undefined = typed[0]?.meta?.kind;

describe('milestoneStops typing (9.89.0)', () => {
  it('compiles against the 9.88.0 shapes and types the new meta', () => {
    expect(bareStrategy).toBe(milestoneStopsStrategy);
    expect(bareStops).toEqual([]);
    expect(fromForeign).toBeNull();
    expect(meta).toBeUndefined();
    expect(kind).toBeUndefined();
  });
});
