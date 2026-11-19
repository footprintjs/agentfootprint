export type StoryStep = {
  id: string;
  label: string;
  title: string;
  description: string;
  owner: string;
  takeaway: string;
  /** Authored teaching projection. Recorded answer excerpts come from the saved run. */
  context: Record<string, unknown>;
};

const question = 'Which selected nodes have the highest reported P95 latency?';
const selection = {
  cluster: 'demo-a',
  window: '2026-09-11T14:00:00Z / 2026-09-11T15:00:00Z',
  revision: 3,
  filter: { field: 'nodes.p95_us', between: [1000, 2000] },
};
const source = {
  ref: 'nodes@v1',
  measure: 'nodes.p95_us',
  unit: 'microseconds',
  grain: 'one reported node summary per source window',
  unknown: 'excluded, never treated as zero',
};
const coverage = {
  checked: 'retained node summaries in this selection',
  cannotCover: 'causal explanation of latency',
};
const prepared = { question, selection, source, coverage };
const finding = {
  ref: 'finding:highest-p95@3',
  sourceRef: 'nodes@v1',
  selectionRevision: 3,
  nodeIds: ['11', '13'],
  maximum: 1500,
  unit: 'microseconds',
  matchedRows: 2,
  ties: 'retained',
};

export const answerSteps: readonly StoryStep[] = [
  {
    id: 'question',
    label: 'Question',
    title: 'Start with the question.',
    description:
      'The application starts with a question about selected nodes. The Run start excerpt is empty.',
    owner: 'Application',
    takeaway: 'Route 1 records the question alongside the tool request.',
    context: {},
  },
  {
    id: 'selection',
    label: 'Scope',
    title: 'The model requests scoped summaries.',
    description:
      'At Route 1, the mock model requests node_summaries with cluster demo-a, the one-hour window, revision 3 and the P95 filter.',
    owner: 'Mock provider',
    takeaway: 'The tool arguments specify which selection the question refers to.',
    context: { question, selection },
  },
  {
    id: 'reference',
    label: 'Reference',
    title: 'The tool returns the source and rows.',
    description:
      'Tool call 1 returns the nodes@v1 source metadata and all four rows, for nodes 11–14.',
    owner: 'Mock node_summaries tool',
    takeaway: 'The source describes the unit and grain. Node 14’s P95 is unknown.',
    context: { question, selection, source },
  },
  {
    id: 'prepare',
    label: 'Prepare',
    title: 'The next iteration carries the tool result.',
    description:
      'Iteration 2 carries forward the previous node_summaries result, including all four rows.',
    owner: 'AgentFootprint tool loop',
    takeaway: 'The next model call has the returned summaries and their source metadata.',
    context: {
      ...prepared,
      availableOperation: 'rank selected rows; keep ties',
      assertionCheck: 'no conflict in supplied comparable assertions',
    },
  },
  {
    id: 'model',
    label: 'Model',
    title: 'The mock model proposes a finding.',
    description:
      'At Route 2, the mock provider supplies a structured finding that names nodes 11 and 13, the source reference and the selection revision.',
    owner: 'Mock provider',
    takeaway: 'Both nodes report the same P95 of 1,500 microseconds.',
    context: {
      ...prepared,
      proposedCall: {
        operation: 'rank',
        dataRef: 'nodes@v1',
        selectionRevision: 3,
        field: 'p95_us',
        order: 'descending',
        keepTies: true,
      },
    },
  },
  {
    id: 'finding',
    label: 'Checks',
    title: 'The proposed finding passes three checks.',
    description:
      'Answer 1 reports that the source reference matches, the proposed maximum appears in a retained row, and the selection revision matches.',
    owner: 'Configured answer validator',
    takeaway: 'These three field checks define the scope of the validation report.',
    context: {
      question,
      selection,
      finding,
      coverage,
      answerContract: 'select a current finding reference',
    },
  },
  {
    id: 'answer',
    label: 'Answer',
    title: 'The run ends with the checked finding.',
    description:
      'After the checks pass, Run end records the structured finding proposed at Route 2.',
    owner: 'AgentFootprint run recorder',
    takeaway: 'The saved output is the finding JSON. The cause of the latency remains unknown.',
    context: {
      selectedFindingRef: finding.ref,
      validation: 'passed configured scope and reference checks',
      rendered: 'Nodes 11 and 13 tie at 1.5 ms in this selection.',
      limitation: coverage.cannotCover,
    },
  },
];

