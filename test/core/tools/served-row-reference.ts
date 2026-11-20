import type { CommitBundle } from 'foottrace';
import { expect } from 'vitest';
import type { ServedRow } from '../../../src/core/agent/receipt/servedRow.js';

const key = 'sourceLinkServedRows';
type Range = readonly [start: number, end: number];
export type ServedRowAddition = readonly [
  commit: number,
  trace: number,
  verb: 'set' | 'append',
  ranges: readonly Range[],
  bounded?: true,
];

function logOf(record: unknown): readonly CommitBundle[] {
  return (record as { readonly commitLog: readonly CommitBundle[] }).commitLog;
}

/** Capture only the placement and value-free ranges. Whole-record equality checks the rest. */
export function servedRowAdditions(record: unknown): ServedRowAddition[] {
  const additions: ServedRowAddition[] = [];
  for (const [index, bundle] of logOf(record).entries()) {
    const trace = bundle.trace.findIndex((entry) => entry.path === key);
    if (trace === -1) continue;
    const { verb } = bundle.trace[trace]!;
    if (verb !== 'set' && verb !== 'append') throw new Error(`Unexpected served row verb: ${verb}`);
    const rows = bundle.overwrite[key] as readonly ServedRow[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const ranges =
      row.served[0]?.elements?.map(([start, end]) => {
        expect(
          Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start,
        ).toBe(true);
        return [start, end] as const;
      }) ?? [];
    additions.push(
      row.bounded === true ? [index, trace, verb, ranges, true] : [index, trace, verb, ranges],
    );
  }
  return additions;
}

/** Insert exactly the served row and its native trace at a pinned call commit. */
export function withServedRowAdditions<T>(record: T, additions: readonly ServedRowAddition[]): T {
  const log = logOf(record);
  for (const [index, trace, verb, ranges, bounded] of additions) {
    const bundle = log[index];
    expect(bundle?.stageId).toBe('call-llm');
    expect(Object.hasOwn(bundle!.overwrite, key)).toBe(false);
    expect(bundle!.trace.some((entry) => entry.path === key)).toBe(false);
    expect(trace).toBeGreaterThanOrEqual(0);
    expect(trace).toBeLessThanOrEqual(bundle!.trace.length);
    const row: ServedRow = {
      kind: 'served',
      version: 1,
      consumer: bundle!.runtimeStageId,
      served: ranges.length > 0 ? [{ key: 'history', elements: ranges }] : [],
      ...(bounded === true && { bounded }),
    };
    bundle!.overwrite[key] = [row];
    bundle!.trace.splice(trace, 0, { path: key, verb });
  }
  return record;
}

export function servedRowReferenceText(cases: Record<string, ServedRowAddition[]>): string {
  const entries = Object.keys(cases)
    .sort()
    .map((name) => {
      const lines = cases[name]!.map((addition) => `    ${JSON.stringify(addition)}`);
      return `  ${JSON.stringify(name)}: [\n${lines.join(',\n')}\n  ]`;
    });
  return `{\n${entries.join(',\n')}\n}\n`;
}
