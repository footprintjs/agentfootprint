/** Native observation retention for chart-backed tools; never executor or privacy authority. */
import type { FlowChartExecutorOptions, RunDials } from 'footprintjs';

/**
 * Native inner-run observation dials shared by both chart-tool adapters.
 * Omitted fields keep the engine defaults. Summary read/write views retain
 * markers instead of values; full commit replay and privacy remain independent.
 * Write summaries also govern the native `onCommit` observation payload.
 */
export type ChartToolObservability = Readonly<
  Pick<RunDials, 'readTracking' | 'writeTracking' | 'commitValues' | 'writeProvenance'>
>;

const VALUES = {
  readTracking: ['full', 'summary', 'off'],
  writeTracking: ['full', 'summary', 'off'],
  commitValues: ['full', 'delta'],
  writeProvenance: ['off', 'reads-prefix'],
} as const satisfies {
  [K in keyof ChartToolObservability]-?: readonly NonNullable<ChartToolObservability[K]>[];
};

/** Admit once at tool definition; own data only, detached from subsequent author mutations. */
export function resolveChartToolObservability(
  value: unknown,
  label: string,
): ChartToolObservability | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => {
    throw new TypeError(
      `${label.slice(
        0,
        160,
      )}: observability requires only supported native observation dials as enumerable plain data.`,
    );
  };
  if (value === null || typeof value !== 'object') return fail();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return fail();
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.hasOwn(VALUES, key)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        return fail();
      if (descriptor.value === undefined) continue;
      const allowed = VALUES[key as keyof ChartToolObservability] as readonly unknown[];
      if (!allowed.includes(descriptor.value)) return fail();
      copy[key] = descriptor.value;
    }
    return Object.keys(copy).length === 0
      ? undefined
      : (Object.freeze(copy) as ChartToolObservability);
  } catch {
    return fail();
  }
}

/** Merge admitted dials with the adapter's internal scope factory, preserving the absent path. */
export function chartToolExecutorOptions(
  resolved: ChartToolObservability | undefined,
  scopeFactory?: FlowChartExecutorOptions['scopeFactory'],
): FlowChartExecutorOptions | undefined {
  if (scopeFactory === undefined) return resolved;
  return { ...resolved, scopeFactory };
}