const identity = {
  scope: 'demo-org/demo-conversation',
  snapshot: 'snapshot-7',
  table: 'nodes',
  row: '11',
  selectionRevision: 3,
  window: 'window-7',
  field: 'p95_us',
  unit: 'microseconds',
  grain: 'node/window-rollup',
};
export const conflictSteps: readonly StoryStep[] = [
  {
    id: 'same-claim',
    label: 'Identity',
    title: 'First, ask: is this the same claim?',
    description:
      'A retained record says 1,150 microseconds. A faulty prepared summary says 1,500. The adapter identifies both as the same node, measure, window and snapshot.',
    owner: 'Adapter declares comparable identity',
    takeaway: 'Different windows or units are not automatically contradictory.',
    context: { identity, retainedRecord: 1150, preparedSummary: 1500 },
  },
  {
    id: 'conflict',
    label: 'Conflict',
    title: 'Name the disagreement.',
    description:
      'ContextFootprint compares the supplied assertions and returns the conflicting pair. It does not decide which source is correct.',
    owner: 'ContextFootprint',
    takeaway: 'A visible disagreement is useful evidence for the host’s next action.',
    context: {
      identity,
      conflicts: [{ retainedRecord: 1150, preparedSummary: 1500 }],
      decision: 'left to host policy',
    },
  },
  {
    id: 'pause',
    label: 'Pause',
    title: 'Pause before sending mixed facts.',
    description:
      'In this example, the configured host policy pauses the factual model call. It re-reads the authorized record because the summary was derived from that record.',
    owner: 'Configured host policy',
    takeaway:
      'The host investigates the faulty projection. It does not silently pick the newest value.',
    context: {
      identity,
      hostState: 'factual model call paused',
      nextAction: 're-resolve authorized retained record',
      audit: 'keep the conflicting summary in diagnostics',
    },
  },
  {
    id: 'repair',
    label: 'Rebuild',
    title: 'Repair the context, keep the evidence.',
    description:
      'The host rebuilds the summary as 1,150 microseconds. A second comparison finds no conflict for this claim. The original record stays unchanged.',
    owner: 'Host repair + ContextFootprint comparison',
    takeaway: 'Only the corrected finding and its limits need to reach the model.',
    context: {
      identity,
      finding: { ref: 'fact:demo-node-11-p95', value: 1150 },
      assertionCheck: 'no conflict for this claim',
      coverage: 'retained node summary; cause unknown',
    },
  },
  {
    id: 'check-output',
    label: 'Check reply',
    title: 'Check the proposed answer, too.',
    description:
      'Suppose a draft selects the right reference but copies 1,500. The host’s structured answer check catches the mismatch before presenting that value.',
    owner: 'Opt-in answerValidation + host rules',
    takeaway:
      'This checks a structured claim against a result. It is not a universal fact-checker for prose.',
    context: {
      candidate: { ref: 'fact:demo-node-11-p95', reportedP95Us: 1500 },
      authorizedValue: 1150,
      validation: 'mismatch; do not deliver this value',
    },
  },
  {
    id: 'checked-answer',
    label: 'Deliver',
    title: 'Let the stored fact supply the number.',
    description:
      'The example host allows one repair attempt. The model returns the current finding reference, and the renderer supplies 1,150 microseconds from the stored result.',
    owner: 'Host-controlled repair + renderer',
    takeaway:
      'If repair fails, explain the limitation. Do not retry indefinitely or invent an answer.',
    context: {
      candidate: { ref: 'fact:demo-node-11-p95' },
      validation: 'passed configured checks',
      rendered: 'Node 11 reports 1.15 ms in this source window.',
      cannotConclude: 'the cause of its latency',
    },
  },
];
