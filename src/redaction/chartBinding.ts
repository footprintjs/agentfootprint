/**
 * chartBinding — every stage of a runner's chart knows its runner, so a chart
 * mounted into an executor the app built still serves its events under the
 * policy the runner declares.
 *
 * Pattern: a decorator over a built chart's stage functions, applied ONCE when
 *          the runner builds its chart (`RunnerBase · initChart`).
 * Role:    the Map half of `src/redaction/`, for the one door that runs a
 *          runner's stages without the runner: `getSpec()` mounted with
 *          footprintjs's own `addSubFlowChart*` and executed by the app's own
 *          `FlowChartExecutor`. footprintjs hands a mounted chart's stages the
 *          PARENT executor's scopes, so no run of this library made them — and
 *          a typed event's payload is served at its source only through a
 *          scope a run made (`runRedaction.ts` · `emitServed`). Without this
 *          binding such a stage would emit raw, its runner's `redact` dropped
 *          in silence.
 *
 * Each stage function (and a pausable stage's `resumeFn`) is wrapped so that,
 * as the stage starts, its scope is tied to the runner's declared policy WHEN
 * no run tied it already (`adoptScopeOutsideRun`). In the runner's own runs —
 * and in a composition that mounts it — every scope is already tied to the
 * run, and the binding does nothing. A runner that declares no policy is
 * byte-identical to before.
 *
 * What it does not reach: a mounted chart's STATE belongs to the app's
 * executor (its commit log and snapshot follow that executor's own policy —
 * footprintjs's law), and a stage built at run time (a dynamic `StageNode`
 * return) is not part of the chart that was bound. Named in
 * `src/redaction/README.md`.
 */

import type { FlowChart } from 'footprintjs';

type StageFn = (scope: unknown, ...rest: unknown[]) => unknown;

/** A chart-shaped value: the built chart, or a mounted subflow's definition. */
interface ChartLike {
  readonly root?: unknown;
  readonly stageMap?: Map<string, unknown>;
  readonly subflows?: Record<string, { readonly root?: unknown }>;
}

/** The node fields this binding reads or replaces — a structural view of footprintjs's `StageNode`. */
interface NodeLike {
  isLoopRef?: boolean;
  fn?: unknown;
  resumeFn?: unknown;
  next?: unknown;
  children?: readonly unknown[];
  subflowDef?: ChartLike;
  subflowResolver?: () => ChartLike;
}

/**
 * Bind every stage of `chart` — its nodes, its stage map, its mounted
 * subflows (eager and lazy) — so each stage calls `adopt(scope)` before it
 * runs. One twin per stage function, so a function the chart holds in two
 * places (a node and the stage map) stays one function — footprintjs's mount
 * guards compare them by identity.
 */
export function bindChartStages(chart: FlowChart, adopt: (scope: unknown) => void): void {
  const twins = new Map<StageFn, StageFn>();
  const twin = (fn: StageFn): StageFn => {
    const known = twins.get(fn);
    if (known !== undefined) return known;
    const bound: StageFn = function boundStage(this: unknown, scope, ...rest) {
      adopt(scope);
      return fn.call(this, scope, ...rest);
    };
    Object.defineProperty(bound, 'name', { value: fn.name, configurable: true });
    twins.set(fn, bound);
    twins.set(bound, bound);
    return bound;
  };

  // Weak: a lazy subflow resolves a fresh definition at run time.
  const seen = new WeakSet<object>();
  const visitNode = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const node = value as NodeLike;
    // A loop's back-edge stub is a reference to a node visited elsewhere.
    if (node.isLoopRef === true) return;
    if (typeof node.fn === 'function') node.fn = twin(node.fn as StageFn);
    if (typeof node.resumeFn === 'function') node.resumeFn = twin(node.resumeFn as StageFn);
    visitNode(node.next);
    for (const child of node.children ?? []) visitNode(child);
    if (node.subflowDef !== undefined) visitChart(node.subflowDef);
    if (typeof node.subflowResolver === 'function') {
      const resolve = node.subflowResolver;
      node.subflowResolver = () => {
        const def = resolve();
        visitChart(def);
        return def;
      };
    }
  };
  const visitChart = (def: ChartLike): void => {
    visitNode(def.root);
    const map = def.stageMap;
    if (map instanceof Map) {
      for (const [id, fn] of map) {
        if (typeof fn === 'function') map.set(id, twin(fn as StageFn));
      }
    }
    for (const sub of Object.values(def.subflows ?? {})) visitNode(sub.root);
  };
  visitChart(chart as unknown as ChartLike);
}
