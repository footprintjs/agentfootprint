// Argument positions are declarations in the installed engine API, not name heuristics.
const regular = { kind: 'stage', name: 0, id: 2, description: 3 };
const branch = { kind: 'stage', name: 1, id: 0, description: 3 };
const mount = {
  kind: 'mount',
  id: 0,
  target: 1,
  mountName: 2,
  description: { at: 3, property: 'description' },
};
const factory = { ...regular, description: { at: 3, property: 'description' } };
const detached = {
  kind: 'mount',
  id: 0,
  target: 1,
  mountName: { at: 2, property: 'mountName' },
  description: { at: 2, property: 'description' },
};
export const METHODS = Object.freeze({
  flowChart: factory,
  flowChartSelector: factory,
  start: regular,
  startSelector: regular,
  addFunction: regular,
  addDeciderFunction: regular,
  addSelectorFunction: regular,
  addPausableFunction: regular,
  addStreamingFunction: { ...regular, description: 4 },
  addFunctionBranch: branch,
  addPausableFunctionBranch: branch,
  addParallelForEach: { kind: 'stage', name: 0, id: 1, description: 3 },
  addListOfFunction: {
    kind: 'stage',
    name: { at: 0, list: true },
    id: { at: 0, list: true },
    description: { at: 0, list: true },
  },
  addRetryLoop: { kind: 'stage', id: 0 },
  addSubFlowChart: mount,
  addSubFlowChartNext: mount,
  addSubFlowChartBranch: mount,
  addLazySubFlowChart: mount,
  addLazySubFlowChartNext: mount,
  addLazySubFlowChartBranch: mount,
  addDetachAndForget: detached,
  addDetachAndJoinLater: detached,
});
export const NOT_A_DECLARATION = new Set([
  'build',
  'end',
  'loopTo',
  'setDefault',
  'tag',
  'setLogger',
  'retry',
  'createTypedScopeFactory',
  'specToStageNode',
]);
export const sourceOrder = (a, b) =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : (a.offset ?? a.line) - (b.offset ?? b.line);
