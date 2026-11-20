import { splitStageId } from 'foottrace';
import { FlowChartBuilder, getSubtreeSnapshot } from 'footprintjs';
import type { StageSnapshot } from 'footprintjs/advanced';
import { vi } from 'vitest';
import { countArrayReads } from './inputWork.js';

/** Count native executions of one stage across all visits to its subflow. */
export function countMountedStageRuns(
  snapshot: Parameters<typeof getSubtreeSnapshot>[0],
  mountId: string,
  stageId: string,
): number {
  function count(root: StageSnapshot | undefined, id: string): number {
    if (root === undefined) return 0;
    const { localStageId } = splitStageId(root.id);
    const here = localStageId === id ? 1 : 0;
    const children = (root.children ?? []).reduce((sum, child) => sum + count(child, id), 0);
    return here + children + count(root.next, id);
  }
  function mounts(root: StageSnapshot | undefined): number {
    if (root === undefined) return 0;
    const here =
      root.subflowId === mountId && root.runtimeStageId !== undefined
        ? count(getSubtreeSnapshot(snapshot, root.runtimeStageId)?.executionTree, stageId)
        : 0;
    const children = (root.children ?? []).reduce((sum, child) => sum + mounts(child), 0);
    return here + children + mounts(root.next);
  }
  return mounts(snapshot.executionTree);
}

/** Observe indexed reads of parent rows by the real mappers of one named mount. */
export function observeMountRowReads(mountId: string) {
  const rows = { findingsLedger: 0, coverageDeclared: 0 };
  function measure<T>(
    parent: Record<string, unknown>,
    map: (parent: Record<string, unknown>) => T,
  ) {
    const probes: { key: keyof typeof rows; reads: () => number }[] = [];
    const observed = new Proxy(parent, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if ((key !== 'findingsLedger' && key !== 'coverageDeclared') || !Array.isArray(value)) {
          return value;
        }
        const probe = countArrayReads(value);
        probes.push({ key, reads: probe.reads });
        return probe.input;
      },
    });
    try {
      return map(observed);
    } finally {
      for (const probe of probes) rows[probe.key] += probe.reads();
    }
  }

  const mountNext = FlowChartBuilder.prototype.addSubFlowChartNext;
  const spy = vi
    .spyOn(FlowChartBuilder.prototype, 'addSubFlowChartNext')
    .mockImplementation(function (this: FlowChartBuilder, id, chart, name, options) {
      const input = options?.inputMapper;
      const output = options?.outputMapper;
      return mountNext.call(
        this,
        id,
        chart,
        name,
        id === mountId
          ? {
              ...options,
              ...(input !== undefined && {
                inputMapper: (parent, binding) => measure(parent, (scope) => input(scope, binding)),
              }),
              ...(output !== undefined && {
                outputMapper: (child, parent, binding) =>
                  measure(parent, (scope) => output(child, scope, binding)),
              }),
            }
          : options,
      );
    });
  return { reads: () => ({ ...rows }), restore: () => spy.mockRestore() };
}
