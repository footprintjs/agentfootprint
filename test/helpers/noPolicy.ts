/**
 * Scopes of a run positively covered by NO policy — for tests that drive stage
 * code outside a runner: a fake scope, or a library chart in a bare executor.
 *
 * A scope nothing tied is a run whose state is UNKNOWN, and its typed events
 * are refused (`src/redaction/runRedaction.ts` · `emitServed`, fail closed). A
 * test that wants the payload as made says, as a runner would when it opens a
 * run without a policy, that the run had none (`redaction/coverage.ts` ·
 * `DECLARED_NONE`).
 */
import { FlowChartExecutor, type FlowChart, type ScopeFactory } from 'footprintjs';
import { createTypedScopeFactory } from 'footprintjs/advanced';

import { DECLARED_NONE } from '../../src/redaction/coverage.js';
import { adoptScopeOutsideRun, outsideRunFor } from '../../src/redaction/runRedaction.js';

const NO_POLICY = outsideRunFor(DECLARED_NONE);

/** `scope`, tied to a run covered by no policy — its events are served as made. */
export function noPolicyScope<S extends object>(scope: S): S {
  adoptScopeOutsideRun(scope, NO_POLICY);
  return scope;
}

/** A scope factory for `chart` in a bare executor: every scope it makes is a no-policy run's. */
export function noPolicyScopeFactory(chart: FlowChart): ScopeFactory {
  const base: ScopeFactory = chart.scopeFactory ?? createTypedScopeFactory();
  return (context, stageName, readOnlyContext, executionEnv) => {
    const scope = base(context, stageName, readOnlyContext, executionEnv);
    if (scope !== null && typeof scope === 'object') noPolicyScope(scope as object);
    return scope;
  };
}

/** A bare executor for `chart` whose every scope is a no-policy run's. */
export function noPolicyExecutor(
  chart: FlowChart,
  options: Omit<
    NonNullable<ConstructorParameters<typeof FlowChartExecutor>[1]>,
    'scopeFactory'
  > = {},
): FlowChartExecutor {
  return new FlowChartExecutor(chart, { ...options, scopeFactory: noPolicyScopeFactory(chart) });
}
