import { expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { completeExport } from './index.js';
import type { ContextExportResult, ContextExportState } from '../chartTypes.js';

it('records counts without filing the actual value record into scope', async () => {
  const result: ContextExportResult = {
    record: {
      format: 'foottrace.value-record.v1',
      valueTable: { private: 'SECRET' },
      record: {
        format: 'agentfootprint.context-recording.v1',
        recording: { private: 'SECRET' },
        calls: [],
        referencePaths: [['snapshot']],
        droppedEvents: 0,
        firstRetainedEventIndex: 0,
      },
    },
  };
  const chart = flowChart<ContextExportState>(
    'Complete',
    completeExport(result),
    'complete',
  ).build();
  const record = (await chart.run({})) as { state: ContextExportState };
  expect(record.state).toMatchObject({ calls: 0, references: 1 });
  expect(JSON.stringify(record)).not.toContain('SECRET');
});
