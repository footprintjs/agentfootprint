import type { ToolResultRowset } from '../../src/index.js';
import type { ToolRowsetCheckedPayload } from '../../src/events/payloads.js';
import type { AgentfootprintEventMap } from '../../src/events.js';

const root: ToolResultRowset = {
  key: 'root',
  columns: { value: 'number' },
  source: { kind: 'inline', path: [] },
};
const published: ToolResultRowset = {
  key: 'stored',
  columns: { value: 'number' },
  source: {
    kind: 'published-dataset',
    refPath: ['dataset', 'ref'],
    artifactKind: 'dataset/rows',
    maxRows: 1000,
    maxBytes: 1048576,
  },
};
const check: ToolRowsetCheckedPayload = {
  toolName: 'read',
  toolCallId: 'c1',
  iteration: 1,
  rowset: 'stored',
  source: 'published-dataset',
  disposition: 'checked-pass',
  reason: 'rows',
  delivery: 'unchanged',
};
const throughPublicMap: AgentfootprintEventMap['agentfootprint.tools.rowset_checked']['payload'] =
  check;
const ambiguous: ToolResultRowset = {
  ...root,
  source: {
    kind: 'inline',
    path: [],
    // @ts-expect-error Inline cannot also claim a published ref.
    refPath: [],
  },
};
const unbounded: ToolResultRowset = {
  ...published,
  // @ts-expect-error Published bindings promise explicit finite workload bounds.
  source: { kind: 'published-dataset', refPath: ['ref'], artifactKind: 'dataset/rows' },
};
const dynamicReason: ToolRowsetCheckedPayload = {
  ...check,
  // @ts-expect-error Reasons are finite native words, never arbitrary error text.
  reason: 'private error text',
};
void [root, published, check, throughPublicMap, ambiguous, unbounded, dynamicReason];
