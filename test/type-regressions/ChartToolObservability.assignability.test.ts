/** Public chart-tool options reuse the native four-dial port without executor or privacy authority. */
import { expect, it } from 'vitest';
import type { RunDials } from 'footprintjs';
import {
  verdictRowsOf,
  type ChartToolObservability,
  type FlowchartAsToolOptions,
  type RunbookAsToolOptions,
  type VerdictRow,
} from '../../src/index.js';

type Native = Readonly<
  Pick<RunDials, 'readTracking' | 'writeTracking' | 'commitValues' | 'writeProvenance'>
>;
type Same<A, B> = [A, B] extends [B, A] ? true : never;
const nativePort: Same<ChartToolObservability, Native> = true;
const flowchartPort: Same<
  FlowchartAsToolOptions['observability'],
  ChartToolObservability | undefined
> = true;
const runbookPort: Same<RunbookAsToolOptions['observability'], ChartToolObservability | undefined> =
  true;
void nativePort;
void flowchartPort;
void runbookPort;

const legal: ChartToolObservability = {
  readTracking: 'summary',
  writeTracking: 'summary',
  commitValues: 'full',
  writeProvenance: 'reads-prefix',
};
// @ts-expect-error this is an immutable authored profile
legal.readTracking = 'off';
// @ts-expect-error privacy remains the existing independently governed option
const privacy: ChartToolObservability = { redact: { keys: ['secret'] } };
// @ts-expect-error no scope/executor replacement capability
const factory: ChartToolObservability = { scopeFactory: () => ({}) };
// @ts-expect-error callback options are not native observation dials
const callback: ChartToolObservability = { callback: () => undefined };
// @ts-expect-error invalid native read-retention enum
const read: ChartToolObservability = { readTracking: 'tiny' };
// @ts-expect-error summaries do not replace replay commit values
const commit: ChartToolObservability = { commitValues: 'summary' };
void privacy;
void factory;
void callback;
void read;
void commit;

it('keeps the legacy public row helper assignable and filtering behavior unchanged', () => {
  const rows: VerdictRow[] = verdictRowsOf({
    verdicts: [{ subject: 'public-17', verdict: 'healthy' }, null],
  });
  expect(rows).toEqual([{ subject: 'public-17', verdict: 'healthy' }]);
});
