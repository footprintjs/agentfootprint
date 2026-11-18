import { expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { decideExport } from './index.js';
import type { ContextExportState } from '../chartTypes.js';

it.each([true, false])('takes the declared refusal branch (refused=%s)', async (refused) => {
  type State = ContextExportState & { chosen?: string };
  const chart = flowChart<State>(
    'Fact',
    (s) => {
      s.refused = refused;
    },
    'fact',
  )
    .addDeciderFunction('Disposition', decideExport, 'disposition')
    .addFunctionBranch('refuse', 'Refused', (s) => {
      s.chosen = 'refuse';
    })
    .addFunctionBranch('complete', 'Complete', (s) => {
      s.chosen = 'complete';
    })
    .end()
    .build();
  const record = (await chart.run({})) as { state: State };
  expect(record.state.chosen).toBe(refused ? 'refuse' : 'complete');
});
