import { flowChart } from 'footprintjs';
import { attemptExport } from './attempt/index.js';
import { decideExport } from './decision/index.js';
import { completeExport } from './complete/index.js';
import { refuseExport } from './refuse/index.js';
import type { ContextExportResult, ContextExportState } from './chartTypes.js';
import type { ContextValueRecording } from './types.js';

/** Wiring only. A separate result cell keeps record contents out of the debug log. */
export async function exportContext(
  work: () => Promise<ContextValueRecording>,
): Promise<ContextValueRecording> {
  const result: ContextExportResult = {};
  const chart = flowChart<ContextExportState>(
    'Encode context record',
    attemptExport(work, result),
    'encode-context',
  )
    .addDeciderFunction('Can complete?', decideExport, 'record-disposition')
    .addFunctionBranch('complete', 'Complete record', completeExport(result))
    .addFunctionBranch('refuse', 'Refuse record', refuseExport(result))
    .end()
    .build();
  await chart.run({});
  return result.record!;
}
